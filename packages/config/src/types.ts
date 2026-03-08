import {
  ANTHROPIC_DEFAULT_AUTH_HEADER,
  ANTHROPIC_DEFAULT_BASE_URL,
  ANTHROPIC_DEFAULT_MODEL,
  ANTHROPIC_DEFAULT_VERSION,
  CODEX_OAUTH_DEFAULT_MODEL,
  DEFAULT_INFERENCE_PROVIDER,
  DEFAULT_PROFILE_ID,
  DEFAULT_PROFILE_NAME,
  OPENAI_COMPAT_DEFAULT_AUTH_HEADER,
  OPENAI_COMPAT_DEFAULT_BASE_URL,
  OPENAI_COMPAT_DEFAULT_MODEL,
  type InferenceProviderId
} from "./provider-defaults.js";

// ─── Shared UI schema types ──────────────────────────────────

/**
 * Describes a single configuration field for UI form generation.
 * Used by Symphony (trigger/action/preset schemas) and potentially other subsystems.
 */
export interface ConfigFieldSchema {
  key: string;
  label: string;
  type: "string" | "number" | "boolean" | "select" | "text" | "model";
  required?: boolean;
  default?: unknown;
  sensitive?: boolean;
  placeholder?: string;
  /** Valid choices for "select" type. */
  options?: string[];
}

// ─── ECLIA config ────────────────────────────────────────────

/**
 * Canonical config schema (dev-time).
 * - eclia.config.toml: committed defaults (no secrets)
 * - eclia.config.local.toml: machine-specific overrides (gitignored, may contain secrets)
 *
 * IMPORTANT:
 * - UI "preferences" should not be stored in TOML (use localStorage). TOML is for process startup config.
 */
