"""
Procedural weapon builder — runs INSIDE Blender (5.x).

    blender -b --factory-startup --python blender_build_weapon.py -- <spec.json>

Reads an engineering spec (real parts, each with an archetype + placement in
metres, muzzle at +X, up = +Z) and builds every part as detailed geometry with
tiling PBR materials, then exports a single field-strip GLB whose node names are
the true part names ("Outer_Shell" for the receiver, "Inner_Part_N" for the rest
in disassembly order) so the web viewer's strict field-strip explode kicks in.
Also renders an assembled + an exploded preview PNG.

The spec is written by scripts/build_weapon_internals.py.
"""
import json
import math
import sys

import bpy
import bmesh
from mathutils import Matrix, Vector

argv = sys.argv[sys.argv.index("--") + 1:]
SPEC = json.load(open(argv[0], encoding="utf-8"))
TEXDIR = SPEC["texture_dir"]

# ---- fresh scene ----------------------------------------------------------
bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
coll = bpy.context.collection
OBJECTS = []  # (obj, slot)  slot 0 = shell


# ===========================================================================
# materials
# ===========================================================================
def make_material(key, cfg):
    mat = bpy.data.materials.new(key)
    mat.use_nodes = True
    nt = mat.node_tree
    nt.nodes.clear()
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    bsdf = nt.nodes.new("ShaderNodeBsdfPrincipled")
    bsdf.inputs["Metallic"].default_value = cfg.get("metallic", 0.0)
    bsdf.inputs["Roughness"].default_value = cfg.get("roughness", 0.5)
    nt.links.new(bsdf.outputs["BSDF"], out.inputs["Surface"])

    tex = nt.nodes.new("ShaderNodeTexImage")
    img_path = f"{TEXDIR}/{cfg['tex']}.png"
    tex.image = bpy.data.images.load(img_path, check_existing=True)
    coords = nt.nodes.new("ShaderNodeTexCoord")
    mapping = nt.nodes.new("ShaderNodeMapping")
    tile = cfg.get("tile", 0.09)
    mapping.inputs["Scale"].default_value = (1.0 / tile, 1.0 / tile, 1.0 / tile)
    nt.links.new(coords.outputs["UV"], mapping.inputs["Vector"])
    nt.links.new(mapping.outputs["Vector"], tex.inputs["Vector"])
    nt.links.new(tex.outputs["Color"], bsdf.inputs["Base Color"])
    return mat


MATERIALS = {k: make_material(k, v) for k, v in SPEC["materials"].items()}


# ===========================================================================
# geometry helpers (Blender Z-up: X=length/muzzle+, Y=side, Z=up)
# ===========================================================================
def emit(name, bm, material, slot):
    me = bpy.data.meshes.new(name)
    bm.normal_update()
    bm.to_mesh(me)
    bm.free()
    ob = bpy.data.objects.new(name, me)
    coll.objects.link(ob)
    ob.data.materials.append(MATERIALS[material])
    OBJECTS.append((ob, slot))
    return ob


def bevel_all(bm, offset=0.0015, segments=2):
    try:
        bmesh.ops.bevel(bm, geom=list(bm.edges), offset=offset, segments=segments,
                        affect="EDGES", clamp_overlap=True)
    except Exception:
        pass


def add_box(bm, cx, cy, cz, sx, sy, sz, rot_y=0.0, bevel=0.0015):
    m = Matrix.Translation((cx, cy, cz))
    if rot_y:
        m = m @ Matrix.Rotation(rot_y, 4, "Y")
    m = m @ Matrix.Diagonal((sx, sy, sz, 1.0))
    r = bmesh.ops.create_cube(bm, size=1.0, matrix=m)
    if bevel:
        edges = {e for v in r["verts"] for e in v.link_edges}
        bmesh.ops.bevel(bm, geom=list(edges), offset=bevel, segments=2,
                        affect="EDGES", clamp_overlap=True)


def add_cyl(bm, x0, x1, r0, r1, y=0.0, z=0.0, seg=28):
    """Tapered cylinder from x0->x1 along X (r0 at x0, r1 at x1)."""
    depth = x1 - x0
    res = bmesh.ops.create_cone(bm, cap_ends=True, cap_tris=False, segments=seg,
                                radius1=r0, radius2=r1, depth=depth)
    verts = res["verts"]
    # cone is along Z centred at origin; rotate Z->X, move to midpoint
    m = Matrix.Translation(((x0 + x1) / 2.0, y, z)) @ Matrix.Rotation(math.radians(90), 4, "Y")
    bmesh.ops.transform(bm, matrix=m, verts=verts)


