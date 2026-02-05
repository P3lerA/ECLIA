export type ChatMessage = {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
};

export type OpenAICompatConfig = {
  base_url: string;
  api_key?: string;
  model: string;
};

export type OpenAICompatStreamEvent =
  | { kind: "delta"; text: string }
  | { kind: "done" };

function resolveChatCompletionsUrl(baseUrl: string): string {
  const trimmed = baseUrl.replace(/\/+$/, "");
  // If user already included /v1, follow that.
  if (trimmed.endsWith("/v1")) return `${trimmed}/chat/completions`;
  return `${trimmed}/v1/chat/completions`;
}

async function* readUtf8Lines(body: ReadableStream<Uint8Array>, signal: AbortSignal): AsyncGenerator<string> {
  const reader = body.getReader();
  const decoder = new TextDecoder("utf-8");
  let buf = "";

  while (true) {
    if (signal.aborted) throw new DOMException("Aborted", "AbortError");
    const { value, done } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });

    let idx: number;
    while ((idx = buf.indexOf("\n")) !== -1) {
      const line = buf.slice(0, idx);
      buf = buf.slice(idx + 1);
      yield line;
    }
  }

  if (buf.length) yield buf;
}

export async function* streamOpenAICompatChat(
  cfg: OpenAICompatConfig,
  args: {
    model?: string;
    messages: ChatMessage[];
    temperature?: number;
    signal: AbortSignal;
  }
): AsyncGenerator<OpenAICompatStreamEvent> {
  const url = resolveChatCompletionsUrl(cfg.base_url);

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "Accept": "text/event-stream"
  };
  const key = (cfg.api_key ?? "").trim();
  if (key) headers["Authorization"] = `Bearer ${key}`;

  const body = {
    model: args.model ?? cfg.model,
    messages: args.messages,
    temperature: typeof args.temperature === "number" ? args.temperature : 0.2,
    stream: true
  };

  const resp = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
    signal: args.signal
  });

  if (!resp.ok || !resp.body) {
    const text = await resp.text().catch(() => "");
    throw new Error(`Inference error: ${resp.status} ${resp.statusText} ${text}`);
  }

  // OpenAI-style SSE stream:
  // data: { ...json... }
  // \n
  // data: [DONE]
  // \n
  for await (const line of readUtf8Lines(resp.body, args.signal)) {
    const s = line.trim();
    if (!s) continue;
    if (!s.startsWith("data:")) continue;

    const payload = s.slice(5).trim();
    if (!payload) continue;
    if (payload === "[DONE]") break;

    let j: any;
    try {
      j = JSON.parse(payload);
    } catch {
      // Ignore malformed fragments.
      continue;
    }

    const choice = j?.choices?.[0];
    const delta = choice?.delta;
    const textDelta = typeof delta?.content === "string" ? delta.content : "";
    if (textDelta) yield { kind: "delta", text: textDelta };

    // Tool calls may appear as stream deltas; ignored for now (gateway will add a proper aggregator later).
  }

  yield { kind: "done" };
}
