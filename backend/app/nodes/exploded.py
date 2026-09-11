"""
Exploded Assembly Pipeline — weapon name -> AI research (5 major parts) ->
per-part web reference images -> preprocess -> textured 3D models ->
trimesh assembly (Outer_Shell + Inner_Part_1..5) -> master GLB for the
interactive exploded-view viewer.
"""
import os
import re
import json
import uuid
from pathlib import Path

from app.tools.llm import chat as llm_chat

from app.tools.deepseek_client import analyze_asset
from app.tools.search import search_web
from app.tools.image_finder import find_best_image
from app.tools.image_preprocess import preprocess_image
from app.tools.assembly_builder import build_master_assembly
from app.nodes.direct3d import generate_best_3d

GENERATED_DIR = Path(__file__).parent.parent.parent / "generated"
IMAGES_DIR = GENERATED_DIR / "images"
MODELS_DIR = GENERATED_DIR / "models"

RESEARCH_MODEL = "meta-llama/Llama-3.3-70B-Instruct"

_RESEARCH_SYSTEM = """You are a tactical hardware intelligence analyst. Using ONLY the
provided web research, identify the FIVE major physical components of the weapon —
the top-level assemblies a technician would separate during a field-strip, ordered
from the main body/receiver outward.

Output ONLY a valid JSON object, no prose, no markdown:
{
  "components": [
    {
      "part_name": "STRING (concise, e.g. 'Barrel Assembly')",
      "description": "STRING (1-2 sentences on what it does, grounded in the research)",
      "material_dependency": "STRING (primary material, e.g. 'Chrome-lined steel')",
      "risk_score": INT (1-100 supply-chain criticality),
      "risk_tier": "CRITICAL | ELEVATED | STABLE",
      "placement": {
        "axis_position": FLOAT (-1.0 rear/stock end ... +1.0 muzzle end — where the part's CENTER sits along the weapon's length),
        "vertical_position": FLOAT (-1.0 bottom/magazine-well ... +1.0 top/sight-line),
        "length_fraction": FLOAT (0.05-0.9 — the part's length as a fraction of the weapon's overall length),
        "orientation": "longitudinal (lies along the barrel) | vertical (stands up/down like a magazine or grip) | compact (roughly cubic)"
      }
    }
  ]
}
The placement must reflect where the part PHYSICALLY sits in the assembled weapon
(e.g. barrel: axis +0.5, vertical +0.2, length 0.45, longitudinal; magazine:
axis 0.0, vertical -0.7, length 0.18, vertical). Return EXACTLY 5 components."""

# Keyword fallbacks when the LLM omits placement (or the BOM fallback is used).
# Checked in order; first keyword hit wins.
_DEFAULT_PLACEMENTS = [
    (("barrel", "muzzle", "gas tube", "gas block", "handguard", "fore"),
     {"axis_position": 0.55, "vertical_position": 0.25, "length_fraction": 0.45, "orientation": "longitudinal"}),
    (("magazine", "mag ", "clip", "drum"),
     {"axis_position": 0.05, "vertical_position": -0.70, "length_fraction": 0.18, "orientation": "vertical"}),
    (("bolt", "carrier", "slide", "breech"),
     {"axis_position": 0.00, "vertical_position": 0.20, "length_fraction": 0.22, "orientation": "longitudinal"}),
    (("stock", "buffer", "brace", "butt"),
     {"axis_position": -0.75, "vertical_position": 0.10, "length_fraction": 0.30, "orientation": "longitudinal"}),
    (("trigger", "grip", "fire control", "hammer"),
     {"axis_position": -0.15, "vertical_position": -0.45, "length_fraction": 0.15, "orientation": "compact"}),
    (("sight", "optic", "scope", "rail"),
     {"axis_position": 0.10, "vertical_position": 0.70, "length_fraction": 0.20, "orientation": "longitudinal"}),
    (("spring", "recoil", "piston", "rod", "guide"),
     {"axis_position": 0.10, "vertical_position": 0.30, "length_fraction": 0.30, "orientation": "longitudinal"}),
    (("receiver", "frame", "body", "housing"),
     {"axis_position": -0.05, "vertical_position": 0.00, "length_fraction": 0.35, "orientation": "longitudinal"}),
]


