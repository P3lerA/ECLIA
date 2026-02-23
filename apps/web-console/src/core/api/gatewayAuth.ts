const TOKEN_KEY = "eclia.gatewayToken.v1";

export const AUTH_REQUIRED_EVENT = "eclia:auth-required";

export function getGatewayToken(): string {
  try {
    return String(localStorage.getItem(TOKEN_KEY) ?? "").trim();
  } catch {
    return "";
  }
}

export function setGatewayToken(token: string): void {
  const t = String(token ?? "").trim();
  try {
    if (!t) localStorage.removeItem(TOKEN_KEY);
    else localStorage.setItem(TOKEN_KEY, t);
  } catch {
    // ignore
  }
}

export function clearGatewayToken(): void {
  try {
    localStorage.removeItem(TOKEN_KEY);
  } catch {
    // ignore
  }
}

export function notifyAuthRequired(detail?: any): void {
  try {
    window.dispatchEvent(new CustomEvent(AUTH_REQUIRED_EVENT, { detail }));
  } catch {
    // Fallback for older browsers.
    window.dispatchEvent(new Event(AUTH_REQUIRED_EVENT));
  }
}
