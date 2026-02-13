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

[[inference.openai_compat.profiles]]
id = "default"
name = "Default"
base_url = "https://api.openai.com/v1"
model = "gpt-4o-mini"
auth_header = "Authorization"
```

Put secrets in `eclia.config.local.toml`.

Note: `profiles` is a TOML array; when merged, arrays are replaced (not deep-merged). If you edit config by hand, keep the full profile definition (base URL, model, and key) together. The web console Settings UI will manage this automatically.

```toml
[inference]
provider = "openai_compat"

[[inference.openai_compat.profiles]]
id = "default"
name = "Default"
base_url = "https://api.openai.com/v1"
model = "gpt-4o-mini"
api_key = "YOUR_KEY_HERE"
auth_header = "Authorization"
```

## Run

From repo root:

```bash
pnpm dev:all
```

This starts:

- Web console (Vite) on `console.host:console.port`
- Gateway on `localhost:api.port`
