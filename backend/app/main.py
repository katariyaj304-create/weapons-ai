"""
FastAPI application — main entry point for the backend.
"""
import sys

# Windows consoles default to cp1252 — unicode symbols in pipeline logs (✓/✗/⟐)
# would otherwise raise UnicodeEncodeError inside the generation threads.
if sys.stdout and hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")

import os
import re
import json
import shutil
import uuid
import asyncio
from pathlib import Path
from fastapi import FastAPI, UploadFile, File, Form, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import StreamingResponse, FileResponse
from dotenv import load_dotenv

load_dotenv()

from app.graph import research_graph
from app.schemas import (
    ResearchRequest, ResearchResponse, PartAnnotation,
    AssetGenerationRequest, AssetGenerationResponse, BOMComponent,
    Direct3DGenerationRequest, Direct3DGenerationResponse,
    FreeCADGenerationRequest, FreeCADGenerationResponse
)

app = FastAPI(
    title="Project Anti-Gravity API",
    description="AI-powered 3D model research and annotation engine",
    version="2.0.0"
)

# CORS for frontend
app.add_middleware(
    CORSMiddleware,
    allow_origin_regex=r"^https?://(localhost|127\.0\.0\.1|.*\.onrender\.com)(:\d+)?$",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Create uploads directory for custom GLB files
UPLOAD_DIR = Path(__file__).parent.parent / "uploads"
UPLOAD_DIR.mkdir(exist_ok=True)

# Create generated directory for pipeline outputs
GENERATED_DIR = Path(__file__).parent.parent / "generated"
GENERATED_DIR.mkdir(exist_ok=True)
(GENERATED_DIR / "images").mkdir(exist_ok=True)
(GENERATED_DIR / "models").mkdir(exist_ok=True)

# Serve uploaded files as static
app.mount("/uploads", StaticFiles(directory=str(UPLOAD_DIR)), name="uploads")
# Serve generated files as static
app.mount("/generated", StaticFiles(directory=str(GENERATED_DIR)), name="generated")


@app.get("/api/health")
async def health_check():
    """Health check endpoint."""
    return {
        "status": "healthy",
        "service": "Project Anti-Gravity",
        "version": "2.0.0"
    }


# ============================================
# RUNTIME SETTINGS — Kaggle GPU endpoint (ephemeral gradio.live URL)
# ============================================

ENV_PATH = Path(__file__).parent.parent / ".env"
_URL_RE = re.compile(r"^https://[a-z0-9]+\.gradio\.live/?$|^https?://[\w.:-]+(/[\w./-]*)?$")


def _persist_env_var(key: str, value: str):
    """Write key=value into backend/.env so it survives restarts."""
    lines = []
    if ENV_PATH.exists():
        lines = ENV_PATH.read_text(encoding="utf-8").splitlines()
    replaced = False
    for i, line in enumerate(lines):
        if line.strip().startswith(f"{key}="):
            lines[i] = f"{key}={value}"
            replaced = True
            break
    if not replaced:
        lines.append(f"{key}={value}")
    ENV_PATH.write_text("\n".join(lines) + "\n", encoding="utf-8")


def _persist_kaggle_endpoint(url: str):
    _persist_env_var("KAGGLE_3D_ENDPOINT", url)


@app.get("/api/settings/sketchfab-token")
async def get_sketchfab_token(probe: bool = False):
    """Whether an asset-library token is configured (never returns the token)."""
    from app.tools.sketchfab_client import validate_token
    token = os.getenv("SKETCHFAB_API_TOKEN", "").strip()
    result = {"configured": bool(token)}
    if probe and token:
        result["probe"] = await asyncio.to_thread(validate_token, token)
    return result


@app.post("/api/settings/sketchfab-token")
async def set_sketchfab_token(payload: dict):
    """
    Set (or clear, with token="") the Sketchfab API token used to download
    free CC-licensed weapon models. Validates against the Sketchfab account
    endpoint before saving; applies immediately and persists to .env.
    """
    from app.tools.sketchfab_client import validate_token
    token = str(payload.get("token", "")).strip()
    if not token:
        os.environ["SKETCHFAB_API_TOKEN"] = ""
        _persist_env_var("SKETCHFAB_API_TOKEN", "")
        return {"ok": True, "configured": False,
                "message": "Asset-library token cleared — weapons will be AI-generated."}

    result = await asyncio.to_thread(validate_token, token)
    if not result["ok"]:
        raise HTTPException(status_code=502, detail=result["error"])

    os.environ["SKETCHFAB_API_TOKEN"] = token
    _persist_env_var("SKETCHFAB_API_TOKEN", token)
    return {"ok": True, "configured": True,
            "message": f"Connected to Sketchfab as {result['username']} — "
                       f"library models will be used when available."}


@app.get("/api/settings/kaggle-endpoint")
async def get_kaggle_endpoint(probe: bool = False):
    """
    Current Kaggle GPU endpoint. With ?probe=true, also live-checks that the
    gradio app is up and exposes /generate_3d (the URL is ephemeral — it dies
    when the Kaggle notebook stops).
    """
    from app.tools.kaggle_client import probe_endpoint
    url = os.getenv("KAGGLE_3D_ENDPOINT", "").strip()
    result = {"url": url, "configured": bool(url)}
    if probe and url:
        result["probe"] = await asyncio.to_thread(probe_endpoint, url)
    return result


@app.post("/api/settings/kaggle-endpoint")
async def set_kaggle_endpoint(payload: dict):
    """
    Set (or clear, with url="") the Kaggle GPU endpoint at runtime. Validates
    that the URL is a live Gradio app exposing /generate_3d BEFORE saving; on
    success it applies immediately (no backend restart) and persists to .env.
    """
    from app.tools.kaggle_client import probe_endpoint
    url = str(payload.get("url", "")).strip().rstrip("/")

    if not url:
        os.environ["KAGGLE_3D_ENDPOINT"] = ""
        _persist_kaggle_endpoint("")
        return {"ok": True, "url": "", "configured": False,
                "message": "Kaggle endpoint cleared — 3D generation falls back to HF Spaces."}

    if not _URL_RE.match(url):
        raise HTTPException(status_code=422, detail="Not a valid URL — paste the https://…gradio.live link printed by the Kaggle notebook.")

    result = await asyncio.to_thread(probe_endpoint, url)
    if not result["ok"]:
        raise HTTPException(status_code=502, detail=result["error"])

    os.environ["KAGGLE_3D_ENDPOINT"] = url
    _persist_kaggle_endpoint(url)
    return {"ok": True, "url": url, "configured": True,
            "latency_s": result["latency_s"],
            "message": f"Connected — /generate_3d verified in {result['latency_s']}s. Applied immediately."}


@app.post("/api/research")
async def research_model(request: ResearchRequest):
    """
    Run the full research pipeline on a 3D model.
    Returns comprehensive research data with 3D part mappings.
    """
    try:
        # Prepare initial state for LangGraph
        initial_state = {
            "model_name": request.model_name,
            "mesh_names": request.mesh_names or [],
            "search_results": None,
            "research_data": None,
            "parts": None,
            "status": "started",
            "error": None
        }

        print(f"\n{'='*60}")
        print(f"[Pipeline] Starting research for: {request.model_name}")
        print(f"[Pipeline] Mesh names provided: {len(request.mesh_names or [])}")
        print(f"{'='*60}\n")

        # Run the LangGraph pipeline
        result = research_graph.invoke(initial_state)

        if result.get("status") == "error":
            raise HTTPException(
                status_code=400,
                detail=result.get("error", "Unknown error in pipeline")
            )

        # Build response
        research_data = result.get("research_data", {})
        parts_data = result.get("parts", [])

        response = ResearchResponse(
            model_name=result.get("model_name", request.model_name),
            history=research_data.get("history", "Research data not available."),
            materials=research_data.get("materials", "Research data not available."),
            general_info=research_data.get("general_info", "Research data not available."),
            functionality=research_data.get("functionality", "Research data not available."),
            parts=[PartAnnotation(**p) for p in parts_data]
        )

        print(f"\n[Pipeline] Complete! Found {len(parts_data)} parts.")
        return response

    except HTTPException:
        raise
    except Exception as e:
        print(f"[Pipeline] Error: {e}")
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/upload-model")
async def upload_model(file: UploadFile = File(...)):
    """
    Upload a custom GLB/GLTF 3D model file.
    Returns the URL where the model can be accessed.
    """
    if not file.filename:
        raise HTTPException(status_code=400, detail="No file provided")

    # Validate file extension
    ext = Path(file.filename).suffix.lower()
    if ext not in (".glb", ".gltf"):
        raise HTTPException(
            status_code=400,
            detail="Only .glb and .gltf files are supported"
        )

    # Generate unique filename
    unique_name = f"{uuid.uuid4().hex[:8]}_{file.filename}"
    file_path = UPLOAD_DIR / unique_name

    # Save file
    try:
        with open(file_path, "wb") as buffer:
            shutil.copyfileobj(file.file, buffer)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to save file: {e}")

    return {
        "filename": unique_name,
        "url": f"/uploads/{unique_name}",
        "original_name": file.filename,
        "size": file_path.stat().st_size
    }


_DIRECT_MODEL_RE = re.compile(r"\.(glb|gltf)($|[?#])", re.IGNORECASE)
_SKFB_UID_RE = re.compile(r"([0-9a-f]{32})", re.IGNORECASE)
_MAX_DIRECT_MB = 400


def _download_direct_model(url: str) -> dict:
    """Fetch a remote .glb/.gltf into uploads/ and return {url, name}."""
    import urllib.request
    from urllib.parse import urlparse, unquote

    fname = unquote(Path(urlparse(url).path).name) or "model.glb"
    unique = f"{uuid.uuid4().hex[:8]}_{re.sub(r'[^A-Za-z0-9._-]+', '_', fname)}"
    dest = UPLOAD_DIR / unique
    req = urllib.request.Request(
        url, headers={"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"})
    with urllib.request.urlopen(req, timeout=180) as resp:
        length = int(resp.headers.get("Content-Length") or 0)
        if length > _MAX_DIRECT_MB * 1e6:
            raise RuntimeError(f"File too large ({length / 1e6:.0f} MB)")
        with open(dest, "wb") as f:
            shutil.copyfileobj(resp, f, 1 << 20)

    head = open(dest, "rb").read(16)
    if not (head[:4] == b"glTF" or head.lstrip()[:1] == b"{"):
        dest.unlink(missing_ok=True)
        raise RuntimeError("The URL did not return a GLB/glTF file")
    name = re.sub(r"[_\-]+", " ", Path(fname).stem).strip() or "Remote Model"
    return {"url": f"/uploads/{unique}", "name": name, "kit": None}


async def _run_kit_enrichment(file_path: str, weapon_label: str) -> dict:
    """
    Core intelligence layer for a model file: research the weapon's components,
    read the file's real sub-part names, and map risk/material intel onto them
    so the viewer balloons + spec sheet match generated-assembly quality.
    Raises on failure (callers decide how to degrade); capped at 90 s.
    """
    from app.nodes.exploded import research_parts, map_kit_intel
    from app.tools.sketchfab_client import extract_part_names

    async def _run():
        components = await asyncio.to_thread(research_parts, weapon_label)
        part_names = await asyncio.to_thread(extract_part_names, file_path)
        intel = await asyncio.to_thread(
            map_kit_intel, part_names, components, weapon_label)
        return {"components": components, "intel": intel}

    return await asyncio.wait_for(_run(), timeout=90)


async def _enrich_kit_intel(file_path: str, weapon_label: str) -> dict:
    """Best-effort wrapper used by /api/open-model — never raises."""
    try:
        return await _run_kit_enrichment(file_path, weapon_label)
    except Exception as e:
        print(f"[open-model] intel enrichment skipped: {e}")
        return {"components": [], "intel": {}}


def _kit_response(file_path: str, info: dict) -> dict:
    rel = Path(file_path).relative_to(UPLOAD_DIR).as_posix()
    return {
        "url": f"/uploads/{rel}",
        "name": info.get("name") or "Sketchfab Model",
        "kit": {
            "name": info.get("name", ""), "author": info.get("author", "unknown"),
            "license": info.get("license", "unknown"),
            "page_url": info.get("page_url", ""),
            "likes": info.get("likes", 0), "faces": info.get("faces", 0),
            "source": "sketchfab",
        },
    }


@app.get("/api/sketchfab-search")
async def sketchfab_search(q: str = ""):
    """
    Browse Sketchfab's free downloadable models for a weapon name so the user
    can PICK one instead of auto-fetching the top match. Search is public
    (works without a token); only the download step needs one, which the
    frontend flags via `token_configured`.
    """
    from app.tools import sketchfab_client as skfb

    q = (q or "").strip()
    if not q:
        raise HTTPException(status_code=422, detail="Type a weapon name to search.")
    results = await asyncio.to_thread(skfb.search_models_pooled, q, 24)
    cands = skfb.rank_candidates(results, q, limit=12)
    return {
        "query": q,
        "results": cands,
        "token_configured": skfb.is_configured(),
    }


@app.post("/api/open-model")
async def open_model(payload: dict):
    """
    Open ANY pasted source in the exploded viewer. Accepts:
      - a direct .glb/.gltf URL            -> downloaded into uploads/
      - a Sketchfab model page URL         -> downloaded via the API (token)
      - a weapon name                      -> best free CC Sketchfab model
    Returns {url, name, kit?} where url is served by this backend.
    """
    from app.tools import sketchfab_client as skfb

    source = str(payload.get("source", "")).strip()
    if not source:
        raise HTTPException(status_code=422, detail="Paste a .glb link, a Sketchfab model URL, or a weapon name.")

    is_url = bool(re.match(r"^https?://", source, re.IGNORECASE))

    # 1) Direct .glb/.gltf link
    if is_url and _DIRECT_MODEL_RE.search(source):
        try:
            return await asyncio.to_thread(_download_direct_model, source)
        except Exception as e:
            raise HTTPException(status_code=502, detail=f"Could not download the model: {e}")

    # 2) Sketchfab model page link
    if is_url and "sketchfab.com" in source.lower():
        uid_match = _SKFB_UID_RE.search(source.split("?")[0])
        if not uid_match:
            raise HTTPException(status_code=422, detail="Could not find a model id in that Sketchfab link — paste the model page URL (sketchfab.com/3d-models/...).")
        uid = uid_match.group(1).lower()
        try:
            info = await asyncio.to_thread(skfb.model_info, uid)
        except RuntimeError as e:
            raise HTTPException(status_code=502, detail=str(e))
        if not info["downloadable"]:
            raise HTTPException(status_code=409, detail=f"'{info['name']}' is not downloadable — only free CC-licensed models can be fetched.")
        if not skfb.is_configured():
            raise HTTPException(status_code=409, detail="Downloading needs a free Sketchfab API token — add it in the Asset Library panel (sketchfab.com -> Settings -> Password & API).")
        target = UPLOAD_DIR / "kits" / uid
        existing = (list(target.rglob("*.glb")) or list(target.rglob("*.gltf"))) \
            if target.exists() else []
        try:
            file_path = str(existing[0]) if existing else await asyncio.to_thread(
                skfb.download_model, uid, str(target))
        except RuntimeError as e:
            raise HTTPException(status_code=502, detail=str(e))
        # No AI in this path: the viewer detects, labels, and explodes the
        # parts from the file's own geometry/material data — instant open.
        return _kit_response(file_path, info)

    if is_url:
        raise HTTPException(status_code=422, detail="Unsupported link — paste a direct .glb/.gltf URL or a Sketchfab model page.")

    # 3) Weapon name -> search the free library
    if not skfb.is_configured():
        raise HTTPException(status_code=409, detail="Fetching by name needs a free Sketchfab API token — add it in the Asset Library panel (sketchfab.com -> Settings -> Password & API).")
    try:
        kit = await asyncio.to_thread(skfb.acquire, source, str(UPLOAD_DIR / "kits"))
    except RuntimeError as e:
        raise HTTPException(status_code=502, detail=str(e))
    if not kit:
        raise HTTPException(status_code=404, detail=f"No suitable free 3D model found for '{source}' — try a direct .glb link or the AI Exploded Assembly generator.")
    # No AI in this path: the viewer detects, labels, and explodes the
    # parts from the file's own geometry/material data — instant open.
    return _kit_response(kit["file_path"], kit)


# ============================================
# ASSET INTEL — deep-research engineering layer for library/local models
# ============================================

INTEL_CACHE_DIR = GENERATED_DIR / "intel"
INTEL_CACHE_DIR.mkdir(exist_ok=True)

FRONTEND_PUBLIC_DIR = (Path(__file__).parent.parent.parent
                       / "frontend" / "public").resolve()


def _intel_cache_path(name: str, url: str) -> Path:
    slug = re.sub(r"[^a-z0-9]+", "-", f"{name} {url}".lower()).strip("-")[:150]
    return INTEL_CACHE_DIR / f"{slug or 'asset'}.json"


# The library models' real exploded parts + geometry, dumped by
# frontend/scripts/dump_library_parts.mjs (same detection as the viewer).
LIBRARY_PARTS_PATH = GENERATED_DIR / "library_parts.json"


def _library_parts(url: str) -> dict | None:
    """The detected part table for a library model url, or None."""
    try:
        table = json.loads(LIBRARY_PARTS_PATH.read_text(encoding="utf-8"))
    except Exception:
        return None
    entry = table.get(url.split("?", 1)[0])
    return entry if entry and entry.get("parts") else None


_INTEL_PROFILE_KEYS = ("designation", "platform", "axis_orientation",
                       "operating_principle", "identified", "part_count")


def _resolve_asset_file(url: str) -> Path:
    """
    Map a frontend asset url (/models/... served from frontend/public, or
    /uploads/... served by this backend) to its local file. Rejects anything
    that escapes the served directories (422) or does not exist (404).
    """
    clean = url.split("?", 1)[0].split("#", 1)[0].strip()
    if not clean.startswith("/") or clean.startswith("//"):
        raise HTTPException(status_code=422,
                            detail="url must be a site-relative path like /models/ak-47/model.glb or /uploads/...")
    if clean.startswith("/uploads/"):
        base, rel = UPLOAD_DIR.resolve(), clean[len("/uploads/"):]
    else:
        base, rel = FRONTEND_PUBLIC_DIR, clean.lstrip("/")
    resolved = (base / rel).resolve()
    try:
        resolved.relative_to(base)
    except ValueError:
        raise HTTPException(status_code=422,
                            detail="url resolves outside the served asset directories")
    if not resolved.is_file():
        raise HTTPException(status_code=404, detail=f"No local asset file at {clean}")
    return resolved


@app.post("/api/asset-intel")
async def asset_intel(payload: dict):
    """
    Deep-research engineering intel for a local library asset:
    {"name": "Ak 47", "url": "/models/ak-47/model.glb"} ->
    {"components": [...], "intel": {part_key|label: part}, "cached": bool,
     "error": str|null} plus the platform profile (designation, operating
     principle...) when the asset is a known library model.

    For library models we know the real exploded parts and their geometry, so
    the master-engineer pass identifies EVERY part (see engineering_intel).
    Anything else (uploaded/Sketchfab kits) falls back to name-based kit intel.
    Results are disk-cached per asset; failures degrade to empty intel with an
    error string (never a 500).
    """
    name = str(payload.get("name", "")).strip()
    url = str(payload.get("url", "")).strip()
    if not name or not url:
        raise HTTPException(status_code=422,
                            detail='Body must be {"name": "...", "url": "/models/.../model.glb"}')
    file_path = _resolve_asset_file(url)
    refresh = bool(payload.get("refresh"))

    library = _library_parts(url)

    cache_path = _intel_cache_path(name, url)
    if cache_path.exists() and not refresh:
        try:
            data = json.loads(cache_path.read_text(encoding="utf-8"))
            # A library asset cached before the master-engineer pass existed only
            # has the old 5-bucket intel — re-research it instead of serving it.
            if library and "identified" not in data:
                print(f"[asset-intel] {name!r} has pre-upgrade intel — re-researching")
            else:
                profile = {k: data[k] for k in _INTEL_PROFILE_KEYS if k in data}
                return {"components": data.get("components", []),
                        "intel": data.get("intel", {}),
                        **profile, "cached": True, "error": None}
        except Exception as e:
            print(f"[asset-intel] unreadable cache {cache_path.name} ({e}) — recomputing")

    try:
        if library:
            from app.tools.engineering_intel import analyze_asset_parts
            result = await asyncio.wait_for(
                asyncio.to_thread(analyze_asset_parts, library.get("id", ""), name,
                                  library["parts"]),
                timeout=240)
        else:
            result = await _run_kit_enrichment(str(file_path), name)
        components = result.get("components") or []
        intel = result.get("intel") or {}
    except Exception as e:
        reason = str(e) or type(e).__name__
        if isinstance(e, asyncio.TimeoutError):
            reason = "enrichment timed out"
        low = reason.lower()
        if "402" in reason or "credit" in low or "quota" in low:
            reason = "LLM research unavailable: HF credits exhausted"
        print(f"[asset-intel] enrichment failed for {name!r}: {reason}")
        return {"components": [], "intel": {}, "cached": False, "error": reason[:300]}

    profile = {k: result[k] for k in _INTEL_PROFILE_KEYS if k in result}
    if components:  # cache successful research only
        try:
            cache_path.write_text(
                json.dumps({"name": name, "url": url, **profile,
                            "components": components, "intel": intel}, indent=1),
                encoding="utf-8")
        except Exception as e:
            print(f"[asset-intel] cache write failed: {e}")
    return {"components": components, "intel": intel, **profile,
            "cached": False, "error": None}


from pydantic import BaseModel
from huggingface_hub import InferenceClient
import base64

class ImageData(BaseModel):
    image: str

@app.post("/api/save-image/{model_name}")
async def save_image(model_name: str, data: ImageData):
    try:
        header, encoded = data.image.split(",", 1)
        image_data = base64.b64decode(encoded)
        output_path = Path(__file__).parent.parent.parent / "frontend" / "public" / "images" / f"{model_name}.png"
        output_path.parent.mkdir(parents=True, exist_ok=True)
        with open(output_path, "wb") as f:
            f.write(image_data)
        return {"status": "ok", "file": str(output_path)}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

class ChatRequest(BaseModel):
    message: str

from duckduckgo_search import DDGS

@app.post("/api/chat")
async def chat_with_ai(request: ChatRequest):
    from app.tools.llm import chat as llm_chat

    # Ground the answer in a quick web search
    search_results = ""
    try:
        with DDGS() as ddgs:
            results = list(ddgs.text(request.message, max_results=3))
            if results:
                search_results = "\nWeb Search Results:\n" + "\n".join(
                    f"- {r['title']}: {r['body']}" for r in results
                )
    except Exception as e:
        print(f"[DDG Search Error] {e}")

    system_prompt = (
        "You are a military intelligence AI voice assistant named Ivory. Answer concisely and "
        "professionally (1-3 sentences max). You have access to these search results to help "
        f"answer the query: {search_results}"
    )

    try:
        response = llm_chat(
            [
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": request.message},
            ],
            max_tokens=250,
            temperature=0.3,
        )
        return {"response": response}
    except Exception as e:
        print(f"[Chat API] Error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# ============================================
# ASSET GENERATION PIPELINE — SSE Streaming
# ============================================

@app.post("/api/generate-asset")
async def generate_asset(request: AssetGenerationRequest):
    """
    Full synchronous pipeline: DeepSeek-R1 → FLUX.1-dev → TRELLIS.2/TripoSR.
    Returns BOM + image URLs + GLB URLs.
    """
    from app.graph import asset_generation_graph

    try:
        initial_state = {
            "asset_name": request.asset_name,
            "bom_data": None,
            "image_paths": None,
            "model_paths": None,
            "status": "started",
            "error": None
        }

        result = await asyncio.to_thread(asset_generation_graph.invoke, initial_state)

        if result.get("status") == "error":
            raise HTTPException(status_code=400, detail=result.get("error"))

        bom_data = result.get("bom_data", {})
        components = bom_data.get("components", [])
        overall_risk = sum(c.get("risk_score", 0) for c in components) / max(len(components), 1)

        return AssetGenerationResponse(
            asset_name=bom_data.get("asset_name", request.asset_name),
            components=[BOMComponent(**c) for c in components],
            overall_risk=round(overall_risk, 1),
            pipeline_status="complete"
        )

    except HTTPException:
        raise
    except Exception as e:
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/generate-asset/stream/{asset_name}")
async def stream_asset_generation(asset_name: str):
    """
    SSE endpoint for real-time progress updates during asset generation.
    """
    from app.tools.deepseek_client import analyze_asset
    from app.tools.flux_client import generate_image as flux_generate
    from app.tools import trellis_client, triposr_client

    async def event_generator():
        try:
            # Stage 1: BOM Analysis
            yield f"data: {json.dumps({'phase': 'bom', 'status': 'running', 'message': f'Analyzing {asset_name} with DeepSeek-R1...'})}\n\n"
            await asyncio.sleep(0.1)

            try:
                bom_data = await asyncio.to_thread(analyze_asset, asset_name)
                components = bom_data.get("components", [])
                yield f"data: {json.dumps({'phase': 'bom', 'status': 'complete', 'data': bom_data})}\n\n"
            except Exception as e:
                yield f"data: {json.dumps({'phase': 'error', 'message': f'BOM analysis failed: {str(e)}'})}\n\n"
                return

            # Stage 2: Image Generation
            yield f"data: {json.dumps({'phase': 'image', 'status': 'starting', 'message': f'Generating {len(components)} component images with FLUX.1-dev...'})}\n\n"

            image_paths = []
            for i, component in enumerate(components):
                part_name = component.get("part_name", f"Component_{i}")
                prompt = component.get("hf_flux_prompt", f"{part_name}, orthographic side profile, white background")

                yield f"data: {json.dumps({'phase': 'image', 'component': i, 'status': 'running', 'message': f'Generating {part_name}...'})}\n\n"

                filename = f"{uuid.uuid4().hex[:8]}_{part_name.replace(' ', '_').lower()}.png"
                output_path = str(GENERATED_DIR / "images" / filename)

                try:
                    result_path = await asyncio.to_thread(flux_generate, prompt, output_path)
                    image_paths.append(result_path)
                    component["image_url"] = f"/generated/images/{filename}"
                    yield f"data: {json.dumps({'phase': 'image', 'component': i, 'status': 'complete', 'image_url': f'/generated/images/{filename}'})}\n\n"
                except Exception as e:
                    print(f"[SSE] Image gen failed for {part_name}: {e}")
                    image_paths.append(None)
                    component["image_url"] = None
                    yield f"data: {json.dumps({'phase': 'image', 'component': i, 'status': 'failed', 'message': str(e)})}\n\n"

            # Stage 3: 3D Model Generation
            yield f"data: {json.dumps({'phase': 'model', 'status': 'starting', 'message': 'Converting images to 3D models...'})}\n\n"

            for i, component in enumerate(components):
                part_name = component.get("part_name", f"Component_{i}")
                image_path = image_paths[i] if i < len(image_paths) else None

                if not image_path:
                    component["glb_url"] = None
                    component["model_source"] = None
                    yield f"data: {json.dumps({'phase': 'model', 'component': i, 'status': 'skipped', 'message': 'No image available'})}\n\n"
                    continue

                yield f"data: {json.dumps({'phase': 'model', 'component': i, 'status': 'running', 'message': f'Converting {part_name} to 3D (TRELLIS.2)...'})}\n\n"

                filename = f"{uuid.uuid4().hex[:8]}_{part_name.replace(' ', '_').lower()}.glb"
                output_path = str(GENERATED_DIR / "models" / filename)

                # Try TRELLIS.2 first
                result = await asyncio.to_thread(trellis_client.generate_3d_model, image_path, output_path)
                if result:
                    component["glb_url"] = f"/generated/models/{filename}"
                    component["model_source"] = "trellis"
                    yield f"data: {json.dumps({'phase': 'model', 'component': i, 'status': 'complete', 'glb_url': f'/generated/models/{filename}', 'model_source': 'trellis'})}\n\n"
                    continue

                # Fallback to TripoSR
                yield f"data: {json.dumps({'phase': 'model', 'component': i, 'status': 'running', 'message': f'TRELLIS failed, trying TripoSR for {part_name}...'})}\n\n"

                result = await asyncio.to_thread(triposr_client.generate_3d_model, image_path, output_path)
                if result:
                    component["glb_url"] = f"/generated/models/{filename}"
                    component["model_source"] = "triposr"
                    yield f"data: {json.dumps({'phase': 'model', 'component': i, 'status': 'complete', 'glb_url': f'/generated/models/{filename}', 'model_source': 'triposr'})}\n\n"
                else:
                    component["glb_url"] = None
                    component["model_source"] = None
                    yield f"data: {json.dumps({'phase': 'model', 'component': i, 'status': 'failed', 'message': 'Both 3D generators failed'})}\n\n"

            # Final response
            overall_risk = sum(c.get("risk_score", 0) for c in components) / max(len(components), 1)
            final_data = {
                "asset_name": bom_data.get("asset_name", asset_name),
                "components": components,
                "overall_risk": round(overall_risk, 1),
                "pipeline_status": "complete"
            }
            yield f"data: {json.dumps({'phase': 'complete', 'data': final_data})}\n\n"

        except Exception as e:
            import traceback
            traceback.print_exc()
            yield f"data: {json.dumps({'phase': 'error', 'message': str(e)})}\n\n"

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        }
    )


