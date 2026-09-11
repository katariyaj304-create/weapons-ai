"""
QUALITY RUBRIC EXTRACTOR  —  "teach the model what we want from these".

We do NOT fine-tune weights. Instead we distill, from a handful of GOLD models,
a written quality standard that an intelligent critic can later grade any
generated model against. This is stage 1 of verifier-guided generation.

For each gold GLB we gather TWO kinds of evidence:
  * VISUAL  — a vision LLM looks at rendered views and describes what makes it
              read as professional (surface finish, proportion, silhouette...).
  * GEOMETRIC — measured directly from the mesh (part count, named-part ratio,
              faces, texture presence, aspect) — objective, not opinion.

Then one synthesis call turns all that evidence into a structured rubric:
per weapon class, a list of weighted criteria each with a concrete pass test.
Saved to backend/generated/quality_rubric.json for the critic to consume.

Run:
  backend\\venv\\Scripts\\python.exe scripts\\quality\\extract_rubric.py
"""
from __future__ import annotations
import os, sys, io, json, base64, tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "backend"))

# Reuse the app's proven vision client + software renderer.
from app.tools.pipeline_monitor import _ask_vision, render_assembly_views, _image_data_url, VISION_MODELS  # noqa: E402

import numpy as np       # noqa: E402
import trimesh           # noqa: E402
from huggingface_hub import InferenceClient  # noqa: E402

# The gold reference set, grouped by weapon class. These are the models whose
# quality we want to reproduce. Part count is irrelevant here — we grade LOOK.
#
# IMPORTANT: only WHOLE, complete weapons belong here. The generated output is a
# solid, fully-textured weapon, so the bar must be set by exterior "hero" models.
# The "*-internals" cutaway/exploded models are DELIBERATELY EXCLUDED — grading a
# generated exterior against a cutaway would teach the critic the wrong silhouette.
GOLD = {
    "firearm": [
        "frontend/public/models/call-of-duty-black-ops-6-as-val/model.glb",
        "frontend/public/models/arx-pounder/model.glb",
        "frontend/public/models/ak-47/model.glb",
        "frontend/public/models/tommy-gun/model.glb",
    ],
    "aircraft": [
        "frontend/public/models/sukhoi-su-57-felon-fighter-jet-free/model.glb",
        "frontend/public/models/kf-21a-boramae-fighter-jet/model.glb",
    ],
    "vehicle": [
        "frontend/public/models/japanese-type-87-rcv/model.glb",
        "frontend/public/models/arx-apc/model.glb",
    ],
}

GENERIC_RE = __import__("re").compile(
    r"^(section|mesh|node|object|group|defaultmaterial|material|part|geometry|"
    r"primitive|scene|model|root|untitled|g\d+|c\d+|obj\d+)[\s_\-\.]*\d*$",
    __import__("re").IGNORECASE,
)


def geometric_stats(path: Path) -> dict:
    """Objective, measurable quality signals straight from the mesh."""
    scene = trimesh.load(str(path), process=False, force="scene")
    if isinstance(scene, trimesh.Trimesh):
        geoms = {"_": scene}
    else:
        geoms = {k: g for k, g in scene.geometry.items()
                 if getattr(g, "faces", None) is not None and len(g.faces) > 0}
    names = list(geoms.keys())
    parts = len(names)
    named = sum(1 for n in names if n and not GENERIC_RE.match(n.strip()))
    total_faces = int(sum(len(g.faces) for g in geoms.values()))
    # texture / vertex-color presence
    has_tex = False
    for g in geoms.values():
        try:
            vc = g.visual.to_color().vertex_colors[:, :3]
            if vc.std() > 4:           # non-uniform color = real texture/paint
                has_tex = True
                break
        except Exception:
            pass
    try:
        merged = scene.to_geometry() if hasattr(scene, "to_geometry") else scene.dump(concatenate=True)
        ext = np.sort(merged.extents)
        aspect = float(ext[2] / max(ext[0], 1e-9))
    except Exception:
        aspect = -1.0
    return {
        "parts": parts,
        "named_ratio": round(named / parts, 2) if parts else 0.0,
        "total_faces": total_faces,
        "faces_per_part": int(total_faces / parts) if parts else 0,
        "has_texture": has_tex,
        "aspect": round(aspect, 1),
    }


