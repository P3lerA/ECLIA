# ECLIA Console (TypeScript Prototype)

An **extensible LLM console frontend shell** — designed like a “console kernel” that stays UI-focused while the real capabilities live behind a swappable transport and plugins.

## What you get

- **Two-stage UI: Landing → Chat**
  - Landing: centered prompt + dynamic contour background + bottom `MENU`
  - After the first message: chat-style conversation; `MENU` moves next to the send button
- **Background: WebGL2 dynamic contours (GPU)**
  - If WebGL2 works: shader-rendered, light-gray topographic contours with a slow *breathing* motion
  - If GPU is unavailable: fallback is a solid background color (no texture). A CPU noise→isolines renderer can be added later if we want an offline texture.
- **Message = blocks**
  - `text / code / tool` is just the start; add `image/table/citation/file` by adding a block type + renderer
- **Transport abstraction**
  - `mock` runs locally without a backend
  - `sse` connects to a tiny `text/event-stream` demo server in `server/`

## Requirements

- Node.js **20.19+ or 22.12+**
- pnpm (or npm)

## Run (mock)

```bash
pnpm install
pnpm dev
```

## Run the SSE demo backend (optional)

Terminal A:

```bash
pnpm dev:server
```

Terminal B:

```bash
pnpm dev
```

Or run both:

```bash
pnpm dev:all
```

Then open `MENU → Settings` and switch **Transport** to `sse`.



## Persistence (browser)

UI/runtime preferences (theme, background texture toggle, transport/model, plugin toggles) are stored in `localStorage`.
Dev host/port stays in TOML on disk.

## Config (TOML)

The console reads dev host/port settings from a project-level TOML config:

- `eclia.config.toml` (committed defaults)
- `eclia.config.local.toml` (optional local overrides, gitignored)

Keys used today:

```toml
[console]
host = "127.0.0.1"
port = 5173

[api]
port = 8787
```

Changes take effect **after restart**.

## One-command dev launcher (macOS/Linux)

From the repo root:

```bash
chmod +x scripts/dev.sh
./scripts/dev.sh
```

This starts both:
- Vite dev server (host/port from config)
- Demo SSE backend (port from config)


## Project layout (the important part)

```txt
src/
  core/                 # extensible core (UI shouldn't know backend details)
    types.ts            # Message / Block / Event / Session types
    renderer/           # block renderer registry
    transport/          # Mock / SSE fetch transport
  state/                # AppState (useReducer + Context)
  features/
    background/         # WebGL2 contours (solid fallback)
    landing/            # Landing view
    chat/               # Chat view (MessageList + ChatComposer)
    menu/               # MenuSheet (sessions/plugins/settings entry)
    settings/           # Settings page
  styles/               # tokens + flat minimal styles
server/
  dev-sse-server.ts     # SSE demo backend
assets/
  eclia-logo.svg        # recommended logo asset for GitHub README
  eclia-logo.html       # standalone HTML/CSS demo of the logo
```

## Extending (you will use this later)

### 1) Add a new block type
1. Add a new union branch in `src/core/types.ts` (e.g. `image`)
2. Register a renderer in `src/core/renderer/defaultRenderers.tsx`
3. Have your backend/transport emit that block

### 2) Add a new transport (wire your gateway/router)
1. Implement `ChatTransport` under `src/core/transport/`
2. Register it in `src/core/runtime.ts`

## Logo export

The logo is implemented as **HTML/CSS** in the app, but GitHub README sanitization may strip CSS when you embed arbitrary HTML.

- Use `assets/eclia-logo.svg` for README embedding:
  ```html
  <img src="./assets/eclia-logo.svg" width="320" alt="ECLIA" />
  ```

- Use `assets/eclia-logo.html` as a standalone demo (local preview or GitHub Pages).