# ============================================
# DIRECT 3D GENERATOR — name -> best web image -> preprocess -> Hunyuan3D-2.1
# ============================================

@app.post("/api/generate-3d-direct")
async def generate_3d_direct(request: Direct3DGenerationRequest):
    """
    Full synchronous pipeline: web image search -> preprocess -> Hunyuan3D-2.1.
    Given just a weapon name, finds the best reference photo and converts it to a 3D GLB model.
    """
    from app.graph import direct3d_graph

    try:
        initial_state = {
            "weapon_name": request.weapon_name,
            "status": "started",
            "error": None,
        }

        result = await asyncio.to_thread(direct3d_graph.invoke, initial_state)

        if result.get("status") == "error":
            raise HTTPException(status_code=400, detail=result.get("error"))

        return Direct3DGenerationResponse(
            weapon_name=result.get("weapon_name", request.weapon_name),
            source_image_url=result.get("source_image_url"),
            source_url=result.get("source_url"),
            preprocessed_image_url=result.get("preprocessed_url"),
            glb_url=result.get("glb_url"),
            model_source=result.get("model_source"),
            status="complete",
        )

    except HTTPException:
        raise
    except Exception as e:
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/generate-3d-direct/stream/{weapon_name}")
async def stream_generate_3d_direct(weapon_name: str):
    """
    SSE endpoint for real-time progress: find best image -> preprocess -> Hunyuan3D-2.1 3D generation.
    """
    from app.tools.image_finder import find_best_image
    from app.tools.image_preprocess import preprocess_image
    from app.nodes.direct3d import generate_best_3d

    images_dir = GENERATED_DIR / "images"
    models_dir = GENERATED_DIR / "models"
    images_dir.mkdir(parents=True, exist_ok=True)
    models_dir.mkdir(parents=True, exist_ok=True)

    async def event_generator():
        try:
            name = weapon_name.strip()
            if not name:
                yield f"data: {json.dumps({'phase': 'error', 'message': 'No weapon name provided'})}\n\n"
                return

            # Stage 1: Find best reference image
            yield f"data: {json.dumps({'phase': 'search', 'status': 'running', 'message': f'Searching the web for the best reference photo of {name}...'})}\n\n"

            found = await asyncio.to_thread(find_best_image, name, str(images_dir))
            if not found:
                yield f"data: {json.dumps({'phase': 'error', 'message': f'No usable reference image found for {name}'})}\n\n"
                return

            source_filename = Path(found["path"]).name
            source_image_url = f"/generated/images/{source_filename}"
            yield f"data: {json.dumps({'phase': 'search', 'status': 'complete', 'image_url': source_image_url, 'source_url': found['source_url']})}\n\n"

            # Stage 2: Preprocess (background removal, crop, normalize)
            yield f"data: {json.dumps({'phase': 'preprocess', 'status': 'running', 'message': 'Removing background and normalizing the image...'})}\n\n"

            pre_filename = f"{uuid.uuid4().hex[:8]}_preprocessed.png"
            pre_output_path = str(images_dir / pre_filename)

            try:
                await asyncio.to_thread(preprocess_image, found["path"], pre_output_path)
            except Exception as e:
                yield f"data: {json.dumps({'phase': 'error', 'message': f'Preprocessing failed: {str(e)}'})}\n\n"
                return

            preprocessed_url = f"/generated/images/{pre_filename}"
            yield f"data: {json.dumps({'phase': 'preprocess', 'status': 'complete', 'image_url': preprocessed_url})}\n\n"

            # Stage 3: 3D Generation with Hunyuan3D-2.1
            yield f"data: {json.dumps({'phase': 'model', 'status': 'running', 'message': 'Generating 3D model with Hunyuan3D-2.1 (this can take a few minutes)...'})}\n\n"

            model_filename = f"{uuid.uuid4().hex[:8]}_{name.replace(' ', '_').lower()}.glb"
            model_output_path = str(models_dir / model_filename)

            result, model_source = await asyncio.to_thread(generate_best_3d, pre_output_path, model_output_path)

            if not result:
                yield f"data: {json.dumps({'phase': 'error', 'message': 'All 3D generators failed (Hunyuan3D-2.1, TRELLIS.2, TripoSR). The HF Spaces may be busy or paused — try again in a few minutes.'})}\n\n"
                return

            glb_url = f"/generated/models/{model_filename}"
            yield f"data: {json.dumps({'phase': 'model', 'status': 'complete', 'glb_url': glb_url, 'model_source': model_source})}\n\n"

            final_data = {
                "weapon_name": name,
                "source_image_url": source_image_url,
                "source_url": found["source_url"],
                "preprocessed_image_url": preprocessed_url,
                "glb_url": glb_url,
                "model_source": model_source,
            }
            yield f"data: {json.dumps({'phase': 'complete', 'data': final_data})}\n\n"

        except Exception as e:
            import traceback
            traceback.print_exc()
            yield f"data: {json.dumps({'phase': 'error', 'message': str(e)})}\n\n"

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        }
    )