export type EcliaConfig = {
  /**
   * Optional override for Codex CLI local state directory.
   * If set, gateway will treat this as ECLIA_CODEX_HOME / CODEX_HOME for spawned `codex app-server`.
   */
  codex_home?: string;

  console: {
    host: string;
    port: number;
  };
  api: {
    port: number;
  };

  /**
   * Memory service (optional).
   *
   * When enabled, the gateway will call the memory service for:
   * - /recall before prompt assembly
   */
  memory: {
    enabled: boolean;
    host: string;
    port: number;

    /**
     * How many recent user-turns to attach in the /recall request body as a fallback transcript.
     *
     * Range: 0–64
     */
    recent_turns: number;

    /**
     * Max memories requested per /recall call.
     *
     * Range: 0–200
     */
    recall_limit: number;

    /**
     * Minimum cosine-similarity score for a recalled memory to be injected.
     *
     * Range: 0–1.  Memories below this threshold are discarded.
     */
    recall_min_score: number;

    /**
     * Gateway HTTP timeout for /recall requests (milliseconds).
     *
     * Range: 50–60000
     */
    timeout_ms: number;

    /**
     * Embeddings sidecar (local) used by the memory service.
     *
     * NOTE: The gateway does not depend on these settings directly; they are
     * included here so the Console can configure the sidecar via TOML.
     */
    embeddings: {
      /**
       * Sentence-Transformers model name or Hugging Face model id.
       * Example: "all-MiniLM-L6-v2"
       */
      model: string;
    };

    /**
     * Memory genesis (bootstrapping) pipeline.
     *
     * This stage runs once after enough transcript turns exist to initialize
     * the memory graph and embeddings cache.
     */
    genesis: {
      /**
       * How many user-turns to include per model request during Stage 1/2 extraction.
       *
       * Range: 1–64
       */
      turns_per_call: number;
    };

    /**
     * Memory extraction pipeline (LLM-based).
     *
     * These settings control how much tool output noise is allowed into the
     * role-structured transcript context when the memory service asks the model
     * to extract memories.
     */
    extract: {
      /**
       * Strategy for handling role=tool messages when building extraction context.
       *
       * - "drop": remove tool messages entirely (recommended; least noisy)
       * - "truncate": keep tool messages, but aggressively clip them
       */
      tool_messages: "drop" | "truncate";

      /**
       * Max characters per tool message when tool_messages="truncate".
       *
       * Range: 0–50000
       */
      tool_max_chars_per_msg: number;

      /**
       * Max total characters contributed by tool messages (tail-kept) when
       * tool_messages="truncate".
       *
       * Range: 0–200000
       */
      tool_max_total_chars: number;
    };
  };

  /**
   * Debug/dev features.
   *
   * These options are intended for local development and troubleshooting.
   */
  debug: {
    /**
     * When enabled, the gateway will dump the *full* upstream request body for each
     * model request under:
     *   <repo>/.eclia/debug/<sessionId>/
     */
    capture_upstream_requests: boolean;

    /**
     * When enabled, the gateway will attempt to recover tool calls from assistant
     * plaintext output (e.g. "Tool exec (calling): ...") if the upstream provider
     * fails to produce structured tool_calls.
     *
     * WARNING: This is a best-effort fallback intended for debugging and compatibility.
     */
    parse_assistant_output: boolean;
  };

  /**
   * Optional "skills" system.
   *
   * Skills are user-enabled capability packs stored under:
   *   <repo>/skills/<name>/skill.md
   *
   * NOTE: The config only tracks which skills are enabled.
   * Skill discovery/metadata is handled by the gateway at runtime.
   */
  skills: {
    /**
     * Names of enabled skills.
     *
     * IMPORTANT: the skill name must exactly match its directory name under /skills.
     */
    enabled: string[];
  };

  /**
   * Optional display names used by system-instruction template placeholders.
   */
  persona: {
    /**
     * Replaces {{USER_PREFERRED_NAME}} in _system.local.md / _system.md.
     */
    user_preferred_name?: string;

    /**
     * Replaces {{ASSISTANT_NAME}} in _system.local.md / _system.md.
     */
    assistant_name?: string;
  };

  inference: {
    /**
     * Effective system instruction (resolved from _system.local.md -> _system.md).
     */
    system_instruction?: string;

    provider: InferenceProviderId;
    openai_compat: {
      profiles: OpenAICompatProfile[];
    };
    anthropic: {
      profiles: AnthropicProfile[];
    };
    codex_oauth: {
      profiles: CodexOAuthProfile[];
    };
  };
  adapters: {
    discord: {
      enabled: boolean;
      app_id?: string; // non-secret (application id / client id)
      bot_token?: string; // secret (prefer local overrides)
      guild_ids?: string[]; // guild whitelist used by registration/runtime filtering
      user_whitelist?: string[]; // allowed Discord user ids for slash/plain-message handling
      force_global_commands?: boolean; // register only global commands (and filter guild replies by whitelist)

      /**
       * Default stream mode for the /eclia slash command when `verbose` is omitted.
       * - final: no intermediate streaming (default)
       * - full: stream intermediate output (tools/deltas)
       */
      default_stream_mode?: "full" | "final";
    };

    telegram: {
      enabled: boolean;
      bot_token?: string; // secret (prefer local overrides)
      /** Allowed Telegram user ids (applies to both private and group chats). */
      user_whitelist?: string[];
      /** Allowed Telegram group/supergroup chat ids (bot replies only when chat.id is in this list). */
      group_whitelist?: string[];
    };
  };

};

export type OpenAICompatProfile = {
  /**
   * Stable identifier used by UI/runtime routing.
   * Not shown to users.
   */
  id: string;

  /**
   * Display name (shown in the Console UI).
   */
  name: string;

  /**
   * Example: https://api.openai.com/v1
   */
  base_url: string;

  /**
   * Real upstream model id (NOT the UI route key).
   */
  model: string;

  /**
   * Secret (prefer local overrides).
   */
  api_key?: string;

  /**
   * Default: Authorization
   */
  auth_header?: string;
};

export type AnthropicProfile = {
  /**
   * Stable identifier used by UI/runtime routing.
   * Not shown to users.
   */
  id: string;

  /**
   * Display name (shown in the Console UI).
   */
  name: string;

  /**
   * Example: https://api.anthropic.com
   * (The gateway will call <base_url>/v1/messages by default.)
   */
  base_url: string;

  /**
   * Real upstream model id (NOT the UI route key).
   */
  model: string;

  /**
   * Secret (prefer local overrides).
   */
  api_key?: string;

  /**
   * Default: x-api-key
   */
  auth_header?: string;

  /**
   * Default: 2023-06-01
   */
  anthropic_version?: string;
};

