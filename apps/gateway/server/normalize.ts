export function inferVendorFromBaseUrl(baseUrl: string): string | undefined {
  const u = (baseUrl ?? "").toLowerCase();
  if (!u) return undefined;
  if (u.includes("minimax")) return "minimax";
  if (u.includes("openai")) return "openai";
  if (u.includes("anthropic")) return "anthropic";
  if (u.includes("googleapis") || u.includes("generativelanguage")) return "google";
  return "custom";
}