# ============================================
# EXPLODED ASSEMBLY — research 5 parts -> web images -> 3D -> trimesh assembly
# ============================================

@app.get("/api/generate-exploded/stream/{weapon_name}")
async def stream_generate_exploded(weapon_name: str):
    """
    SSE endpoint: research the weapon's 5 major parts, fetch + preprocess web
    reference images for the whole weapon (shell) and each part, generate
    textured 3D models, then combine everything into a single hierarchical
    master assembly GLB (Outer_Shell + Inner_Part_1..5) for the exploded viewer.
    """
    from app.nodes.exploded import (
        research_parts, part_image_query, generate_part_model, build_assembly,
        map_kit_intel, IMAGES_DIR as EXP_IMAGES_DIR,
    )
    from app.tools.image_finder import find_best_images
    from app.tools.image_preprocess import preprocess_image
    from app.tools.pipeline_monitor import qc_image, qc_mesh, qc_assembly
    from app.tools.sketchfab_client import extract_part_names

    async def event_generator():
        try:
            name = weapon_name.strip()
            if not name:
                yield f"data: {json.dumps({'phase': 'error', 'message': 'No weapon name provided'})}\n\n"
                return

            # ---- Stage 0: ASSET LIBRARY first (artist-made kit quality) -----
            # A curated downloadable model beats anything AI can generate from
            # photos. When a Sketchfab token is configured and a well-matched
            # free CC model exists, acquire it and present it directly as the
            # kit — the AI pipeline below is the fallback.
            from app.tools import sketchfab_client
            if sketchfab_client.is_configured():
                yield f"data: {json.dumps({'phase': 'research', 'status': 'running', 'message': f'Searching the curated 3D asset library for {name}...'})}\n\n"
                try:
                    kit = await asyncio.to_thread(
                        sketchfab_client.acquire, name, str(UPLOAD_DIR / "kits"))
                except Exception as e:
                    kit = None
                    yield f"data: {json.dumps({'phase': 'research', 'status': 'running', 'message': f'Asset library unavailable ({str(e)[:120]}) — falling back to AI generation'})}\n\n"
                if kit:
                    rel = Path(kit["file_path"]).relative_to(UPLOAD_DIR).as_posix()
                    kit_url = f"/uploads/{rel}"
                    attribution = {
                        "name": kit["name"], "author": kit["author"],
                        "license": kit["license"], "page_url": kit["page_url"],
                        "likes": kit["likes"], "faces": kit["faces"],
                        "source": "sketchfab",
                    }
                    msg = (f"Library hit: '{kit['name']}' by {kit['author']} "
                           f"({kit['likes']} likes, {kit['faces']:,} faces, {kit['license']})")
                    yield f"data: {json.dumps({'phase': 'assembly', 'status': 'running', 'message': msg})}\n\n"

                    # Intelligence enrichment: research the weapon, read the
                    # kit's real sub-part names, map risk/material intel onto
                    # them. Best-effort — the kit ships either way.
                    kit_components, kit_intel = [], {}
                    try:
                        yield f"data: {json.dumps({'phase': 'research', 'status': 'running', 'message': 'Mapping component intelligence onto the kit parts...'})}\n\n"
                        kit_components = await asyncio.to_thread(research_parts, name)
                        kit_part_names = await asyncio.to_thread(extract_part_names, kit["file_path"])
                        kit_intel = await asyncio.to_thread(
                            map_kit_intel, kit_part_names, kit_components, name)
                        yield f"data: {json.dumps({'phase': 'research', 'status': 'complete', 'data': {'components': kit_components}})}\n\n"
                    except Exception as e:
                        print(f"[Exploded] Kit enrichment skipped: {e}")

                    yield f"data: {json.dumps({'phase': 'assembly', 'status': 'complete', 'glb_url': kit_url})}\n\n"
                    final_data = {
                        "weapon_name": name,
                        "assembly_url": kit_url,
                        "shell_glb_url": kit_url,
                        "shell_image_url": None,
                        "components": kit_components,
                        "kit": attribution,
                        "kit_intel": kit_intel,
                    }
                    yield f"data: {json.dumps({'phase': 'complete', 'data': final_data})}\n\n"
                    return
                yield f"data: {json.dumps({'phase': 'research', 'status': 'running', 'message': 'No suitable library asset — generating with AI pipeline'})}\n\n"

            # ---- Stage 1: AI research -> 5 major parts (Tavily-grounded) ----
            yield f"data: {json.dumps({'phase': 'research', 'status': 'running', 'message': f'Researching the 5 major components of {name}...'})}\n\n"
            try:
                components = await asyncio.to_thread(research_parts, name)
            except Exception as e:
                yield f"data: {json.dumps({'phase': 'error', 'message': f'Research failed: {str(e)}'})}\n\n"
                return
            yield f"data: {json.dumps({'phase': 'research', 'status': 'complete', 'data': {'components': components}})}\n\n"

            # ---- Stage 2+3: shell + 5 parts, SEQUENTIAL with an LLM MONITOR --
            # index 0 = outer shell (whole weapon), 1..5 = inner components.
            # Each subject runs one at a time (a single Kaggle GPU serializes the
            # 3D jobs anyway, so this costs almost nothing) and every stage is
            # gated: the reference image is vision-checked BEFORE GPU time is
            # spent on it, and the resulting mesh is geometry-checked AFTER.
            # A rejected candidate is replaced by the next-best image — nonsense
            # inputs never reach the assembly.
            subjects = [(0, f"{name} (outer shell)", name, None)]
            for i, component in enumerate(components):
                part_name = component.get("part_name", f"Component {i + 1}")
                subjects.append((i + 1, part_name, part_name, part_image_query(name, part_name)))

            results = {}  # idx -> {"images": ..., "model": ...}
            for idx, label, search_label, query in subjects:
                phase = "shell" if idx == 0 else "part"
                comp_field = {} if idx == 0 else {"component": idx - 1}

                def emit(status, **extra):
                    return f"data: {json.dumps({'phase': phase, **comp_field, 'status': status, **extra})}\n\n"

                yield emit("running", message=f"[{idx + 1}/{len(subjects)}] Finding reference images for {label}...")
                candidates = await asyncio.to_thread(
                    find_best_images, search_label, str(EXP_IMAGES_DIR), query, 3)
                if not candidates:
                    yield emit("failed", message=f"No usable reference image found for {label}")
                    if idx > 0:
                        components[idx - 1]["glb_url"] = None
                    continue

                images = None
                model = None
                for ci, cand in enumerate(candidates):
                    verdict = await asyncio.to_thread(
                        qc_image, cand["path"], search_label, name, idx > 0)
                    tag = f"Monitor[{verdict['checked_by']}]"
                    if not verdict["approved"] and ci < len(candidates) - 1:
                        yield emit("running", message=(
                            f"{tag} rejected image {ci + 1} for {label}: "
                            f"{verdict['reason']} — trying next candidate"))
                        continue
                    if not verdict["approved"]:
                        yield emit("running", message=(
                            f"{tag} found no ideal image for {label}; "
                            f"using best available ({verdict['reason']})"))
                    else:
                        yield emit("running", message=(
                            f"{tag} approved image for {label} "
                            f"(confidence {verdict['score']:.2f})"))

                    # Preprocess the approved candidate for 3D reconstruction
                    pre_filename = f"{uuid.uuid4().hex[:8]}_preprocessed.png"
                    pre_path = str(EXP_IMAGES_DIR / pre_filename)
                    try:
                        await asyncio.to_thread(preprocess_image, cand["path"], pre_path)
                    except Exception as e:
                        yield emit("running", message=f"Preprocess failed for {label} ({e}) — next candidate")
                        continue
                    images = {
                        "preprocessed_path": pre_path,
                        "preprocessed_url": f"/generated/images/{pre_filename}",
                        "source_url": cand["source_url"],
                    }
                    yield emit("image_ready" if idx == 0 else "running",
                               image_url=images["preprocessed_url"],
                               message=f"Generating 3D model for {label}...")

                    candidate_model = await asyncio.to_thread(
                        generate_part_model, pre_path, label)
                    if not candidate_model:
                        yield emit("running", message=f"3D generation failed for {label} — trying next image")
                        continue

                    mesh_verdict = await asyncio.to_thread(
                        qc_mesh, candidate_model["glb_path"], label)
                    if mesh_verdict["approved"]:
                        yield emit("running", message=(
                            f"Monitor approved mesh for {label} ({mesh_verdict['reason']})"))
                        model = candidate_model
                        break
                    yield emit("running", message=(
                        f"Monitor rejected mesh for {label}: {mesh_verdict['reason']} — retrying"))

                results[idx] = {"images": images, "model": model} if images else None
                if not model:
                    if idx > 0:
                        components[idx - 1]["image_url"] = (images or {}).get("preprocessed_url")
                        components[idx - 1]["glb_url"] = None
                    yield emit("failed", message=f"3D generation failed for {label}")
                    continue

                if idx > 0:
                    components[idx - 1]["image_url"] = images["preprocessed_url"]
                    components[idx - 1]["glb_url"] = model["glb_url"]
                    components[idx - 1]["model_source"] = model["model_source"]
                yield emit("complete",
                           image_url=images["preprocessed_url"],
                           glb_url=model["glb_url"], model_source=model["model_source"])

            shell_result = results.get(0)
            if not shell_result or not shell_result.get("model"):
                yield f"data: {json.dumps({'phase': 'error', 'message': f'Shell 3D generation failed for {name}'})}\n\n"
                return

            shell_model = shell_result["model"]
            shell_images = shell_result["images"]
            part_glb_paths = [
                (results.get(i + 1) or {}).get("model", {}).get("glb_path") if (results.get(i + 1) or {}).get("model") else None
                for i in range(len(components))
            ]

            if not any(part_glb_paths):
                yield f"data: {json.dumps({'phase': 'error', 'message': 'All 5 part generations failed — cannot build assembly'})}\n\n"
                return

            # ---- Stage 4: trimesh normalization + master assembly ----
            yield f"data: {json.dumps({'phase': 'assembly', 'status': 'running', 'message': 'Placing parts anatomically inside the shell silhouette...'})}\n\n"
            try:
                assembly = await asyncio.to_thread(
                    build_assembly, name, shell_model["glb_path"], part_glb_paths,
                    components,
                )
            except Exception as e:
                yield f"data: {json.dumps({'phase': 'error', 'message': f'Assembly build failed: {str(e)}'})}\n\n"
                return

            # ---- Stage 5: MONITOR looks at the assembled result -------------
            # Render the rest-state assembly and let the vision LLM check it
            # reads as ONE weapon. If parts protrude, rebuild once with all
            # parts globally shrunk — geometric containment plus a second pair
            # of eyes.
            yield f"data: {json.dumps({'phase': 'assembly', 'status': 'running', 'message': 'Monitor inspecting the assembled weapon...'})}\n\n"
            try:
                preview_png = assembly["glb_path"].rsplit(".", 1)[0] + "_qc.png"
                verdict = await asyncio.to_thread(qc_assembly, assembly["glb_path"], name, preview_png)
                reason = verdict.get("reason", "")
                if not verdict["approved"]:
                    msg = f"Monitor flagged the assembly ({reason}) — rebuilding with tighter part sizing..."
                    yield f"data: {json.dumps({'phase': 'assembly', 'status': 'running', 'message': msg})}\n\n"
                    assembly = await asyncio.to_thread(
                        build_assembly, name, shell_model["glb_path"], part_glb_paths,
                        components, 0.78,
                    )
                    yield f"data: {json.dumps({'phase': 'assembly', 'status': 'running', 'message': 'Auto-corrected assembly rebuilt (parts scaled down 22%)'})}\n\n"
                else:
                    msg = f"Monitor approved the assembly: {reason}"
                    yield f"data: {json.dumps({'phase': 'assembly', 'status': 'running', 'message': msg})}\n\n"
            except Exception as e:
                print(f"[Exploded] Assembly QC skipped: {e}")

            yield f"data: {json.dumps({'phase': 'assembly', 'status': 'complete', 'glb_url': assembly['glb_url']})}\n\n"

            final_data = {
                "weapon_name": name,
                "assembly_url": assembly["glb_url"],
                "shell_glb_url": shell_model["glb_url"],
                "shell_image_url": shell_images["preprocessed_url"],
                "components": components,
            }
            yield f"data: {json.dumps({'phase': 'complete', 'data': final_data})}\n\n"

        except Exception as e:
            import traceback
            traceback.print_exc()
            yield f"data: {json.dumps({'phase': 'error', 'message': str(e)})}\n\n"

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        }
    )


