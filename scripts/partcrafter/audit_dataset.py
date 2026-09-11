"""
Audit local GLB assets for suitability as PartCrafter fine-tuning samples.

PartCrafter trains on one GLB per object where each PART is a separate mesh in
the scene. The mp16 config accepts up to 16 parts. A sample is usable if it has
2..16 distinct part meshes. Single-mesh GLBs need splitting first; >16-part GLBs
need part grouping/capping before they can be used.

Run:
  backend\\venv\\Scripts\\python.exe scripts\\partcrafter\\audit_dataset.py
"""
from __future__ import annotations
import sys, glob, os, re, json
from pathlib import Path

try:
    import trimesh
except Exception as e:  # pragma: no cover
    print("[STOP] trimesh not importable in this interpreter:", e)
    raise SystemExit(1) from None

ROOT = Path(__file__).resolve().parents[2]
MAX_PARTS = 16          # PartCrafter mp16 ceiling
MIN_PARTS = 2           # need at least 2 parts to be a "structured" sample

GENERIC_RE = re.compile(
    r"^(section|mesh|node|object|group|defaultmaterial|material|"
    r"polysurface|part|geometry|primitive|scene|model|root|untitled|"
    r"g\d+|c\d+|obj\d+)[\s_\-\.]*\d*$",
    re.IGNORECASE,
)

# Where the good multi-part weapon GLBs live. We prefer public/ over dist/
# (identical copies) and skip raw single-mesh source uploads.
SCAN = [
    ROOT / "frontend" / "public" / "models",     # the 30 library assets
    ROOT / "backend" / "uploads" / "kits",        # downloaded Sketchfab CC kits
]
EXTRA_FILES = [
    ROOT / "backend" / "uploads" / "a0833ba9_free_-_m4_modular_kit_gun.glb",
    ROOT / "frontend" / "public" / "models" / "ak-47-internals" / "model.glb",
]


def find_glbs() -> list[Path]:
    seen: dict[str, Path] = {}
    for base in SCAN:
        if base.exists():
            for p in base.rglob("model.glb"):
                seen[str(p).lower()] = p
            for p in base.rglob("*.glb"):
                seen[str(p).lower()] = p
    for f in EXTRA_FILES:
        if f.exists():
            seen[str(f).lower()] = f
    return sorted(seen.values(), key=lambda p: str(p).lower())


def part_names(path: Path) -> list[str]:
    """Return the list of part mesh names in a GLB scene."""
    scene = trimesh.load(str(path), process=False, force="scene")
    if isinstance(scene, trimesh.Trimesh):
        return ["<single-mesh>"]
    names = []
    for name, geom in scene.geometry.items():
        # only count geometry that actually has faces
        if getattr(geom, "faces", None) is not None and len(geom.faces) > 0:
            names.append(name)
    return names


def classify(n_parts: int) -> str:
    if n_parts <= 1:
        return "SINGLE (needs split)"
    if n_parts > MAX_PARTS:
        return f">16 (needs grouping)"
    return "USABLE"


def main() -> int:
    glbs = find_glbs()
    if not glbs:
        print("[STOP] No GLBs found under scan roots.")
        return 1

    rows = []
    for p in glbs:
        try:
            names = part_names(p)
        except Exception as e:
            rows.append((p, -1, 0, f"ERROR: {type(e).__name__}: {e}"))
            continue
        n = len(names) if names != ["<single-mesh>"] else 1
        named = sum(1 for nm in names if nm and not GENERIC_RE.match(nm.strip()))
        rows.append((p, n, named, classify(n)))

    usable = [r for r in rows if r[3] == "USABLE"]
    single = [r for r in rows if r[3].startswith("SINGLE")]
    over = [r for r in rows if r[3].startswith(">16")]
    errs = [r for r in rows if r[3].startswith("ERROR")]

    print("=" * 78)
    print(f"PartCrafter dataset audit  —  {len(rows)} GLBs scanned")
    print("=" * 78)
    for p, n, named, status in rows:
        rel = p.relative_to(ROOT)
        parts = "single" if n == 1 else (f"{n} parts" if n >= 0 else "err")
        realnames = f"{named} real-named" if n > 1 else ""
        print(f"  [{status:<20}] {parts:<10} {realnames:<14} {rel}")

    print("-" * 78)
    print(f"  USABLE now (2..16 parts) : {len(usable):>3}")
    print(f"  SINGLE-mesh (splittable) : {len(single):>3}")
    print(f"  >16 parts (groupable)    : {len(over):>3}")
    print(f"  errors                   : {len(errs):>3}")
    print("-" * 78)
    # honest verdict on whether there's enough to fine-tune
    n_ok = len(usable)
    print("VERDICT:")
    if n_ok < 20:
        print(f"  {n_ok} usable samples is FAR too few for a stable LoRA fine-tune.")
        print(f"  A DiT LoRA needs ~200+ paired samples to avoid overfitting.")
        print(f"  -> Generate procedural variants (scale/proportion jitter of the")
        print(f"     AK-47 internals + each firearm family) to reach 200+, OR")
        print(f"     recover the SINGLE/>16 buckets with a split/group pass.")
    elif n_ok < 100:
        print(f"  {n_ok} usable — enough for a PROOF-OF-CONCEPT LoRA, will overfit.")
        print(f"  Add procedural variants to reach 200+ before trusting output.")
    else:
        print(f"  {n_ok} usable — a viable starting set for an mp16 LoRA fine-tune.")

    # machine-readable manifest for the staging step
    out = ROOT / "scripts" / "partcrafter" / "audit_report.json"
    out.write_text(json.dumps({
        "usable": [str(r[0].relative_to(ROOT)) for r in usable],
        "single": [str(r[0].relative_to(ROOT)) for r in single],
        "over16": [str(r[0].relative_to(ROOT)) for r in over],
        "errors": [str(r[0].relative_to(ROOT)) for r in errs],
        "counts": {"usable": len(usable), "single": len(single),
                   "over16": len(over), "errors": len(errs)},
    }, indent=2), encoding="utf-8")
    print(f"\nWrote {out.relative_to(ROOT)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
