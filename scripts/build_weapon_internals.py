"""
Build a procedural, engineering-correct INTERNALS model for a weapon and wire it
into the app's exploded viewer.

For each weapon we hand-author the real field-strip part table (every part with
its archetype, placement in metres, material and risk tier from the research),
drive scripts/blender_build_weapon.py to model + texture + export a field-strip
GLB, then:
  - drop the GLB at frontend/public/models/<id>-internals/model.glb
  - write the aligned intel cache (backend/generated/intel/...) so the viewer
    labels every Inner_Part_N with its true name instantly
  - register a library card in frontend/src/assets_data.js

    python scripts/build_weapon_internals.py ak-47
    python scripts/build_weapon_internals.py --list

Blender: C:\\Program Files\\Blender Foundation\\Blender 5.1\\blender.exe
"""
import json
import re
import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SCRIPTS = ROOT / "scripts"
TEXDIR = SCRIPTS / "assets" / "textures"
BLENDER = Path(r"C:\Program Files\Blender Foundation\Blender 5.1\blender.exe")
PUBLIC_MODELS = ROOT / "frontend" / "public" / "models"
INTEL_DIR = ROOT / "backend" / "generated" / "intel"
ASSETS_JS = ROOT / "frontend" / "src" / "assets_data.js"

MATERIALS = {
    "phosphate": {"tex": "phosphate_steel", "metallic": 1.0, "roughness": 0.62, "tile": 0.10},
    "polished": {"tex": "polished_steel", "metallic": 1.0, "roughness": 0.22, "tile": 0.12},
    "blued": {"tex": "blued_steel", "metallic": 1.0, "roughness": 0.34, "tile": 0.11},
    "carbon": {"tex": "carbon_steel", "metallic": 0.8, "roughness": 0.7, "tile": 0.09},
    "walnut": {"tex": "walnut", "metallic": 0.0, "roughness": 0.42, "tile": 0.16},
    "bakelite": {"tex": "bakelite", "metallic": 0.0, "roughness": 0.34, "tile": 0.13},
    "polymer": {"tex": "polymer", "metallic": 0.0, "roughness": 0.5, "tile": 0.08},
}