# ============================================
# WEAPONS NEWS FEED — latest field news + one-line "bottom line" captions
# ============================================

_NEWS_CACHE = {"data": None, "ts": 0}
_NEWS_TTL = 600  # seconds


def _fetch_weapons_news(query: str, limit: int = 12) -> list:
    """Fetch recent news via DDGS, then add a one-line 'bottom line' per item."""
    try:
        from ddgs import DDGS
    except ImportError:
        from duckduckgo_search import DDGS

    raw = []
    try:
        with DDGS() as ddgs:
            raw = list(ddgs.news(query, safesearch="off", max_results=limit))
    except Exception as e:
        print(f"[News] Search failed: {e}")
        return []

    items = []
    for r in raw:
        items.append({
            "title": r.get("title", ""),
            "body": (r.get("body", "") or "")[:400],
            "url": r.get("url", ""),
            "source": r.get("source", ""),
            "date": r.get("date", ""),
            "image": r.get("image", ""),
            "bottom_line": "",
        })

    # One LLM call to caption every headline with a crisp bottom line
    try:
        from app.tools.llm import chat as llm_chat

        headlines = "\n".join(f"{i+1}. {it['title']} — {it['body'][:160]}" for i, it in enumerate(items))
        text = llm_chat(
            [
                {"role": "system", "content": (
                    "You are a defense-desk editor. For each numbered news item, write a single "
                    "punchy 'bottom line' sentence (max 18 words) capturing why it matters. "
                    "Output ONLY a JSON array of strings in the same order, nothing else.")},
                {"role": "user", "content": headlines},
            ],
            max_tokens=1024,
            temperature=0.3,
        )
        match = re.search(r"\[.*\]", text, re.DOTALL)
        if match:
            lines = json.loads(match.group())
            for i, line in enumerate(lines):
                if i < len(items):
                    items[i]["bottom_line"] = str(line)
    except Exception as e:
        print(f"[News] Caption generation failed: {e}")

    return items


