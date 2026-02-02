# ECLIA Console (TypeScript 原型)

这是一个 **可扩展的 LLM Console 前端壳**（偏“控制台内核”思路）：

- **Landing → Chat 的两阶段 UI**
  - 初始是 Landing：居中输入框 + 背景等高线纹理 + 底部 `MENU`
  - 发送第一条消息后进入 Chat：会话式消息流；`MENU` 挪到发送框右侧
- **Message = blocks**
  - text / code / tool 只是开始；未来加 image/table/citation/file… 只要加 block + renderer
- **Transport 抽象**
  - 默认 `mock` 本地可跑
  - 可切换 `sse`（仓库里带了一个很小的 `text/event-stream` 示例服务端）

> 目标：把复杂性隔离在 `src/core/`：transport、事件、block renderer。  
> UI 组件只做渲染和少量交互，扩展通过“注册表”长出来。

---

## 运行环境

- Node.js **20.19+ 或 22.12+**
- pnpm / npm 均可

---

## 一键启动（Mock 模式）

```bash
pnpm install
pnpm dev
```

---

## 启动 SSE 示例后端（可选）

终端 A：

```bash
pnpm dev:server
```

终端 B：

```bash
pnpm dev
```

或同时启动：

```bash
pnpm dev:all
```

然后在 `MENU -> Settings` 里把 Transport 切到 `sse`。

---

## 目录结构（重点看这里）

```
src/
  core/                 # 可扩展核心（UI 不应该知道太多细节）
    types.ts            # Message / Block / Event / Session 等核心类型
    renderer/           # block 渲染注册表（插件点之一）
    transport/          # Mock / SSE Fetch Transport（插件点之二）
  state/                # AppState（useReducer + Context）
  features/
    landing/            # Landing 视图
    chat/               # Chat 视图（MessageList + Composer）
    menu/               # MenuSheet（底部弹出菜单：sessions/plugins/settings）
  styles/               # tokens + 等高线背景 + 极简组件样式
server/
  dev-sse-server.ts     # SSE 示例后端（仅演示事件流结构）
```

---

## 扩展指南（你后面会用到）

### 1) 新增 block 类型
1. 在 `src/core/types.ts` 里加一个 Block union 分支（例如 `image`）
2. 在 `src/core/renderer/defaultRenderers.tsx` 里注册渲染器
3. 后端/transport 发回该 block 即可显示

### 2) 新增 Transport（对接你的网关/代理）
1. 在 `src/core/transport/` 里实现 `ChatTransport`
2. 在 `src/core/runtime.ts` 注册到 `transportRegistry`

### 3) MENU 扩展
`src/features/menu/MenuSheet.tsx` 里把 session、plugins、settings 当作 section。  
你可以继续加：账号、API key、可观测性、RBAC… 前端不会被迫换架构。

---

## 许可证
MIT
