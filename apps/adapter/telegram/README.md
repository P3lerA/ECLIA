# Telegram Adapter (MVP)

Current scope (first milestone):

- ✅ Private chats only (no groups)
- ✅ Reply only to users in `adapters.telegram.user_whitelist`
- ✅ Default `streamMode=final` (no verbose streaming)
- ✅ `/clear` to reset the session for the current private chat

## Configuration

Put secrets in `eclia.config.local.toml`:

```toml
[adapters.telegram]
enabled = true
bot_token = "<your bot token>"
user_whitelist = ["123456789"]
```

Run with:

```bash
pnpm dev:all
```

The adapter also exposes an internal HTTP endpoint for the gateway `send` tool:

- `GET /health`
- `POST /send`

By default it listens on `127.0.0.1:8791` (override with `ECLIA_TELEGRAM_ADAPTER_PORT`).
