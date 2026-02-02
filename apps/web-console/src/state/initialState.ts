import type { AppState } from "./reducer";

function nowMeta(label: string) {
  const d = new Date();
  const hm = d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  return `${label} · ${hm}`;
}

export function makeInitialState(): AppState {
  const t = Date.now();

  return {
    model: "local/ollama",
    transport: "mock",

    sessions: [
      { id: "s1", title: "New session", meta: nowMeta("just now"), createdAt: t },
      { id: "s2", title: "工具调用：浏览器自动化", meta: nowMeta("yesterday"), createdAt: t - 86400000 },
      { id: "s3", title: "Prompt 试验：JSON Schema", meta: nowMeta("last week"), createdAt: t - 7 * 86400000 }
    ],
    activeSessionId: "s1",

    messagesBySession: {
      // s1 初始为空：显示 Landing 视图（居中输入框 + MENU）
      s1: [],

      // s2 做一个示例会话，方便你直接看 chat UI
      s2: [
        {
          id: "m21",
          role: "assistant",
          createdAt: t - 86400000 + 1000,
          blocks: [
            {
              type: "text",
              text:
                "这是一个示例会话。\n\n" +
                "这个项目的核心是：Message = blocks + Transport 事件流。\n" +
                "UI 只负责渲染与交互，能力靠后端/插件注入。"
            }
          ]
        },
        {
          id: "m22",
          role: "user",
          createdAt: t - 86400000 + 2000,
          blocks: [{ type: "text", text: "把 MENU 做成底部弹出，并且可以切换历史 session。" }]
        },
        {
          id: "m23",
          role: "assistant",
          createdAt: t - 86400000 + 3000,
          blocks: [
            { type: "tool", name: "plan_ui", status: "ok", payload: { menu: "bottom-sheet", sidebar: false } }
          ]
        }
      ],

      s3: []
    },

    plugins: [
      { id: "sessions", name: "Session Sync", enabled: true, description: "会话持久化到后端" },
      { id: "tools", name: "Tools Runtime", enabled: true, description: "允许 tool_call / tool_result 事件" },
      { id: "rag", name: "RAG", enabled: false, description: "检索增强（引用/召回）" },
      { id: "trace", name: "Tracing", enabled: false, description: "事件追踪与可观测性" }
    ],

    inspectorTab: "events",
    logsByTab: {
      events: [{ id: "l1", tab: "events", at: t, type: "boot", summary: "app start", data: {} }],
      tools: [],
      context: []
    }
  };
}
