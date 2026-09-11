"""
Assembly Builder — normalizes raw AI-generated 3D models (1 outer weapon shell +
up to 5 inner mechanical components) into a single hierarchical GLB for the
interactive "Exploded View" web viewer.

Two placement modes (pure trimesh + numpy, textures/UVs preserved):

ANATOMICAL (preferred) — each part carries a `placement` dict produced by the
LLM research stage (with keyword fallbacks):
    axis_position     -1..1   rear (stock) -> muzzle, along the shell's long axis
    vertical_position -1..1   bottom (magazine well) -> top (sights)
    length_fraction    0..1   part length as a fraction of the weapon's length
    orientation       "longitudinal" | "vertical" | "compact"
Parts are rotated so their own longest axis matches the stated orientation,
scaled to their real-world proportion, anchored where that part physically sits
in the weapon, clamped fully inside the shell, and lightly relaxed so two parts
never occupy the same spot.

SLOT (fallback, no placement data) — parts are centered, uniformly scaled into
75% of the shell volume and spaced evenly along the longitudinal axis.

Output hierarchy is strict: "Outer_Shell", "Inner_Part_1" ... "Inner_Part_5".
"""
import numpy as np
import trimesh
from pathlib import Path

# Inner parts must fit inside this fraction of the shell's bounding volume
FIT_RATIO = 0.75
# Gap between adjacent inner parts, as a fraction of the slot length
PART_GAP_RATIO = 0.10
# Anatomical mode: keep parts within this fraction of the shell's bbox
ANATOMY_ENVELOPE = 0.94
# Two parts closer than this fraction of shell length get pushed apart
MIN_AXIS_SEPARATION = 0.08


def _load_as_single_mesh(path: str) -> trimesh.Trimesh:
    """
    Load any supported 3D file (.obj / .glb / .gltf / .stl ...) and flatten it
    to a single Trimesh. Scene files are collapsed with their transforms baked
    in so downstream math sees true world-space geometry. Texture/UV visuals
    survive this (single-mesh scenes keep their material through the dump).
    """
    loaded = trimesh.load(path, force="scene")
    if isinstance(loaded, trimesh.Scene):
        # to_mesh() bakes every node transform and concatenates all geometry.
        # Use dump(concatenate=True) for wide trimesh version compatibility.
        mesh = loaded.to_geometry() if hasattr(loaded, "to_geometry") else loaded.dump(concatenate=True)
    else:
        mesh = loaded
    if not isinstance(mesh, trimesh.Trimesh) or mesh.vertices.size == 0:
        raise ValueError(f"No usable geometry found in {path}")
    return mesh


def _center_at_origin(mesh: trimesh.Trimesh) -> trimesh.Trimesh:
    """Translate a mesh so its axis-aligned bounding-box center sits at (0,0,0)."""
    bbox_center = mesh.bounds.mean(axis=0)  # midpoint of (min, max) corners
    mesh.apply_translation(-bbox_center)
    return mesh


def _shell_axes(shell_extents: np.ndarray) -> tuple:
    """
    Classify the shell's axes by extent. For a rifle in profile:
    long = barrel direction, vertical = height, thin = side-to-side thickness.
    """
    order = np.argsort(shell_extents)  # ascending
    thin_axis, vertical_axis, long_axis = int(order[0]), int(order[1]), int(order[2])
    return long_axis, vertical_axis, thin_axis


def _orient_part(part: trimesh.Trimesh, orientation: str,
                 long_axis: int, vertical_axis: int, thin_axis: int) -> trimesh.Trimesh:
    """
    Rotate a part (90° permutations only — never skews textures) so its own
    longest bbox axis points the way the real component lies in the weapon:
      longitudinal -> along the barrel, vertical -> up/down (magazine, grip),
      compact -> leave as generated.
    """
    if orientation == "compact":
        return part
    part_order = np.argsort(part.extents)  # ascending: thin, mid, longest
    src = [int(part_order[2]), int(part_order[1]), int(part_order[0])]
    if orientation == "vertical":
        dst = [vertical_axis, long_axis, thin_axis]
    else:  # longitudinal
        dst = [long_axis, vertical_axis, thin_axis]

    rot = np.zeros((3, 3))
    for s, d in zip(src, dst):
        rot[d, s] = 1.0
    if np.linalg.det(rot) < 0:  # keep it a proper rotation (no mirroring)
        rot[:, src[2]] *= -1
    tf = np.eye(4)
    tf[:3, :3] = rot
    part.apply_transform(tf)
    return part


