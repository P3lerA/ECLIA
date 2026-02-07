/**
 * Generate a reasonably unique identifier in both secure and insecure browser contexts.
 *
 * Why this exists:
 * - `crypto.randomUUID()` is only available in *secure contexts* (HTTPS / localhost).
 * - ECLIA is often accessed over a LAN IP via plain HTTP (e.g. http://192.168.x.x:5173),
 *   which is an insecure context.
 * - In that scenario, directly calling `crypto.randomUUID()` can throw and break message sending.
 */

let lastMs = 0;
let counter = 0;

export function makeId(prefix = "m"): string {
  const c: any = (globalThis as any).crypto;

  if (c && typeof c.randomUUID === "function") {
    return c.randomUUID();
  }

  // `getRandomValues()` is available in more contexts than `randomUUID()`.
  // Prefer it when possible to keep IDs collision-resistant.
  if (c && typeof c.getRandomValues === "function") {
    return uuidV4FromGetRandomValues(c);
  }

  // Last resort: timestamp + counter + Math.random.
  // (Not cryptographically strong, but good enough for UI message IDs.)
  const now = Date.now();
  if (now === lastMs) counter++;
  else {
    lastMs = now;
    counter = 0;
  }
  return `${prefix}_${now}_${counter}_${Math.random().toString(16).slice(2)}`;
}

function uuidV4FromGetRandomValues(c: { getRandomValues(a: Uint8Array): Uint8Array }): string {
  const b = new Uint8Array(16);
  c.getRandomValues(b);

  // RFC 4122 version 4 UUID.
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;

  const hex = Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
