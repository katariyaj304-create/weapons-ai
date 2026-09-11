"""
Pipeline Monitor — LLM quality gates between every stage of the exploded
assembly pipeline, so nonsense never propagates:

  qc_image(...)    BEFORE 3D generation: a vision LLM confirms the downloaded
                   photo really shows the requested subject (an isolated part —
                   not the whole weapon, not a diagram/meme/watermark wall).
  qc_mesh(...)     AFTER 3D generation: geometric sanity — enough faces, not a
                   flat sliver, not a degenerate blob.
  qc_assembly(...) AFTER assembly: renders 4 views of the master GLB and asks
                   the vision LLM whether it reads as ONE coherent weapon with
                   nothing sticking out.

Every LLM check is BEST-EFFORT: if the vision model is unavailable or errors,
the gate falls back to its heuristic score and approves — the monitor improves
quality, it must never block generation.
"""
import os
import io
import json
import re
import base64
import functools

from dotenv import load_dotenv

load_dotenv()

# The distilled whole-weapon quality bar (produced by scripts/quality/extract_rubric.py).
RUBRIC_PATH = os.path.join(os.path.dirname(__file__), "..", "..",
                           "generated", "quality_rubric.json")
# A generated model must score at least this against the gold rubric to be
# accepted as "library-grade". Tuned so a clean textured Hunyuan output passes
# and a gray blob / cutaway does not.
QUALITY_BAR = 0.62

# Tried in order until one answers; all verified available on this account's
# HF Inference providers (probed 2026-07-12).
VISION_MODELS = [
    "Qwen/Qwen2.5-VL-72B-Instruct",
    "meta-llama/Llama-4-Scout-17B-16E-Instruct",
    "google/gemma-3-27b-it",
]

# Mesh sanity thresholds
MIN_FACES = 1500          # below this an image-to-3D output is a degenerate blob
MAX_ASPECT_RATIO = 30.0   # longest/shortest bbox extent; above this = flat sliver


def _image_data_url(image_path: str, max_side: int = 768) -> str:
    """Downscale + base64-encode an image for a vision-LLM message."""
    from PIL import Image
    with Image.open(image_path) as im:
        im = im.convert("RGB")
        im.thumbnail((max_side, max_side))
        buf = io.BytesIO()
        im.save(buf, format="JPEG", quality=85)
    return "data:image/jpeg;base64," + base64.b64encode(buf.getvalue()).decode()


def _ask_vision(image_path: str, question: str) -> dict:
    """
    Ask the first available vision model a question about an image. The model
    must answer with a JSON object. Returns the parsed dict, or None if every
    model failed (caller then falls back to heuristics).
    """
    api_key = os.getenv("HF_API_KEY")
    if not api_key:
        return None
    try:
        from huggingface_hub import InferenceClient
        data_url = _image_data_url(image_path)
    except Exception as e:
        print(f"[Monitor] vision prep failed: {e}")
        return None

    for model in VISION_MODELS:
        try:
            client = InferenceClient(api_key=api_key)
            completion = client.chat.completions.create(
                model=model,
                messages=[{
                    "role": "user",
                    "content": [
                        {"type": "text", "text": question},
                        {"type": "image_url", "image_url": {"url": data_url}},
                    ],
                }],
                max_tokens=300,
                temperature=0.1,
            )
            text = completion.choices[0].message.content or ""
            match = re.search(r"\{.*\}", text, re.DOTALL)
            if match:
                return json.loads(match.group())
        except Exception as e:
            print(f"[Monitor] vision model {model} unavailable: {e}")
            continue
    return None


