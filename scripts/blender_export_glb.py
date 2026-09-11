"""Runs INSIDE Blender (any 4.x/5.x): import one model file, relink textures,
export a single self-contained GLB.

    blender -b --factory-startup --python blender_export_glb.py -- <src> <dst> <search_dir>

<src>        source model (.fbx / .obj / .blend / .glb / .gltf)
<dst>        output .glb path
<search_dir> folder to scan for missing texture files (the asset folder)
"""
import sys
import bpy

argv = sys.argv[sys.argv.index("--") + 1:]
src, dst, search_dir = argv[0], argv[1], argv[2]
ext = src.lower().rsplit(".", 1)[-1]

if ext == "blend":
    bpy.ops.wm.open_mainfile(filepath=src)
else:
    # Wipe the default startup scene (cube/camera/light) before importing
    bpy.ops.wm.read_factory_settings(use_empty=True)
    if ext == "fbx":
        try:
            bpy.ops.import_scene.fbx(filepath=src)
        except AttributeError:
            bpy.ops.wm.fbx_import(filepath=src)  # Blender >= 4.5 C++ importer
    elif ext == "obj":
        bpy.ops.wm.obj_import(filepath=src)
    elif ext in ("glb", "gltf"):
        bpy.ops.import_scene.gltf(filepath=src)
    else:
        raise SystemExit(f"[STOP] unsupported extension: {ext}")

# Resolve any texture paths that broke when the archive was unpacked
try:
    bpy.ops.file.find_missing_files(directory=search_dir)
except Exception as exc:  # noqa: BLE001 - purely best-effort
    print(f"[warn] find_missing_files: {exc}")


# ---- Auto-relink loose textures (Sketchfab FBX habit: files on disk, ----
# ---- but the materials reference nothing) ------------------------------
def _norm(s):
    return "".join(c for c in s.lower() if c.isalnum())


CHANNEL_KEYS = {
    "basecolor": "base", "albedo": "base", "diffuse": "base",
    "normal": "normal", "roughness": "rough", "metallic": "metal",
    "metalness": "metal",
}


def relink_textures():
    import os
    candidates = []  # (norm_name, path, channel)
    for root, _dirs, files in os.walk(search_dir):
        for f in files:
            if not f.lower().endswith((".png", ".jpg", ".jpeg", ".tga",
                                       ".bmp", ".tif", ".tiff")):
                continue
            n = _norm(os.path.splitext(f)[0])
            channel = "base"
            for key, ch in CHANNEL_KEYS.items():
                if key in n:
                    channel = ch
                    break
            # prefer files inside a "textures" folder over raw source dumps
            rank = 0 if "textures" in root.lower() else 1
            candidates.append((n, os.path.join(root, f), channel, rank))
    candidates.sort(key=lambda c: (c[3], len(c[0])))
    if not candidates:
        return

    materials = [m for m in bpy.data.materials if m.use_nodes]
    base_candidates = [c for c in candidates if c[2] == "base"]

    # Repair image nodes whose file is missing but a same-named file with a
    # different extension exists (archives often ship .png for .bmp refs)
    for mat in materials:
        for node in mat.node_tree.nodes:
            img = getattr(node, "image", None)
            if img is None or img.packed_file:
                continue
            path = bpy.path.abspath(img.filepath) if img.filepath else ""
            if path and os.path.exists(path):
                continue
            stem = _norm(os.path.splitext(
                os.path.basename(img.filepath or img.name))[0])
            hit = (next((c for c in candidates if c[0] == stem), None)
                   or next((c for c in candidates if stem and stem in c[0]),
                           None))
            if hit:
                try:
                    node.image = bpy.data.images.load(hit[1],
                                                      check_existing=True)
                    print(f"[fix] {mat.name}: -> {os.path.basename(hit[1])}")
                except Exception:  # noqa: BLE001
                    pass

    for mat in materials:
        bsdf = next((n for n in mat.node_tree.nodes
                     if n.type == "BSDF_PRINCIPLED"), None)
        if bsdf is None or bsdf.inputs["Base Color"].links:
            continue  # already textured
        mn = _norm(mat.name)

        def _score(c):
            fn = c[0]
            s = 0
            if fn and len(fn) >= 3 and fn in mn:
                s = len(fn) * 2   # filename embedded in material name
            elif mn and mn in fn:
                s = len(mn)       # material name embedded in filename
            return (s, -c[3])     # prefer textures/ folder on ties

        mine = sorted((c for c in candidates if _score(c)[0] > 0),
                      key=_score, reverse=True)
        if not mine and len(materials) == 1 and len(base_candidates) == 1:
            mine = base_candidates  # single material + single texture
        if not mine:
            continue
        nodes, links = mat.node_tree.nodes, mat.node_tree.links
        for ch, sock in (("base", "Base Color"), ("rough", "Roughness"),
                         ("metal", "Metallic")):
            hit = next((c for c in mine if c[2] == ch), None)
            if not hit or bsdf.inputs[sock].links:
                continue
            try:
                img = bpy.data.images.load(hit[1], check_existing=True)
            except Exception:  # noqa: BLE001
                continue
            tex = nodes.new("ShaderNodeTexImage")
            tex.image = img
            if ch != "base":
                img.colorspace_settings.name = "Non-Color"
            links.new(tex.outputs["Color"], bsdf.inputs[sock])
            print(f"[link] {mat.name}: {sock} <- {os.path.basename(hit[1])}")
        hit = next((c for c in mine if c[2] == "normal"), None)
        if hit and not bsdf.inputs["Normal"].links:
            try:
                img = bpy.data.images.load(hit[1], check_existing=True)
                img.colorspace_settings.name = "Non-Color"
                tex = nodes.new("ShaderNodeTexImage")
                tex.image = img
                nrm = nodes.new("ShaderNodeNormalMap")
                links.new(tex.outputs["Color"], nrm.inputs["Color"])
                links.new(nrm.outputs["Normal"], bsdf.inputs["Normal"])
                print(f"[link] {mat.name}: Normal <- {os.path.basename(hit[1])}")
            except Exception:  # noqa: BLE001
                pass


try:
    relink_textures()
except Exception as exc:  # noqa: BLE001 - never fail the export over textures
    print(f"[warn] relink_textures: {exc}")

mesh_objects = [o for o in bpy.data.objects if o.type == "MESH"]
if not mesh_objects:
    raise SystemExit("[STOP] no mesh objects after import")
print(f"[info] {len(mesh_objects)} mesh objects, "
      f"{sum(len(o.data.polygons) for o in mesh_objects)} faces")

bpy.ops.export_scene.gltf(
    filepath=dst,
    export_format="GLB",
    export_apply=True,      # bake modifiers (matters for .blend sources)
    export_yup=True,
)
print(f"[done] exported {dst}")
