import {
  ANTHROPIC_DEFAULT_AUTH_HEADER,
  ANTHROPIC_DEFAULT_BASE_URL,
  ANTHROPIC_DEFAULT_MODEL,
  ANTHROPIC_DEFAULT_VERSION,
  CODEX_OAUTH_DEFAULT_MODEL,
  DEFAULT_INFERENCE_PROVIDER,
  DEFAULT_PROFILE_ID,
  DEFAULT_PROFILE_NAME,
  OPENAI_COMPAT_DEFAULT_AUTH_HEADER,
  OPENAI_COMPAT_DEFAULT_BASE_URL,
  OPENAI_COMPAT_DEFAULT_MODEL,
  type InferenceProviderId
} from "./provider-defaults.js";

/**
 * Canonical config schema (dev-time).
 * - eclia.config.toml: committed defaults (no secrets)
 * - eclia.config.local.toml: machine-specific overrides (gitignored, may contain secrets)
 *
 * IMPORTANT:
 * - UI "preferences" should not be stored in TOML (use localStorage). TOML is for process startup config.
 */
export type EcliaConfig = {
  /**
   * Optional override for Codex CLI local state directory.
   * If set, gateway will treat this as ECLIA_CODEX_HOME / CODEX_HOME for spawned `codex app-server`.
   */
  codex_home?: string;

  console: {
    host: string;
    port: number;
  };
  api: {
    port: number;
  };

  /**
   * Debug/dev features.
   *
   * These options are intended for local development and troubleshooting.
   */
  debug: {
    /**
     * When enabled, the gateway will dump the *full* upstream request body for each
     * model request under:
     *   <repo>/.eclia/debug/<sessionId>/
     */
    capture_upstream_requests: boolean;

    /**
     * When enabled, the gateway will attempt to recover tool calls from assistant
     * plaintext output (e.g. "Tool exec (calling): ...") if the upstream provider
     * fails to emit structured tool_calls.
     *
     * WARNING: This is a best-effort fallback intended for debugging and compatibility.
     */
    parse_assistant_output: boolean;
  };

  /**
   * Optional "skills" system.
   *
   * Skills are user-enabled capability packs stored under:
   *   <repo>/skills/<name>/skill.md
   *
   * NOTE: The config only tracks which skills are enabled.
   * Skill discovery/metadata is handled by the gateway at runtime.
   */
  skills: {
    /**
     * Names of enabled skills.
     *
     * IMPORTANT: the skill name must exactly match its directory name under /skills.
     */
    enabled: string[];
  };

  /**
   * Optional display names used by system-instruction template placeholders.
   */
  persona: {
    /**
     * Replaces {{USER_PREFERRED_NAME}} in _system.local.md / _system.md.
     */
    user_preferred_name?: string;

    /**
     * Replaces {{ASSISTANT_NAME}} in _system.local.md / _system.md.
     */
    assistant_name?: string;
  };

  inference: {
    /**
     * Effective system instruction (resolved from _system.local.md -> _system.md).
     */
    system_instruction?: string;

    provider: InferenceProviderId;
    openai_compat: {
      profiles: OpenAICompatProfile[];
    };
    anthropic: {
      profiles: AnthropicProfile[];
    };
    codex_oauth: {
      profiles: CodexOAuthProfile[];
    };
  };
  adapters: {
    discord: {
      enabled: boolean;
      app_id?: string; // non-secret (application id / client id)
      bot_token?: string; // secret (prefer local overrides)
      guild_ids?: string[]; // guild whitelist used by registration/runtime filtering
      user_whitelist?: string[]; // allowed Discord user ids for slash/plain-message handling
      force_global_commands?: boolean; // register only global commands (and filter guild replies by whitelist)

      /**
       * Default stream mode for the /eclia slash command when `verbose` is omitted.
       * - final: no intermediate streaming (default)
       * - full: stream intermediate output (tools/deltas)
       */
      default_stream_mode?: "full" | "final";
    };

    telegram: {
      enabled: boolean;
      bot_token?: string; // secret (prefer local overrides)
      /** Allowed Telegram user ids (applies to both private and group chats). */
      user_whitelist?: string[];
      /** Allowed Telegram group/supergroup chat ids (bot replies only when chat.id is in this list). */
      group_whitelist?: string[];
    };
  };

  plugins: {
    /**
     * Listener-type plugins.
     */
    listener: {
      /**
       * Email triage daemon.
       *
       * Watches IMAP mailboxes using ImapFlow (IDLE) and prompts the configured model
       * (no context) to decide whether to notify the user via the `send` tool.
       */
      email: {
        enabled: boolean;
        /** Effective triage template (resolved from plugins/listener/email/_triage.local.md). */
        triage_prompt?: string;
        accounts: EmailListenerAccount[];
      };
    };
  };
};

export type EmailListenerNotifyTarget =
  | { kind: "discord"; channel_id: string }
  | { kind: "telegram"; chat_id: string };

export type EmailListenerAccount = {
  id: string;
  host: string;
  port: number;
  secure: boolean;
  user: string;
  pass?: string; // secret (prefer local overrides)
  mailbox?: string; // default: INBOX
  criterion: string;
  model?: string; // route key
  notify: EmailListenerNotifyTarget;
  /** Deprecated: kept for compatibility. Runtime always behaves as now (ignore existing mail). */
  start_from?: "now" | "all";
  /** Maximum characters to include from the message body. Default: 12000. */
  max_body_chars?: number;
};

