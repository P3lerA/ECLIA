import { useEffect, useMemo, useState } from "react";
import { ChevronDown, Send, Trash2 } from "lucide-react";

type ModelItem = { id: string };

export default function App() {
  const [baseUrl, setBaseUrl] = useState<string>("/api"); // 走 Vite proxy
  const [models, setModels] = useState<ModelItem[]>([]);
  const [model, setModel] = useState<string>("");
  const [temperature, setTemperature] = useState<number>(0.7);
  const [maxTokens, setMaxTokens] = useState<number>(256);
  const [jsonMode, setJsonMode] = useState<boolean>(false);
  const [input, setInput] = useState<string>("");
  const [messages, setMessages] = useState<Array<{ role: "user" | "assistant"; content: string }>>([]);
  const [status, setStatus] = useState<string>("");

  const canSend = input.trim().length > 0 && model;
  const clampNumber = (value: string, min: number, max: number, fallback: number) => {
    const n = Number(value);
    if (!Number.isFinite(n)) return fallback;
    return Math.min(max, Math.max(min, n));
  };

  useEffect(() => {
    const load = async () => {
      setStatus("Loading models...");
      try {
        const r = await fetch(`${baseUrl}/v1/models`);
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const j = await r.json();
        const list: ModelItem[] = j?.data ?? [];
        setModels(list);
        setModel(list?.[0]?.id ?? "");
        setStatus("");
      } catch (e: any) {
        setStatus(`Failed to load models: ${String(e?.message ?? e)}`);
      }
    };
    load();
  }, [baseUrl]);

  const headerSub = useMemo(() => {
    if (status) return status;
    return model ? `Connected · ${model}` : "Not connected";
  }, [status, model]);

  const send = async () => {
    if (!canSend) return;

    const next = [...messages, { role: "user" as const, content: input.trim() }];
    setMessages(next);
    setInput("");

    try {
      const body: any = {
        model,
        messages: next,
        temperature,
        max_tokens: maxTokens,
      };
      if (jsonMode) body.response_format = { type: "json_object" };

      const r = await fetch(`${baseUrl}/v1/chat/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const j = await r.json();
      const text = j?.choices?.[0]?.message?.content ?? "";
      setMessages((m) => [...m, { role: "assistant", content: text }]);
      setStatus("");
    } catch (e: any) {
      setStatus(`Request failed: ${String(e?.message ?? e)}`);
    }
  };

  const clear = () => setMessages([]);

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      {/* Glass Navbar */}
      <div className="sticky top-0 z-50 backdrop-blur-md bg-slate-950/70 border-b border-slate-200/10">
        <div className="mx-auto max-w-5xl px-4 py-4 flex items-center justify-between">
          <div>
            <h1 className="font-serif font-bold tracking-tight text-2xl text-slate-50">
              LLM Console
            </h1>
            <p className="text-sm text-slate-300">{headerSub}</p>
          </div>

          <button
            onClick={clear}
            className="rounded-full px-4 py-2 font-medium bg-slate-900 hover:bg-slate-800 border border-slate-200/10
                       transition-all duration-300 flex items-center gap-2"
          >
            <Trash2 size={16} />
            清空对话
          </button>
        </div>
      </div>

      <main className="mx-auto max-w-5xl px-4 py-8 animate-fade-in">
        {/* Soft Card */}
        <div className="rounded-2xl bg-slate-900/40 border border-slate-200/10 p-5 transition-all duration-300">
          <div className="grid grid-cols-1 md:grid-cols-12 gap-4">
            <div className="md:col-span-4">
              <label className="text-xs text-slate-300">Model</label>
              <div className="mt-1 relative">
                <select
                  value={model}
                  onChange={(e) => setModel(e.target.value)}
                  className="w-full rounded-2xl bg-slate-950 border border-slate-200/10 px-4 py-3 pr-10
                             outline-none focus:border-slate-200/30 transition-all duration-300"
                >
                  {models.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.id}
                    </option>
                  ))}
                </select>
                <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
              </div>
            </div>

            <div className="md:col-span-2">
              <label className="text-xs text-slate-300">Temperature</label>
              <input
                type="number"
                step="0.1"
                min={0}
                max={2}
                value={temperature}
                onChange={(e) => setTemperature(clampNumber(e.target.value, 0, 2, 0.7))}
                className="mt-1 w-full rounded-2xl bg-slate-950 border border-slate-200/10 px-4 py-3
                           outline-none focus:border-slate-200/30 transition-all duration-300"
              />
            </div>

            <div className="md:col-span-2">
              <label className="text-xs text-slate-300">Max tokens</label>
              <input
                type="number"
                min={1}
                max={4096}
                value={maxTokens}
                onChange={(e) => setMaxTokens(clampNumber(e.target.value, 1, 4096, 256))}
                className="mt-1 w-full rounded-2xl bg-slate-950 border border-slate-200/10 px-4 py-3
                           outline-none focus:border-slate-200/30 transition-all duration-300"
              />
            </div>

            <div className="md:col-span-2">
              <label className="text-xs text-slate-300">API Base</label>
              <input
                value={baseUrl}
                onChange={(e) => setBaseUrl(e.target.value)}
                className="mt-1 w-full rounded-2xl bg-slate-950 border border-slate-200/10 px-4 py-3
                           outline-none focus:border-slate-200/30 transition-all duration-300"
                placeholder="/api"
              />
            </div>

            <div className="md:col-span-2 flex items-end">
              <label className="w-full inline-flex items-center justify-between rounded-2xl bg-slate-950
                                 border border-slate-200/10 px-4 py-3 transition-all duration-300">
                <span className="text-sm text-slate-200">JSON mode</span>
                <input
                  type="checkbox"
                  checked={jsonMode}
                  onChange={(e) => setJsonMode(e.target.checked)}
                  className="h-4 w-4 accent-slate-200"
                />
              </label>
            </div>
          </div>
        </div>

        {/* Chat */}
        <div className="mt-6 rounded-2xl bg-slate-900/40 border border-slate-200/10 p-5">
          <div className="space-y-3 max-h-[52vh] overflow-auto pr-1">
            {messages.length === 0 ? (
              <div className="text-slate-400 text-sm">
                输入点东西，让模型说句话。
              </div>
            ) : (
              messages.map((m, i) => (
                <div
                  key={i}
                  className={[
                    "rounded-2xl px-4 py-3 border transition-all duration-300",
                    m.role === "user"
                      ? "bg-slate-950 border-slate-200/10"
                      : "bg-slate-900/60 border-slate-200/5",
                  ].join(" ")}
                >
                  <div className="text-xs text-slate-400 mb-1">
                    {m.role === "user" ? "You" : "Assistant"}
                  </div>
                  <pre className="whitespace-pre-wrap break-words text-sm text-slate-100">
                    {m.content}
                  </pre>
                </div>
              ))
            )}
          </div>

          <div className="mt-4 flex gap-3">
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              rows={2}
              className="flex-1 rounded-2xl bg-slate-950 border border-slate-200/10 px-4 py-3
                         outline-none focus:border-slate-200/30 transition-all duration-300 resize-none"
              placeholder="输入消息..."
            />
            {/* Pill Button */}
            <button
              onClick={send}
              disabled={!canSend}
              className={[
                "rounded-full px-5 py-3 font-medium flex items-center gap-2",
                "transition-all duration-300",
                canSend
                  ? "bg-slate-100 text-slate-950 hover:bg-slate-200"
                  : "bg-slate-800 text-slate-500 cursor-not-allowed",
              ].join(" ")}
            >
              <Send size={16} />
              发送
            </button>
          </div>

          {status && (
            <div className="mt-3 text-sm text-rose-300">{status}</div>
          )}
        </div>
      </main>
    </div>
  );
}
