"""
Kaggle GPU Client — TEXTURED image-to-3D via a Hunyuan3D-2 Gradio endpoint you
host on Kaggle.

Set KAGGLE_3D_ENDPOINT in backend/.env to the public gradio.live URL printed by
the Kaggle notebook (kaggle/ONE_CELL_paste_into_kaggle.py). When present, this
runs on YOUR Kaggle GPU — no Hugging Face ZeroGPU quota, colored/detailed meshes.

The endpoint exposes a stable api_name '/generate_3d' taking (image_filepath,
octree_resolution). Higher octree resolution = finer geometry (slower).
"""
import os
import shutil
import time
from pathlib import Path
from dotenv import load_dotenv

load_dotenv()

MAX_RETRIES = 1
# Hunyuan3D-2 octree resolution. 256 is a good quality/speed balance on a T4;
# bump toward 384 for finer detail at the cost of generation time.
OCTREE_RESOLUTION = 256


def is_configured() -> bool:
    """True if a Kaggle endpoint URL is set in the environment."""
    return bool(os.getenv("KAGGLE_3D_ENDPOINT", "").strip())


def probe_endpoint(url: str) -> dict:
    """
    Check that `url` is a live Gradio app exposing the /generate_3d API.
    Returns {"ok": bool, "latency_s": float|None, "error": str|None,
    "has_generate_3d": bool}. Network-bound — call from a worker thread.
    """
    url = (url or "").strip().rstrip("/")
    if not url:
        return {"ok": False, "latency_s": None, "error": "No URL provided",
                "has_generate_3d": False}
    try:
        from gradio_client import Client
    except ImportError:
        return {"ok": False, "latency_s": None,
                "error": "gradio_client not installed on the backend",
                "has_generate_3d": False}

    start = time.time()
    try:
        client = Client(url, verbose=False)
        api = client.view_api(return_format="dict", print_info=False) or {}
        named = api.get("named_endpoints", {}) or {}
        has_api = "/generate_3d" in named
        return {
            "ok": has_api,
            "latency_s": round(time.time() - start, 2),
            "error": None if has_api else (
                "Endpoint is live but does not expose /generate_3d — "
                "is this the URL printed by the Kaggle notebook?"),
            "has_generate_3d": has_api,
        }
    except Exception as e:
        return {"ok": False, "latency_s": round(time.time() - start, 2),
                "error": f"Could not reach endpoint: {e}",
                "has_generate_3d": False}


def generate_3d_model(image_path: str, output_path: str) -> str:
    """
    Convert an image to a textured GLB using the Kaggle-hosted Hunyuan3D-2
    endpoint. Returns output_path on success, None on failure (or if not
    configured). Hunyuan textured generation is slower than TripoSR
    (~60-150s) but far higher quality.
    """
    endpoint = os.getenv("KAGGLE_3D_ENDPOINT", "").strip().rstrip("/")
    if not endpoint:
        return None

    try:
        from gradio_client import Client, handle_file
    except ImportError:
        print("[Kaggle Client] gradio_client not installed")
        return None

    Path(output_path).parent.mkdir(parents=True, exist_ok=True)

    for attempt in range(MAX_RETRIES + 1):
        try:
            print(f"[Kaggle Client] Connecting to {endpoint} (attempt {attempt + 1})...")
            client = Client(endpoint)

            print(f"[Kaggle Client] Uploading image: {image_path}")
            result = client.predict(
                handle_file(image_path),
                OCTREE_RESOLUTION,
                api_name="/generate_3d",
            )

            model_path = _extract_glb_path(result)
            if model_path and Path(model_path).exists():
                shutil.copy2(model_path, output_path)
                print(f"[Kaggle Client] Model saved to {output_path}")
                return output_path
            elif model_path and str(model_path).startswith("http"):
                import httpx
                resp = httpx.get(model_path, follow_redirects=True, timeout=300)
                if resp.status_code == 200:
                    with open(output_path, "wb") as f:
                        f.write(resp.content)
                    print(f"[Kaggle Client] Model downloaded to {output_path}")
                    return output_path

            print(f"[Kaggle Client] No GLB found in result: {result}")

        except Exception as e:
            print(f"[Kaggle Client] Attempt {attempt + 1} failed: {e}")
            if attempt < MAX_RETRIES:
                time.sleep(6)

    print("[Kaggle Client] All attempts failed")
    return None


def _extract_glb_path(result):
    """Pull a .glb/.obj path out of the various gradio result shapes."""
    if isinstance(result, str):
        return result
    if isinstance(result, dict):
        return result.get("path") or result.get("value") or result.get("url")
    if isinstance(result, (list, tuple)):
        for item in result:
            found = _extract_glb_path(item)
            if isinstance(found, str) and (found.endswith(".glb") or found.endswith(".obj")):
                return found
        for item in result:
            found = _extract_glb_path(item)
            if found:
                return found
    return None