def qc_image(image_path: str, subject: str, weapon_name: str,
             is_part: bool) -> dict:
    """
    Gate a downloaded reference image before it is spent on GPU time.
    Returns {"approved": bool, "score": float, "reason": str, "checked_by": str}.
    """
    if is_part:
        question = (
            f'This image was found searching for the "{subject}" component of a '
            f'{weapon_name}. Answer ONLY a JSON object: '
            f'{{"shows_subject": true/false (a real photo of that ISOLATED component '
            f'— false if it shows the ENTIRE weapon, a diagram/drawing/render with '
            f'text labels, a meme, or something unrelated), '
            f'"clean_background": true/false, "confidence": 0.0-1.0, '
            f'"reason": "one short sentence"}}'
        )
    else:
        question = (
            f'This image was found searching for a {weapon_name}. Answer ONLY a '
            f'JSON object: {{"shows_subject": true/false (a real photo of the whole '
            f'{weapon_name} — false for diagrams, drawings, memes, text-covered or '
            f'unrelated images), "clean_background": true/false, '
            f'"confidence": 0.0-1.0, "reason": "one short sentence"}}'
        )

    verdict = _ask_vision(image_path, question)
    if verdict is not None:
        shows = bool(verdict.get("shows_subject"))
        conf = float(verdict.get("confidence", 0.5) or 0.5)
        approved = shows and conf >= 0.4
        return {
            "approved": approved,
            "score": conf if shows else 1.0 - conf,
            "reason": str(verdict.get("reason", ""))[:200],
            "checked_by": "vision-llm",
        }

    # Fallback: heuristic only — a plausible image passes rather than blocking.
    try:
        from app.tools.image_finder import _white_bg_score
        white = _white_bg_score(image_path)
    except Exception:
        white = 0.5
    return {"approved": True, "score": round(0.4 + white * 0.4, 2),
            "reason": "vision monitor offline — heuristic pass",
            "checked_by": "heuristic"}


def qc_mesh(glb_path: str, subject: str) -> dict:
    """
    Geometric sanity gate on a generated 3D model.
    Returns {"approved": bool, "reason": str, "faces": int}.
    """
    try:
        import numpy as np
        import trimesh
        loaded = trimesh.load(glb_path, force="scene")
        if isinstance(loaded, trimesh.Scene):
            mesh = loaded.to_geometry() if hasattr(loaded, "to_geometry") \
                else loaded.dump(concatenate=True)
        else:
            mesh = loaded
        faces = int(len(mesh.faces))
        ext = np.sort(mesh.extents)
        if faces < MIN_FACES:
            return {"approved": False, "faces": faces,
                    "reason": f"only {faces} faces — degenerate output"}
        if ext[0] <= 0 or ext[2] / max(ext[0], 1e-9) > MAX_ASPECT_RATIO:
            return {"approved": False, "faces": faces,
                    "reason": "flat sliver geometry — bad reconstruction"}
        return {"approved": True, "faces": faces,
                "reason": f"{faces} faces, extents ok"}
    except Exception as e:
        return {"approved": True, "faces": -1,
                "reason": f"mesh check errored ({e}) — letting it through"}


def render_assembly_views(glb_path: str, out_path: str, size: int = 384) -> str:
    """
    Software-render 4 views of a GLB (numpy+PIL painter's algorithm — no GPU,
    no matplotlib). Used to give the vision LLM eyes on the final assembly.
    """
    import numpy as np
    from PIL import Image, ImageDraw
    import trimesh

    scene = trimesh.load(glb_path)
    mesh = scene.to_geometry() if hasattr(scene, "to_geometry") else scene

    V = mesh.vertices - mesh.vertices.mean(axis=0)
    V = V / (np.abs(V).max() or 1.0)
    F = mesh.faces
    N = mesh.face_normals

    try:
        vc = mesh.visual.to_color().vertex_colors[:, :3].astype(np.float32) / 255.0
        base = vc[F].mean(axis=1)
    except Exception:
        base = np.tile(np.array([0.62, 0.66, 0.72], np.float32), (len(F), 1))

    light = np.array([0.4, 0.6, 0.7])
    light /= np.linalg.norm(light)

    def rot(elev, azim):
        e, a = np.radians(elev), np.radians(azim)
        Ry = np.array([[np.cos(a), 0, np.sin(a)], [0, 1, 0], [-np.sin(a), 0, np.cos(a)]])
        Rx = np.array([[1, 0, 0], [0, np.cos(e), -np.sin(e)], [0, np.sin(e), np.cos(e)]])
        return Rx @ Ry

    def view(elev, azim):
        R = rot(elev, azim)
        Vr, Nr = V @ R.T, N @ R.T
        m = 1.15
        px = ((Vr[:, 0] / m + 1) / 2 * (size - 1)).astype(np.float32)
        py = ((1 - (Vr[:, 1] / m + 1) / 2) * (size - 1)).astype(np.float32)
        shade = np.clip(Nr @ light, 0.12, 1.0)
        facing = Nr[:, 2] > -0.05
        order = np.argsort(Vr[F][:, :, 2].mean(axis=1))
        img = Image.new("RGB", (size, size), (240, 240, 240))
        dr = ImageDraw.Draw(img)
        for fi in order:
            if not facing[fi]:
                continue
            t = F[fi]
            pts = [(px[t[0]], py[t[0]]), (px[t[1]], py[t[1]]), (px[t[2]], py[t[2]])]
            c = base[fi] * (0.25 + 0.75 * shade[fi])
            dr.polygon(pts, fill=tuple(int(np.clip(v, 0, 1) * 255) for v in c))
        return img

    views = [(18, 35), (0, 90), (0, 0), (25, 200)]
    tiles = [view(e, a) for e, a in views]
    strip = Image.new("RGB", (size * 4 + 15, size), (240, 240, 240))
    for i, t in enumerate(tiles):
        strip.paste(t, (i * (size + 5), 0))
    strip.save(out_path)
    return out_path


