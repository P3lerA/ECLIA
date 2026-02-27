# ECLIA Discord Adapter

This adapter connects ECLIA sessions to Discord.

It does two things:

1) **Inbound**: receives Discord messages/commands and forwards them to the gateway `/api/chat` endpoint.
2) **Outbound** (prep for `send` tool): exposes a local HTTP endpoint (`POST /send`) that can post text and attachments to the channel/thread associated with a session.

## Environment variables

Required (env or local TOML):

- `DISCORD_BOT_TOKEN` **or** `adapters.discord.bot_token` in `eclia.config.local.toml`
- `DISCORD_APP_ID` **or** `adapters.discord.app_id` in `eclia.config.local.toml`

Recommended (for fast command iteration):

- `DISCORD_GUILD_WHITELIST` – preferred guild whitelist env (comma/newline/space separated list).
- `DISCORD_GUILD_ID` – legacy single guild id (fallback).
- `DISCORD_GUILD_IDS` – legacy multi-guild list (fallback).
- `adapters.discord.guild_ids` in `eclia.config.local.toml` – TOML array form used as guild whitelist, e.g.
- `DISCORD_USER_WHITELIST` – preferred user whitelist env (comma/newline/space separated list).
- `DISCORD_USER_ID` – legacy single-user fallback.
- `adapters.discord.user_whitelist` in `eclia.config.local.toml` – TOML array of allowed Discord user ids:

  ```toml
  [adapters.discord]
  guild_ids = ["123456789012345678", "987654321098765432"]
  user_whitelist = ["111111111111111111", "222222222222222222"]
  force_global_commands = false
  ```

  Registration behavior:
  - `force_global_commands = false` (default): register slash commands only in `guild_ids`, and clear global commands.
  - `force_global_commands = true`: register slash commands as global only, skip guild registration, and enforce guild whitelist at runtime (DM allowed).
  Input behavior:
  - Slash commands and message chat only respond to users in `user_whitelist`.
  - Message chat accepts plain text by default (prefix optional).

Gateway connection:

- `ECLIA_GATEWAY_URL` – default: `http://127.0.0.1:<api.port>` (from `eclia.config.toml`).

Optional:

- `ECLIA_DISCORD_STREAM=1` – periodically edits the reply while the gateway streams.
- `ECLIA_DISCORD_DEFAULT_STREAM_MODE=full|final` – default stream mode for the `/eclia` slash command when `verbose` is omitted.
  - Prefer configuring `adapters.discord.default_stream_mode` in `eclia.config.local.toml` (Settings -> Adapters -> Advanced).
- `ECLIA_DISCORD_FORCE_GLOBAL_COMMANDS=1` – env override for `adapters.discord.force_global_commands`.
  - Back-compat: `ECLIA_DISCORD_KEEP_GLOBAL_COMMANDS=1` is treated the same way.
- `ECLIA_DISCORD_REQUIRE_PREFIX=1` – require `!eclia`-style prefix for message chat.
  - Back-compat: `ECLIA_DISCORD_ALLOW_MESSAGE_PREFIX=1` is treated as prefix-required mode.
  - Requires Message Content privileged intent.
- `ECLIA_DISCORD_PREFIX` – default `!eclia`.

Outbound endpoint:

- `ECLIA_DISCORD_ADAPTER_PORT` – default `8790`.
- `ECLIA_ADAPTER_KEY` – if set, outbound requests must include header `x-eclia-adapter-key: <value>`.

## Run

```bash
pnpm -C apps/adapter/discord dev
```