# ---------------------------------------------------------------------------
# AK-47 — real field-strip + fire-control part table (metres, muzzle +X, up +Z)
# slot = disassembly order (1 = removed first). shell = the receiver.
# ---------------------------------------------------------------------------
def ak47_parts():
    B = 0.012  # bore height above receiver centreline
    return [
        dict(slot=0, shell=True, name="Receiver", archetype="receiver", material="phosphate",
             assembly="Receiver", risk_tier="ELEVATED", risk_score=72, mat="Stamped sheet steel",
             function="Stamped steel housing that holds the barrel, fire-control group and bolt group.",
             params=dict(x0=-0.13, x1=0.13, w=0.036, h=0.05, z=0.0, mag_x=-0.02)),
        dict(slot=1, name="Magazine", archetype="magazine", material="bakelite",
             assembly="Feed system", risk_tier="STABLE", risk_score=30, mat="Bakelite / steel",
             function="Detachable curved box magazine feeding 7.62x39mm rounds.",
             params=dict(x=-0.02, z=-0.055)),
        dict(slot=2, name="Dust Cover", archetype="dust_cover", material="blued",
             assembly="Receiver cover", risk_tier="STABLE", risk_score=28, mat="Stamped steel",
             function="Stamped top cover enclosing the bolt carrier and recoil spring.",
             params=dict(x0=-0.06, x1=0.13, z=0.028, r=0.021)),
        dict(slot=3, name="Recoil Spring Assembly", archetype="spring", material="polished",
             assembly="Recoil system", risk_tier="STABLE", risk_score=34, mat="Spring steel",
             function="Return spring and guide rod that drive the bolt carrier back into battery.",
             params=dict(x0=-0.11, x1=0.06, radius=0.007, coils=15, z=0.017, wire=0.0016, guide_r=0.003)),
        dict(slot=4, name="Bolt Carrier", archetype="bolt_carrier", material="polished",
             assembly="Bolt group", risk_tier="CRITICAL", risk_score=90, mat="Machined steel",
             function="Long-stroke carrier driven by the gas piston; cams the bolt to lock and unlock.",
             params=dict(x0=-0.07, x1=0.055, r=0.011, z=0.014)),
        dict(slot=5, name="Gas Piston", archetype="rod", material="carbon",
             assembly="Gas system", risk_tier="ELEVATED", risk_score=64, mat="Chrome-lined steel",
             function="Piston fixed to the carrier; expanding propellant gas drives it rearward.",
             params=dict(x0=0.055, x1=0.20, r=0.006, z=0.02, head=True)),
        dict(slot=6, name="Bolt", archetype="bolt", material="polished",
             assembly="Bolt group", risk_tier="CRITICAL", risk_score=88, mat="Machined steel",
             function="Rotating bolt with locking lugs that seals the chamber at the moment of firing.",
             params=dict(x0=0.05, x1=0.086, r=0.0085, z=0.013)),
        dict(slot=7, name="Gas Tube & Upper Handguard", archetype="tube", material="blued",
             assembly="Gas system", risk_tier="ELEVATED", risk_score=55, mat="Steel / wood",
             function="Channels tapped gas back to the piston; the wood upper handguard shields the hand.",
             params=dict(x0=0.13, x1=0.28, r=0.013, z=0.028)),
        dict(slot=8, name="Lower Handguard", archetype="handguard", material="walnut",
             assembly="Furniture", risk_tier="STABLE", risk_score=22, mat="Laminated wood",
             function="Wooden fore-end that insulates the shooter from barrel heat.",
             params=dict(x0=0.13, x1=0.25, z=-0.006, w=0.05, h=0.03)),
        dict(slot=9, name="Gas Block", archetype="gas_block", material="phosphate",
             assembly="Gas system", risk_tier="ELEVATED", risk_score=60, mat="Forged steel",
             function="Taps combustion gas from the barrel port and redirects it into the gas tube.",
             params=dict(x=0.28, r=0.013, z=B)),
        dict(slot=10, name="Front Sight Base", archetype="front_sight", material="phosphate",
             assembly="Sights", risk_tier="STABLE", risk_score=26, mat="Forged steel",
             function="Muzzle-end post protected by wings; sets elevation/windage zero.",
             params=dict(x=0.40, z=B)),
        dict(slot=11, name="Barrel", archetype="barrel", material="blued",
             assembly="Barrel group", risk_tier="CRITICAL", risk_score=95, mat="Chrome-lined steel",
             function="Chrome-lined, rifled bore that accelerates and stabilises the projectile.",
             params=dict(x0=0.11, x_step=0.28, x1=0.42, r0=0.012, r1=0.010, z=B)),
        dict(slot=12, name="Rear Sight Block", archetype="rear_sight", material="phosphate",
             assembly="Sights", risk_tier="STABLE", risk_score=25, mat="Steel",
             function="Tangent leaf sight graduated in hundreds of metres.",
             params=dict(x=0.15, z=0.03)),
        dict(slot=13, name="Buttstock", archetype="stock", material="walnut",
             assembly="Furniture", risk_tier="STABLE", risk_score=20, mat="Laminated wood",
             function="Shoulder stock that sets length of pull and absorbs recoil.",
             params=dict(x0=-0.42, x1=-0.13, z=-0.004, tilt=0.03)),
        dict(slot=14, name="Buttplate", archetype="buttplate", material="carbon",
             assembly="Furniture", risk_tier="STABLE", risk_score=18, mat="Stamped steel",
             function="Ribbed steel plate; often houses a cleaning-kit trap.",
             params=dict(x=-0.425, z=-0.006)),
        dict(slot=15, name="Pistol Grip", archetype="grip", material="bakelite",
             assembly="Furniture", risk_tier="STABLE", risk_score=20, mat="Bakelite",
             function="Firing-hand grip angled for control.",
             params=dict(x=-0.10, z=-0.05, tilt_deg=18)),
        dict(slot=16, name="Trigger", archetype="trigger", material="polished",
             assembly="Fire-control group", risk_tier="ELEVATED", risk_score=58, mat="Machined steel",
             function="Releases the hammer; part of the sheet-metal AK fire-control group.",
             params=dict(x=-0.05, z=-0.042)),
        dict(slot=17, name="Hammer", archetype="hammer", material="polished",
             assembly="Fire-control group", risk_tier="ELEVATED", risk_score=62, mat="Machined steel",
             function="Spring-driven hammer that strikes the firing pin.",
             params=dict(x=-0.085, z=-0.012, r=0.016)),
        dict(slot=18, name="Selector Lever", archetype="selector", material="phosphate",
             assembly="Fire-control group", risk_tier="STABLE", risk_score=30, mat="Stamped steel",
             function="Right-side safety/selector that blocks the trigger and covers the dust-cover gap.",
             params=dict(x=0.02, y=0.02, z=0.012)),
        dict(slot=19, name="Magazine Catch", archetype="small", material="phosphate",
             assembly="Feed system", risk_tier="STABLE", risk_score=24, mat="Stamped steel",
             function="Sprung paddle that locks the magazine into the well.",
             params=dict(x=-0.03, z=-0.032, sx=0.014, sy=0.01, sz=0.016)),
    ]


