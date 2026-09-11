"""
Direct 3D Generation Nodes — weapon name -> best web image -> preprocess -> Hunyuan3D-2.1 GLB.
"""
import shutil
import uuid
from pathlib import Path

from app.tools.image_finder import find_best_image
from app.tools.image_preprocess import preprocess_image
from app.tools import hunyuan3d_client, trellis_client, triposr_client, kaggle_client
from app.tools import pipeline_monitor

GENERATED_DIR = Path(__file__).parent.parent.parent / "generated"
IMAGES_DIR = GENERATED_DIR / "images"
MODELS_DIR = GENERATED_DIR / "models"


def _ensure_dirs():
    IMAGES_DIR.mkdir(parents=True, exist_ok=True)
    MODELS_DIR.mkdir(parents=True, exist_ok=True)


def generate_best_3d(image_path: str, output_path: str, weapon_name: str = None):
    """
    Convert an image to a GLB and keep the BEST candidate, judged against the
    gold whole-weapon quality bar (pipeline_monitor.qc_quality).

    Your own Kaggle GPU (if configured) goes FIRST — no HF ZeroGPU quota, faster,
    and textured. The public HF Spaces are fallbacks. Rather than blindly taking
    the first generator that returns *anything*, each candidate is graded; the
    moment one clears the library bar we stop (so a good textured Kaggle result
    costs nothing extra), and if none clears it we return the highest scorer.

    Returns (output_path, source_name) or (None, None).
    """
    generators = []
    if kaggle_client.is_configured():
        generators.append(("kaggle-hunyuan3d", kaggle_client.generate_3d_model))
    generators += [
        ("hunyuan3d", hunyuan3d_client.generate_3d_model),
        ("trellis-2", trellis_client.generate_3d_model),
        ("triposr", triposr_client.generate_3d_model),
    ]

    out_dir = Path(output_path).parent
    stem = Path(output_path).stem
    preview = str(out_dir / f"{stem}_qc.png")
    best = None  # (score, candidate_path, source_name, reason)

    for source_name, generate in generators:
        print(f"[Direct3D] Trying generator: {source_name}")
        cand_path = str(out_dir / f"{stem}__{source_name}.glb")
        result = generate(image_path, cand_path)
        if not result:
            continue

        q = pipeline_monitor.qc_quality(result, weapon_name or "weapon", preview)
        print(f"[Direct3D] {source_name}: quality={q['score']} "
              f"approved={q['approved']} — {q['reason']}")

        if best is None or q["score"] > best[0]:
            best = (q["score"], result, source_name, q["reason"])

        if q["approved"]:
            break  # library-grade — don't spend more GPU / HF quota

    if best is None:
        return None, None

    # Promote the winning candidate to the caller's requested output path.
    if best[1] != output_path:
        shutil.copyfile(best[1], output_path)
    print(f"[Direct3D] Selected {best[2]} (quality={best[0]}) — {best[3]}")
    return output_path, best[2]


def find_image_node(state: dict) -> dict:
    """Stage 1: search the web for the best reference photo of the named weapon."""
    if state.get("status") == "error":
        return state

    weapon_name = state.get("weapon_name", "").strip()
    _ensure_dirs()

    print(f"[Direct3D] Finding best reference image for: {weapon_name}")
    found = find_best_image(weapon_name, str(IMAGES_DIR))

    if not found:
        return {**state, "status": "error", "error": f"Could not find a usable reference image for '{weapon_name}'"}

    source_filename = Path(found["path"]).name
    return {
        **state,
        "source_image_path": found["path"],
        "source_image_url": f"/generated/images/{source_filename}",
        "source_url": found["source_url"],
        "status": "image_found",
    }


def preprocess_image_node(state: dict) -> dict:
    """Stage 2: remove background, crop, and normalize the found image."""
    if state.get("status") == "error":
        return state

    source_path = state.get("source_image_path")
    filename = f"{uuid.uuid4().hex[:8]}_preprocessed.png"
    output_path = str(IMAGES_DIR / filename)

    print("[Direct3D] Preprocessing image for 3D reconstruction...")
    try:
        preprocess_image(source_path, output_path)
    except Exception as e:
        return {**state, "status": "error", "error": f"Preprocessing failed: {e}"}

    return {
        **state,
        "preprocessed_path": output_path,
        "preprocessed_url": f"/generated/images/{filename}",
        "status": "preprocessed",
    }


def generate_model_node(state: dict) -> dict:
    """Stage 3: convert the preprocessed image into a textured GLB via Hunyuan3D-2.1."""
    if state.get("status") == "error":
        return state

    weapon_name = state.get("weapon_name", "asset")
    image_path = state.get("preprocessed_path")
    filename = f"{uuid.uuid4().hex[:8]}_{weapon_name.replace(' ', '_').lower()}.glb"
    output_path = str(MODELS_DIR / filename)

    print("[Direct3D] Generating 3D model (Hunyuan3D-2.1 primary)...")
    result, source_name = generate_best_3d(image_path, output_path,
                                            weapon_name=weapon_name)

    if not result:
        return {**state, "status": "error", "error": "All 3D generators failed"}

    return {
        **state,
        "glb_url": f"/generated/models/{filename}",
        "model_source": source_name,
        "status": "complete",
    }