def _shell_profile(shell: trimesh.Trimesh, long_axis: int, vertical_axis: int,
                   thin_axis: int, bins: int = 48):
    """
    2.5D silhouette of the shell: for slices along the long axis, the vertical
    range [ymin, ymax] and half-thickness the shell actually occupies. A part
    confined to this profile is hidden inside the weapon's SHAPE, not just its
    bounding box (a rifle's bbox is mostly empty air under the barrel).
    Empty bins are filled from their nearest occupied neighbor.
    """
    v = shell.vertices
    x = v[:, long_axis]
    edges = np.linspace(x.min(), x.max(), bins + 1)
    idx = np.clip(np.digitize(x, edges) - 1, 0, bins - 1)

    ymin = np.full(bins, np.nan)
    ymax = np.full(bins, np.nan)
    zhalf = np.full(bins, np.nan)
    for b in range(bins):
        m = idx == b
        if np.count_nonzero(m) >= 3:
            ymin[b] = v[m, vertical_axis].min()
            ymax[b] = v[m, vertical_axis].max()
            zhalf[b] = np.abs(v[m, thin_axis]).max()

    valid = np.where(~np.isnan(ymin))[0]
    if valid.size == 0:  # pathological shell — no profile available
        return None
    for b in range(bins):
        if np.isnan(ymin[b]):
            near = valid[np.argmin(np.abs(valid - b))]
            ymin[b], ymax[b], zhalf[b] = ymin[near], ymax[near], zhalf[near]
    return {"edges": edges, "ymin": ymin, "ymax": ymax, "zhalf": zhalf}


def _profile_window(profile: dict, x0: float, x1: float):
    """Tightest [ymin, ymax] and half-thickness over the span [x0, x1]."""
    edges = profile["edges"]
    b0 = int(np.clip(np.digitize(x0, edges) - 1, 0, len(profile["ymin"]) - 1))
    b1 = int(np.clip(np.digitize(x1, edges) - 1, 0, len(profile["ymin"]) - 1))
    sl = slice(min(b0, b1), max(b0, b1) + 1)
    return (float(np.max(profile["ymin"][sl])),
            float(np.min(profile["ymax"][sl])),
            float(np.min(profile["zhalf"][sl])))