# ---------------------------------------------------------------------------
# AK-74M — AK-pattern, 5.45x39mm, polymer furniture + slotted muzzle brake
# ---------------------------------------------------------------------------
def ak74m_parts():
    B = 0.012
    return [
        dict(slot=0, shell=True, name="Receiver", archetype="receiver", material="phosphate",
             assembly="Receiver", risk_tier="ELEVATED", risk_score=72, mat="Stamped sheet steel",
             function="Stamped steel receiver of the 5.45mm AK-74M.",
             params=dict(x0=-0.13, x1=0.13, w=0.036, h=0.05, z=0.0, mag_x=-0.02)),
        dict(slot=1, name="Magazine", archetype="magazine", material="polymer",
             assembly="Feed system", risk_tier="STABLE", risk_score=28, mat="Glass-filled polymer",
             function="Ribbed 30-round polymer magazine for 5.45x39mm.",
             params=dict(x=-0.02, z=-0.055)),
        dict(slot=2, name="Dust Cover", archetype="dust_cover", material="phosphate",
             assembly="Receiver cover", risk_tier="STABLE", risk_score=28, mat="Stamped steel",
             function="Ribbed stamped top cover.",
             params=dict(x0=-0.06, x1=0.13, z=0.028, r=0.021)),
        dict(slot=3, name="Recoil Spring Assembly", archetype="spring", material="polished",
             assembly="Recoil system", risk_tier="STABLE", risk_score=34, mat="Spring steel",
             function="Return spring and guide rod driving the carrier back into battery.",
             params=dict(x0=-0.11, x1=0.06, radius=0.007, coils=15, z=0.017, wire=0.0016, guide_r=0.003)),
        dict(slot=4, name="Bolt Carrier", archetype="bolt_carrier", material="polished",
             assembly="Bolt group", risk_tier="CRITICAL", risk_score=90, mat="Machined steel",
             function="Long-stroke carrier that cams the rotating bolt.",
             params=dict(x0=-0.07, x1=0.055, r=0.011, z=0.014)),
        dict(slot=5, name="Gas Piston", archetype="rod", material="carbon",
             assembly="Gas system", risk_tier="ELEVATED", risk_score=64, mat="Chrome-lined steel",
             function="Piston fixed to the carrier, driven by tapped propellant gas.",
             params=dict(x0=0.055, x1=0.20, r=0.006, z=0.02, head=True)),
        dict(slot=6, name="Bolt", archetype="bolt", material="polished",
             assembly="Bolt group", risk_tier="CRITICAL", risk_score=88, mat="Machined steel",
             function="Rotating bolt with locking lugs sealing the chamber.",
             params=dict(x0=0.05, x1=0.086, r=0.0085, z=0.013)),
        dict(slot=7, name="Gas Tube & Upper Handguard", archetype="tube", material="polymer",
             assembly="Gas system", risk_tier="ELEVATED", risk_score=55, mat="Steel / polymer",
             function="Gas tube with a polymer upper handguard.",
             params=dict(x0=0.13, x1=0.28, r=0.013, z=0.028)),
        dict(slot=8, name="Lower Handguard", archetype="handguard", material="polymer",
             assembly="Furniture", risk_tier="STABLE", risk_score=20, mat="Glass-filled polymer",
             function="Polymer fore-end.",
             params=dict(x0=0.13, x1=0.25, z=-0.006, w=0.05, h=0.03)),
        dict(slot=9, name="Gas Block", archetype="gas_block", material="phosphate",
             assembly="Gas system", risk_tier="ELEVATED", risk_score=60, mat="Forged steel",
             function="Taps barrel gas into the gas tube.",
             params=dict(x=0.28, r=0.013, z=B)),
        dict(slot=10, name="Front Sight Base", archetype="front_sight", material="phosphate",
             assembly="Sights", risk_tier="STABLE", risk_score=26, mat="Forged steel",
             function="Winged front sight post.",
             params=dict(x=0.39, z=B)),
        dict(slot=11, name="Muzzle Brake", archetype="muzzle_device", material="phosphate",
             assembly="Muzzle device", risk_tier="ELEVATED", risk_score=52, mat="Steel",
             function="Chambered muzzle brake cutting recoil and muzzle rise — the AK-74 signature.",
             params=dict(x0=0.42, x1=0.46, r=0.014, rings=3, z=B)),
        dict(slot=12, name="Barrel", archetype="barrel", material="blued",
             assembly="Barrel group", risk_tier="CRITICAL", risk_score=95, mat="Chrome-lined steel",
             function="Cold-hammer-forged, chrome-lined 5.45mm bore.",
             params=dict(x0=0.11, x_step=0.28, x1=0.42, r0=0.011, r1=0.009, z=B)),
        dict(slot=13, name="Rear Sight Block", archetype="rear_sight", material="phosphate",
             assembly="Sights", risk_tier="STABLE", risk_score=25, mat="Steel",
             function="Tangent rear sight.", params=dict(x=0.15, z=0.03)),
        dict(slot=14, name="Buttstock", archetype="stock", material="polymer",
             assembly="Furniture", risk_tier="STABLE", risk_score=20, mat="Polymer",
             function="Polymer shoulder stock.",
             params=dict(x0=-0.42, x1=-0.13, z=-0.004, tilt=0.03)),
        dict(slot=15, name="Buttplate", archetype="buttplate", material="polymer",
             assembly="Furniture", risk_tier="STABLE", risk_score=18, mat="Polymer",
             function="Polymer butt pad.", params=dict(x=-0.425, z=-0.006)),
        dict(slot=16, name="Pistol Grip", archetype="grip", material="polymer",
             assembly="Furniture", risk_tier="STABLE", risk_score=20, mat="Polymer",
             function="Polymer firing grip.", params=dict(x=-0.10, z=-0.05, tilt_deg=18)),
        dict(slot=17, name="Trigger", archetype="trigger", material="polished",
             assembly="Fire-control group", risk_tier="ELEVATED", risk_score=58, mat="Machined steel",
             function="Releases the hammer.", params=dict(x=-0.05, z=-0.042)),
        dict(slot=18, name="Hammer", archetype="hammer", material="polished",
             assembly="Fire-control group", risk_tier="ELEVATED", risk_score=62, mat="Machined steel",
             function="Spring-driven hammer.", params=dict(x=-0.085, z=-0.012, r=0.016)),
        dict(slot=19, name="Selector Lever", archetype="selector", material="phosphate",
             assembly="Fire-control group", risk_tier="STABLE", risk_score=30, mat="Stamped steel",
             function="Right-side safety/selector.", params=dict(x=0.02, y=0.02, z=0.012)),
    ]


