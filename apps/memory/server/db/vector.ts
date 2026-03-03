export const R_DIM = 32;

function randomNormal(): number {
  // Box-Muller transform.
  let u = 0;
  let v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  return Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
}

export function vectorNorm(v: Float32Array): number {
  let s = 0;
  for (let i = 0; i < v.length; i++) s += v[i] * v[i];
  return Math.sqrt(s);
}

export function makeRandomUnitVector(dim: number): Float32Array {
  const a = new Float32Array(dim);
  let s = 0;
  for (let i = 0; i < dim; i++) {
    const x = randomNormal();
    a[i] = x;
    s += x * x;
  }
  const n = Math.sqrt(s) || 1;
  for (let i = 0; i < dim; i++) a[i] /= n;
  return a;
}

export function scaleVectorToNorm(v: Float32Array, target: number): Float32Array {
  const t = Number.isFinite(target) ? Math.max(0, target) : 0;
  if (t === 0) {
    v.fill(0);
    return v;
  }

  const n = vectorNorm(v);
  if (!n) {
    const u = makeRandomUnitVector(v.length);
    for (let i = 0; i < v.length; i++) v[i] = u[i] * t;
    return v;
  }

  const k = t / n;
  for (let i = 0; i < v.length; i++) v[i] *= k;
  return v;
}

export function toVectorJson(v: ArrayLike<number>): string {
  const n = v.length;
  const parts = new Array<string>(n);
  for (let i = 0; i < n; i++) {
    const x = typeof v[i] === "number" ? v[i] : Number(v[i]);
    parts[i] = Number.isFinite(x) ? String(x) : "0";
  }
  return `[${parts.join(",")}]`;
}

export function parseVectorJson(raw: string, dimHint?: number): Float32Array {
  try {
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return new Float32Array(dimHint ?? 0);
    const dim = typeof dimHint === "number" && dimHint > 0 ? dimHint : arr.length;
    const out = new Float32Array(dim);
    for (let i = 0; i < dim; i++) {
      const x = typeof arr[i] === "number" ? arr[i] : typeof arr[i] === "string" ? Number(arr[i]) : NaN;
      out[i] = Number.isFinite(x) ? x : 0;
    }
    return out;
  } catch {
    return new Float32Array(dimHint ?? 0);
  }
}

export const ZERO_R_JSON = `[${new Array(R_DIM).fill(0).join(",")}]`;
