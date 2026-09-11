"""
Generate seamless tiling base-colour textures for the procedural weapon builder.

Pure numpy + PIL (runs on the base pythoncore-3.14 or backend venv). Periodic
FBM noise (built in the frequency domain so it wraps perfectly) is mapped to the
real material palettes a gunsmith works with: phosphated steel, in-the-white
polished steel, blued steel, walnut furniture, oxblood bakelite, matte polymer.

    python scripts/gen_pbr_textures.py
    -> scripts/assets/textures/<material>.png   (1024x1024, tiling)
"""
import numpy as np
from PIL import Image
from pathlib import Path

OUT = Path(__file__).resolve().parent / "assets" / "textures"
OUT.mkdir(parents=True, exist_ok=True)
N = 1024
rng = np.random.default_rng(7)


def periodic_fbm(shape=(N, N), octaves=6, persistence=0.55, aniso=(1.0, 1.0), seed=0):
    """Seamless fractal noise via inverse FFT of a 1/f^a spectrum. aniso stretches
    the frequency falloff per axis (for directional grain)."""
    r = np.random.default_rng(seed)
    fy = np.fft.fftfreq(shape[0])[:, None]
    fx = np.fft.fftfreq(shape[1])[None, :]
    freq = np.sqrt((fy * aniso[0]) ** 2 + (fx * aniso[1]) ** 2)
    freq[0, 0] = 1e-6
    amp = 1.0 / (freq ** (1.0 + (1.0 - persistence)))
    # clamp very low freqs so we keep some large-scale structure but no DC blowup
    amp[0, 0] = 0.0
    phase = np.exp(2j * np.pi * r.random(shape))
    field = np.fft.ifft2(amp * phase).real
    field -= field.min()
    field /= max(field.max(), 1e-9)
    return field


def norm(a):
    a = a - a.min()
    return a / max(a.max(), 1e-9)


def lerp(c0, c1, t):
    c0 = np.array(c0, float)
    c1 = np.array(c1, float)
    return c0[None, None, :] * (1 - t[..., None]) + c1[None, None, :] * t[..., None]


def save(name, rgb):
    Image.fromarray(np.clip(rgb, 0, 255).astype(np.uint8)).save(OUT / f"{name}.png")
    print(f"  {name}.png")


def metal_speckle(base_lo, base_hi, grain_seed, streak=False, streak_seed=1):
    fine = periodic_fbm(octaves=7, persistence=0.5, seed=grain_seed)
    fine = norm(fine)
    t = fine
    if streak:  # brushed / machined directional grain
        brushed = periodic_fbm(octaves=6, persistence=0.6, aniso=(6.0, 0.4), seed=streak_seed)
        t = norm(0.5 * fine + 0.5 * norm(brushed))
    rgb = lerp(base_lo, base_hi, t)
    # sparse darker pits for a worked-metal feel
    pits = periodic_fbm(octaves=8, persistence=0.4, seed=grain_seed + 50)
    mask = (pits > 0.82).astype(float)
    rgb *= (1 - 0.18 * mask)[..., None]
    return rgb


print("Generating tiling PBR base-colour maps ->", OUT)

# --- phosphated / parkerised steel: matte, mid-dark, fine tooth ---
save("phosphate_steel", metal_speckle((44, 46, 49), (78, 80, 84), grain_seed=1))

# --- in-the-white polished steel (bolt, carrier): bright, brushed ---
save("polished_steel", metal_speckle((120, 124, 132), (196, 200, 208),
                                      grain_seed=2, streak=True, streak_seed=11))

# --- blued steel (barrel, dust cover): near-black with cold blue sheen ---
blue = metal_speckle((18, 19, 26), (46, 49, 62), grain_seed=3, streak=True, streak_seed=13)
save("blued_steel", blue)

# --- carbon / manganese-phosphate (piston, muzzle): sooty matte ---
save("carbon_steel", metal_speckle((22, 21, 20), (44, 42, 40), grain_seed=4))

# --- walnut furniture: warm grain streaked along the length ---
grain = periodic_fbm(octaves=5, persistence=0.6, aniso=(9.0, 0.5), seed=5)
rings = np.sin(grain * 22.0 + periodic_fbm(octaves=4, seed=6) * 4.0)
t = norm(0.6 * norm(grain) + 0.4 * norm(rings))
wood = lerp((59, 34, 17), (120, 74, 38), t)
wood += (norm(periodic_fbm(octaves=7, aniso=(12, 0.4), seed=7))[..., None] - 0.5) * 26
save("walnut", wood)

# --- oxblood bakelite (grip, AK mag): marbled deep red-brown ---
swirl = periodic_fbm(octaves=5, persistence=0.62, aniso=(2.5, 1.0), seed=8)
marb = norm(swirl + 0.4 * norm(periodic_fbm(octaves=6, seed=9)))
bak = lerp((74, 26, 18), (128, 58, 34), marb)
bak += (norm(periodic_fbm(octaves=7, seed=10))[..., None] - 0.5) * 18
save("bakelite", bak)

# --- matte black polymer: fine stipple ---
stip = norm(periodic_fbm(octaves=8, persistence=0.45, seed=12))
poly = lerp((16, 16, 18), (34, 34, 37), stip)
save("polymer", poly)

# --- brass (cartridge cases, if used) ---
save("brass", metal_speckle((150, 110, 40), (205, 165, 78), grain_seed=14, streak=True, streak_seed=15))

print("done.")
