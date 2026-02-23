import { getGatewayToken, notifyAuthRequired } from "./gatewayAuth";

function resolveUrlString(input: RequestInfo | URL): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.toString();
  // Request
  return (input as Request).url ?? "";
}

function isSameOriginApi(urlStr: string): boolean {
  if (!urlStr) return false;
  // Relative URL
  if (urlStr.startsWith("/api/")) return true;

  try {
    const u = new URL(urlStr, window.location.href);
    return u.origin === window.location.origin && u.pathname.startsWith("/api/");
  } catch {
    return false;
  }
}

/**
 * Wrapper around fetch() that:
 *  - attaches the gateway bearer token (when configured), and
 *  - emits a global auth-required event on HTTP 401.
 */
export async function apiFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const urlStr = resolveUrlString(input);
  const token = getGatewayToken();

  let headers: Headers | undefined;
  if (isSameOriginApi(urlStr) && token) {
    headers = new Headers(init?.headers ?? {});
    if (!headers.has("Authorization")) headers.set("Authorization", `Bearer ${token}`);
  }

  const resp = await fetch(input, {
    ...init,
    ...(headers ? { headers } : {})
  });

  if (resp.status === 401 && isSameOriginApi(urlStr)) {
    notifyAuthRequired({ url: urlStr, status: resp.status });
  }

  return resp;
}