def add_disc(bm, cx, cy, cz, r, thick, seg=24):
    """Flat disc, axis along Y (a hammer / wheel face)."""
    res = bmesh.ops.create_cone(bm, cap_ends=True, cap_tris=False, segments=seg,
                                radius1=r, radius2=r, depth=thick)
    m = Matrix.Translation((cx, cy, cz)) @ Matrix.Rotation(math.radians(90), 4, "X")
    bmesh.ops.transform(bm, matrix=m, verts=res["verts"])


def sweep_tube(bm, points, radius, ring=8):
    """Sweep a circular section along a polyline (springs, rods, curved feeds)."""
    pts = [Vector(p) for p in points]
    rings = []
    up = Vector((0, 0, 1))
    for i, p in enumerate(pts):
        t = (pts[min(i + 1, len(pts) - 1)] - pts[max(i - 1, 0)])
        if t.length < 1e-9:
            t = Vector((1, 0, 0))
        t.normalize()
        n1 = t.cross(up)
        if n1.length < 1e-6:
            n1 = t.cross(Vector((0, 1, 0)))
        n1.normalize()
        n2 = t.cross(n1).normalized()
        rings.append([bm.verts.new(p + (math.cos(a) * n1 + math.sin(a) * n2) * radius)
                      for a in [2 * math.pi * k / ring for k in range(ring)]])
    bm.verts.ensure_lookup_table()
    for i in range(len(rings) - 1):
        for k in range(ring):
            a, b = rings[i][k], rings[i][(k + 1) % ring]
            c, d = rings[i + 1][k], rings[i + 1][(k + 1) % ring]
            bm.faces.new((a, b, d, c))


def helix_points(x0, x1, radius, coils, y=0.0, z=0.0, steps=96):
    pts = []
    for k in range(steps + 1):
        t = k / steps
        ang = 2 * math.pi * coils * t
        pts.append((x0 + (x1 - x0) * t, y + math.cos(ang) * radius, z + math.sin(ang) * radius))
    return pts


# ===========================================================================
# archetypes  (params come from the spec)
# ===========================================================================
def build_receiver(bm, p):
    x0, x1 = p["x0"], p["x1"]
    w, h, z = p.get("w", 0.036), p.get("h", 0.05), p.get("z", 0.0)
    add_box(bm, (x0 + x1) / 2, 0, z, x1 - x0, w, h)
    # magazine well lip + trigger guard below
    add_box(bm, p.get("mag_x", x0 + 0.05), 0, z - h / 2 - 0.012, 0.05, w * 0.8, 0.03)
    add_box(bm, x0 + 0.02, 0, z - h / 2 - 0.03, 0.075, 0.006, 0.02)  # trigger guard bar


def build_barrel(bm, p):
    add_cyl(bm, p["x0"], p["x_step"], p["r0"], p["r0"], y=0, z=p["z"])
    add_cyl(bm, p["x_step"], p["x1"], p["r1"], p["r1"], y=0, z=p["z"])
    add_cyl(bm, p["x1"], p["x1"] + 0.012, p["r1"] * 1.25, p["r1"] * 1.1, y=0, z=p["z"])  # muzzle nut


def build_tube(bm, p):
    add_cyl(bm, p["x0"], p["x1"], p["r"], p.get("r1", p["r"]), y=0, z=p["z"])


def build_rod(bm, p):
    add_cyl(bm, p["x0"], p["x1"], p["r"], p["r"], y=p.get("y", 0), z=p["z"], seg=12)
    if p.get("head"):
        add_cyl(bm, p["x1"], p["x1"] + 0.02, p["r"] * 1.8, p["r"] * 1.8, y=p.get("y", 0), z=p["z"])


def build_spring(bm, p):
    sweep_tube(bm, helix_points(p["x0"], p["x1"], p["radius"], p["coils"], z=p["z"]),
               p.get("wire", 0.0016), ring=6)
    add_cyl(bm, p["x0"] - 0.02, p["x1"], p.get("guide_r", 0.003), p.get("guide_r", 0.003), z=p["z"], seg=10)


