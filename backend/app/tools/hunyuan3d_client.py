"""
Hunyuan3D-2.1 Image-to-3D Client — high-fidelity textured 3D generation via HF Space.
"""
import os
import shutil
import time
from pathlib import Path
from dotenv import load_dotenv

load_dotenv()

# Primary target is Hunyuan3D-2.1; the official 2.0 Space is a drop-in fallback
# with the identical /generation_all API for when 2.1 is paused/asleep.
SPACE_IDS = ["tencent/Hunyuan3D-2.1", "tencent/Hunyuan3D-2"]
MAX_RETRIES = 1
COLD_START_TIMEOUT = 240  # seconds — large model, can take a while to wake up


def _make_client(Client, space_id: str, api_key: str):
    """gradio_client renamed hf_token -> token in v1.x -> 2.x; support both."""
    try:
        return Client(space_id, token=api_key)
    except TypeError:
        return Client(space_id, hf_token=api_key)


def generate_3d_model(image_path: str, output_path: str) -> str:
    """
    Convert a preprocessed 2D image into a textured GLB model using the
    tencent/Hunyuan3D-2.1 Space. Returns output_path on success, None on failure.
    """
    try:
        from gradio_client import Client, handle_file
    except ImportError:
        print("[Hunyuan3D Client] gradio_client not installed. Run: pip install gradio_client")
        return None

    api_key = os.getenv("HF_API_KEY")
    Path(output_path).parent.mkdir(parents=True, exist_ok=True)

    for space_id in SPACE_IDS:
        for attempt in range(MAX_RETRIES + 1):
            try:
                print(f"[Hunyuan3D Client] Connecting to {space_id} (attempt {attempt + 1})...")
                client = _make_client(Client, space_id, api_key)

                print(f"[Hunyuan3D Client] Uploading image: {image_path}")
                result, last_err = _try_generate(client, handle_file, image_path)

                if result is None:
                    raise last_err or RuntimeError("No compatible API endpoint responded on the Space")

                model_path = _extract_model_path(result)

                if model_path and Path(model_path).exists():
                    shutil.copy2(model_path, output_path)
                    print(f"[Hunyuan3D Client] Model saved to {output_path}")
                    return output_path
                elif model_path and str(model_path).startswith("http"):
                    import httpx
                    resp = httpx.get(model_path, follow_redirects=True, timeout=120)
                    if resp.status_code == 200:
                        with open(output_path, "wb") as f:
                            f.write(resp.content)
                        print(f"[Hunyuan3D Client] Model downloaded to {output_path}")
                        return output_path

                print(f"[Hunyuan3D Client] No model file found in result: {result}")

            except Exception as e:
                print(f"[Hunyuan3D Client] Attempt {attempt + 1} on {space_id} failed: {e}")
                if "PAUSED" in str(e) or "RUNTIME_ERROR" in str(e):
                    break  # Space is down — retrying won't help, move to the next Space
                if attempt < MAX_RETRIES:
                    wait = 8 * (attempt + 1)
                    print(f"[Hunyuan3D Client] Retrying in {wait}s (Space may be waking up)...")
                    time.sleep(wait)

    print("[Hunyuan3D Client] All attempts failed")
    return None


# Lean inference params — fewer steps + lower octree resolution trade a little
# surface detail for a large speedup, which matters most when generating 6 models.
GEN_STEPS = 20
GEN_OCTREE = 128
GEN_NUM_CHUNKS = 8000


def _try_generate(client, handle_file, image_path: str):
    """
    Generate a mesh on a Hunyuan3D Space. We call /shape_generation FIRST: it is
    the endpoint that actually works on the live Space and is faster (no texture
    bake pass). The textured /generation_all endpoint is currently erroring
    server-side, so it's only a secondary attempt in case the Space gets fixed.
    """
    last_err = None

    # Fast, reliable shape-only generation with lean params
    try:
        result = client.predict(
            caption="",
            image=handle_file(image_path),
            mv_image_front=None,
            mv_image_back=None,
            mv_image_left=None,
            mv_image_right=None,
            steps=GEN_STEPS,
            guidance_scale=5.0,
            seed=1234,
            octree_resolution=GEN_OCTREE,
            check_box_rembg=True,
            num_chunks=GEN_NUM_CHUNKS,
            randomize_seed=False,
            api_name="/shape_generation",
        )
        return result, None
    except Exception as e:
        last_err = e
        print(f"[Hunyuan3D Client] /shape_generation unavailable: {e}")

    # Secondary: full textured endpoint (works only if the Space is healthy)
    try:
        result = client.predict(
            caption="",
            image=handle_file(image_path),
            mv_image_front=None,
            mv_image_back=None,
            mv_image_left=None,
            mv_image_right=None,
            steps=GEN_STEPS,
            guidance_scale=5.0,
            seed=1234,
            octree_resolution=GEN_OCTREE,
            check_box_rembg=True,
            num_chunks=GEN_NUM_CHUNKS,
            randomize_seed=False,
            api_name="/generation_all",
        )
        return result, None
    except Exception as e:
        last_err = e
        print(f"[Hunyuan3D Client] /generation_all unavailable: {e}")

    return None, last_err


def _extract_model_path(result):
    """Pull a .glb/.obj file path out of the various possible gradio result shapes."""
    if isinstance(result, str):
        return result
    if isinstance(result, dict):
        return result.get("path") or result.get("value") or result.get("url")
    if isinstance(result, (list, tuple)):
        for item in result:
            found = _extract_model_path(item)
            if isinstance(found, str) and (found.endswith(".glb") or found.endswith(".obj")):
                return found
        for item in result:
            found = _extract_model_path(item)
            if found:
                return found
    return None
