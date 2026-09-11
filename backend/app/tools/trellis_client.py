"""
TRELLIS.2 Image-to-3D Client — converts 2D images to fully TEXTURED GLB models
via the microsoft/TRELLIS.2 HF Space (TRELLIS.2-4B model).

The Space uses a session-based Gradio API:
  1. /start_session      — initializes per-session state on the Space
  2. /preprocess_image   — background removal + normalization on the Space side
  3. /image_to_3d        — runs the model, stores the result in session state
  4. /extract_glb        — bakes texture + decimates and returns the GLB file
"""
import os
import shutil
import time
from pathlib import Path
from dotenv import load_dotenv

load_dotenv()

SPACE_ID = "microsoft/TRELLIS.2"
MAX_RETRIES = 0  # fallback-only; its image_to_3d is erroring server-side, don't burn time retrying
TEXTURE_SIZE = 1024
DECIMATION_TARGET = 150000


def generate_3d_model(image_path: str, output_path: str) -> str:
    """
    Convert a 2D image to a textured GLB 3D model using microsoft/TRELLIS.2.
    Returns output_path on success, None on failure.
    """
    try:
        from gradio_client import Client, handle_file
    except ImportError:
        print("[TRELLIS Client] gradio_client not installed. Run: pip install gradio_client")
        return None

    api_key = os.getenv("HF_API_KEY")
    Path(output_path).parent.mkdir(parents=True, exist_ok=True)

    for attempt in range(MAX_RETRIES + 1):
        try:
            print(f"[TRELLIS Client] Connecting to {SPACE_ID} (attempt {attempt + 1})...")
            try:
                client = Client(SPACE_ID, token=api_key)
            except TypeError:
                client = Client(SPACE_ID, hf_token=api_key)

            # 1. Initialize session state on the Space
            try:
                client.predict(api_name="/start_session")
            except Exception as se:
                print(f"[TRELLIS Client] start_session skipped: {se}")

            # 2. Space-side preprocessing (background removal / alpha)
            print(f"[TRELLIS Client] Preprocessing image: {image_path}")
            try:
                preprocessed = client.predict(
                    input=handle_file(image_path),
                    api_name="/preprocess_image"
                )
            except Exception as pe:
                print(f"[TRELLIS Client] Preprocess step skipped: {pe}")
                preprocessed = None

            # 3. Run image -> 3D (result is stored in the session; the return
            #    value is just an HTML preview we can ignore). The preprocessed
            #    output is a client-side download — it must be re-uploaded via
            #    handle_file or the Space tries to read our local path.
            print("[TRELLIS Client] Running image_to_3d (textured)...")
            source = preprocessed if isinstance(preprocessed, str) else image_path
            client.predict(
                image=handle_file(source),
                seed=0,
                resolution="1024",
                api_name="/image_to_3d"
            )

            # 4. Extract the textured GLB from session state
            print("[TRELLIS Client] Extracting textured GLB...")
            result = client.predict(
                decimation_target=DECIMATION_TARGET,
                texture_size=TEXTURE_SIZE,
                api_name="/extract_glb"
            )

            glb_path = _extract_glb_path(result)

            if glb_path and Path(glb_path).exists():
                shutil.copy2(glb_path, output_path)
                print(f"[TRELLIS Client] Textured GLB saved to {output_path}")
                return output_path
            elif glb_path and str(glb_path).startswith("http"):
                import httpx
                resp = httpx.get(glb_path, follow_redirects=True, timeout=120)
                if resp.status_code == 200:
                    with open(output_path, "wb") as f:
                        f.write(resp.content)
                    print(f"[TRELLIS Client] Textured GLB downloaded to {output_path}")
                    return output_path

            print(f"[TRELLIS Client] No GLB found in result: {result}")

        except Exception as e:
            print(f"[TRELLIS Client] Attempt {attempt + 1} failed: {e}")
            if attempt < MAX_RETRIES:
                wait = 15 * (attempt + 1)
                print(f"[TRELLIS Client] Retrying in {wait}s (Space may be waking up)...")
                time.sleep(wait)

    print(f"[TRELLIS Client] All attempts failed for {image_path}")
    return None


def _extract_glb_path(result):
    """Pull a .glb file path out of the various possible gradio result shapes."""
    if isinstance(result, str):
        return result
    if isinstance(result, dict):
        return result.get("path") or result.get("value") or result.get("url")
    if isinstance(result, (list, tuple)):
        for item in result:
            found = _extract_glb_path(item)
            if isinstance(found, str) and found.endswith(".glb"):
                return found
        for item in result:
            found = _extract_glb_path(item)
            if found:
                return found
    return None