@app.get("/api/news")
async def weapons_news(q: str = "military weapons defense technology"):
    """
    Latest weapons/defense field news with a one-line 'bottom line' per story.
    Cached for 10 minutes to stay within search + inference limits.
    """
    import time
    now = time.time()
    if _NEWS_CACHE["data"] and (now - _NEWS_CACHE["ts"]) < _NEWS_TTL:
        return {"items": _NEWS_CACHE["data"], "cached": True}

    items = await asyncio.to_thread(_fetch_weapons_news, q)
    if items:
        _NEWS_CACHE["data"] = items
        _NEWS_CACHE["ts"] = now
    return {"items": items, "cached": False}


# ============================================
# EVOLUTION TIMELINE — concept → prototype → adoption → variants → current, with sources
# ============================================

EVOLUTION_DIR = GENERATED_DIR / "evolution"
EVOLUTION_DIR.mkdir(exist_ok=True)


def _evolution_cache_path(weapon: str) -> Path:
    slug = re.sub(r"[^a-z0-9]+", "-", weapon.lower()).strip("-") or "unknown"
    return EVOLUTION_DIR / f"{slug}.json"


@app.get("/api/evolution")
async def weapon_evolution(weapon: str, refresh: bool = False):
    """Sourced design evolution of a weapon, from original concept to its current form.

    Cached to disk per weapon — the research + synthesis pass costs ~30-60s, and a
    weapon's history does not change between sessions. `refresh=true` re-researches.
    """
    name = (weapon or "").strip()
    if not name:
        raise HTTPException(status_code=422, detail="A weapon name is required.")

    cache = _evolution_cache_path(name)
    if cache.exists() and not refresh:
        try:
            return {**json.loads(cache.read_text(encoding="utf-8")), "cached": True}
        except Exception as e:
            print(f"[Evolution] cache read failed for {name}: {e}")

    from app.tools.evolution import build_evolution

    try:
        doc = await asyncio.to_thread(build_evolution, name)
    except Exception as e:
        raise HTTPException(status_code=502, detail=str(e))

    try:
        cache.write_text(json.dumps(doc, indent=2), encoding="utf-8")
    except Exception as e:
        print(f"[Evolution] cache write failed for {name}: {e}")

    return {**doc, "cached": False}