def resolve_placement(component: dict) -> dict:
    """
    Best placement for a component: the LLM's own (validated) if present,
    else a keyword default from the part name, else a safe center block.
    """
    placement = component.get("placement")
    if isinstance(placement, dict) and "axis_position" in placement:
        try:
            return {
                "axis_position": float(placement.get("axis_position", 0.0)),
                "vertical_position": float(placement.get("vertical_position", 0.0)),
                "length_fraction": float(placement.get("length_fraction", 0.3)),
                "orientation": str(placement.get("orientation", "longitudinal")).split()[0].lower(),
            }
        except (TypeError, ValueError):
            pass
    name = (component.get("part_name") or "").lower()
    for keywords, default in _DEFAULT_PLACEMENTS:
        if any(k in name for k in keywords):
            return dict(default)
    return {"axis_position": 0.0, "vertical_position": 0.0,
            "length_fraction": 0.3, "orientation": "longitudinal"}


def _parse_components(text: str) -> list:
    """Extract the components list from an LLM JSON response."""
    text = re.sub(r"<think>.*?</think>", "", text, flags=re.DOTALL)
    text = re.sub(r"```(?:json)?", "", text)
    match = re.search(r"\{.*\}", text, re.DOTALL)
    if not match:
        return []
    data = json.loads(match.group())
    return data.get("components", [])[:5]


def research_parts(weapon_name: str) -> list:
    """
    Stage 1: research the weapon with the Tavily API, then have an LLM distill the
    findings into its 5 major components. Falls back to the DeepSeek BOM client if
    Tavily or the LLM is unavailable.
    Each entry: {part_name, description, material_dependency, risk_score, risk_tier}.
    """
    try:
        research = search_web(
            f"{weapon_name} five major components parts breakdown field strip assembly",
            max_results=4,
        )
        if research and not research.startswith("Error") and not research.startswith("Search error"):
            content = llm_chat(
                [
                    {"role": "system", "content": _RESEARCH_SYSTEM},
                    {"role": "user", "content": (
                        f"Weapon: {weapon_name}\n\nWeb research:\n{research[:4000]}\n\n"
                        f"Identify the 5 major components."
                    )},
                ],
                model=RESEARCH_MODEL,
                max_tokens=2048,
                temperature=0.2,
            )
            components = _parse_components(content)
            if len(components) >= 3:
                print(f"[Exploded] Tavily-grounded research found {len(components)} components")
                return components
            print("[Exploded] Tavily research under-filled; falling back to BOM client")
    except Exception as e:
        print(f"[Exploded] Tavily research failed ({e}); falling back to BOM client")

    # Fallback: DeepSeek/Llama BOM client (no web grounding)
    bom = analyze_asset(weapon_name)
    components = bom.get("components", [])[:5]
    if not components:
        raise ValueError(f"Research returned no components for '{weapon_name}'")
    return components


def map_kit_intel(kit_part_names: list, components: list, weapon_name: str) -> dict:
    """
    Match a kit's actual sub-part names to the researched components so the
    intelligence layer (risk tier, materials, description) lands on the real
    parts. Returns {kit_part_name: component_dict}. One LLM call; empty dict
    on any failure — enrichment must never break kit delivery.
    """
    if not kit_part_names or not components:
        return {}
    try:
        comp_lines = "\n".join(f"{i}: {c.get('part_name', '?')}" for i, c in enumerate(components))
        part_lines = "\n".join(f"- {p}" for p in kit_part_names)
        content = llm_chat(
            [
                {"role": "system", "content": (
                    "You match 3D-model sub-part names to weapon component categories. "
                    "Output ONLY a JSON object mapping EACH sub-part name to the best "
                    "component index (integer) or -1 when nothing fits (bullets, "
                    "scenery, decals). No prose.")},
                {"role": "user", "content": (
                    f"Weapon: {weapon_name}\n\nComponent categories:\n{comp_lines}\n\n"
                    f"3D model sub-parts:\n{part_lines}\n\n"
                    f'Return JSON like {{"Handguard M4": 1, "Bullets": -1}}.')},
            ],
            model=RESEARCH_MODEL,
            max_tokens=1024,
            temperature=0.1,
        )
        text = re.sub(r"```(?:json)?", "", content or "")
        match = re.search(r"\{.*\}", text, re.DOTALL)
        if not match:
            return {}
        raw = json.loads(match.group())
        intel = {}
        for part, idx in raw.items():
            try:
                idx = int(idx)
            except (TypeError, ValueError):
                continue
            if 0 <= idx < len(components):
                intel[str(part)] = components[idx]
        print(f"[Exploded] Kit intel mapped {len(intel)}/{len(kit_part_names)} parts")
        return intel
    except Exception as e:
        print(f"[Exploded] Kit intel mapping failed: {e}")
        return {}


