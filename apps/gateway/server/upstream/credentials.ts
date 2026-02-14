export type UpstreamHeaders = Record<string, string>;

export class MissingCredentialError extends Error {
  readonly code = "missing_credential" as const;

  constructor(message: string) {
    super(message);
    this.name = "MissingCredentialError";
  }
}

/**
 * Credentials are intentionally modeled as a provider so we can later support
 * dynamic auth (OAuth tokens, refresh, device flows, etc.) without touching the
 * chat/tool-loop logic.
 */
export interface CredentialProvider {
  readonly kind: string;
  getHeaders(): Promise<UpstreamHeaders>;
}

export function createStaticApiKeyCredential(args: {
  apiKey: string;
  headerName?: string;
  /**
   * When the header is Authorization, many OpenAI-compatible backends expect a
   * Bearer token. For non-Authorization headers we pass the raw apiKey.
   */
  treatAuthorizationAsBearer?: boolean;
  /**
   * Error message used when apiKey is missing/blank.
   * Keep it user-facing (it will be persisted into the session).
   */
  missingMessage?: string;
}): CredentialProvider {
  const headerName = (args.headerName ?? "Authorization").trim() || "Authorization";
  const apiKey = String(args.apiKey ?? "");
  const treatAuthorizationAsBearer = args.treatAuthorizationAsBearer !== false;

  return {
    kind: "static_api_key",
    async getHeaders() {
      if (!apiKey.trim()) {
        throw new MissingCredentialError(args.missingMessage ?? "Missing API key");
      }

      const isAuth = headerName.toLowerCase() === "authorization";
      const value = isAuth && treatAuthorizationAsBearer ? `Bearer ${apiKey}` : apiKey;
      return { [headerName]: value };
    }
  };
}

/**
 * Codex app-server in managed ChatGPT mode keeps its own auth on disk and
 * refreshes automatically. ECLIA doesn't need to carry any per-request secrets.
 */
export function createNoAuthCredential(): CredentialProvider {
  return {
    kind: "no_auth",
    async getHeaders() {
      return {};
    }
  };
}
