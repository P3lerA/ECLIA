#!/usr/bin/env bash
set -euo pipefail
command -v python3 >/dev/null || { echo "python3 not found" >&2; exit 127; }

HOST="http://127.0.0.1:7860"
TEMPLATE=""
PROMPT=""
NEG_EXTRA=""
UPSCALE=0
OUT=""
OUT_DIR=""
SEED=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --host) HOST="$2"; shift 2;;
    --template|-t) TEMPLATE="$2"; shift 2;;
    --prompt|-p) PROMPT="$2"; shift 2;;
    --neg|--negative) NEG_EXTRA="$2"; shift 2;;
    --seed) SEED="$2"; shift 2;;
    --upscale) UPSCALE=1; shift;;
    --out|-o) OUT="$2"; shift 2;;
    --out-dir) OUT_DIR="$2"; shift 2;;
    *) echo "Unknown arg: $1" >&2; exit 2;;
  esac
done

if [[ -z "$TEMPLATE" ]]; then echo "Missing --template" >&2; exit 2; fi
if [[ ! -f "$TEMPLATE" ]]; then echo "Template not found: $TEMPLATE" >&2; exit 2; fi
if [[ -z "$PROMPT" ]]; then echo "Missing --prompt" >&2; exit 2; fi

# Choose default output directory
if [[ -z "$OUT_DIR" ]]; then
  OUT_DIR="${ECLIA_ARTIFACT_DIR:-.}"
fi
# Expand ~ in OUT_DIR if present
if [[ "$OUT_DIR" == "~"* ]]; then
  OUT_DIR="${OUT_DIR/#\~/$HOME}"
fi

# Determine output path
timestamp="out_$(date +%Y%m%d_%H%M%S).png"
if [[ -z "$OUT" ]]; then
  OUT_PATH="${OUT_DIR%/}/${timestamp}"
else
  if [[ "$OUT" == /* || "$OUT" == "~"* ]]; then
    # absolute or ~ path overrides OUT_DIR
    OUT_PATH="${OUT/#\~/$HOME}"
  else
    # relative OUT goes under OUT_DIR
    OUT_PATH="${OUT_DIR%/}/${OUT}"
  fi
fi

PAYLOAD="$(python3 - "$TEMPLATE" "$PROMPT" "$NEG_EXTRA" "$UPSCALE" "$SEED" <<'PY'
import json, sys

template_path, user_prompt, neg_extra, upscale_flag, seed = sys.argv[1:6]
upscale = (upscale_flag == "1")

with open(template_path, "r", encoding="utf-8") as f:
    tpl = json.load(f)

tpl_prompt = (tpl.get("prompt") or "").strip()
user_prompt = (user_prompt or "").strip()

if user_prompt:
    if tpl_prompt:
        prompt = tpl_prompt.rstrip(", ") + ", " + user_prompt
    else:
        prompt = user_prompt
else:
    prompt = tpl_prompt

neg = (tpl.get("negative_prompt") or "").strip()
neg_extra = (neg_extra or "").strip()
if neg_extra:
    neg = (neg.rstrip(", ") + ", " + neg_extra) if neg else neg_extra

payload = dict(tpl)
payload["prompt"] = prompt
if neg:
    payload["negative_prompt"] = neg
else:
    payload.pop("negative_prompt", None)

# Upscale toggle: default OFF unless --upscale
if upscale:
    missing = [k for k in ("hr_scale", "hr_upscaler", "hr_second_pass_steps") if k not in payload]
    if missing:
        print(f"Template missing hires keys for --upscale: {missing}", file=sys.stderr)
        sys.exit(2)
    payload["enable_hr"] = True
else:
    payload["enable_hr"] = False

# Optional seed override
if seed:
    try:
        payload["seed"] = int(seed)
    except ValueError:
        payload["seed"] = seed

print(json.dumps(payload, ensure_ascii=False))
PY
)"

PY_DECODE=$(cat <<'PY'
import sys, json, base64
from pathlib import Path

out_path = Path(sys.argv[1]).expanduser().resolve()

data = sys.stdin.buffer.read()
if not data:
    print("No response body from server.", file=sys.stderr)
    sys.exit(1)

try:
    r = json.loads(data)
except json.JSONDecodeError:
    preview = data[:400].decode("utf-8", errors="replace")
    print("Non-JSON response from server (first 400 bytes):\n" + preview, file=sys.stderr)
    sys.exit(1)

if isinstance(r, dict) and (r.get("error") or (r.get("detail") and not r.get("images"))):
    msg = r.get("error") or r.get("detail") or r
    print(f"API error: {msg}", file=sys.stderr)
    sys.exit(1)

images = r.get("images") or []
if not images:
    print("No images in response.", file=sys.stderr)
    sys.exit(1)

def decode_image(s: str) -> bytes:
    if s.startswith("data:image"):
        s = s.split(",", 1)[1]
    return base64.b64decode(s)

out_path.parent.mkdir(parents=True, exist_ok=True)

if len(images) == 1:
    out_path.write_bytes(decode_image(images[0]))
    print(str(out_path))  # stdout ONLY: artifact path
else:
    stem = out_path.stem
    suffix = out_path.suffix if out_path.suffix else ".png"
    for i, s in enumerate(images):
        p = out_path.with_name(f"{stem}_{i}{suffix}")
        p.write_bytes(decode_image(s))
        print(str(p))
PY
)

curl -sS --fail \
  -H "Content-Type: application/json" \
  -d "$PAYLOAD" \
  "$HOST/sdapi/v1/txt2img" \
| python3 -c "$PY_DECODE" "$OUT_PATH"

