/**
 * Web tool (gateway-native): unified interface for web search/extract/crawl.
 *
 * Phase 1 implementation: Tavily only.
 *
 * Design goal:
 * - Keep the model-facing schema stable (mode: search|extract|crawl)
 * - Normalize provider-specific responses into a compact, model-friendly payload
 */

import type { ToolAccessMode } from "../policy.js";
import type { ToolSafetyCheck } from "../approvalFlow.js";

export const WEB_TOOL_SCHEMA: any = {
  type: "object",
  additionalProperties: true,
  properties: {
    provider: {
      type: "string",
      enum: ["tavily"],
      default: "tavily",
      description: "Web provider."
    },
    mode: {
      type: "string",
      enum: ["search", "extract", "crawl"],
      default: "search",
      description:
        "Operation mode. search: return per-URL summaries + links. extract: fetch and return page content for given URL(s). crawl: traverse a site and return extracted content for discovered pages."
    },

    // Shared-ish fields
    query: { type: "string", description: "Search query (mode=search)." },
    url: { type: "string", description: "Single URL (mode=extract/crawl)." },
    urls: { type: "array", items: { type: "string" }, description: "List of URLs (mode=extract)." },

    // Search options (Tavily compatible)
    max_results: { type: "integer", minimum: 1, maximum: 20, description: "Max search results (mode=search)." },
    search_depth: {
      type: "string",
      enum: ["basic", "advanced", "fast", "ultra-fast"],
      description: "Search depth."
    },
    time_range: {
      type: "string",
      enum: ["day", "week", "month", "year", "d", "w", "m", "y"],
      description: "Time filter."
    },
    start_date: { type: "string", description: "Start date YYYY-MM-DD." },
    end_date: { type: "string", description: "End date YYYY-MM-DD." },
    // Extract/Crawl options (Tavily compatible)
    extract_depth: { type: "string", enum: ["basic", "advanced"], description: "Extraction depth." },
    format: { type: "string", enum: ["markdown", "text"], description: "Extraction format." },
    instructions: { type: "string", description: "Natural language crawl instructions." },
    max_depth: { type: "integer", minimum: 1, maximum: 5, description: "Crawl max depth." },
    max_breadth: { type: "integer", minimum: 1, maximum: 500, description: "Crawl max breadth." },
    limit: { type: "integer", minimum: 1, description: "Crawl page limit." },
    timeout: { type: "number", description: "Provider timeout." },
    // Output shaping (gateway-side)
    max_chars_per_content: {
      type: "integer",
      minimum: 500,
      maximum: 200000,
      description: "Truncate each document's extracted content to this many characters (gateway-side)."
    },
    max_total_chars: {
      type: "integer",
      minimum: 1000,
      maximum: 500000,
      description: "Truncate total extracted content across all results (gateway-side)."
    }
  }
};

export type WebToolMode = "search" | "extract" | "crawl";
export type WebProviderId = "tavily";

export type NormalizedWebToolArgs = {
  provider: WebProviderId;
  mode: WebToolMode;

  // Search
  query?: string;
  max_results?: number;
  search_depth?: "basic" | "advanced" | "fast" | "ultra-fast";
  time_range?: "day" | "week" | "month" | "year" | "d" | "w" | "m" | "y";
  start_date?: string;
  end_date?: string;

  // Extract/Crawl
  url?: string;
  urls?: string[];
  extract_depth?: "basic" | "advanced";
  format?: "markdown" | "text";
  instructions?: string;
  max_depth?: number;
  max_breadth?: number;
  limit?: number;
  timeout?: number;

  // Output shaping
  max_chars_per_content?: number;
  max_total_chars?: number;
};