# ---------------------------------------------------------------------------
# AS Val — 9x39mm, integrally suppressed special-purpose rifle
# ---------------------------------------------------------------------------
def asval_parts():
    B = 0.012
    return [
        dict(slot=0, shell=True, name="Receiver", archetype="receiver", material="phosphate",
             assembly="Receiver", risk_tier="ELEVATED", risk_score=70, mat="Stamped / milled steel",
             function="AKS-74U-derived receiver housing the bolt and fire-control groups.",
             params=dict(x0=-0.12, x1=0.10, w=0.036, h=0.05, z=0.0, mag_x=-0.02)),
        dict(slot=1, name="Magazine", archetype="magazine", material="polymer",
             assembly="Feed system", risk_tier="STABLE", risk_score=30, mat="Polymer",
             function="20-round magazine feeding heavy subsonic 9x39mm rounds.",
             params=dict(x=-0.02, z=-0.05)),
        dict(slot=2, name="Dust Cover", archetype="dust_cover", material="phosphate",
             assembly="Receiver cover", risk_tier="STABLE", risk_score=26, mat="Stamped steel",
             function="Hinged top cover with the integral rear sight.",
             params=dict(x0=-0.06, x1=0.10, z=0.028, r=0.021)),
        dict(slot=3, name="Recoil Spring Assembly", archetype="spring", material="polished",
             assembly="Recoil system", risk_tier="STABLE", risk_score=34, mat="Spring steel",
             function="Return spring and guide rod.",
             params=dict(x0=-0.10, x1=0.05, radius=0.007, coils=13, z=0.017, wire=0.0016, guide_r=0.003)),
        dict(slot=4, name="Bolt Carrier", archetype="bolt_carrier", material="polished",
             assembly="Bolt group", risk_tier="CRITICAL", risk_score=88, mat="Machined steel",
             function="Gas-driven carrier camming the rotating bolt.",
             params=dict(x0=-0.06, x1=0.05, r=0.011, z=0.014)),
        dict(slot=5, name="Gas Piston", archetype="rod", material="carbon",
             assembly="Gas system", risk_tier="ELEVATED", risk_score=60, mat="Chrome-lined steel",
             function="Piston driven by gas bled from the ported barrel inside the suppressor.",
             params=dict(x0=0.05, x1=0.16, r=0.006, z=0.02, head=True)),
        dict(slot=6, name="Bolt", archetype="bolt", material="polished",
             assembly="Bolt group", risk_tier="CRITICAL", risk_score=86, mat="Machined steel",
             function="Rotating bolt locking into the barrel extension.",
             params=dict(x0=0.045, x1=0.08, r=0.0085, z=0.013)),
        dict(slot=7, name="Barrel", archetype="barrel", material="blued",
             assembly="Barrel group", risk_tier="CRITICAL", risk_score=92, mat="Ported steel",
             function="Short ported barrel that bleeds gas into the integral suppressor.",
             params=dict(x0=0.09, x_step=0.16, x1=0.24, r0=0.010, r1=0.009, z=B)),
        dict(slot=8, name="Integral Suppressor", archetype="suppressor", material="phosphate",
             assembly="Suppressor", risk_tier="ELEVATED", risk_score=66, mat="Steel shroud",
             function="Large baffled shroud around the barrel — the defining feature of the AS Val.",
             params=dict(x0=0.09, x1=0.44, r=0.028, z=B)),
        dict(slot=9, name="Front Sight", archetype="front_sight", material="phosphate",
             assembly="Sights", risk_tier="STABLE", risk_score=24, mat="Steel",
             function="Front post mounted atop the suppressor.",
             params=dict(x=0.40, z=B + 0.03)),
        dict(slot=10, name="Rear Sight", archetype="rear_sight", material="phosphate",
             assembly="Sights", risk_tier="STABLE", risk_score=24, mat="Steel",
             function="Flip aperture rear sight on the dust cover.",
             params=dict(x=-0.04, z=0.035)),
        dict(slot=11, name="Skeleton Stock", archetype="skeleton_stock", material="phosphate",
             assembly="Furniture", risk_tier="STABLE", risk_score=22, mat="Steel tube",
             function="Side-folding skeletonised metal stock.",
             params=dict(x0=-0.34, x1=-0.12, z=0.0, r=0.008)),
        dict(slot=12, name="Pistol Grip", archetype="grip", material="polymer",
             assembly="Furniture", risk_tier="STABLE", risk_score=20, mat="Polymer",
             function="Polymer firing grip.", params=dict(x=-0.09, z=-0.05, tilt_deg=16)),
        dict(slot=13, name="Trigger", archetype="trigger", material="polished",
             assembly="Fire-control group", risk_tier="ELEVATED", risk_score=56, mat="Machined steel",
             function="Releases the hammer.", params=dict(x=-0.045, z=-0.042)),
        dict(slot=14, name="Hammer", archetype="hammer", material="polished",
             assembly="Fire-control group", risk_tier="ELEVATED", risk_score=60, mat="Machined steel",
             function="Spring-driven hammer.", params=dict(x=-0.075, z=-0.012, r=0.015)),
        dict(slot=15, name="Selector Lever", archetype="selector", material="phosphate",
             assembly="Fire-control group", risk_tier="STABLE", risk_score=28, mat="Stamped steel",
             function="AK-pattern safety/selector.", params=dict(x=0.01, y=0.02, z=0.012)),
    ]