def visual_assessment(strip_png: str, wclass: str) -> dict | None:
    q = (
        f"These are 4 rendered views of a professional 3D model of a {wclass}. "
        f"Judge it as a 3D artist reviewing production quality. Answer ONLY a JSON "
        f"object with fields (each 0.0-1.0 where 1.0 is flawless): "
        f'{{"surface_finish": .., "proportion_accuracy": .., '
        f'"silhouette_readability": .., "detail_level": .., "texture_quality": .., '
        f'"topology_cleanliness": .., '
        f'"strengths": "what makes it look professional, one sentence", '
        f'"tells_of_quality": "concrete visual cues to look for, one sentence"}}'
    )
    return _ask_vision(strip_png, q)


def _ask_text(prompt: str) -> dict | None:
    api_key = os.getenv("HF_API_KEY")
    if not api_key:
        return None
    import re
    for model in VISION_MODELS:
        try:
            client = InferenceClient(api_key=api_key)
            comp = client.chat.completions.create(
                model=model,
                messages=[{"role": "user", "content": prompt}],
                max_tokens=1400, temperature=0.2,
            )
            text = comp.choices[0].message.content or ""
            m = re.search(r"\{.*\}", text, re.DOTALL)
            if m:
                return json.loads(m.group())
        except Exception as e:
            print(f"[rubric] text model {model} failed: {e}")
            continue
    return None


def synthesize(evidence: dict) -> dict | None:
    prompt = (
        "You are a senior 3D art director defining an ACCEPTANCE RUBRIC for a "
        "generated-3D pipeline. Below is measured + observed evidence from GOLD "
        "reference models we consider professional-grade, grouped by weapon class.\n\n"
        + json.dumps(evidence, indent=2)
        + "\n\nProduce ONLY a JSON object of this exact shape:\n"
        '{"version": 1, "classes": {"<class>": {'
        '"criteria": [{"name": "...", "kind": "visual|geometric", '
        '"description": "what good looks like", '
        '"measure": "how the critic checks it (a visual question OR a geometric '
        'threshold like total_faces>=N, named_ratio>=x, has_texture==true)", '
        '"weight": 0.0-1.0, "pass_threshold": 0.0-1.0}], '
        '"gold_baselines": {"min_total_faces": int, "min_named_ratio": float, '
        '"texture_required": bool, "typical_part_range": [min,max]}}}}\n'
        "Derive the geometric thresholds from the evidence (use conservative "
        "floors, not averages). Cover 5-8 criteria per class spanning silhouette, "
        "proportion, surface finish, topology, texture, and part separation. "
        "Weights within a class should sum to ~1.0."
    )
    return _ask_text(prompt)


def main() -> int:
    if not os.getenv("HF_API_KEY"):
        # load backend/.env the way the app does
        from dotenv import load_dotenv
        load_dotenv(ROOT / "backend" / ".env")
    if not os.getenv("HF_API_KEY"):
        print("[STOP] HF_API_KEY not found in env or backend/.env")
        return 1

    tmp = Path(tempfile.mkdtemp(prefix="rubric_"))
    evidence: dict = {}
    for wclass, paths in GOLD.items():
        evidence[wclass] = []
        for rel in paths:
            p = ROOT / rel
            if not p.exists():
                print(f"  skip (missing): {rel}")
                continue
            print(f"  [{wclass}] {p.name} ...", flush=True)
            stats = geometric_stats(p)
            strip = str(tmp / (p.parent.name + ".png"))
            visual = None
            try:
                render_assembly_views(str(p), strip, size=384)
                visual = visual_assessment(strip, wclass)
            except Exception as e:
                print(f"      render/vision failed: {e}")
            evidence[wclass].append({
                "model": p.parent.name,
                "geometric": stats,
                "visual": visual or "vision-offline",
            })
            print(f"      geom={stats}  visual={'ok' if visual else 'none'}")

    print("\nSynthesizing rubric from evidence ...", flush=True)
    rubric = synthesize(evidence)
    out = ROOT / "backend" / "generated" / "quality_rubric.json"
    out.parent.mkdir(parents=True, exist_ok=True)
    payload = {"rubric": rubric, "evidence": evidence}
    out.write_text(json.dumps(payload, indent=2), encoding="utf-8")
    print(f"\nWrote {out.relative_to(ROOT)}")
    if rubric:
        for wclass, spec in rubric.get("classes", {}).items():
            crits = spec.get("criteria", [])
            print(f"  {wclass}: {len(crits)} criteria; baselines={spec.get('gold_baselines')}")
    else:
        print("  [warn] synthesis returned no rubric — evidence still saved.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
