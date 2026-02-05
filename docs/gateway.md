# Gateway (dev)

The gateway is a small backend service that the web console talks to via `/api/*`.

Current endpoints:

- `POST /api/chat` (SSE stream)
- `GET /api/config`
- `PUT /api/config`
- `GET /api/health`

## Inference config

The gateway reads `eclia.config.toml` and merges overrides from `eclia.config.local.toml`.

To use an OpenAI-compatible server, set:

```toml
[inference]
provider = "openai_compat"

[inference.openai_compat]
base_url = "https://api.openai.com/v1"
model = "gpt-4o-mini"
```

Put secrets in `eclia.config.local.toml`:

```toml
[inference.openai_compat]
api_key = "YOUR_KEY_HERE"
```

## Run

From repo root:

```bash
pnpm dev:all
```

This starts:

- Web console (Vite) on `console.host:console.port`
- Gateway on `localhost:api.port`