def qc_assembly(glb_path: str, weapon_name: str, preview_out: str) -> dict:
    """
    Final gate: render the assembled (rest-state) GLB and have the vision LLM
    judge whether it reads as one coherent weapon. Returns
    {"approved": bool, "reason": str, "preview_path": str|None}.
    """
    try:
        render_assembly_views(glb_path, preview_out)
    except Exception as e:
        return {"approved": True, "preview_path": None,
                "reason": f"preview render failed ({e}) — skipping visual QC"}

    question = (
        f'These are 4 rendered views of a 3D model that should look like a single '
        f'{weapon_name} (its internal parts are hidden inside the body). Answer '
        f'ONLY a JSON object: {{"looks_like_single_weapon": true/false, '
        f'"parts_sticking_out": true/false (extra geometry protruding that does '
        f'not belong to the weapon silhouette), "confidence": 0.0-1.0, '
        f'"reason": "one short sentence"}}'
    )
    verdict = _ask_vision(preview_out, question)
    if verdict is not None:
        ok = bool(verdict.get("looks_like_single_weapon")) and \
            not bool(verdict.get("parts_sticking_out"))
        return {"approved": ok, "preview_path": preview_out,
                "reason": str(verdict.get("reason", ""))[:200]}
    return {"approved": True, "preview_path": preview_out,
            "reason": "vision monitor offline — geometric containment already enforced"}


# ---------------------------------------------------------------------------
# LOOK critic — grade a generated model against the gold WHOLE-weapon rubric.
# This is what makes generated output match "the best weapons in the library".
# Cutaway/exploded/internal looks are an automatic fail: the target is a solid,
# complete, well-textured weapon, never an internals view.
# ---------------------------------------------------------------------------

_CLASS_KEYWORDS = {
    "aircraft": ("jet", "fighter", "aircraft", "airplane", "plane", "bomber",
                 "uav", "drone", "helicopter", "raptor", "felon", "boramae",
                 "su-", "mig", "f-16", "f-22", "f-35", "kc-", "ch-53", "rustom"),
    "vehicle": ("tank", "apc", "rcv", "abrams", "vehicle", "truck", "carrier",
                "artillery", "mortar", "battleship", "warship", "howitzer", "t-72"),
    "firearm": ("rifle", "gun", "pistol", "revolver", "shotgun", "smg", "carbine",
                "ak-", "ak47", "m4", "m16", "glock", "val", "mini-14", "tommy",
                "pounder", "mp5", "uzi"),
}


def infer_weapon_class(weapon_name: str) -> str:
    """Best-effort weapon-class routing so we grade against the right rubric."""
    n = (weapon_name or "").lower()
    for cls, kws in _CLASS_KEYWORDS.items():
        if any(k in n for k in kws):
            return cls
    return "firearm"


@functools.lru_cache(maxsize=1)
def _load_rubric():
    try:
        with open(os.path.abspath(RUBRIC_PATH), encoding="utf-8") as f:
            return json.load(f).get("rubric") or None
    except Exception:
        return None


