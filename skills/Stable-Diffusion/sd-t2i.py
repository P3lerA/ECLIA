#!/usr/bin/env python3
"""
sd-t2i.py — Cross-platform Stable Diffusion WebUI Forge/A1111 txt2img CLI

Contract (automation-friendly):
- Saves image files on the machine running this script (client-side).
- Prints ONLY the absolute saved image path(s) to stdout, one per line.
- Writes errors to stderr and exits non-zero on failure.

Args (unix-style):
  --host <url>              (default: http://127.0.0.1:7860)
  --template, -t <path>     (required) JSON template with model-specific defaults
  --prompt, -p <text>       (required) user prompt (appended after template.prompt)
  --neg, --negative <text>  (optional) extra negatives appended to template.negative_prompt
  --seed <int|string>       (optional) overrides template seed
  --upscale                 (optional) enable Hires Fix (enable_hr=true); default off
  --out, -o <path>          (optional) output file path (absolute or relative)
  --out-dir <dir>           (optional) output directory

Template lookup fallbacks (if --template is not absolute):
  1) relative to current working directory
  2) relative to this script directory
  3) relative to <script_dir>/templates/
"""
from __future__ import annotations

import argparse
import base64
import datetime as _dt
import json
import os
import sys
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any, Dict, List


EXIT_ARG = 2
EXIT_RUN = 1


def eprint(msg: str) -> None:
    sys.stderr.write(msg + "\n")


def _strip_trailing_commas_spaces(s: str) -> str:
    return s.rstrip(" ,\t\r\n")


def resolve_template_path(template_arg: str) -> Path:
    raw = Path(template_arg).expanduser()

    candidates: List[Path]
    if raw.is_absolute():
        candidates = [raw]
    else:
        script_dir = Path(__file__).resolve().parent
        candidates = [
            Path.cwd() / raw,
            script_dir / raw,
            script_dir / "templates" / raw,
        ]

    for p in candidates:
        if p.is_file():
            return p

    tried = "\n".join(f"  - {c}" for c in candidates)
    raise FileNotFoundError(f"Template not found: {template_arg}\nTried:\n{tried}")


def choose_out_dir(out_dir_arg: str | None) -> Path:
    if out_dir_arg and out_dir_arg.strip():
        return Path(out_dir_arg).expanduser()
    env = os.environ.get("ECLIA_ARTIFACT_DIR")
    if env:
        return Path(env).expanduser()
    return Path(".")


def is_abs_or_tilde(p: str) -> bool:
    return p.startswith("~") or Path(p).is_absolute()


def build_out_path(out_dir: Path, out_arg: str | None) -> Path:
    out_dir = out_dir.expanduser()

    if out_arg and out_arg.strip():
        out_arg = out_arg.strip()
        if is_abs_or_tilde(out_arg):
            out_path = Path(out_arg).expanduser()
        else:
            out_path = out_dir / out_arg
    else:
        ts = _dt.datetime.now().strftime("%Y%m%d_%H%M%S")
        out_path = out_dir / f"out_{ts}.png"

    try:
        return out_path.expanduser().resolve(strict=False)  # py3.9+
    except TypeError:
        return Path(os.path.abspath(str(out_path.expanduser())))


def load_json(path: Path) -> Dict[str, Any]:
    try:
        with path.open("r", encoding="utf-8") as f:
            obj = json.load(f)
    except json.JSONDecodeError as ex:
        raise ValueError(f"Failed to parse JSON: {path}\n{ex}") from ex
    if not isinstance(obj, dict):
        raise ValueError(f"Template JSON must be an object/dict: {path}")
    return obj


def merge_prompts(tpl: Dict[str, Any], user_prompt: str, neg_extra: str) -> None:
    tpl_prompt = _strip_trailing_commas_spaces(str(tpl.get("prompt", "") or "").strip())
    user_prompt = (user_prompt or "").strip()

    tpl["prompt"] = f"{tpl_prompt}, {user_prompt}" if tpl_prompt and user_prompt else (tpl_prompt or user_prompt)

    neg = _strip_trailing_commas_spaces(str(tpl.get("negative_prompt", "") or "").strip())
    neg_extra = (neg_extra or "").strip()

    if neg_extra:
        tpl["negative_prompt"] = f"{neg}, {neg_extra}" if neg else neg_extra
    else:
        if neg:
            tpl["negative_prompt"] = neg
        else:
            tpl.pop("negative_prompt", None)