function coerceNonEmptyString(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

function coerceBoolean(v: unknown): boolean | undefined {
  if (v === true || v === false) return v;
  if (typeof v === "string") {
    const s = v.trim().toLowerCase();
    if (s === "true" || s === "1" || s === "yes") return true;
    if (s === "false" || s === "0" || s === "no") return false;
  }
  return undefined;
}

function coerceInt(v: unknown): number | undefined {
  if (typeof v === "number" && Number.isFinite(v)) return Math.trunc(v);
  if (typeof v === "string" && v.trim()) {
    const n = Number(v);
    if (Number.isFinite(n)) return Math.trunc(n);
  }
  return undefined;
}

function clampInt(v: unknown, min: number, max: number): number | undefined {
  const n = coerceInt(v);
  if (n === undefined) return undefined;
  if (n < min) return min;
  if (n > max) return max;
  return n;
}

function coerceNumber(v: unknown): number | undefined {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim()) {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return undefined;
}

function coerceStringArray(v: unknown): string[] | undefined {
  if (!Array.isArray(v)) return undefined;
  const out: string[] = [];
  for (const x of v) {
    const s = coerceNonEmptyString(x);
    if (s) out.push(s);
  }
  return out.length ? out : undefined;
}

function coerceEnum<T extends string>(v: unknown, allowed: readonly T[]): T | undefined {
  const s = coerceNonEmptyString(v);
  return (allowed as readonly string[]).includes(s) ? (s as T) : undefined;
}

export function parseWebArgs(raw: unknown): NormalizedWebToolArgs {
  const obj = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as any) : {};

  const provider = (coerceEnum(obj.provider, ["tavily"] as const) ?? "tavily") as WebProviderId;
  const mode = (coerceEnum(obj.mode, ["search", "extract", "crawl"] as const) ?? "search") as WebToolMode;

  const urlsFromSingle = coerceNonEmptyString(obj.url);
  const urlsList = coerceStringArray(obj.urls);
  const urls = urlsList ?? (urlsFromSingle ? [urlsFromSingle] : undefined);

  return {
    provider,
    mode,

    query: coerceNonEmptyString(obj.query) || coerceNonEmptyString(obj.q) || undefined,
    max_results: clampInt(obj.max_results ?? obj.maxResults, 1, 20),
    search_depth: coerceEnum(obj.search_depth ?? obj.searchDepth, ["basic", "advanced", "fast", "ultra-fast"] as const),
    time_range: coerceEnum(obj.time_range ?? obj.timeRange, ["day", "week", "month", "year", "d", "w", "m", "y"] as const),
    start_date: coerceNonEmptyString(obj.start_date ?? obj.startDate) || undefined,
    end_date: coerceNonEmptyString(obj.end_date ?? obj.endDate) || undefined,
    url: urlsFromSingle || undefined,
    urls,
    extract_depth: coerceEnum(obj.extract_depth ?? obj.extractDepth, ["basic", "advanced"] as const),
    format: coerceEnum(obj.format, ["markdown", "text"] as const),
    instructions: coerceNonEmptyString(obj.instructions) || undefined,
    max_depth: clampInt(obj.max_depth ?? obj.maxDepth, 1, 5),
    max_breadth: clampInt(obj.max_breadth ?? obj.maxBreadth, 1, 500),
    limit: coerceInt(obj.limit),
    timeout: coerceNumber(obj.timeout),
    max_chars_per_content: clampInt(obj.max_chars_per_content ?? obj.maxCharsPerContent, 500, 200_000),
    max_total_chars: clampInt(obj.max_total_chars ?? obj.maxTotalChars, 1_000, 500_000)
  };
}

/**
 * Safe-mode policy for web access:
 * - search: allowed without approval (summary-only)
 * - extract/crawl: require approval (fetches full content)
 */
export function checkWebNeedsApproval(parsed: NormalizedWebToolArgs, mode: ToolAccessMode): ToolSafetyCheck {
  if (mode !== "safe") return { requireApproval: false, reason: "full_mode" };
  if (parsed.mode === "search") return { requireApproval: false, reason: "safe_search" };
  return { requireApproval: true, reason: `safe_${parsed.mode}` };
}

type TavilyAuth = { apiKey: string; projectId?: string };

function getPath(obj: any, path: string[]): any {
  let cur = obj;
  for (const k of path) {
    if (!cur || typeof cur !== "object") return undefined;
    cur = (cur as any)[k];
  }
  return cur;
}