# ---------------------------------------------------------------------------
# Thompson M1928A1 — .45 ACP, blowback SMG, drum mag + finned barrel
# ---------------------------------------------------------------------------
def tommy_parts():
    B = 0.010
    return [
        dict(slot=0, shell=True, name="Receiver", archetype="receiver", material="blued",
             assembly="Receiver", risk_tier="ELEVATED", risk_score=68, mat="Milled steel",
             function="Heavy milled steel receiver of the Thompson.",
             params=dict(x0=-0.10, x1=0.10, w=0.04, h=0.055, z=0.0, mag_x=0.0)),
        dict(slot=1, name="Drum Magazine", archetype="drum_mag", material="blued",
             assembly="Feed system", risk_tier="STABLE", risk_score=32, mat="Stamped steel",
             function="Iconic 50-round rotary drum magazine for .45 ACP.",
             params=dict(x=0.0, z=-0.075, r=0.055, thick=0.03)),
        dict(slot=2, name="Bolt", archetype="bolt", material="polished",
             assembly="Bolt group", risk_tier="CRITICAL", risk_score=82, mat="Machined steel",
             function="Heavy blowback bolt (with Blish H-piece on early guns).",
             params=dict(x0=-0.05, x1=0.05, r=0.014, z=0.012)),
        dict(slot=3, name="Recoil Spring Assembly", archetype="spring", material="polished",
             assembly="Recoil system", risk_tier="STABLE", risk_score=34, mat="Spring steel",
             function="Return spring behind the bolt.",
             params=dict(x0=-0.09, x1=-0.02, radius=0.008, coils=12, z=0.012, wire=0.0018, guide_r=0.003)),
        dict(slot=4, name="Actuator Knob", archetype="small", material="polished",
             assembly="Bolt group", risk_tier="STABLE", risk_score=30, mat="Steel",
             function="Top-mounted cocking knob riding in the receiver slot.",
             params=dict(x=-0.02, z=0.04, sx=0.014, sy=0.012, sz=0.02)),
        dict(slot=5, name="Finned Barrel", archetype="finned_barrel", material="blued",
             assembly="Barrel group", risk_tier="CRITICAL", risk_score=90, mat="Steel",
             function="Radially finned barrel for air cooling — a Thompson hallmark.",
             params=dict(x0=0.10, x1=0.30, r=0.011, z=B, fins=11, fin_r=0.02)),
        dict(slot=6, name="Cutts Compensator", archetype="muzzle_device", material="blued",
             assembly="Muzzle device", risk_tier="ELEVATED", risk_score=50, mat="Steel",
             function="Slotted muzzle compensator reducing climb in full-auto.",
             params=dict(x0=0.30, x1=0.345, r=0.014, rings=2, z=B)),
        dict(slot=7, name="Front Sight", archetype="front_sight", material="blued",
             assembly="Sights", risk_tier="STABLE", risk_score=22, mat="Steel",
             function="Blade front sight.", params=dict(x=0.29, z=B)),
        dict(slot=8, name="Rear Sight", archetype="rear_sight", material="blued",
             assembly="Sights", risk_tier="STABLE", risk_score=22, mat="Steel",
             function="Adjustable aperture rear sight (Lyman).", params=dict(x=-0.06, z=0.04)),
        dict(slot=9, name="Vertical Foregrip", archetype="grip", material="walnut",
             assembly="Furniture", risk_tier="STABLE", risk_score=20, mat="Walnut",
             function="Front vertical grip (the classic Tommy-gun foregrip).",
             params=dict(x=0.18, z=-0.06, tilt_deg=0)),
        dict(slot=10, name="Buttstock", archetype="stock", material="walnut",
             assembly="Furniture", risk_tier="STABLE", risk_score=20, mat="Walnut",
             function="Detachable wood shoulder stock.",
             params=dict(x0=-0.32, x1=-0.10, z=-0.004, tilt=0.02)),
        dict(slot=11, name="Pistol Grip", archetype="grip", material="walnut",
             assembly="Furniture", risk_tier="STABLE", risk_score=20, mat="Walnut",
             function="Wood firing grip.", params=dict(x=-0.06, z=-0.05, tilt_deg=12)),
        dict(slot=12, name="Trigger", archetype="trigger", material="polished",
             assembly="Fire-control group", risk_tier="ELEVATED", risk_score=54, mat="Machined steel",
             function="Trip for the open-bolt sear.", params=dict(x=-0.02, z=-0.042)),
        dict(slot=13, name="Sear", archetype="small", material="polished",
             assembly="Fire-control group", risk_tier="ELEVATED", risk_score=56, mat="Machined steel",
             function="Holds and releases the bolt in open-bolt firing.",
             params=dict(x=-0.05, z=-0.02, sx=0.016, sy=0.01, sz=0.014)),
    ]