def apply_upscale_toggle(tpl: Dict[str, Any], upscale: bool) -> None:
    if upscale:
        missing = [k for k in ("hr_scale", "hr_upscaler", "hr_second_pass_steps") if k not in tpl]
        if missing:
            raise KeyError(f"Template missing hires keys for --upscale: {missing}")
        tpl["enable_hr"] = True

        # Forge quirk: some versions crash in hires pass if hr_additional_modules is missing or null.
        # The UI's default is ["Use same choices"] and it is a multi-select (list) field.
        ham = tpl.get("hr_additional_modules", None)
        if ham is None:
            tpl["hr_additional_modules"] = ["Use same choices"]
        elif isinstance(ham, str):
            s = ham.strip()
            tpl["hr_additional_modules"] = [s] if s else ["Use same choices"]
        elif isinstance(ham, list):
            # Keep user-provided list as-is, but validate it's list[str].
            if not all(isinstance(x, str) for x in ham):
                raise TypeError("Template key 'hr_additional_modules' must be a list of strings (or omitted).")
        else:
            raise TypeError("Template key 'hr_additional_modules' must be a list of strings (or omitted).")

    else:
        tpl["enable_hr"] = False


def apply_seed_override(tpl: Dict[str, Any], seed_raw: str | None) -> None:
    if seed_raw is None:
        return
    s = seed_raw.strip()
    if not s:
        return
    try:
        tpl["seed"] = int(s)
    except ValueError:
        tpl["seed"] = s


def http_post_json(url: str, payload: Dict[str, Any], timeout_sec: int = 60 * 60) -> bytes:
    data = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    req = urllib.request.Request(
        url=url,
        data=data,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout_sec) as resp:
            return resp.read()
    except urllib.error.HTTPError as ex:
        body = ex.read() if hasattr(ex, "read") else b""
        preview = body[:400].decode("utf-8", errors="replace")
        raise RuntimeError(f"HTTP {ex.code} {ex.reason}\nResponse preview (first 400 chars):\n{preview}") from ex
    except urllib.error.URLError as ex:
        raise RuntimeError(f"HTTP request failed: {ex.reason}") from ex


def parse_response(body: bytes) -> Dict[str, Any]:
    if not body:
        raise RuntimeError("No response body from server.")
    try:
        return json.loads(body)
    except json.JSONDecodeError:
        preview = body[:400].decode("utf-8", errors="replace")
        raise RuntimeError("Non-JSON response from server (first 400 bytes):\n" + preview)


def decode_image_b64(s: str) -> bytes:
    if s.startswith("data:image"):
        s = s.split(",", 1)[1]
    return base64.b64decode(s)


def save_images(out_path: Path, images: List[str]) -> List[Path]:
    out_path.parent.mkdir(parents=True, exist_ok=True)

    if len(images) == 1:
        out_path.write_bytes(decode_image_b64(images[0]))
        return [out_path]

    stem = out_path.stem
    suffix = out_path.suffix if out_path.suffix else ".png"
    saved: List[Path] = []
    for i, s in enumerate(images):
        p = out_path.with_name(f"{stem}_{i}{suffix}")
        p.write_bytes(decode_image_b64(s))
        saved.append(p)
    return saved


def main(argv: List[str]) -> int:
    ap = argparse.ArgumentParser(add_help=False)
    ap.add_argument("--host", default="http://127.0.0.1:7860")
    ap.add_argument("--template", "-t", required=True)
    ap.add_argument("--prompt", "-p", required=True)
    ap.add_argument("--neg", "--negative", dest="neg_extra", default="")
    ap.add_argument("--seed", default=None)
    ap.add_argument("--upscale", action="store_true")
    ap.add_argument("--out", "-o", default=None)
    ap.add_argument("--out-dir", default=None)

    try:
        args = ap.parse_args(argv)
    except SystemExit:
        return EXIT_ARG

    try:
        template_path = resolve_template_path(args.template)
    except Exception as ex:
        eprint(str(ex))
        return EXIT_ARG

    out_dir = choose_out_dir(args.out_dir)
    out_path = build_out_path(out_dir, args.out)

    try:
        tpl = load_json(template_path)
        merge_prompts(tpl, args.prompt, args.neg_extra)
        apply_upscale_toggle(tpl, args.upscale)
        apply_seed_override(tpl, args.seed)
    except (ValueError, KeyError) as ex:
        eprint(str(ex))
        return EXIT_ARG
    except Exception as ex:
        eprint("Failed to build payload: " + str(ex))
        return EXIT_ARG

    url = args.host.rstrip("/") + "/sdapi/v1/txt2img"

    try:
        body = http_post_json(url, tpl)
        r = parse_response(body)
    except Exception as ex:
        eprint(str(ex))
        return EXIT_RUN

    if isinstance(r, dict) and (r.get("error") or (r.get("detail") and not r.get("images"))):
        msg = r.get("error") or r.get("detail") or r
        eprint(f"API error: {msg}")
        return EXIT_RUN

    images = r.get("images") if isinstance(r, dict) else None
    if not images:
        eprint("No images in response.")
        return EXIT_RUN

    try:
        saved = save_images(out_path, images)
    except Exception as ex:
        eprint("Failed to write image(s): " + str(ex))
        return EXIT_RUN

    for p in saved:
        try:
            p_abs = p.resolve(strict=False)
        except TypeError:
            p_abs = Path(os.path.abspath(str(p)))
        sys.stdout.write(str(p_abs) + "\n")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