def _place_anatomical(parts: list, placements: list, shell_extents: np.ndarray,
                      shell: trimesh.Trimesh = None):
    """
    Scale + position each (slot, mesh) using its placement dict. Mutates the
    meshes in place. `placements` is aligned with `parts` (same order).
    When the shell mesh is given, parts are clamped into its actual local
    silhouette so nothing pokes out of the weapon's shape at rest.
    """
    long_axis, vertical_axis, thin_axis = _shell_axes(shell_extents)
    envelope = shell_extents * ANATOMY_ENVELOPE
    profile = _shell_profile(shell, long_axis, vertical_axis, thin_axis) \
        if shell is not None else None
    print(f"[Assembly] Anatomical mode — long={'XYZ'[long_axis]}, "
          f"vertical={'XYZ'[vertical_axis]}, thin={'XYZ'[thin_axis]}, "
          f"profile={'yes' if profile else 'no'}")

    MARGIN = 0.86  # fraction of the local silhouette window a part may fill

    placed = []  # (slot, mesh, axis_pos, vert_pos) for the relax pass
    for (slot, part), placement in zip(parts, placements):
        orientation = str(placement.get("orientation", "longitudinal")).lower()
        axis_pos = float(np.clip(placement.get("axis_position", 0.0), -1.0, 1.0))
        vert_pos = float(np.clip(placement.get("vertical_position", 0.0), -1.0, 1.0))
        length_frac = float(np.clip(placement.get("length_fraction", 0.3), 0.05, 0.9))

        _orient_part(part, orientation, long_axis, vertical_axis, thin_axis)

        # Scale to the part's real-world proportion of the weapon...
        ext = part.extents
        driving_axis = vertical_axis if orientation == "vertical" else long_axis
        target = length_frac * shell_extents[long_axis]
        scale = target / ext[driving_axis] if ext[driving_axis] > 0 else 1.0
        # ...but never let any dimension escape the shell envelope.
        for a in range(3):
            if ext[a] * scale > envelope[a] > 0:
                scale = envelope[a] / ext[a]
        part.apply_scale(scale)

        # Provisional anchor along the barrel from the free room left over.
        ext = part.extents
        free_long = max(envelope[long_axis] - ext[long_axis], 0.0) / 2.0
        anchor_long = axis_pos * free_long

        if profile is not None:
            # --- Silhouette clamp: fit height/thickness to the LOCAL shape ---
            x0 = anchor_long - ext[long_axis] / 2
            x1 = anchor_long + ext[long_axis] / 2
            ylo, yhi, zh = _profile_window(profile, x0, x1)
            avail_h = max(yhi - ylo, 0.0) * MARGIN
            avail_t = max(zh * 2.0, 0.0) * MARGIN
            shrink = 1.0
            if avail_h > 0 and ext[vertical_axis] > avail_h:
                shrink = min(shrink, avail_h / ext[vertical_axis])
            if avail_t > 0 and ext[thin_axis] > avail_t:
                shrink = min(shrink, avail_t / ext[thin_axis])
            if shrink < 1.0:
                part.apply_scale(shrink)
                ext = part.extents
                # smaller part -> recompute its local window once
                x0 = anchor_long - ext[long_axis] / 2
                x1 = anchor_long + ext[long_axis] / 2
                ylo, yhi, zh = _profile_window(profile, x0, x1)

            # Vertical anchor INSIDE the local silhouette strip
            strip = max((yhi - ylo) - ext[vertical_axis], 0.0)
            y_center = (ylo + yhi) / 2 + vert_pos * strip / 2
        else:
            free_vert = max(envelope[vertical_axis] - ext[vertical_axis], 0.0) / 2.0
            y_center = vert_pos * free_vert

        offset = np.zeros(3)
        offset[long_axis] = anchor_long
        offset[vertical_axis] = y_center
        part.apply_translation(offset)
        placed.append([slot, part, offset[long_axis], vert_pos])
        print(f"[Assembly] Inner part {slot + 1}: {orientation}, "
              f"axis={axis_pos:+.2f}, vert={vert_pos:+.2f}, "
              f"len={length_frac:.2f} -> extents {np.round(part.extents, 3)}")

    # Light relax pass: parts sharing the same vertical band shouldn't sit on
    # top of each other along the barrel axis.
    min_sep = shell_extents[long_axis] * MIN_AXIS_SEPARATION
    placed.sort(key=lambda p: p[2])
    for i in range(1, len(placed)):
        prev, cur = placed[i - 1], placed[i]
        same_band = abs(prev[3] - cur[3]) < 0.5
        gap = cur[2] - prev[2]
        if same_band and gap < min_sep:
            push = min_sep - gap
            shift = np.zeros(3)
            shift[long_axis] = push
            cur[1].apply_translation(shift)
            cur[2] += push
            print(f"[Assembly] Relaxed part {cur[0] + 1} forward by {push:.3f} "
                  f"to avoid overlap with part {prev[0] + 1}")