def part_image_query(weapon_name: str, part_name: str) -> str:
    """Search phrasing tuned to find an isolated photo of a single component."""
    return (f"{part_name} of {weapon_name} component part isolated "
            f"white background product photo")


def find_and_preprocess(subject: str, query: str = None) -> dict:
    """
    Find the best web image for `subject`, preprocess it for 3D reconstruction.
    Returns {source_path, source_image_url, preprocessed_path, preprocessed_url,
    source_url} or None.
    """
    IMAGES_DIR.mkdir(parents=True, exist_ok=True)
    found = find_best_image(subject, str(IMAGES_DIR), query=query)
    if not found:
        return None

    pre_filename = f"{uuid.uuid4().hex[:8]}_preprocessed.png"
    pre_path = str(IMAGES_DIR / pre_filename)
    try:
        preprocess_image(found["path"], pre_path)
    except Exception as e:
        print(f"[Exploded] Preprocess failed for {subject}: {e}")
        return None

    return {
        "source_path": found["path"],
        "source_image_url": f"/generated/images/{Path(found['path']).name}",
        "preprocessed_path": pre_path,
        "preprocessed_url": f"/generated/images/{pre_filename}",
        "source_url": found["source_url"],
    }


def generate_part_model(image_path: str, label: str) -> dict:
    """
    Stage 3 helper: image -> textured GLB for one shell/part.
    Returns {"glb_path", "glb_url", "model_source"} or None.
    """
    MODELS_DIR.mkdir(parents=True, exist_ok=True)
    filename = f"{uuid.uuid4().hex[:8]}_{label.replace(' ', '_').lower()}.glb"
    output_path = str(MODELS_DIR / filename)

    result, source_name = generate_best_3d(image_path, output_path)
    if not result:
        return None
    return {
        "glb_path": output_path,
        "glb_url": f"/generated/models/{filename}",
        "model_source": source_name,
    }


def process_subject(label: str, query: str = None) -> dict:
    """
    Full per-subject unit of work (find image -> preprocess -> textured 3D),
    designed to be run concurrently for the shell and all 5 parts at once.
    Returns {images, model} — `model` is None if 3D generation failed, and the
    whole result is None if no reference image could be found.
    """
    images = find_and_preprocess(label, query)
    if not images:
        return None
    model = generate_part_model(images["preprocessed_path"], label)
    return {"images": images, "model": model}


def build_assembly(weapon_name: str, shell_glb_path: str, part_glb_paths: list,
                   components: list = None, size_multiplier: float = 1.0) -> dict:
    """
    Final stage: normalize + combine shell and inner parts into a single
    hierarchical GLB (Outer_Shell, Inner_Part_1..5) for the exploded viewer.
    When `components` (the researched parts) is given, each part is placed
    anatomically — where it physically sits in the weapon — instead of in
    generic slots.
    """
    MODELS_DIR.mkdir(parents=True, exist_ok=True)
    filename = f"{uuid.uuid4().hex[:8]}_{weapon_name.replace(' ', '_').lower()}_assembly.glb"
    output_path = str(MODELS_DIR / filename)

    placements = None
    if components:
        placements = [resolve_placement(c) for c in components[:len(part_glb_paths)]]

    build_master_assembly(shell_glb_path, part_glb_paths, output_path,
                          placements=placements, size_multiplier=size_multiplier)
    return {
        "glb_path": output_path,
        "glb_url": f"/generated/models/{filename}",
    }
