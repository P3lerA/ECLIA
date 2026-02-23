import { getGatewayToken } from "./gatewayAuth";

export function apiArtifactUrl(path: string): string {
  const token = getGatewayToken();
  const t = token ? `&token=${encodeURIComponent(token)}` : "";
  return `/api/artifacts?path=${encodeURIComponent(path)}${t}`;
}