# ============================================
# MATERIALS ANALYSIS — component materials, strength-of-materials, cost & selection
# ============================================

MATERIALS_DIR = GENERATED_DIR / "materials"
MATERIALS_DIR.mkdir(exist_ok=True)


def _materials_cache_path(weapon: str) -> Path:
    slug = re.sub(r"[^a-z0-9]+", "-", weapon.lower()).strip("-") or "unknown"
    return MATERIALS_DIR / f"{slug}.json"


@app.get("/api/materials")
async def weapon_materials(weapon: str, refresh: bool = False):
    """Chief-materials-engineer dossier for a weapon: per-component materials, strength-of-materials,
    the army's cost/selection trade-off, and best-in-class material recommendations.

    Cached to disk per weapon (research + synthesis ~20s). `refresh=true` re-researches.
    """
    name = (weapon or "").strip()
    if not name:
        raise HTTPException(status_code=422, detail="A weapon name is required.")

    cache = _materials_cache_path(name)
    if cache.exists() and not refresh:
        try:
            return {**json.loads(cache.read_text(encoding="utf-8")), "cached": True}
        except Exception as e:
            print(f"[Materials] cache read failed for {name}: {e}")

    from app.tools.materials import build_materials

    try:
        doc = await asyncio.to_thread(build_materials, name)
    except Exception as e:
        raise HTTPException(status_code=502, detail=str(e))

    try:
        cache.write_text(json.dumps(doc, indent=2), encoding="utf-8")
    except Exception as e:
        print(f"[Materials] cache write failed for {name}: {e}")

    return {**doc, "cached": False}


