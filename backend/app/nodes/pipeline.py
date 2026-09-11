"""
Pipeline Node — orchestrates the 3-stage asset generation pipeline:
  1. BOM Analysis (DeepSeek-R1)
  2. Image Generation (FLUX.1-dev)
  3. 3D Model Generation (TRELLIS.2 + TripoSR fallback)
"""
import uuid
from pathlib import Path

from app.tools.deepseek_client import analyze_asset
from app.tools.flux_client import generate_image as flux_generate
from app.tools import trellis_client
from app.tools import triposr_client

# Output directories
GENERATED_DIR = Path(__file__).parent.parent.parent / "generated"
IMAGES_DIR = GENERATED_DIR / "images"
MODELS_DIR = GENERATED_DIR / "models"


def _ensure_dirs():
    """Create output directories if they don't exist."""
    GENERATED_DIR.mkdir(exist_ok=True)
    IMAGES_DIR.mkdir(exist_ok=True)
    MODELS_DIR.mkdir(exist_ok=True)


def bom_analysis_node(state: dict) -> dict:
    """
    Stage 1: Call DeepSeek-R1 to deconstruct the asset into a 5-part BOM.
    """
    if state.get("status") == "error":
        return state

    asset_name = state.get("asset_name", "").strip()
    if not asset_name:
        return {**state, "status": "error", "error": "No asset name provided"}

    print(f"\n{'='*60}")
    print(f"[Pipeline Stage 1] BOM Analysis for: {asset_name}")
    print(f"{'='*60}\n")

    try:
        bom_data = analyze_asset(asset_name)

        # Validate BOM structure
        components = bom_data.get("components", [])
        if not components:
            return {**state, "status": "error", "error": "BOM analysis returned no components"}

        print(f"[Pipeline Stage 1] ✓ Got {len(components)} components")
        for i, c in enumerate(components):
            print(f"  [{i+1}] {c.get('part_name', 'N/A')} — Risk: {c.get('risk_score', 'N/A')} ({c.get('risk_tier', 'N/A')})")

        return {
            **state,
            "bom_data": bom_data,
            "status": "bom_complete"
        }

    except Exception as e:
        print(f"[Pipeline Stage 1] ✗ Error: {e}")
        return {**state, "status": "error", "error": f"BOM analysis failed: {str(e)}"}


def image_generation_node(state: dict) -> dict:
    """
    Stage 2: Generate orthographic 2D images for each BOM component using FLUX.1-dev.
    """
    if state.get("status") == "error":
        return state

    _ensure_dirs()
    bom_data = state.get("bom_data", {})
    components = bom_data.get("components", [])

    print(f"\n{'='*60}")
    print(f"[Pipeline Stage 2] Image Generation — {len(components)} components")
    print(f"{'='*60}\n")

    image_paths = []

    for i, component in enumerate(components):
        part_name = component.get("part_name", f"Component_{i}")
        prompt = component.get("hf_flux_prompt", f"{part_name}, orthographic side profile, isolated pure white background, hard-surface topology, industrial design")

        filename = f"{uuid.uuid4().hex[:8]}_{part_name.replace(' ', '_').lower()}.png"
        output_path = str(IMAGES_DIR / filename)

        print(f"[Pipeline Stage 2] [{i+1}/{len(components)}] Generating: {part_name}")

        try:
            result_path = flux_generate(prompt, output_path)
            image_paths.append(result_path)
            component["image_url"] = f"/generated/images/{filename}"
            print(f"[Pipeline Stage 2] ✓ [{i+1}] Image saved: {filename}")
        except Exception as e:
            print(f"[Pipeline Stage 2] ✗ [{i+1}] Image failed: {e}")
            image_paths.append(None)
            component["image_url"] = None

    return {
        **state,
        "bom_data": bom_data,
        "image_paths": image_paths,
        "status": "images_complete"
    }


def model_generation_node(state: dict) -> dict:
    """
    Stage 3: Convert 2D images to 3D GLB models using TRELLIS.2 (primary) + TripoSR (fallback).
    """
    if state.get("status") == "error":
        return state

    _ensure_dirs()
    bom_data = state.get("bom_data", {})
    components = bom_data.get("components", [])
    image_paths = state.get("image_paths", [])

    print(f"\n{'='*60}")
    print(f"[Pipeline Stage 3] 3D Model Generation — {len(components)} components")
    print(f"{'='*60}\n")

    model_paths = []

    for i, component in enumerate(components):
        part_name = component.get("part_name", f"Component_{i}")
        image_path = image_paths[i] if i < len(image_paths) else None

        if not image_path or not Path(image_path).exists():
            print(f"[Pipeline Stage 3] [{i+1}] Skipping {part_name} — no image available")
            model_paths.append(None)
            component["glb_url"] = None
            component["model_source"] = None
            continue

        filename = f"{uuid.uuid4().hex[:8]}_{part_name.replace(' ', '_').lower()}.glb"
        output_path = str(MODELS_DIR / filename)

        print(f"[Pipeline Stage 3] [{i+1}/{len(components)}] Converting to 3D: {part_name}")

        # Try TRELLIS.2 first
        result = trellis_client.generate_3d_model(image_path, output_path)
        if result:
            model_paths.append(result)
            component["glb_url"] = f"/generated/models/{filename}"
            component["model_source"] = "trellis"
            print(f"[Pipeline Stage 3] ✓ [{i+1}] TRELLIS.2 success: {filename}")
            continue

        # Fallback to TripoSR
        print(f"[Pipeline Stage 3] [{i+1}] TRELLIS.2 failed, trying TripoSR...")
        result = triposr_client.generate_3d_model(image_path, output_path)
        if result:
            model_paths.append(result)
            component["glb_url"] = f"/generated/models/{filename}"
            component["model_source"] = "triposr"
            print(f"[Pipeline Stage 3] ✓ [{i+1}] TripoSR success: {filename}")
            continue

        # Both failed
        print(f"[Pipeline Stage 3] ✗ [{i+1}] Both 3D generators failed for {part_name}")
        model_paths.append(None)
        component["glb_url"] = None
        component["model_source"] = None

    return {
        **state,
        "bom_data": bom_data,
        "model_paths": model_paths,
        "status": "models_complete"
    }