export type OpenAICompatProfile = {
  /**
   * Stable identifier used by UI/runtime routing.
   * Not shown to users.
   */
  id: string;

  /**
   * Display name (shown in the Console UI).
   */
  name: string;

  /**
   * Example: https://api.openai.com/v1
   */
  base_url: string;

  /**
   * Real upstream model id (NOT the UI route key).
   */
  model: string;

  /**
   * Secret (prefer local overrides).
   */
  api_key?: string;

  /**
   * Default: Authorization
   */
  auth_header?: string;
};

export type AnthropicProfile = {
  /**
   * Stable identifier used by UI/runtime routing.
   * Not shown to users.
   */
  id: string;

  /**
   * Display name (shown in the Console UI).
   */
  name: string;

  /**
   * Example: https://api.anthropic.com
   * (The gateway will call <base_url>/v1/messages by default.)
   */
  base_url: string;

  /**
   * Real upstream model id (NOT the UI route key).
   */
  model: string;

  /**
   * Secret (prefer local overrides).
   */
  api_key?: string;

  /**
   * Default: x-api-key
   */
  auth_header?: string;

  /**
   * Default: 2023-06-01
   */
  anthropic_version?: string;
};

export type CodexOAuthProfile = {
  /**
   * Stable identifier used by UI/runtime routing.
   */
  id: string;

  /**
   * Display name (shown in the Console UI).
   */
  name: string;

  /**
   * Real upstream model id (NOT the UI route key).
   */
  model: string;

  /**
   * Secret OAuth tokens (prefer local overrides).
   *
   * NOTE: for now we treat these as opaque strings; different backends may
   * return different token sets.
   */
  access_token?: string;
  refresh_token?: string;
  id_token?: string;

  /**
   * Epoch milliseconds, if known.
   */
  expires_at?: number;
};

export type EcliaConfigPatch = Partial<{
  codex_home: string;
  console: Partial<EcliaConfig["console"]>;
  api: Partial<EcliaConfig["api"]>;
  debug: Partial<EcliaConfig["debug"]>;
  skills: Partial<EcliaConfig["skills"]>;
  persona: Partial<EcliaConfig["persona"]>;
  inference: Partial<{
    system_instruction: string;
    provider: EcliaConfig["inference"]["provider"];
    openai_compat: Partial<{
      profiles: Array<
        Partial<Pick<OpenAICompatProfile, "id" | "name" | "base_url" | "model" | "api_key" | "auth_header">> &
          Pick<OpenAICompatProfile, "id">
      >;
    }>;
    anthropic: Partial<{
      profiles: Array<
        Partial<Pick<AnthropicProfile, "id" | "name" | "base_url" | "model" | "api_key" | "auth_header" | "anthropic_version">> &
          Pick<AnthropicProfile, "id">
      >;
    }>;
    codex_oauth: Partial<{
      profiles: Array<
        Partial<Pick<CodexOAuthProfile, "id" | "name" | "model" | "access_token" | "refresh_token" | "id_token" | "expires_at">> &
          Pick<CodexOAuthProfile, "id">
      >;
    }>;
  }>;
  adapters: Partial<{
    discord: Partial<EcliaConfig["adapters"]["discord"]>;
    telegram: Partial<EcliaConfig["adapters"]["telegram"]>;
  }>;
  plugins: Partial<{
    listener: Partial<{
      email: Partial<EcliaConfig["plugins"]["listener"]["email"]>;
    }>;
  }>;
}>;

export const DEFAULT_ECLIA_CONFIG: EcliaConfig = {
  console: { host: "127.0.0.1", port: 5173 },
  api: { port: 8787 },
  debug: {
    capture_upstream_requests: false,
    parse_assistant_output: false
  },
  skills: {
    enabled: []
  },
  persona: {},
  inference: {
    provider: DEFAULT_INFERENCE_PROVIDER,
    openai_compat: {
      profiles: [
        {
          id: DEFAULT_PROFILE_ID,
          name: DEFAULT_PROFILE_NAME,
          base_url: OPENAI_COMPAT_DEFAULT_BASE_URL,
          model: OPENAI_COMPAT_DEFAULT_MODEL,
          auth_header: OPENAI_COMPAT_DEFAULT_AUTH_HEADER
        }
      ]
    },
    anthropic: {
      profiles: [
        {
          id: DEFAULT_PROFILE_ID,
          name: DEFAULT_PROFILE_NAME,
          base_url: ANTHROPIC_DEFAULT_BASE_URL,
          model: ANTHROPIC_DEFAULT_MODEL,
          auth_header: ANTHROPIC_DEFAULT_AUTH_HEADER,
          anthropic_version: ANTHROPIC_DEFAULT_VERSION
        }
      ]
    },
    codex_oauth: {
      profiles: [
        {
          id: DEFAULT_PROFILE_ID,
          name: DEFAULT_PROFILE_NAME,
          // Codex app-server model id (not the UI route key).
          model: CODEX_OAUTH_DEFAULT_MODEL
        }
      ]
    }
  },
  adapters: {
    discord: {
      enabled: false,
      guild_ids: [],
      user_whitelist: [],
      force_global_commands: false,
      default_stream_mode: "final"
    },
    telegram: {
      enabled: false,
      user_whitelist: [],
      group_whitelist: []
    }
  },
  plugins: {
    listener: {
      email: {
        enabled: false,
        accounts: []
      }
    }
  }
};
