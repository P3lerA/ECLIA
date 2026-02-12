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

- `DISCORD_GUILD_ID` – legacy single guild id. If set, registers slash commands to that guild (updates instantly).
- `DISCORD_GUILD_IDS` – comma/newline/space separated list of guild ids (multi-guild).
- `adapters.discord.guild_ids` in `eclia.config.local.toml` – TOML array form (multi-guild), e.g.

  ```toml
  [adapters.discord]
  guild_ids = ["123456789012345678", "987654321098765432"]
  ```

  When guild ids are set, the adapter will (by default) clear global slash commands to avoid duplicate command listings.
  If you want to keep global commands, set `ECLIA_DISCORD_KEEP_GLOBAL_COMMANDS=1`.

Gateway connection:

- `ECLIA_GATEWAY_URL` – default: `http://127.0.0.1:<api.port>` (from `eclia.config.toml`).

Optional:

- `ECLIA_DISCORD_STREAM=1` – periodically edits the reply while the gateway streams.
- `ECLIA_DISCORD_ALLOW_MESSAGE_PREFIX=1` – also enable prefix-style chat (`!eclia ...`).
  - Requires Message Content privileged intent.
- `ECLIA_DISCORD_PREFIX` – default `!eclia`.

Outbound endpoint:

- `ECLIA_DISCORD_ADAPTER_PORT` – default `8790`.
- `ECLIA_ADAPTER_KEY` – if set, outbound requests must include header `x-eclia-adapter-key: <value>`.

## Run

```bash
pnpm -C apps/adapter/discord dev
```