# ---------------------------------------------------------------------------
# Ruger Mini-14 — .223, mini-Garand op-rod action, wood stock
# ---------------------------------------------------------------------------
def mini14_parts():
    B = 0.012
    return [
        dict(slot=0, shell=True, name="Receiver", archetype="receiver", material="phosphate",
             assembly="Receiver", risk_tier="ELEVATED", risk_score=66, mat="Investment-cast steel",
             function="Investment-cast receiver of the Mini-14.",
             params=dict(x0=-0.06, x1=0.10, w=0.034, h=0.045, z=0.0, mag_x=0.0)),
        dict(slot=1, name="Wood Stock", archetype="stock", material="walnut",
             assembly="Furniture", risk_tier="STABLE", risk_score=20, mat="Hardwood",
             function="One-piece wood rifle stock the barreled action beds into.",
             params=dict(x0=-0.30, x1=0.22, z=-0.03, tilt=0.0)),
        dict(slot=2, name="Magazine", archetype="magazine", material="blued",
             assembly="Feed system", risk_tier="STABLE", risk_score=28, mat="Steel",
             function="Detachable 20-round box magazine for .223 Remington.",
             params=dict(x=0.02, z=-0.055)),
        dict(slot=3, name="Bolt", archetype="bolt", material="polished",
             assembly="Bolt group", risk_tier="CRITICAL", risk_score=86, mat="Machined steel",
             function="Rotating bolt with dual locking lugs (Garand-type).",
             params=dict(x0=0.02, x1=0.06, r=0.0085, z=0.012)),
        dict(slot=4, name="Bolt Carrier / Slide", archetype="bolt_carrier", material="polished",
             assembly="Bolt group", risk_tier="CRITICAL", risk_score=84, mat="Machined steel",
             function="Slide that cams the bolt, driven by the operating rod.",
             params=dict(x0=-0.03, x1=0.05, r=0.010, z=0.013)),
        dict(slot=5, name="Operating Rod", archetype="rod", material="carbon",
             assembly="Gas system", risk_tier="ELEVATED", risk_score=62, mat="Steel",
             function="Garand-style op-rod on the right side, driven by the gas piston.",
             params=dict(x0=0.02, x1=0.30, r=0.006, y=0.015, z=-0.004, head=True)),
        dict(slot=6, name="Recoil Spring", archetype="spring", material="polished",
             assembly="Recoil system", risk_tier="STABLE", risk_score=32, mat="Spring steel",
             function="Op-rod return spring.",
             params=dict(x0=0.04, x1=0.20, radius=0.005, coils=16, z=-0.004, wire=0.0014, guide_r=0.002)),
        dict(slot=7, name="Barrel", archetype="barrel", material="blued",
             assembly="Barrel group", risk_tier="CRITICAL", risk_score=92, mat="Chrome-moly steel",
             function="Rifled .223 barrel.",
             params=dict(x0=0.10, x_step=0.26, x1=0.40, r0=0.010, r1=0.008, z=B)),
        dict(slot=8, name="Gas Block", archetype="gas_block", material="phosphate",
             assembly="Gas system", risk_tier="ELEVATED", risk_score=58, mat="Steel",
             function="Fixed gas block under the barrel tapping gas to the op-rod piston.",
             params=dict(x=0.28, r=0.011, z=B - 0.02)),
        dict(slot=9, name="Front Sight", archetype="front_sight", material="phosphate",
             assembly="Sights", risk_tier="STABLE", risk_score=24, mat="Steel",
             function="Winged front sight.", params=dict(x=0.37, z=B)),
        dict(slot=10, name="Rear Aperture Sight", archetype="rear_sight", material="phosphate",
             assembly="Sights", risk_tier="STABLE", risk_score=24, mat="Steel",
             function="Ghost-ring aperture rear sight.", params=dict(x=-0.02, z=0.03)),
        dict(slot=11, name="Trigger", archetype="trigger", material="polished",
             assembly="Fire-control group", risk_tier="ELEVATED", risk_score=54, mat="Machined steel",
             function="Releases the hammer.", params=dict(x=0.0, z=-0.05)),
        dict(slot=12, name="Hammer", archetype="hammer", material="polished",
             assembly="Fire-control group", risk_tier="ELEVATED", risk_score=58, mat="Machined steel",
             function="Spring-driven hammer in the trigger housing.",
             params=dict(x=-0.03, z=-0.02, r=0.014)),
    ]