def _geo_mini(glb_path: str) -> dict:
    """Objective backstop: face count + real-texture presence."""
    try:
        import numpy as np  # noqa: F401
        import trimesh
        scene = trimesh.load(glb_path, force="scene")
        geoms = ([scene] if isinstance(scene, trimesh.Trimesh)
                 else [g for g in scene.geometry.values()
                       if getattr(g, "faces", None) is not None and len(g.faces)])
        faces = int(sum(len(g.faces) for g in geoms))
        has_tex = False
        for g in geoms:
            try:
                vc = g.visual.to_color().vertex_colors[:, :3]
                if vc.std() > 4:                 # non-uniform = real texture/paint
                    has_tex = True
                    break
            except Exception:
                pass
        return {"faces": faces, "has_texture": has_tex}
    except Exception:
        return {"faces": -1, "has_texture": False}


def qc_quality(glb_path: str, weapon_name: str, preview_out: str,
               wclass: str = None) -> dict:
    """
    Grade a generated GLB against the gold WHOLE-weapon quality bar and decide
    whether it is library-grade. Best-effort: if the vision model is offline it
    falls back to geometry only and never blocks generation.

    Returns {"approved", "score", "reason", "breakdown", "preview_path"}.
    """
    wclass = wclass or infer_weapon_class(weapon_name)
    try:
        render_assembly_views(glb_path, preview_out)
    except Exception as e:
        return {"approved": True, "score": 0.5, "preview_path": None,
                "reason": f"preview render failed ({e}) — quality critic skipped",
                "breakdown": {}}

    gstats = _geo_mini(glb_path)
    spec = (_load_rubric() or {}).get("classes", {}).get(wclass)

    if spec:
        crit_lines = "; ".join(
            f'{c.get("name")}: {c.get("description", "")}'
            for c in spec.get("criteria", []) if c.get("kind") != "geometric")
        question = (
            f'These are 4 rendered views of a generated 3D model of a '
            f'{weapon_name} ({wclass}). Grade it against this professional '
            f'acceptance rubric: {crit_lines}. It must look like a COMPLETE, real, '
            f'well-textured weapon — NOT a cutaway / exploded / internal view, not '
            f'a gray untextured blob. Answer ONLY a JSON object: '
            f'{{"overall": 0.0-1.0, "is_cutaway": true/false, '
            f'"looks_professional": true/false, "reason": "one short sentence"}}')
    else:
        question = (
            f'These are 4 rendered views of a generated 3D model of a '
            f'{weapon_name}. Judge it as a 3D art director against production / AAA '
            f'game reference. It must look like a COMPLETE, real, well-textured '
            f'{weapon_name} — NOT a cutaway / exploded / internal view, not a gray '
            f'untextured blob. Answer ONLY a JSON object: '
            f'{{"overall": 0.0-1.0, "is_cutaway": true/false, '
            f'"looks_professional": true/false, "reason": "one short sentence"}}')

    verdict = _ask_vision(preview_out, question)
    if verdict is not None:
        score = float(verdict.get("overall", 0.5) or 0.5)
        cutaway = bool(verdict.get("is_cutaway"))
        # An untextured mesh cannot meet a bar the gold models set with texture.
        tex_required = bool((spec or {}).get("gold_baselines", {}).get("texture_required"))
        if (tex_required or spec is None) and not gstats["has_texture"]:
            score = min(score, 0.5)
        approved = (score >= QUALITY_BAR and not cutaway
                    and gstats["faces"] >= MIN_FACES)
        return {"approved": approved, "score": round(score, 2),
                "preview_path": preview_out,
                "reason": str(verdict.get("reason", ""))[:200],
                "breakdown": {"cutaway": cutaway, "class": wclass, **gstats}}

    # Vision offline: don't block — pass on geometry alone.
    ok = gstats["faces"] >= MIN_FACES
    return {"approved": ok, "score": 0.5 if ok else 0.3,
            "preview_path": preview_out,
            "reason": "quality critic offline — geometry-only pass",
            "breakdown": {"class": wclass, **gstats}}
