import type { EcliaConfig } from "./types.js";

/**
 * Shared request DTO for PUT /api/config.
 *
 * Notes:
 * - Empty strings can have endpoint-specific semantics (e.g. "unchanged" for secrets).
 * - This type models transport shape only; endpoint handlers apply validation/normalization.
 */
export type ConfigApiRequestBody = {
  codex_home?: string;
  console?: { host?: string; port?: number };
  api?: { port?: number };
  memory?: {
    enabled?: boolean;
    host?: string;
    port?: number;
    recent_turns?: number;
    recall_limit?: number;
    timeout_ms?: number;
    embeddings?: {
      model?: string;
    };
  };
  persona?: {
    user_preferred_name?: string;
    assistant_name?: string;
  };
  debug?: {
    capture_upstream_requests?: boolean;
    parse_assistant_output?: boolean;
  };
  skills?: {
    enabled?: string[];
  };
  inference?: {
    system_instruction?: string;
    openai_compat?: {
      profiles?: Array<{
        id: string;
        name?: string;
        base_url?: string;
        model?: string;
        api_key?: string;
        auth_header?: string;
      }>;
    };
    anthropic?: {
      profiles?: Array<{
        id: string;
        name?: string;
        base_url?: string;
        model?: string;
        api_key?: string;
        auth_header?: string;
        anthropic_version?: string;
      }>;
    };
    codex_oauth?: {
      profiles?: Array<{
        id: string;
        name?: string;
        model?: string;
      }>;
    };
  };
  adapters?: {
    discord?: {
      enabled?: boolean;
      app_id?: string;
      bot_token?: string;
      guild_ids?: string[];
      user_whitelist?: string[];
      force_global_commands?: boolean;
      default_stream_mode?: string;
    };

    telegram?: {
      enabled?: boolean;
      bot_token?: string;
      user_whitelist?: string[];
      group_whitelist?: string[];
    };
  };
  tools?: {
    web?: {
      active_profile?: string;
      profiles?: Array<{
        id: string;
        name?: string;
        provider?: string;
        api_key?: string;
        project_id?: string;
      }>;
    };
  };

  plugins?: {
    listener?: {
      email?: {
        enabled?: boolean;
        triage_prompt?: string;
        accounts?: Array<{
          id: string;
          host?: string;
          port?: number;
          secure?: boolean;
          user?: string;
          pass?: string;
          mailbox?: string;
          criterion?: string;
          model?: string;
          notify?: {
            kind?: string;
            channel_id?: string;
            chat_id?: string;
          };
          start_from?: string;
          max_body_chars?: number;
        }>;
      };
    };
  };
};

/**
 * Shared response config shape for GET /api/config.
 * Secrets are intentionally excluded.
 */
export type ConfigApiConfig = {
  codex_home?: string;
  console: { host: string; port: number };
  api?: { port: number };
  memory?: {
    enabled?: boolean;
    host?: string;
    port?: number;
    recent_turns?: number;
    recall_limit?: number;
    timeout_ms?: number;
    embeddings?: {
      model?: string;
    };
  };
  persona?: {
    user_preferred_name?: string;
    assistant_name?: string;
  };
  debug?: {
    capture_upstream_requests?: boolean;
    parse_assistant_output?: boolean;
  };
  skills?: {
    enabled?: string[];
    available?: Array<{ name?: string; summary?: string }>;
  };
  inference?: {
    system_instruction?: string;
    provider?: EcliaConfig["inference"]["provider"] | string;
    openai_compat?: {
      profiles?: Array<{
        id: string;
        name?: string;
        base_url?: string;
        model?: string;
        auth_header?: string;
        api_key_configured?: boolean;
      }>;
    };
    anthropic?: {
      profiles?: Array<{
        id: string;
        name?: string;
        base_url?: string;
        model?: string;
        auth_header?: string;
        anthropic_version?: string;
        api_key_configured?: boolean;
      }>;
    };
    codex_oauth?: {
      profiles?: Array<{
        id: string;
        name?: string;
        model?: string;
      }>;
    };
  };
  adapters?: {
    discord?: {
      enabled?: boolean;
      app_id?: string;
      guild_ids?: string[];
      user_whitelist?: string[];
      force_global_commands?: boolean;
      default_stream_mode?: string;
      app_id_configured?: boolean;
      bot_token_configured?: boolean;
    };

    telegram?: {
      enabled?: boolean;
      user_whitelist?: string[];
      group_whitelist?: string[];
      bot_token_configured?: boolean;
    };
  };
  tools?: {
    web?: {
      active_profile?: string;
      profiles?: Array<{
        id: string;
        name?: string;
        provider?: string;
        project_id?: string;
        api_key_configured?: boolean;
      }>;
    };
  };

  plugins?: {
    listener?: {
      email?: {
        enabled?: boolean;
        triage_prompt?: string;
        accounts?: Array<{
          id: string;
          host?: string;
          port?: number;
          secure?: boolean;
          user?: string;
          mailbox?: string;
          criterion?: string;
          model?: string;
          notify?: {
            kind?: string;
            channel_id?: string;
            chat_id?: string;
          };
          start_from?: string;
          max_body_chars?: number;
          pass_configured?: boolean;
        }>;
      };
    };
  };
};

export type ConfigApiSuccessResponse = {
  ok: true;
  config: ConfigApiConfig;
  restartRequired?: boolean;
  warning?: string;
  // Present in local mock server responses.
  paths?: { base: string; local: string };
};

export type ConfigApiErrorResponse = {
  ok: false;
  error: string;
  hint?: string;
};

export type ConfigApiResponse = ConfigApiSuccessResponse | ConfigApiErrorResponse;