WEAPONS = {
    "ak-47": {
        "name": "AK-47 — Internals (Cutaway)",
        "designation": "AK-47 / AKM 7.62x39mm gas-operated assault rifle",
        "operating_principle": ("Long-stroke gas piston: propellant gas tapped from the barrel drives "
                                "the piston and bolt carrier rearward, the rotating bolt unlocks, the "
                                "spent case ejects and the recoil spring returns the group into battery."),
        "image": "/images/ak-47.png",
        "parts": ak47_parts,
    },
    "ak-74m": {
        "name": "AK-74M — Internals (Cutaway)",
        "designation": "AK-74M 5.45x39mm gas-operated assault rifle",
        "operating_principle": ("Same long-stroke gas-piston action as the AK-47 in the smaller 5.45x39mm "
                                "calibre, with polymer furniture and a chambered muzzle brake that cuts "
                                "recoil and muzzle rise."),
        "image": "/images/low-poly-ak-74m-zenitco.png",
        "parts": ak74m_parts,
    },
    "as-val": {
        "name": "AS Val — Internals (Cutaway)",
        "designation": "AS Val 9x39mm integrally suppressed special-purpose rifle",
        "operating_principle": ("Gas-operated rotating-bolt action firing heavy subsonic 9x39mm rounds; "
                                "the barrel is ported into a large integral suppressor so the round stays "
                                "subsonic and the report is suppressed at the source."),
        "image": "/images/as_val.png",
        "parts": asval_parts,
    },
    "tommy-gun": {
        "name": "Thompson M1928A1 — Internals (Cutaway)",
        "designation": "Thompson M1928A1 .45 ACP submachine gun",
        "operating_principle": ("Blowback, open-bolt action: the heavy bolt is held to the rear by the "
                                "sear, and on firing the .45 ACP cartridge blows it back against the "
                                "recoil spring; a finned barrel sheds heat and a Cutts compensator tames climb."),
        "image": "/images/tommy-gun.png",
        "parts": tommy_parts,
    },
    "mini-14": {
        "name": "Ruger Mini-14 — Internals (Cutaway)",
        "designation": "Ruger Mini-14 .223 gas-operated semi-automatic rifle",
        "operating_principle": ("A scaled-down M1 Garand / M14 action: a fixed gas block drives a "
                                "side-mounted operating rod and slide that cam a rotating bolt, cycling "
                                ".223 Remington from a detachable box magazine."),
        "image": "/images/mini-14_ranch_rifle.png",
        "parts": mini14_parts,
    },
}


