"""Regenerate frontend/src/assets_data.js from frontend/public/models.

Every asset folder is scanned; the web-loadable model is chosen in priority
order: model.glb (Blender-converted) > scene.gltf > any other .glb/.gltf.
Folders with no loadable model are listed but marked STANDBY so broken cards
are visible instead of silently 404ing.
"""
import json
import os

MODELS_DIR = os.path.join("frontend", "public", "models")


def find_model_file(folder_name):
    folder_path = os.path.join(MODELS_DIR, folder_name)
    preferred = [
        os.path.join(folder_path, "model.glb"),
        os.path.join(folder_path, "scene.gltf"),
    ]
    for p in preferred:
        if os.path.exists(p):
            return "/" + os.path.relpath(p, "frontend/public").replace("\\", "/")
    for root, _dirs, files in os.walk(folder_path):
        for f in sorted(files):
            if f.lower().endswith((".glb", ".gltf")):
                rel = os.path.relpath(os.path.join(root, f), "frontend/public")
                return "/" + rel.replace("\\", "/")
    return None


def format_name(name):
    return name.replace("-", " ").replace("_", " ").title().strip()


assets = []
missing = []
folders = sorted(
    d for d in os.listdir(MODELS_DIR)
    if os.path.isdir(os.path.join(MODELS_DIR, d))
)
for i, m in enumerate(folders):
    url = find_model_file(m)
    if not url:
        missing.append(m)
    assets.append({
        "id": m,
        "name": format_name(m),
        "serial": f"ASSET-{str(i + 1).zfill(3)}",
        "status": "READY" if url else "STANDBY",
        "statusType": "ready" if url else "standby",
        "url": url,
        "image": f"/images/{m}.png",
        "specs": [
            {"label": "Type", "value": "TACTICAL"},
            {"label": "Status", "value": "VERIFIED" if url else "NO MODEL",
             "isStatus": True},
        ],
    })

js_content = f"export const PREDEFINED_ASSETS = {json.dumps(assets, indent=2)};\n"
with open("frontend/src/assets_data.js", "w", encoding="utf-8") as f:
    f.write(js_content)

print(f"assets_data.js updated: {len(assets)} assets, {len(missing)} without a model")
for m in missing:
    print("  no model:", m)
