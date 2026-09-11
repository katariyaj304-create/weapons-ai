"""
Self-contained GLB turntable preview — numpy + PIL + trimesh only (NO matplotlib,
so it runs in the backend venv without extra installs).

Usage:
    python scripts/render_glb_preview.py <path-to.glb> [out.png]

Renders 4 views (3/4 front, side, front, 3/4 rear) side by side using a painter's
algorithm with Lambert shading. Honors baked vertex colors / textures if present.
"""
import sys
import numpy as np
from PIL import Image, ImageDraw
import trimesh


def render(glb_path: str, out_path: str = None, size: int = 512) -> str:
    scene = trimesh.load(glb_path)
    mesh = scene.to_geometry() if hasattr(scene, "to_geometry") else scene

    V = mesh.vertices - mesh.vertices.mean(axis=0)
    V = V / (np.abs(V).max() or 1.0)
    F = mesh.faces
    N = mesh.face_normals

    try:  # per-face base color from texture/vertex colors
        vc = mesh.visual.to_color().vertex_colors[:, :3].astype(np.float32) / 255.0
        base = vc[F].mean(axis=1)
    except Exception:
        base = np.tile(np.array([0.62, 0.66, 0.72], np.float32), (len(F), 1))

    light = np.array([0.4, 0.6, 0.7]); light /= np.linalg.norm(light)

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
        order = np.argsort(Vr[F][:, :, 2].mean(axis=1))  # far first
        img = Image.new("RGB", (size, size), (13, 15, 18))
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
    strip = Image.new("RGB", (size * 4 + 15, size), (13, 15, 18))
    for i, t in enumerate(tiles):
        strip.paste(t, (i * (size + 5), 0))

    out_path = out_path or (glb_path.rsplit(".", 1)[0] + "_preview.png")
    strip.save(out_path)
    print(f"verts {len(mesh.vertices)} faces {len(mesh.faces)}")
    print(f"SAVED {out_path}")
    return out_path


if __name__ == "__main__":
    if len(sys.argv) < 2:
        raise SystemExit("usage: python scripts/render_glb_preview.py <path.glb> [out.png]")
    render(sys.argv[1], sys.argv[2] if len(sys.argv) > 2 else None)