MATERIAL_PROFILE_DIR = GENERATED_DIR / "material_profiles"
MATERIAL_PROFILE_DIR.mkdir(exist_ok=True)


def _material_profile_cache_path(material: str) -> Path:
    slug = re.sub(r"[^a-z0-9]+", "-", material.lower()).strip("-") or "unknown"
    return MATERIAL_PROFILE_DIR / f"{slug}.json"


@app.get("/api/material-analysis")
async def material_analysis(material: str, refresh: bool = False):
    """Deep engineering assay of a single material (alloy/polymer/composite) as used in weapons:
    composition, mechanical properties, strength-of-materials behaviour, an 8-axis rating profile,
    weapon applications, processing, pros/cons and alternatives. Cached to disk per material.
    """
    name = (material or "").strip()
    if not name:
        raise HTTPException(status_code=422, detail="A material name is required.")

    cache = _material_profile_cache_path(name)
    if cache.exists() and not refresh:
        try:
            return {**json.loads(cache.read_text(encoding="utf-8")), "cached": True}
        except Exception as e:
            print(f"[MaterialProfile] cache read failed for {name}: {e}")

    from app.tools.material_profile import build_material_profile

    try:
        doc = await asyncio.to_thread(build_material_profile, name)
    except Exception as e:
        raise HTTPException(status_code=502, detail=str(e))

    try:
        cache.write_text(json.dumps(doc, indent=2), encoding="utf-8")
    except Exception as e:
        print(f"[MaterialProfile] cache write failed for {name}: {e}")

    return {**doc, "cached": False}


