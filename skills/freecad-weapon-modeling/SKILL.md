---
name: freecad-weapon-modeling
description: Master AI Skill for generating parametric 3D CAD weapon models, military vehicles (Arjun MBT), and multi-part exploded assemblies using FreeCAD Python API, live web research, and 5-pass iterative refinement.
---

# Master AI FreeCAD Weapon & Armor Modeling Skill

This skill guides the AI assistant in designing high-precision 3D parametric CAD models of weapons, military vehicles, artillery, and tactical hardware using FreeCAD's Python script engine (`FreeCAD`, `Part`, `BRep`, `Draft`, `Mesh`), combined with web internet research and a 5-pass iterative CAD refinement loop.

## Core Capabilities

1. **FreeCAD API Mastery**:
   - Construct CSG solid primitives: `Part.makeBox()`, `Part.makeCylinder()`, `Part.makeCone()`, `Part.makeTorus()`, `Part.makeSphere()`.
   - Apply boolean operations: `solidA.cut(solidB)`, `solidA.fuse(solidB)`, `solidA.common(solidB)`.
   - Apply engineering surface features: `makeFillet()`, `makeChamfer()`, revolve/extrude operations (`Draft.makeWire()`, `Part.Wire`).
   - Multi-body hierarchical assemblies with named part nodes for WebGL exploded views.

2. **5-Pass Multi-Iteration Refinement Protocol**:
   - **Pass 1 - Structural Framework**: Primary B-Rep CAD geometry (Hull, Turret, Receiver, Gun Barrel).
   - **Pass 2 - Mechanical Systems**: Moving assemblies, suspension, hatches, breech mechanisms.
   - **Pass 3 - Tactical Detailing**: Composite armor modules (e.g., Kanchan armor), thermal sights, optics, rails, muzzle devices.
   - **Pass 4 - Quality & Topology Audit**: Manifold checks, fillets/chamfers, edge smoothing, CAD CSG integrity validation.
   - **Pass 5 - Multi-Body Assembly Packaging**: Hierarchical node setup, explosion translation vectors, PBR material properties, and GLB export.

3. **Supported Asset Categories**:
   - **Main Battle Tanks & Armored Vehicles**: Arjun MBT (Hull, Turret, 120mm Gun, Kanchan Composite Armor, Track Units, Sights, Engine Deck, Fuel Tanks).
   - **Small Arms & Rifles**: AR-15 / M4A1, AK-47, Glock 19, Barrett M82 Sniper Rifle.
   - **Heavy Weapons & Sci-Fi Ordnance**: Railguns, Plasma Pulse Cannons, Guided Missile Launchers.

4. **Multi-Part Exploded View Vectors**:
   Each component node must specify anatomical explosion offset vectors:
   - `Gun_Barrel` / `Muzzle`: Forward along +Z axis
   - `Stock` / `Rear_Engine`: Backward along -Z axis
   - `Turret` / `Optic_Sight`: Upward along +Y axis
   - `Magazine` / `Track_Assembly`: Downward along -Y axis or sideways along X axis
