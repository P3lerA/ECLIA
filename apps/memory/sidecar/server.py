import os
import shutil
import time
from pathlib import Path
from typing import List

from fastapi import FastAPI, Query
from pydantic import BaseModel, Field

# sentence-transformers lazily downloads models from the Hugging Face Hub.
# https://www.sbert.net/docs/package_reference/sentence_transformer/SentenceTransformer.html
from sentence_transformers import SentenceTransformer


def _env_str(key: str, default: str) -> str:
    v = os.environ.get(key)
    if v is None:
        return default
    s = str(v).strip()
    return s if s else default


def _env_int(key: str, default: int) -> int:
    v = os.environ.get(key)
    if v is None:
        return default
    try:
        return int(str(v).strip())
    except Exception:
        return default


MODEL_NAME = _env_str("ECLIA_EMBEDDINGS_MODEL", "all-MiniLM-L6-v2")

# ---------------------------------------------------------------------------
# HuggingFace cache helpers
# ---------------------------------------------------------------------------


def _hf_cache_dir() -> Path:
    """Resolve the HuggingFace Hub cache directory."""
    # Respect HF_HOME / HF_HUB_CACHE / SENTENCE_TRANSFORMERS_HOME
    if os.environ.get("HF_HUB_CACHE"):
        return Path(os.environ["HF_HUB_CACHE"])
    hf_home = os.environ.get("HF_HOME", str(Path.home() / ".cache" / "huggingface"))
    return Path(hf_home) / "hub"


def _model_cache_path(model_name: str) -> Path:
    safe = "models--" + model_name.replace("/", "--")
    return _hf_cache_dir() / safe


def _is_model_cached(model_name: str) -> bool:
    def _check(name: str) -> bool:
        snapshots = _model_cache_path(name) / "snapshots"
        return snapshots.is_dir() and any(snapshots.iterdir())

    if _check(model_name):
        return True
    # sentence-transformers auto-prefixes short names with "sentence-transformers/"
    if "/" not in model_name:
        return _check(f"sentence-transformers/{model_name}")
    return False


# ---------------------------------------------------------------------------
# Startup: load the configured model
# ---------------------------------------------------------------------------

_model: SentenceTransformer | None = None
_DIM: int = 0

if _is_model_cached(MODEL_NAME):
    _model = SentenceTransformer(MODEL_NAME)
    _DIM = int(_model.get_sentence_embedding_dimension())
    print(f"[embeddings] model loaded from cache: {MODEL_NAME} dim={_DIM}")
else:
    print(f"[embeddings] model not cached: {MODEL_NAME} (use POST /model/download to fetch it)")


# ---------------------------------------------------------------------------
# Request/response models
# ---------------------------------------------------------------------------


class EmbedRequest(BaseModel):
    texts: List[str] = Field(default_factory=list)
    normalize: bool = True


class EmbedResponse(BaseModel):
    ok: bool
    model: str
    dim: int
    embeddings: List[List[float]]


class ModelActionRequest(BaseModel):
    name: str


# ---------------------------------------------------------------------------
# App
# ---------------------------------------------------------------------------

app = FastAPI(title="ECLIA Embeddings Sidecar", version="0.1.0")


@app.get("/health")
def health():
    return {
        "ok": True,
        "service": "embeddings",
        "model": MODEL_NAME,
        "dim": _DIM,
        "model_loaded": _model is not None,
        "ts": int(time.time() * 1000),
    }


@app.post("/embed", response_model=EmbedResponse)
def embed(req: EmbedRequest):
    if _model is None:
        return {"ok": False, "model": MODEL_NAME, "dim": 0, "embeddings": []}

    texts = [str(t) for t in (req.texts or [])]
    if not texts:
        return {"ok": True, "model": MODEL_NAME, "dim": _DIM, "embeddings": []}

    vecs = _model.encode(texts, normalize_embeddings=bool(req.normalize))
    return {"ok": True, "model": MODEL_NAME, "dim": int(vecs.shape[1]), "embeddings": vecs.tolist()}


# ---------------------------------------------------------------------------
# Model management
# ---------------------------------------------------------------------------


@app.get("/model/status")
def model_status(name: str = Query(..., min_length=1)):
    name = name.strip()
    cached = _is_model_cached(name)
    return {"ok": True, "model": name, "cached": cached}


@app.post("/model/download")
def model_download(req: ModelActionRequest):
    global _model, _DIM
    name = req.name.strip()
    if not name:
        return {"ok": False, "error": "name is required"}

    try:
        m = SentenceTransformer(name)
        # If this is the configured model, hot-swap it.
        if name == MODEL_NAME:
            _model = m
            _DIM = int(m.get_sentence_embedding_dimension())
        return {"ok": True, "model": name, "cached": True, "dim": int(m.get_sentence_embedding_dimension())}
    except Exception as e:
        return {"ok": False, "model": name, "error": str(e)}


@app.post("/model/delete")
def model_delete(req: ModelActionRequest):
    global _model, _DIM
    name = req.name.strip()
    if not name:
        return {"ok": False, "error": "name is required"}

    cache_path = _model_cache_path(name)
    try:
        if cache_path.is_dir():
            shutil.rmtree(cache_path)
        # If we just deleted the active model, unload it.
        if name == MODEL_NAME:
            _model = None
            _DIM = 0
        return {"ok": True, "model": name, "cached": False}
    except Exception as e:
        return {"ok": False, "model": name, "error": str(e)}


if __name__ == "__main__":
    import uvicorn

    host = _env_str("ECLIA_EMBEDDINGS_HOST", "127.0.0.1")
    port = _env_int("ECLIA_EMBEDDINGS_PORT", 8789)

    uvicorn.run(app, host=host, port=port, log_level="info")
