"""Convert every library asset that lacks a web-loadable model into
frontend/public/models/<id>/model.glb using headless Blender.

Usage:  python scripts/convert_library_models.py [blender.exe path]

Assets that already ship scene.gltf are left untouched. Existing model.glb
outputs are skipped (delete the file to force a re-convert).
"""
import subprocess
import sys
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8")
sys.stderr.reconfigure(encoding="utf-8")

ROOT = Path(__file__).resolve().parent.parent
MODELS = ROOT / "frontend" / "public" / "models"
EXPORT_SCRIPT = ROOT / "scripts" / "blender_export_glb.py"

# asset folder -> source file (relative to the asset folder)
SOURCES = {
    "ak-47": "source/AKM.fbx",
    "arx-apc": "source/model/ARX APC.obj",
    "arx-pounder": "source/model/ARX POUNDER.obj",
    "boeing-kc-46a": "source/Boeing KC-46A Pegasus.obj",
    "boeing-kc-46a-pegasus": "source/Boeing KC-46A Pegasus.obj",
    "call-of-duty-black-ops-6-as-val": "source/ASVAL/ASVAL.fbx",
    "drdo-rustom-2-uav": "source/Rustom UAV.blend",
    "japanese-type-87-rcv": "source/uploads_files_4545858_Type+87+RCV.obj",
    "jet-fighter": "source/JEt.fbx",
    "kf-21a-boramae-fighter-jet": "source/KF-21A Boramae Fighter Jet.obj",
    "low-poly-ak-74m-zenitco": "source/ak74m tuning.blend",
    "m1a2-abrams": "source/M1A2 Abrams.obj",
    "m1a2-sepv2-abrams-main-battle-tank-dc":
        "source/M1A2 SEPV2 Abrams Main Battle Tank DC.obj",
    "mortar-60": "source/mortar 60.glb",
    "sikorsky-ch-53e-sea-stallion": "source/Sikorsky CH-53E Sea Stallion.obj",
    "simple-tank": "simple_tank.glb",
    "sukhoi-su-57-felon-fighter-jet-free": "source/su57.blend",
    "sukhoi-su-57-felon-p-fighter-jet-free": "source/SU-57.blend",
    "t-72a-obr-1980": "source/t72-1980.fbx",
    "tommy-gun": "source/Tommy Gun.fbx",
    "us-super-battleship-rhodeisland": "source/蒙巨拿.fbx",
}


def find_blender() -> Path:
    if len(sys.argv) > 1:
        return Path(sys.argv[1])
    base = Path(r"C:\Program Files\Blender Foundation")
    candidates = sorted(base.glob("Blender */blender.exe"), reverse=True)
    if not candidates:
        raise SystemExit("[STOP] blender.exe not found under " + str(base))
    return candidates[0]


def main() -> None:
    blender = find_blender()
    print(f"[info] using {blender}")
    ok, failed, skipped = [], [], []

    for asset, rel in SOURCES.items():
        src = MODELS / asset / rel
        dst = MODELS / asset / "model.glb"
        if not src.exists():
            print(f"[skip] {asset}: source missing ({rel})")
            failed.append(asset)
            continue
        if dst.exists():
            print(f"[skip] {asset}: model.glb already present")
            skipped.append(asset)
            continue
        if src.suffix.lower() == ".glb":
            # already web-ready: copy losslessly instead of re-encoding
            import shutil
            shutil.copyfile(src, dst)
            print(f"[copy] {asset}: {rel} -> model.glb")
            ok.append(asset)
            continue
        print(f"[conv] {asset}  <-  {rel}")
        proc = subprocess.run(
            [str(blender), "-b", "--factory-startup",
             "--python", str(EXPORT_SCRIPT), "--",
             str(src), str(dst), str(MODELS / asset)],
            capture_output=True, text=True, encoding="utf-8",
            errors="replace", timeout=900,
        )
        if dst.exists() and dst.stat().st_size > 10_000:
            print(f"       ok ({dst.stat().st_size // 1024} KB)")
            ok.append(asset)
        else:
            tail = "\n".join((proc.stdout + proc.stderr).splitlines()[-12:])
            print(f"       FAILED (exit {proc.returncode})\n{tail}\n")
            failed.append(asset)

    print(f"\n[summary] converted={len(ok)} skipped={len(skipped)} "
          f"failed={len(failed)}")
    if failed:
        print("  failed: " + ", ".join(failed))


if __name__ == "__main__":
    main()
