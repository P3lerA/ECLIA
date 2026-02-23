export function apiArtifactUrl(path: string): string {
  return `/api/artifacts?path=${encodeURIComponent(path)}`;
}