# ============================================
# FREECAD MASTER AI ENDPOINTS
# ============================================

import json
from fastapi.responses import StreamingResponse

try:
    from app.tools.freecad_mcp_setup import get_full_status, install_mcp_addon
    from app.tools.freecad_ai_controller import FreeCADMasterController
    from app.tools.freecad_mcp_bridge import FreeCADMCPBridge
except ImportError as _imp_err:
    print(f"[FreeCAD MCP] Import warning: {_imp_err}")
    get_full_status = None
    install_mcp_addon = None
    FreeCADMasterController = None
    FreeCADMCPBridge = None

@app.get("/api/freecad/status")
async def get_freecad_status():
    """Check FreeCAD software installation status on host machine."""
    from app.tools.freecad_engine import detect_freecad
    status = detect_freecad()
    if get_full_status:
        try:
            status["mcp_status"] = get_full_status()
        except Exception:
            pass
    return status

@app.get("/api/freecad/mcp-status")
async def get_freecad_mcp_status():
    if not get_full_status:
        return {"error": "MCP setup module not available"}
    try:
        return get_full_status()
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/freecad/mcp-setup")
async def setup_freecad_mcp():
    if not install_mcp_addon:
        return {"error": "MCP setup module not available"}
    try:
        success = install_mcp_addon()
        return {"installed": success, "status": get_full_status() if get_full_status else {}}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/freecad/generate/stream/{weapon_name}")
async def generate_freecad_model_stream(
    weapon_name: str, 
    time_limit: int = 360, 
    quality_threshold: int = 75, 
    max_iterations: int = 8, 
    enable_web_search: bool = True
):
    if not FreeCADMasterController or not FreeCADMCPBridge:
        raise HTTPException(status_code=500, detail="FreeCAD MCP modules not available")
        
    async def event_generator():
        queue = asyncio.Queue()
        
        def progress_callback(phase, data):
            try:
                queue.put_nowait({"phase": phase, **data})
            except Exception:
                pass
        
        bridge = FreeCADMCPBridge()
        host = os.getenv("FREECAD_MCP_HOST", "localhost")
        port = int(os.getenv("FREECAD_MCP_PORT", "9875"))
        bridge.connect(host, port)
                
        controller = FreeCADMasterController(
            mcp_bridge=bridge,
            generated_dir=str(GENERATED_DIR / "models"),
            max_iterations=max_iterations,
            time_limit=time_limit,
            quality_threshold=quality_threshold
        )
        
        task = asyncio.create_task(asyncio.to_thread(controller.master_loop, weapon_name, progress_callback))
        
        while not task.done() or not queue.empty():
            try:
                event = await asyncio.wait_for(queue.get(), timeout=1.0)
                yield f"data: {json.dumps(event)}\n\n"
            except asyncio.TimeoutError:
                continue
            except Exception as e:
                yield f"data: {json.dumps({'phase': 'error', 'message': str(e)})}\n\n"
                break
                
        try:
            await task
        except Exception as e:
            yield f"data: {json.dumps({'phase': 'error', 'message': str(e)})}\n\n"
            
    return StreamingResponse(event_generator(), media_type="text/event-stream")


@app.get("/api/freecad/hf-models")
async def get_freecad_hf_models():
    """Get recommended open-access Hugging Face AI models for 3D & CAD generation."""
    from app.tools.freecad_engine import get_recommended_hf_models
    return {"models": get_recommended_hf_models()}


@app.post("/api/freecad/generate", response_model=FreeCADGenerationResponse)
async def generate_freecad_model(req: FreeCADGenerationRequest):
    """
    Generate 3D CAD weapon / military vehicle (e.g. Arjun MBT) model using
    the FreeCAD Master AI Engine with iterative refinement.
    """
    asset_name = req.asset_name.strip()
    if not asset_name:
        raise HTTPException(status_code=422, detail="An asset name is required.")
        
    if FreeCADMasterController and FreeCADMCPBridge:
        try:
            bridge = FreeCADMCPBridge()
            host = os.getenv("FREECAD_MCP_HOST", "localhost")
            port = int(os.getenv("FREECAD_MCP_PORT", "9875"))
            bridge.connect(host, port)
            
            controller = FreeCADMasterController(
                mcp_bridge=bridge,
                generated_dir=str(GENERATED_DIR / "models"),
                max_iterations=req.max_iterations,
                time_limit=req.time_limit,
                quality_threshold=req.quality_threshold
            )
            
            def noop_cb(phase, data): pass
            
            res = await asyncio.to_thread(controller.master_loop, asset_name, noop_cb)
            return res
        except Exception as e:
            raise HTTPException(status_code=500, detail=f"FreeCAD Generation Error: {str(e)}")
    else:
        from app.tools.freecad_engine import generate_freecad_5pass
        try:
            res = await asyncio.to_thread(
                generate_freecad_5pass,
                asset_name=asset_name,
                enable_web_search=req.enable_web_search,
                generated_dir=GENERATED_DIR
            )
            return res
        except Exception as e:
            raise HTTPException(status_code=500, detail=f"FreeCAD Generation Error: {str(e)}")


# ============================================
# UNIFIED FRONTEND SERVING (1-TURN DEPLOYMENT)
# ============================================
REPO_ROOT = Path(__file__).resolve().parent.parent.parent
FRONTEND_DIST = REPO_ROOT / "frontend" / "dist"
FRONTEND_PUBLIC = REPO_ROOT / "frontend" / "public"

if (FRONTEND_PUBLIC / "models").exists():
    app.mount("/models", StaticFiles(directory=str(FRONTEND_PUBLIC / "models")), name="public_models")
if (FRONTEND_PUBLIC / "images").exists():
    app.mount("/images", StaticFiles(directory=str(FRONTEND_PUBLIC / "images")), name="public_images")

if FRONTEND_DIST.exists():
    if (FRONTEND_DIST / "assets").exists():
        app.mount("/assets", StaticFiles(directory=str(FRONTEND_DIST / "assets")), name="dist_assets")

    @app.get("/{full_path:path}")
    async def serve_spa(full_path: str):
        # Prevent catching API, uploads, or generated routes
        if full_path.startswith(("api/", "uploads/", "generated/")):
            raise HTTPException(status_code=404, detail="Not Found")
        
        target = FRONTEND_DIST / full_path
        if full_path and target.is_file():
            return FileResponse(target)
            
        index_file = FRONTEND_DIST / "index.html"
        if index_file.exists():
            return FileResponse(index_file)
        return {"message": "Frontend build not found. Please run npm run build."}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("app.main:app", host="0.0.0.0", port=8000, reload=True)