def build_bolt_carrier(bm, p):
    x0, x1, z = p["x0"], p["x1"], p["z"]
    add_cyl(bm, x0, x1, p["r"], p["r"], z=z)              # cylindrical body
    add_box(bm, (x0 + x1) / 2, 0, z + p["r"], (x1 - x0) * 0.9, p["r"] * 1.4, p["r"] * 0.9)  # top rib
    add_box(bm, x0 + 0.01, 0, z - p["r"] * 0.6, 0.02, p["r"] * 1.2, p["r"] * 0.8)  # carrier lug


def build_bolt(bm, p):
    z = p["z"]
    add_cyl(bm, p["x0"], p["x1"], p["r"], p["r"], z=z, seg=16)
    for a in range(3):  # locking lugs
        ang = a * 2 * math.pi / 3
        add_box(bm, p["x1"] - 0.006, math.cos(ang) * p["r"], z + math.sin(ang) * p["r"],
                0.01, 0.006, 0.006, bevel=0)


def build_gas_block(bm, p):
    z = p["z"]
    add_box(bm, p["x"], 0, z, 0.028, 0.03, 0.036)
    add_cyl(bm, p["x"] - 0.014, p["x"] + 0.014, p["r"], p["r"], z=z)  # barrel collar
    add_box(bm, p["x"], 0, z + 0.028, 0.01, 0.006, 0.02)             # gas port boss up


def build_front_sight(bm, p):
    z = p["z"]
    add_box(bm, p["x"], 0, z, 0.02, 0.03, 0.03)          # base
    add_box(bm, p["x"], 0.012, z + 0.028, 0.012, 0.006, 0.02)   # protective wing L
    add_box(bm, p["x"], -0.012, z + 0.028, 0.012, 0.006, 0.02)  # protective wing R
    add_cyl(bm, p["x"] - 0.003, p["x"] + 0.003, 0.0016, 0.0016, z=z + 0.03)  # sight post


def build_rear_sight(bm, p):
    z = p["z"]
    add_box(bm, p["x"], 0, z, 0.03, 0.03, 0.02)          # sight block
    add_box(bm, p["x"] - 0.01, 0, z + 0.014, 0.02, 0.024, 0.008)  # leaf


def build_dust_cover(bm, p):
    x0, x1, z = p["x0"], p["x1"], p["z"]
    # curved top cover: shallow half-cylinder
    res = bmesh.ops.create_cone(bm, cap_ends=False, segments=16,
                                radius1=p["r"], radius2=p["r"], depth=x1 - x0)
    m = Matrix.Translation(((x0 + x1) / 2, 0, z)) @ Matrix.Rotation(math.radians(90), 4, "Y")
    bmesh.ops.transform(bm, matrix=m, verts=res["verts"])
    # delete the lower half of the tube so it reads as a cover
    for v in list(bm.verts):
        if v.co.z < z - 0.001:
            bm.verts.remove(v)


def build_handguard(bm, p):
    x0, x1, z = p["x0"], p["x1"], p["z"]
    add_box(bm, (x0 + x1) / 2, 0, z, x1 - x0, p.get("w", 0.05), p.get("h", 0.03), bevel=0.004)


def build_stock(bm, p):
    x0, x1 = p["x0"], p["x1"]
    add_box(bm, (x0 + x1) / 2, 0, p["z"], x1 - x0, 0.032, 0.045, rot_y=p.get("tilt", 0.0), bevel=0.004)


def build_buttplate(bm, p):
    add_box(bm, p["x"], 0, p["z"], 0.008, 0.036, 0.09, bevel=0.003)


def build_grip(bm, p):
    add_box(bm, p["x"], 0, p["z"], 0.03, 0.028, 0.09, rot_y=math.radians(p.get("tilt_deg", 20)), bevel=0.006)


def build_magazine(bm, p):
    """Curved 30-round mag: boxes stacked down and leaning toward the muzzle,
    all in the X-Z plane (a clean banana, never a corkscrew)."""
    n = 6
    x0, z0 = p["x"], p["z"]
    seg = 0.03
    lean = 0.26           # forward drift per segment (curve toward muzzle)
    for i in range(n):
        ang = math.radians(8) * i
        cz = z0 - i * seg * 0.9
        cx = x0 + i * seg * 0.9 * lean
        add_box(bm, cx, 0, cz, 0.03 + 0.003 * i, 0.026, seg, rot_y=ang, bevel=0.002)


def build_small(bm, p):
    add_box(bm, p["x"], p.get("y", 0), p["z"], p.get("sx", 0.012), p.get("sy", 0.01),
            p.get("sz", 0.02), bevel=0.001)