def build(weapon_key: str):
    if weapon_key not in WEAPONS:
        raise SystemExit(f"[STOP] no internals spec for '{weapon_key}'. Known: {', '.join(WEAPONS)}")
    w = WEAPONS[weapon_key]
    parts = w["parts"]()
    asset_id = f"{weapon_key}-internals"

    if not (TEXDIR / "phosphate_steel.png").exists():
        raise SystemExit("[STOP] textures missing — run: python scripts/gen_pbr_textures.py")
    if not BLENDER.exists():
        raise SystemExit(f"[STOP] Blender not found at {BLENDER}")

    out_dir = PUBLIC_MODELS / asset_id
    out_dir.mkdir(parents=True, exist_ok=True)
    glb_path = out_dir / "model.glb"

    scratch = SCRIPTS / "_spec_tmp"
    scratch.mkdir(exist_ok=True)
    render_png = scratch / f"{asset_id}_assembled.png"
    render_exp = scratch / f"{asset_id}_exploded.png"

    spec = {
        "name": w["name"], "designation": w["designation"],
        "texture_dir": str(TEXDIR).replace("\\", "/"),
        "output_glb": str(glb_path).replace("\\", "/"),
        "render_png": str(render_png).replace("\\", "/"),
        "render_exploded_png": str(render_exp).replace("\\", "/"),
        "materials": MATERIALS,
        "parts": [{"slot": p["slot"], "name": p["name"], "archetype": p["archetype"],
                   "material": p["material"], "shell": p.get("shell", False),
                   "params": p["params"]} for p in parts],
    }
    spec_path = scratch / f"{asset_id}_spec.json"
    spec_path.write_text(json.dumps(spec, indent=1), encoding="utf-8")

    print(f"[internals] driving Blender for {asset_id} ({len(parts)} parts)...")
    proc = subprocess.run(
        [str(BLENDER), "-b", "--factory-startup", "--python",
         str(SCRIPTS / "blender_build_weapon.py"), "--", str(spec_path)],
        capture_output=True, text=True)
    tail = "\n".join(proc.stdout.splitlines()[-25:])
    print(tail)
    if proc.returncode != 0 or not glb_path.exists():
        print(proc.stderr[-2000:])
        raise SystemExit(f"[STOP] Blender build failed (rc={proc.returncode})")
    print(f"[internals] GLB -> {glb_path}  ({glb_path.stat().st_size // 1024} KB)")

    _write_intel(asset_id, w, parts)
    _register_card(asset_id, w)
    print(f"[internals] done. Open: http://localhost:5173/?glb=/models/{asset_id}/model.glb&name={w['name']}")
    print(f"[internals] previews: {render_png.name}, {render_exp.name} in {scratch}")


def _intel_cache_path(name: str, url: str) -> Path:
    slug = re.sub(r"[^a-z0-9]+", "-", f"{name} {url}".lower()).strip("-")[:150]
    return INTEL_DIR / f"{slug or 'asset'}.json"


def _write_intel(asset_id: str, w: dict, parts: list):
    """Aligned intel: components[] in slot order + intel keyed by Inner_Part_N and name."""
    url = f"/models/{asset_id}/model.glb"
    inner = sorted([p for p in parts if not p.get("shell")], key=lambda p: p["slot"])
    components, intel = [], {}
    for p in inner:
        entry = {
            "part_name": p["name"], "assembly": p["assembly"],
            "description": p["function"], "material_dependency": p["mat"],
            "risk_tier": p["risk_tier"], "risk_score": p["risk_score"],
            "disassembly_order": p["slot"], "confidence": "high",
            "geometry_cue": "procedurally modelled to spec",
        }
        components.append({"part_name": p["name"], "description": p["function"],
                           "material_dependency": p["mat"], "risk_tier": p["risk_tier"],
                           "risk_score": p["risk_score"]})
        intel[f"Inner_Part_{p['slot']}"] = entry
        intel.setdefault(p["name"], entry)

    data = {
        "name": w["name"], "url": url, "designation": w["designation"],
        "platform": "firearm", "axis_orientation": "muzzle at +X, buttstock at -X",
        "operating_principle": w["operating_principle"],
        "identified": len(inner), "part_count": len(inner),
        "components": components, "intel": intel,
    }
    INTEL_DIR.mkdir(parents=True, exist_ok=True)
    path = _intel_cache_path(w["name"], url)
    path.write_text(json.dumps(data, indent=1), encoding="utf-8")
    print(f"[internals] intel cache -> {path.name}  ({len(components)} components)")


def _register_card(asset_id: str, w: dict):
    js = ASSETS_JS.read_text(encoding="utf-8")
    if f'"id": "{asset_id}"' in js:
        print("[internals] library card already present")
        return
    card = (
        "  {\n"
        f'    "id": "{asset_id}",\n'
        f'    "name": "{w["name"]}",\n'
        '    "serial": "ASSET-INT-01",\n'
        '    "status": "READY",\n'
        '    "statusType": "ready",\n'
        f'    "url": "/models/{asset_id}/model.glb",\n'
        f'    "image": "{w["image"]}",\n'
        '    "specs": [\n'
        '      { "label": "Type", "value": "CUTAWAY" },\n'
        '      { "label": "Status", "value": "ENGINEERED", "isStatus": true }\n'
        "    ]\n"
        "  },\n"
    )
    idx = js.rindex("];")
    # insert after the opening "[" so it shows first in the library
    open_idx = js.index("[") + 1
    js = js[:open_idx] + "\n" + card + js[open_idx:]
    ASSETS_JS.write_text(js, encoding="utf-8")
    print(f"[internals] registered library card '{asset_id}'")


if __name__ == "__main__":
    args = [a for a in sys.argv[1:] if a]
    if not args or args[0] == "--list":
        print("weapons with an internals spec:", ", ".join(WEAPONS))
        raise SystemExit(0)
    build(args[0])
