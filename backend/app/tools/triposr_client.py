"""
TripoSR Image-to-3D Client — fallback 3D model generator via HF Space.
"""
import os
import shutil
import time
from pathlib import Path
from dotenv import load_dotenv

load_dotenv()

SPACE_ID = "stabilityai/TripoSR"
MAX_RETRIES = 2


def generate_3d_model(image_path: str, output_path: str) -> str:
    """
    Convert a 2D image to a GLB/OBJ 3D model using stabilityai/TripoSR Space.
    Returns output_path on success, None on failure.
    """
    try:
        from gradio_client import Client, handle_file
    except ImportError:
        print("[TripoSR Client] gradio_client not installed")
        return None

    api_key = os.getenv("HF_API_KEY")
    Path(output_path).parent.mkdir(parents=True, exist_ok=True)

    for attempt in range(MAX_RETRIES + 1):
        try:
            print(f"[TripoSR Client] Connecting to {SPACE_ID} (attempt {attempt + 1})...")
            try:
                client = Client(SPACE_ID, token=api_key)
            except TypeError:
                client = Client(SPACE_ID, hf_token=api_key)

            print(f"[TripoSR Client] Processing image: {image_path}")

            # TripoSR typically has a simpler API
            try:
                result = client.predict(
                    handle_file(image_path),
                    True,       # remove_background
                    0.85,       # foreground_ratio
                    api_name="/preprocess"
                )
                print(f"[TripoSR Client] Preprocess done: {type(result)}")
            except Exception as pe:
                print(f"[TripoSR Client] Preprocess skipped: {pe}")
                result = image_path

            # Generate 3D
            try:
                gen_result = client.predict(
                    handle_file(image_path) if isinstance(result, str) and not result.startswith('/') else result,
                    256,        # mc_resolution
                    api_name="/generate"
                )
            except Exception:
                gen_result = client.predict(
                    handle_file(image_path),
                    api_name="/run"
                )

            print(f"[TripoSR Client] Generation result type: {type(gen_result)}")

            # Extract the 3D file path
            model_path = None
            if isinstance(gen_result, str):
                model_path = gen_result
            elif isinstance(gen_result, (list, tuple)):
                for item in gen_result:
                    if isinstance(item, str) and (item.endswith('.glb') or item.endswith('.obj')):
                        model_path = item
                        break
                    elif isinstance(item, dict) and 'path' in item:
                        model_path = item['path']
                        break
                if not model_path and len(gen_result) > 0:
                    first = gen_result[0]
                    if isinstance(first, str):
                        model_path = first
                    elif isinstance(first, dict):
                        model_path = first.get('path', first.get('value'))
            elif isinstance(gen_result, dict):
                model_path = gen_result.get('path', gen_result.get('value'))

            if model_path and Path(model_path).exists():
                shutil.copy2(model_path, output_path)
                print(f"[TripoSR Client] ✓ Model saved to {output_path}")
                return output_path
            elif model_path and model_path.startswith('http'):
                import httpx
                resp = httpx.get(model_path, follow_redirects=True, timeout=60)
                if resp.status_code == 200:
                    with open(output_path, 'wb') as f:
                        f.write(resp.content)
                    print(f"[TripoSR Client] ✓ Model downloaded to {output_path}")
                    return output_path

            print(f"[TripoSR Client] No model file found in result: {gen_result}")

        except Exception as e:
            print(f"[TripoSR Client] ✗ Attempt {attempt + 1} failed: {e}")
            if attempt < MAX_RETRIES:
                wait = 10 * (attempt + 1)
                print(f"[TripoSR Client] Retrying in {wait}s...")
                time.sleep(wait)

    print(f"[TripoSR Client] ✗ All attempts failed")
    return None