def _place_slots(parts: list, shell_extents: np.ndarray):
    """Fallback: uniform scale into 75% of the shell, even slots along the axis."""
    long_axis = int(np.argmax(shell_extents))
    cross_axes = [a for a in range(3) if a != long_axis]
    print(f"[Assembly] Slot mode — longitudinal axis: {'XYZ'[long_axis]}")

    inner_envelope = shell_extents * FIT_RATIO
    slot_length = inner_envelope[long_axis] / len(parts)
    usable_slot = slot_length * (1.0 - PART_GAP_RATIO)

    for slot, part in parts:
        ext = part.extents
        scale = min(
            inner_envelope[cross_axes[0]] / ext[cross_axes[0]] if ext[cross_axes[0]] > 0 else np.inf,
            inner_envelope[cross_axes[1]] / ext[cross_axes[1]] if ext[cross_axes[1]] > 0 else np.inf,
            usable_slot / ext[long_axis] if ext[long_axis] > 0 else np.inf,
        )
        part.apply_scale(scale)

    span = inner_envelope[long_axis]
    start = -span / 2 + slot_length / 2
    for order, (slot, part) in enumerate(parts):
        offset = np.zeros(3)
        offset[long_axis] = start + order * slot_length
        part.apply_translation(offset)


def build_master_assembly(shell_path: str, part_paths: list, output_path: str,
                          placements: list = None,
                          size_multiplier: float = 1.0) -> str:
    """
    Combine 1 outer shell + up to 5 inner part models into master_assembly.glb.

    Args:
        shell_path:  path to the outer shell model (.obj/.glb/...)
        part_paths:  list of paths to inner component models (missing/None
                     entries are skipped, keeping their slot numbering)
        output_path: destination .glb path
        placements:  optional list aligned with part_paths of anatomical
                     placement dicts (see module docstring); entries may be
                     None. Anatomical mode engages when ANY placement is given.
        size_multiplier: global scale-down applied to every part's
                     length_fraction — used by the QC monitor's auto-correct
                     rebuild when the first assembly has protrusions.

    Returns output_path on success. Raises on unrecoverable geometry errors.
    """
    Path(output_path).parent.mkdir(parents=True, exist_ok=True)
    placements = placements or []

    # ---- Step 1: outer shell centered at absolute origin --------------------
    shell = _load_as_single_mesh(shell_path)
    shell = _center_at_origin(shell)
    shell_extents = shell.extents.copy()  # (x, y, z) dimensions after centering
    print(f"[Assembly] Shell extents: {np.round(shell_extents, 3)}")

    # ---- Step 2: load + locally center the inner parts ----------------------
    parts = []       # (slot_index, mesh) — slot keeps stable Inner_Part_N numbering
    part_place = []  # placement dict (or None) aligned with `parts`
    for i, path in enumerate(part_paths[:5]):
        if not path or not Path(path).exists():
            print(f"[Assembly] Inner part {i + 1}: missing, slot skipped")
            continue
        try:
            part = _center_at_origin(_load_as_single_mesh(path))
            parts.append((i, part))
            part_place.append(placements[i] if i < len(placements) else None)
        except Exception as e:
            print(f"[Assembly] Inner part {i + 1}: failed to load ({e}), slot skipped")

    if not parts:
        raise ValueError("No inner parts could be loaded — nothing to assemble")

    # ---- Step 3+4: place the parts inside the shell --------------------------
    if any(p for p in part_place):
        # Fill gaps so one missing placement doesn't degrade the whole build
        filled = [p if p else {"axis_position": 0.0, "vertical_position": 0.0,
                               "length_fraction": 0.3, "orientation": "longitudinal"}
                  for p in part_place]
        if size_multiplier != 1.0:
            filled = [{**p, "length_fraction":
                       float(p.get("length_fraction", 0.3)) * size_multiplier}
                      for p in filled]
        _place_anatomical(parts, filled, shell_extents, shell=shell)
    else:
        _place_slots(parts, shell_extents)

    # ---- Step 5: build the scene with the strict node hierarchy -------------
    scene = trimesh.Scene()
    scene.add_geometry(shell, node_name="Outer_Shell", geom_name="Outer_Shell")
    for slot, part in parts:
        name = f"Inner_Part_{slot + 1}"
        scene.add_geometry(part, node_name=name, geom_name=name)

    # ---- Step 6: export as GLB, preserving node names ------------------------
    scene.export(output_path)
    print(f"[Assembly] Master assembly exported to {output_path} "
          f"({len(parts)} inner parts)")
    return output_path