def build_trigger(bm, p):
    z = p["z"]
    add_box(bm, p["x"], 0, z, 0.008, 0.006, 0.03)
    add_box(bm, p["x"], 0, z - 0.018, 0.014, 0.006, 0.01, rot_y=math.radians(20))  # curved shoe


def build_hammer(bm, p):
    add_disc(bm, p["x"], 0, p["z"], p.get("r", 0.016), 0.008)
    add_box(bm, p["x"] - 0.004, 0, p["z"] + 0.014, 0.008, 0.007, 0.016, rot_y=math.radians(-25))  # spur


def build_selector(bm, p):
    add_box(bm, p["x"], p["y"], p["z"], 0.05, 0.006, 0.012)          # lever arm on side
    add_box(bm, p["x"] + 0.02, p["y"], p["z"] + 0.03, 0.01, 0.006, 0.04)  # paddle


def build_finned_barrel(bm, p):
    """Thompson-style barrel with radial cooling fins."""
    z = p["z"]
    add_cyl(bm, p["x0"], p["x1"], p["r"], p["r"], z=z)
    fins = p.get("fins", 10)
    fin_r = p.get("fin_r", p["r"] * 1.7)
    for i in range(fins):
        fx = p["x0"] + 0.02 + (p["x1"] - p["x0"] - 0.04) * i / max(fins - 1, 1)
        add_cyl(bm, fx - 0.003, fx + 0.003, fin_r, fin_r, z=z, seg=20)


def build_muzzle_device(bm, p):
    """Ported muzzle brake / Cutts compensator — stepped, ringed cylinder."""
    z = p["z"]
    add_cyl(bm, p["x0"], p["x1"], p["r"], p["r"], z=z)
    for i in range(p.get("rings", 3)):
        rx = p["x0"] + 0.006 + (p["x1"] - p["x0"] - 0.012) * i / max(p.get("rings", 3) - 1, 1)
        add_cyl(bm, rx - 0.0025, rx + 0.0025, p["r"] * 1.35, p["r"] * 1.35, z=z, seg=18)


def build_drum_mag(bm, p):
    """Thompson 50-round drum: a flat disc under the receiver + feed tower."""
    r, thick = p.get("r", 0.055), p.get("thick", 0.03)
    add_disc(bm, p["x"], 0, p["z"], r, thick, seg=32)
    add_disc(bm, p["x"], 0, p["z"], r * 0.45, thick + 0.006, seg=24)   # hub
    add_box(bm, p["x"], 0, p["z"] + r + 0.006, 0.02, thick * 0.7, 0.02)  # feed tower up into receiver


def build_suppressor(bm, p):
    """AS Val integral suppressor: large shroud tube over the barrel."""
    z = p["z"]
    add_cyl(bm, p["x0"], p["x1"], p["r"], p["r"], z=z, seg=28)
    add_cyl(bm, p["x0"] - 0.006, p["x0"] + 0.004, p["r"] * 1.08, p["r"] * 1.08, z=z, seg=28)  # rear cap
    add_cyl(bm, p["x1"] - 0.004, p["x1"] + 0.006, p["r"] * 1.05, p["r"] * 0.9, z=z, seg=28)   # front cap


def build_skeleton_stock(bm, p):
    """Tubular / skeletonised metal stock (AKS / AS Val style)."""
    z = p["z"]
    add_cyl(bm, p["x0"], p["x1"], p.get("r", 0.008), p.get("r", 0.008), y=0.014, z=z + 0.01, seg=10)
    add_cyl(bm, p["x0"], p["x1"], p.get("r", 0.008), p.get("r", 0.008), y=-0.014, z=z - 0.01, seg=10)
    add_box(bm, p["x0"], 0, z, 0.008, 0.045, 0.05)   # butt pad


BUILDERS = {
    "receiver": build_receiver, "barrel": build_barrel, "tube": build_tube,
    "rod": build_rod, "spring": build_spring, "bolt_carrier": build_bolt_carrier,
    "bolt": build_bolt, "gas_block": build_gas_block, "front_sight": build_front_sight,
    "rear_sight": build_rear_sight, "dust_cover": build_dust_cover,
    "handguard": build_handguard, "stock": build_stock, "buttplate": build_buttplate,
    "grip": build_grip, "magazine": build_magazine, "small": build_small,
    "trigger": build_trigger, "hammer": build_hammer, "selector": build_selector,
    "finned_barrel": build_finned_barrel, "muzzle_device": build_muzzle_device,
    "drum_mag": build_drum_mag, "suppressor": build_suppressor,
    "skeleton_stock": build_skeleton_stock,
}