export function resolveTavilyAuth(rawConfig?: any): TavilyAuth | null {
  const envKey = coerceNonEmptyString(process.env.TAVILY_API_KEY) || coerceNonEmptyString(process.env.ECLIA_TAVILY_API_KEY);

  // Preferred: profile-based config.
  const toolsWeb = (rawConfig as any)?.tools?.web;
  const profiles = Array.isArray(toolsWeb?.profiles) ? (toolsWeb.profiles as any[]) : null;
  const activeId = coerceNonEmptyString(toolsWeb?.active_profile);
  const activeProfile =
    profiles?.find((p) => coerceNonEmptyString(p?.id) === activeId) ??
    profiles?.find((p) => coerceNonEmptyString(p?.provider) === "tavily") ??
    profiles?.[0];

  const cfgKeyProfile = coerceNonEmptyString(activeProfile?.api_key);

  const cfgKey =
    cfgKeyProfile ||
    coerceNonEmptyString(getPath(rawConfig, ["tools", "web", "tavily", "api_key"])) ||
    coerceNonEmptyString(getPath(rawConfig, ["tools", "tavily", "api_key"])) ||
    coerceNonEmptyString(getPath(rawConfig, ["tavily", "api_key"])) ||
    coerceNonEmptyString((rawConfig as any)?.tavily_api_key);

  const apiKey = envKey || cfgKey;
  if (!apiKey) return null;

  const projectId =
    coerceNonEmptyString(process.env.TAVILY_PROJECT) ||
    coerceNonEmptyString(process.env.ECLIA_TAVILY_PROJECT) ||
    coerceNonEmptyString(activeProfile?.project_id) ||
    coerceNonEmptyString(getPath(rawConfig, ["tools", "web", "tavily", "project_id"])) ||
    coerceNonEmptyString(getPath(rawConfig, ["tools", "tavily", "project_id"])) ||
    coerceNonEmptyString((rawConfig as any)?.tavily_project_id) ||
    undefined;

  return { apiKey, projectId };
}

function truncateText(s: string, maxChars: number): { text: string; truncated: boolean; originalChars: number } {
  const src = typeof s === "string" ? s : "";
  const originalChars = src.length;
  if (originalChars <= maxChars) return { text: src, truncated: false, originalChars };
  return { text: src.slice(0, maxChars) + "\n\n[...truncated...]", truncated: true, originalChars };
}

function distributeTruncation(args: {
  results: Array<{ url: string; raw_content?: string | null; [k: string]: any }>;
  maxCharsPerContent: number;
  maxTotalChars: number;
}): Array<{ url: string; raw_content?: string | null; raw_content_truncated?: boolean; raw_content_original_chars?: number }> {
  let remaining = args.maxTotalChars;
  const out: Array<{ url: string; raw_content?: string | null; raw_content_truncated?: boolean; raw_content_original_chars?: number }> = [];

  for (const row of args.results) {
    const url = typeof row?.url === "string" ? row.url : "";
    const raw = typeof row?.raw_content === "string" ? row.raw_content : "";

    const per = Math.max(500, Math.min(args.maxCharsPerContent, remaining));
    const t = truncateText(raw, per);
    remaining = Math.max(0, remaining - t.text.length);

    out.push({
      url,
      raw_content: t.text,
      raw_content_truncated: t.truncated,
      raw_content_original_chars: t.originalChars
    });

    if (remaining <= 0) break;
  }

  return out;
}

async function tavilyPostJson(args: {
  endpoint: "/search" | "/extract" | "/crawl";
  body: any;
  auth: TavilyAuth;
  timeoutMs: number;
}): Promise<{ ok: true; json: any } | { ok: false; error: { code: string; message: string; status?: number; details?: any } }> {
  const baseUrl = "https://api.tavily.com";
  const url = baseUrl + args.endpoint;

  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), Math.max(1_000, args.timeoutMs));

  try {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      Authorization: `Bearer ${args.auth.apiKey}`
    };
    if (args.auth.projectId) headers["X-Project-ID"] = args.auth.projectId;

    const res = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(args.body ?? {}),
      signal: controller.signal
    });

    const text = await res.text();
    let json: any = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = null;
    }

    if (!res.ok) {
      return {
        ok: false,
        error: {
          code: "provider_http_error",
          message: `Tavily HTTP ${res.status}`,
          status: res.status,
          details: json ?? text
        }
      };
    }

    return { ok: true, json: json ?? {} };
  } catch (e: any) {
    const msg = String(e?.name === "AbortError" ? "Request timed out" : e?.message ?? e);
    return { ok: false, error: { code: "provider_fetch_error", message: msg } };
  } finally {
    clearTimeout(t);
  }
}