export type CodexOAuthProfile = {
  /**
   * Stable identifier used by UI/runtime routing.
   */
  id: string;

  /**
   * Display name (shown in the Console UI).
   */
  name: string;

  /**
   * Real upstream model id (NOT the UI route key).
   */
  model: string;

  /**
   * Secret OAuth tokens (prefer local overrides).
   *
   * NOTE: for now we treat these as opaque strings; different backends may
   * return different token sets.
   */
  access_token?: string;
  refresh_token?: string;
  id_token?: string;

  /**
   * Epoch milliseconds, if known.
   */
  expires_at?: number;
};

export type EcliaConfigPatch = Partial<{
  codex_home: string;
  console: Partial<EcliaConfig["console"]>;
  api: Partial<EcliaConfig["api"]>;
  memory: Partial<EcliaConfig["memory"]>;
  debug: Partial<EcliaConfig["debug"]>;
  skills: Partial<EcliaConfig["skills"]>;
  persona: Partial<EcliaConfig["persona"]>;
  inference: Partial<{
    system_instruction: string;
    provider: EcliaConfig["inference"]["provider"];
    openai_compat: Partial<{
      profiles: Array<
        Partial<Pick<OpenAICompatProfile, "id" | "name" | "base_url" | "model" | "api_key" | "auth_header">> &
          Pick<OpenAICompatProfile, "id">
      >;
    }>;
    anthropic: Partial<{
      profiles: Array<
        Partial<Pick<AnthropicProfile, "id" | "name" | "base_url" | "model" | "api_key" | "auth_header" | "anthropic_version">> &
          Pick<AnthropicProfile, "id">
      >;
    }>;
    codex_oauth: Partial<{
      profiles: Array<
        Partial<Pick<CodexOAuthProfile, "id" | "name" | "model" | "access_token" | "refresh_token" | "id_token" | "expires_at">> &
          Pick<CodexOAuthProfile, "id">
      >;
    }>;
  }>;
  adapters: Partial<{
    discord: Partial<EcliaConfig["adapters"]["discord"]>;
    telegram: Partial<EcliaConfig["adapters"]["telegram"]>;
  }>;
}>;

export const DEFAULT_ECLIA_CONFIG: EcliaConfig = {
  console: { host: "127.0.0.1", port: 5173 },
  api: { port: 8787 },
  memory: {
    enabled: false,
    host: "127.0.0.1",
    port: 8788,
    recent_turns: 8,
    recall_limit: 20,
    recall_min_score: 0.6,
    timeout_ms: 1200,
    embeddings: { model: "all-MiniLM-L6-v2" },
    genesis: {
      turns_per_call: 20
    },
    extract: {
      tool_messages: "drop",
      tool_max_chars_per_msg: 1200,
      tool_max_total_chars: 5000
    }
  },
  debug: {
    capture_upstream_requests: false,
    parse_assistant_output: false
  },
  skills: {
    enabled: []
  },
  persona: {},
  inference: {
    provider: DEFAULT_INFERENCE_PROVIDER,
    openai_compat: {
      profiles: [
        {
          id: DEFAULT_PROFILE_ID,
          name: DEFAULT_PROFILE_NAME,
          base_url: OPENAI_COMPAT_DEFAULT_BASE_URL,
          model: OPENAI_COMPAT_DEFAULT_MODEL,
          auth_header: OPENAI_COMPAT_DEFAULT_AUTH_HEADER
        }
      ]
    },
    anthropic: {
      profiles: [
        {
          id: DEFAULT_PROFILE_ID,
          name: DEFAULT_PROFILE_NAME,
          base_url: ANTHROPIC_DEFAULT_BASE_URL,
          model: ANTHROPIC_DEFAULT_MODEL,
          auth_header: ANTHROPIC_DEFAULT_AUTH_HEADER,
          anthropic_version: ANTHROPIC_DEFAULT_VERSION
        }
      ]
    },
    codex_oauth: {
      profiles: [
        {
          id: DEFAULT_PROFILE_ID,
          name: DEFAULT_PROFILE_NAME,
          // Codex app-server model id (not the UI route key).
          model: CODEX_OAUTH_DEFAULT_MODEL
        }
      ]
    }
  },
  adapters: {
    discord: {
      enabled: false,
      guild_ids: [],
      user_whitelist: [],
      force_global_commands: false,
      default_stream_mode: "final"
    },
    telegram: {
      enabled: false,
      user_whitelist: [],
      group_whitelist: []
    }
  }
};