# ===========================================================================
# build all parts
# ===========================================================================
for part in SPEC["parts"]:
    bm = bmesh.new()
    BUILDERS[part["archetype"]](bm, part["params"])
    bmesh.ops.recalc_face_normals(bm, faces=list(bm.faces))
    node = "Outer_Shell" if part.get("shell") else f"Inner_Part_{part['slot']}"
    ob = emit(node, bm, part["material"], part["slot"])
    ob["part_name"] = part["name"]

print(f"[build] {len(OBJECTS)} parts created")


# ---- UV unwrap every part so the tiling textures land correctly -----------
for ob, _slot in OBJECTS:
    bpy.context.view_layer.objects.active = ob
    ob.select_set(True)
    try:
        bpy.ops.object.mode_set(mode="EDIT")
        bpy.ops.mesh.select_all(action="SELECT")
        bpy.ops.uv.smart_project(angle_limit=1.15, island_margin=0.02)
        bpy.ops.object.mode_set(mode="OBJECT")
    except Exception as e:
        print(f"[warn] UV unwrap failed for {ob.name}: {e}")
    ob.select_set(False)

# shade smooth for the cylindrical parts
for ob, _slot in OBJECTS:
    for poly in ob.data.polygons:
        poly.use_smooth = True


# ===========================================================================
# export GLB (Y-up)
# ===========================================================================
out_glb = SPEC["output_glb"]
bpy.ops.export_scene.gltf(
    filepath=out_glb, export_format="GLB", use_selection=False,
    export_apply=True, export_yup=True, export_normals=True,
    export_texcoords=True, export_materials="EXPORT", export_image_format="AUTO",
)
print(f"[build] exported {out_glb}")


# ===========================================================================
# preview renders (assembled + exploded) — best effort
# ===========================================================================
def setup_render():
    try:
        scene.render.engine = "BLENDER_EEVEE_NEXT"
    except Exception:
        try:
            scene.render.engine = "BLENDER_EEVEE"
        except Exception:
            scene.render.engine = "BLENDER_WORKBENCH"
    scene.render.resolution_x = 1600
    scene.render.resolution_y = 900
    scene.render.film_transparent = False
    world = bpy.data.worlds.new("W")
    world.use_nodes = True
    world.node_tree.nodes["Background"].inputs[0].default_value = (0.9, 0.9, 0.92, 1)
    world.node_tree.nodes["Background"].inputs[1].default_value = 1.1
    scene.world = world
    # 3-point-ish lighting
    for name, loc, energy in [("key", (0.6, -0.8, 0.9), 900),
                              ("fill", (-0.7, -0.5, 0.4), 350),
                              ("rim", (0.2, 0.9, 0.6), 500)]:
        ld = bpy.data.lights.new(name, "AREA")
        ld.energy = energy
        ld.size = 0.8
        lo = bpy.data.objects.new(name, ld)
        lo.location = loc
        coll.objects.link(lo)
    cam_d = bpy.data.cameras.new("cam")
    cam = bpy.data.objects.new("cam", cam_d)
    cam.location = (0.35, -1.15, 0.55)
    cam.rotation_euler = (math.radians(64), 0, math.radians(17))
    cam_d.lens = 62
    coll.objects.link(cam)
    scene.camera = cam


def render_to(path):
    scene.render.filepath = path
    try:
        bpy.ops.render.render(write_still=True)
        print(f"[build] rendered {path}")
    except Exception as e:
        print(f"[warn] render failed: {e}")


if SPEC.get("render_png"):
    setup_render()
    render_to(SPEC["render_png"])
    if SPEC.get("render_exploded_png"):
        # field-strip: shell up, parts spread along X by slot
        parts = sorted([o for o in OBJECTS if o[1] > 0], key=lambda o: o[1])
        span = 0.9
        for i, (ob, _slot) in enumerate(parts):
            ob.location.x += (i - len(parts) / 2) * (span / max(len(parts), 1)) * 1.2
            ob.location.z += 0.02
        for ob, slot in OBJECTS:
            if slot == 0:
                ob.location.z += 0.28
        render_to(SPEC["render_exploded_png"])

print("[build] done")