export async function invokeWebTool(args: {
  parsed: NormalizedWebToolArgs;
  rawConfig?: any;
}): Promise<{ ok: boolean; result: any }> {
  // Phase 1: Tavily only.
  if (args.parsed.provider !== "tavily") {
    return {
      ok: false,
      result: {
        type: "web_result",
        ok: false,
        provider: args.parsed.provider,
        mode: args.parsed.mode,
        error: { code: "unsupported_provider", message: `Unsupported web provider: ${args.parsed.provider}` }
      }
    };
  }

  const auth = resolveTavilyAuth(args.rawConfig);
  if (!auth) {
    return {
      ok: false,
      result: {
        type: "web_result",
        ok: false,
        provider: "tavily",
        mode: args.parsed.mode,
        error: {
          code: "missing_api_key",
          message:
            "Missing Tavily API key. Set TAVILY_API_KEY (or ECLIA_TAVILY_API_KEY) env var, or configure tools.web.profiles[].api_key (active profile) in eclia.config.local.toml. (Back-compat: tools.web.tavily.api_key)"
        }
      }
    };
  }

  const maxCharsPerContent = args.parsed.max_chars_per_content ?? 20_000;
  const maxTotalChars = args.parsed.max_total_chars ?? 120_000;

  if (args.parsed.mode === "search") {
    const query = coerceNonEmptyString(args.parsed.query);
    if (!query) {
      return {
        ok: false,
        result: {
          type: "web_result",
          ok: false,
          provider: "tavily",
          mode: "search",
          error: { code: "missing_query", message: "mode=search requires 'query'" }
        }
      };
    }

    // NOTE: Tavily docs emphasize that include_answer/include_raw_content/max_results must be set manually.
    // We force summary-only behavior for search by disabling answer and raw content.
    const body: any = {
      query,
      max_results: typeof args.parsed.max_results === "number" ? args.parsed.max_results : 5,
      include_answer: false,
      include_raw_content: false
    };

    if (args.parsed.search_depth) body.search_depth = args.parsed.search_depth;
    if (args.parsed.time_range) body.time_range = args.parsed.time_range;
    if (args.parsed.start_date) body.start_date = args.parsed.start_date;
    if (args.parsed.end_date) body.end_date = args.parsed.end_date;

    const r = await tavilyPostJson({ endpoint: "/search", body, auth, timeoutMs: 30_000 });
    if (!r.ok) {
      return {
        ok: false,
        result: { type: "web_result", ok: false, provider: "tavily", mode: "search", error: r.error }
      };
    }

    const results = Array.isArray(r.json?.results) ? (r.json.results as any[]) : [];

    return {
      ok: true,
      result: {
        type: "web_result",
        ok: true,
        provider: "tavily",
        mode: "search",
        query: typeof r.json?.query === "string" ? r.json.query : query,
        results: results
          .map((x) => {
            const title = typeof x?.title === "string" ? x.title : "";
            const url = typeof x?.url === "string" ? x.url : "";
            const summary = typeof x?.content === "string" ? x.content : "";
            const score = typeof x?.score === "number" ? x.score : undefined;
            const favicon = typeof x?.favicon === "string" ? x.favicon : undefined;
            const t = truncateText(summary, 2_000);
            return {
              title,
              url,
              summary: t.text,
              summary_truncated: t.truncated,
              summary_original_chars: t.originalChars,
              ...(score !== undefined ? { score } : {}),
              ...(favicon ? { favicon } : {})
            };
          })
          .filter((x) => x.url),
        response_time: r.json?.response_time,
        ...(r.json?.request_id ? { request_id: r.json.request_id } : {})
      }
    };
  }

  if (args.parsed.mode === "extract") {
    const urls = Array.isArray(args.parsed.urls) ? args.parsed.urls.filter((u) => coerceNonEmptyString(u)) : [];
    if (urls.length === 0) {
      return {
        ok: false,
        result: {
          type: "web_result",
          ok: false,
          provider: "tavily",
          mode: "extract",
          error: { code: "missing_urls", message: "mode=extract requires 'url' or 'urls'" }
        }
      };
    }

    const body: any = {
      urls,
      extract_depth: args.parsed.extract_depth ?? "basic",
      format: args.parsed.format ?? "markdown"
    };

    if (typeof args.parsed.timeout === "number") body.timeout = args.parsed.timeout;
    if (args.parsed.query) body.query = args.parsed.query;

    const timeoutMs = Math.max(10_000, Math.min(120_000, Math.round((args.parsed.timeout ?? 60) * 1_000)));
    const r = await tavilyPostJson({ endpoint: "/extract", body, auth, timeoutMs });
    if (!r.ok) {
      return {
        ok: false,
        result: { type: "web_result", ok: false, provider: "tavily", mode: "extract", error: r.error }
      };
    }

    const resultsRaw = Array.isArray(r.json?.results) ? (r.json.results as any[]) : [];
    const resultsTrimmed = distributeTruncation({
      results: resultsRaw.map((x) => ({
        url: typeof x?.url === "string" ? x.url : "",
        raw_content: typeof x?.raw_content === "string" ? x.raw_content : ""
      })),
      maxCharsPerContent,
      maxTotalChars
    });

    // Merge back auxiliary fields (images, favicon) when present.
    const merged = resultsTrimmed.map((row) => {
      const src = resultsRaw.find((x) => typeof x?.url === "string" && x.url === row.url);
      const title = typeof src?.title === "string" ? src.title : undefined;
      const images = Array.isArray(src?.images) ? src.images : undefined;
      const favicon = typeof src?.favicon === "string" ? src.favicon : undefined;
      return {
        ...row,
        ...(title ? { title } : {}),
        ...(images ? { images } : {}),
        ...(favicon ? { favicon } : {})
      };
    });

    return {
      ok: true,
      result: {
        type: "web_result",
        ok: true,
        provider: "tavily",
        mode: "extract",
        results: merged,
        failed_results: Array.isArray(r.json?.failed_results) ? r.json.failed_results : [],
        response_time: r.json?.response_time,
        ...(r.json?.request_id ? { request_id: r.json.request_id } : {})
      }
    };
  }

  // crawl
  {
    const url = coerceNonEmptyString(args.parsed.url);
    if (!url) {
      return {
        ok: false,
        result: {
          type: "web_result",
          ok: false,
          provider: "tavily",
          mode: "crawl",
          error: { code: "missing_url", message: "mode=crawl requires 'url'" }
        }
      };
    }

    const body: any = {
      url,
      extract_depth: args.parsed.extract_depth ?? "basic",
      format: args.parsed.format ?? "markdown"
    };

    if (args.parsed.instructions) body.instructions = args.parsed.instructions;
    if (typeof args.parsed.max_depth === "number") body.max_depth = args.parsed.max_depth;
    if (typeof args.parsed.max_breadth === "number") body.max_breadth = args.parsed.max_breadth;
    if (typeof args.parsed.limit === "number") body.limit = args.parsed.limit;
    // NOTE: Not model-configurable. We force site-local crawl by default.
    body.allow_external = false;
    if (typeof args.parsed.timeout === "number") body.timeout = args.parsed.timeout;

    const timeoutMs = Math.max(10_000, Math.min(160_000, Math.round((args.parsed.timeout ?? 150) * 1_000)));
    const r = await tavilyPostJson({ endpoint: "/crawl", body, auth, timeoutMs });
    if (!r.ok) {
      return {
        ok: false,
        result: { type: "web_result", ok: false, provider: "tavily", mode: "crawl", error: r.error }
      };
    }

    const resultsRaw = Array.isArray(r.json?.results) ? (r.json.results as any[]) : [];
    const resultsTrimmed = distributeTruncation({
      results: resultsRaw.map((x) => ({
        url: typeof x?.url === "string" ? x.url : "",
        raw_content: typeof x?.raw_content === "string" ? x.raw_content : ""
      })),
      maxCharsPerContent,
      maxTotalChars
    });

    const merged = resultsTrimmed.map((row) => {
      const src = resultsRaw.find((x) => typeof x?.url === "string" && x.url === row.url);
      const title = typeof src?.title === "string" ? src.title : undefined;
      const images = Array.isArray(src?.images) ? src.images : undefined;
      const favicon = typeof src?.favicon === "string" ? src.favicon : undefined;
      return {
        ...row,
        ...(title ? { title } : {}),
        ...(images ? { images } : {}),
        ...(favicon ? { favicon } : {})
      };
    });

    return {
      ok: true,
      result: {
        type: "web_result",
        ok: true,
        provider: "tavily",
        mode: "crawl",
        base_url: r.json?.base_url,
        results: merged,
        response_time: r.json?.response_time,
        ...(r.json?.request_id ? { request_id: r.json.request_id } : {})
      }
    };
  }
}
