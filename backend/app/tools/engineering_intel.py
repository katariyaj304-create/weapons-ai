"""
Master-engineer intel for library assets.

The exploded viewer splits every library model into real, movable parts — but
the artists named most of those meshes `defaultMaterial_3`, `Section 12` or
`C1 7`. This module gives each of those parts its true engineering identity:

  1. resolve the asset id to the REAL platform it depicts (a designation you
     can actually research — `t-72a-obr-1980` -> "T-72A main battle tank");
  2. deep-research that platform with Tavily (parts nomenclature, operating
     mechanism, subsystem architecture, materials);
  3. hand an LLM the research PLUS the model's actual part table (each part's
     normalized position along the hull/barrel axis, its height, its size) and
     have it assign every part its correct engineering name, parent assembly,
     function, material and disassembly order — following the platform's own
     design logic (a gas-operated rifle strips barrel -> gas system -> bolt
     carrier -> fire control -> feed; a tank splits hull / turret / running
     gear / powerpack).

Output feeds the exploded viewer's balloons + component sheet and the BOM /
risk dashboard, and is disk-cached per asset by app.main.
"""
import json
import re

from app.tools.llm import chat as llm_chat
from app.tools.search import search_web

RESEARCH_MODEL = "meta-llama/Llama-3.3-70B-Instruct"

# ---------------------------------------------------------------------------
# 1. Asset -> real platform. Library ids are artist slugs ("basic_missle",
#    "simple-tank"); research needs a designation that exists in the world.
# ---------------------------------------------------------------------------
SUBJECTS = {
    "abandoned_soviet_btr_-_80": ("BTR-80 8x8 amphibious armoured personnel carrier", "armored_vehicle"),
    "ak-47": ("AK-47 / AKM 7.62x39mm gas-operated assault rifle", "firearm"),
    "arx-apc": ("8x8 wheeled armoured personnel carrier with roof weapon station", "armored_vehicle"),
    "arx-pounder": ("wheeled turreted self-propelled gun / fire-support vehicle", "armored_vehicle"),
    "as_val": ("AS Val 9x39mm integrally suppressed special-purpose assault rifle", "firearm"),
    "basic_missle": ("guided missile — nose/seeker, warhead, guidance section, rocket motor, control fins", "missile"),
    "boeing-kc-46a": ("Boeing KC-46A Pegasus aerial refuelling tanker", "aircraft"),
    "boeing-kc-46a-pegasus": ("Boeing KC-46A Pegasus aerial refuelling tanker", "aircraft"),
    "call-of-duty-black-ops-6-as-val": ("AS Val 9x39mm integrally suppressed assault rifle", "firearm"),
    "drdo-rustom-2-uav": ("DRDO Rustom-2 (TAPAS-BH-201) MALE unmanned aerial vehicle", "aircraft"),
    "japanese-type-87-rcv": ("Type 87 Reconnaissance and Patrol Vehicle (JGSDF 6x6 armoured car)", "armored_vehicle"),
    "jet-fighter": ("supersonic multirole jet fighter aircraft", "aircraft"),
    "kf-21a-boramae-fighter-jet": ("KAI KF-21 Boramae 4.5-generation multirole fighter", "aircraft"),
    "kfir_c.10_block_60": ("IAI Kfir C.10 (Block 60) delta-wing multirole fighter", "aircraft"),
    "koreanavy-_kss3_class_-_submarine": ("KSS-III Dosan Ahn Changho-class diesel-electric attack submarine", "submarine"),
    "low-poly-ak-74m-zenitco": ("AK-74M 5.45x39mm assault rifle with Zenitco furniture", "firearm"),
    "m1a2-abrams": ("M1A2 Abrams main battle tank", "tank"),
    "m1a2-sepv2-abrams-main-battle-tank-dc": ("M1A2 SEPv2 Abrams main battle tank", "tank"),
    "mini-14_ranch_rifle": ("Ruger Mini-14 Ranch Rifle, gas-operated .223 semi-automatic rifle", "firearm"),
    "missle_game_ready_4k_pbr_textures_free": ("air-to-surface guided missile", "missile"),
    "mortar-60": ("60mm light infantry mortar (tube, baseplate, bipod, sight)", "mortar"),
    "sikorsky-ch-53e-sea-stallion": ("Sikorsky CH-53E Super Stallion heavy-lift helicopter", "helicopter"),
    "simple-tank": ("main battle tank — hull, turret, gun, running gear", "tank"),
    "submarine-kss3": ("KSS-III Dosan Ahn Changho-class diesel-electric attack submarine", "submarine"),
    "sukhoi-su-57-felon-fighter-jet-free": ("Sukhoi Su-57 Felon stealth multirole fighter", "aircraft"),
    "sukhoi-su-57-felon-p-fighter-jet-free": ("Sukhoi Su-57 Felon stealth multirole fighter", "aircraft"),
    "t-72a-obr-1980": ("T-72A (obr. 1980) main battle tank", "tank"),
    "tommy-gun": ("Thompson M1928A1 .45 ACP submachine gun", "firearm"),
    "type87_arv": ("Type 87 Reconnaissance and Patrol Vehicle (JGSDF 6x6 armoured car)", "armored_vehicle"),
    "us-super-battleship-rhodeisland": ("battleship — main gun turrets, superstructure, hull, propulsion", "warship"),
}

# Keyword fallback for anything not in the table (uploads, new library assets)
_CLASS_KEYWORDS = [
    (("rifle", "ak-", "ak4", "ak7", "m4", "m16", "gun", "pistol", "smg", "carbine", "val"), "firearm"),
    (("tank", "abrams", "t-72", "t-90", "leopard"), "tank"),
    (("apc", "btr", "ifv", "armou", "armor", "rcv", "arv"), "armored_vehicle"),
    (("missile", "missle", "rocket"), "missile"),
    (("mortar",), "mortar"),
    (("helicopter", "ch-53", "apache", "stallion"), "helicopter"),
    (("submarine", "kss"), "submarine"),
    (("battleship", "destroyer", "frigate", "carrier", "navy"), "warship"),
    (("jet", "fighter", "aircraft", "uav", "drone", "su-", "f-1", "f-2", "f-3"), "aircraft"),
]


def resolve_subject(asset_id: str, asset_name: str) -> tuple:
    """(research subject, platform class) for a library asset."""
    key = (asset_id or "").strip().lower()
    if key in SUBJECTS:
        return SUBJECTS[key]
    hay = f"{key} {asset_name}".lower()
    for keywords, platform in _CLASS_KEYWORDS:
        if any(k in hay for k in keywords):
            return (asset_name or asset_id, platform)
    return (asset_name or asset_id, "generic")


# ---------------------------------------------------------------------------
# 2. Per-platform engineering doctrine: what the axis means, which assemblies
#    a real engineer would break the machine into, what to research.
# ---------------------------------------------------------------------------
PLATFORM_DOCTRINE = {
    "firearm": {
        "axis": "the bore axis: -1 is the buttstock/rear of the receiver, +1 is the muzzle",
        "assemblies": ("Barrel group, gas system (gas block/tube/piston), bolt & bolt carrier group, "
                       "receiver & dust cover, fire control group (trigger, hammer, sear, selector), "
                       "feed system (magazine, mag catch), furniture (stock, grip, handguard), sights, "
                       "recoil/return spring assembly, muzzle device or suppressor"),
        "queries": ("{s} parts nomenclature exploded view diagram list of components",
                    "{s} field strip disassembly order step by step",
                    "{s} operating mechanism gas system bolt carrier locking",
                    "{s} barrel receiver materials steel polymer manufacturing"),
    },
    "tank": {
        "axis": "the hull centreline: -1 is the rear (engine deck / exhaust), +1 is the front glacis and gun muzzle",
        "assemblies": ("Hull & glacis armour, turret & mantlet, main gun barrel with thermal sleeve, "
                       "autoloader/ammunition stowage, powerpack (engine + transmission), running gear "
                       "(drive sprocket, road wheels, idler, tracks, torsion bars), fire-control & sights, "
                       "ERA / composite armour packages, commander's cupola and secondary armament"),
        "queries": ("{s} main components hull turret powerpack running gear breakdown",
                    "{s} armour composition armor package construction materials",
                    "{s} engine transmission suspension torsion bar specifications",
                    "{s} main gun autoloader fire control system"),
    },
    "armored_vehicle": {
        "axis": "the hull centreline: -1 is the rear (troop ramp / engine), +1 is the front hull",
        "assemblies": ("Armoured hull, turret or remote weapon station, powerpack, drivetrain and wheel "
                       "stations, suspension, troop compartment and ramp, vision blocks/optics, "
                       "add-on armour and slat/cage screens"),
        "queries": ("{s} components hull turret drivetrain layout breakdown",
                    "{s} armour protection construction materials",
                    "{s} engine transmission suspension wheels specification",
                    "{s} weapon station armament optics"),
    },
    "aircraft": {
        "axis": "the fuselage waterline: -1 is the tail/exhaust nozzles, +1 is the nose/radome",
        "assemblies": ("Radome & radar, forward fuselage and cockpit, centre fuselage with fuel tanks, "
                       "wings and control surfaces (flaps, ailerons, leading-edge slats), empennage "
                       "(stabilators, vertical tails, rudders), engine bays and nozzles, air intakes/ducts, "
                       "landing gear, avionics bays, weapon stations/bays"),
        "queries": ("{s} airframe structure sections fuselage wing empennage breakdown",
                    "{s} engine intake nozzle propulsion system",
                    "{s} avionics radar sensors systems",
                    "{s} airframe materials composite titanium alloy construction"),
    },
    "helicopter": {
        "axis": "the fuselage: -1 is the tail boom/tail rotor, +1 is the nose",
        "assemblies": ("Main rotor head and blades, transmission/main gearbox, engines, fuselage and cabin, "
                       "tail boom, tail rotor and intermediate/tail gearboxes, landing gear, sponsons/fuel, "
                       "cockpit and avionics"),
        "queries": ("{s} main rotor transmission gearbox engines components",
                    "{s} airframe fuselage tail boom structure",
                    "{s} rotor blade materials composite construction",
                    "{s} systems avionics specifications"),
    },
    "missile": {
        "axis": "the missile body: -1 is the tail (nozzle/fins), +1 is the nose (seeker)",
        "assemblies": ("Nose/seeker or fuze section, guidance & control section, warhead section, "
                       "rocket motor / sustainer, control actuation section, tail fins and wings, "
                       "airframe casing"),
        "queries": ("{s} sections seeker guidance warhead rocket motor fins breakdown",
                    "{s} guidance and control section how it works",
                    "{s} warhead fuze rocket motor propellant",
                    "{s} airframe materials construction"),
    },
    "mortar": {
        "axis": "the tube: -1 is the muzzle end (tube points up-forward), +1 is the breech/baseplate end — infer from the geometry",
        "assemblies": ("Smoothbore tube/barrel, baseplate, bipod with traversing and elevating mechanisms, "
                       "sight unit, breech cap and firing pin"),
        "queries": ("{s} components tube baseplate bipod sight breakdown",
                    "{s} how it works firing mechanism drop fired",
                    "{s} tube baseplate materials steel alloy",
                    "{s} bipod elevation traverse mechanism"),
    },
    "submarine": {
        "axis": "the pressure hull: -1 is the stern (propulsor/planes), +1 is the bow (sonar dome)",
        "assemblies": ("Bow sonar dome, torpedo room, pressure hull sections, sail/fin with masts and "
                       "periscopes, control room, AIP/battery and machinery spaces, propulsion motor, "
                       "propulsor/propeller, stern and bow planes, rudder"),
        "queries": ("{s} sections pressure hull sail propulsion layout",
                    "{s} propulsion AIP battery machinery",
                    "{s} sonar masts periscope sensors",
                    "{s} hull steel construction materials"),
    },
    "warship": {
        "axis": "the keel: -1 is the stern, +1 is the bow",
        "assemblies": ("Hull and armour belt, main gun turrets and barbettes, superstructure and bridge, "
                       "fire-control directors and radars, secondary/AA batteries, funnels and uptakes, "
                       "propulsion machinery and shafts, propellers and rudders, deck fittings"),
        "queries": ("{s} main battery turrets superstructure hull layout",
                    "{s} armour belt protection scheme",
                    "{s} propulsion boilers turbines shafts propellers",
                    "{s} fire control directors radar secondary armament"),
    },
    "generic": {
        "axis": "the machine's long axis: -1 is the rear, +1 is the front",
        "assemblies": ("Primary structure, propulsion/power, control systems, payload/armament, "
                       "running gear or mounting"),
        "queries": ("{s} main components parts breakdown",
                    "{s} how it works mechanism",
                    "{s} construction materials",
                    "{s} technical specifications"),
    },
}


def deep_research(subject: str, platform: str, max_chars: int = 7000) -> str:
    """Multi-query Tavily research on the real platform. Never raises."""
    doctrine = PLATFORM_DOCTRINE.get(platform, PLATFORM_DOCTRINE["generic"])
    blocks = []
    for template in doctrine["queries"]:
        try:
            text = search_web(template.format(s=subject), max_results=3)
        except Exception as e:  # network/key failure -> keep whatever we have
            print(f"[Intel] research query failed: {e}")
            continue
        if text and not text.startswith(("Error", "Search error", "No results")):
            blocks.append(text)
    research = "\n\n".join(blocks)
    return research[:max_chars]


# ---------------------------------------------------------------------------
# 3. Assign every real 3D part its engineering identity.
# ---------------------------------------------------------------------------
_SYSTEM = """You are a master weapons systems engineer with mastery of small arms,
armoured vehicles, artillery, combat aircraft, rotorcraft, missiles and naval
platforms. You produce technical exploded-view documentation.

You are given (a) verified web research on a real platform and (b) the ACTUAL part
list of a 3D model of that platform, with each part's measured geometry. The mesh
names are usually meaningless artist names — TRUST THE GEOMETRY, not the name.

Geometry columns, all normalized to the model's own bounding box:
  axis  -1..+1  position along the long axis. {axis_hint}
  vert  -1..+1  height: -1 = underside (magazine well, belly, keel), +1 = topline
                (sight rail, dust cover, deck, canopy)
  lat   -1..+1  left/right of the centreline (paired parts sit at mirrored lat)
  len   0..1    the part's own length as a fraction of the whole
  vol   0..1    the part's share of the bounding volume (mass proxy)
  faces         triangle count (detail proxy: high = a complex machined assembly)

The last column already states where each part sits — that column is the evidence.
Name each part FROM ITS OWN ROW. Do not walk down a memorised parts list in order:
the model's part order is not the textbook order, and a name that contradicts the
geometry is a defect.

Binding rules (they override any habit):
- The platform's real assemblies are: {assemblies}
- The part marked LARGEST VOLUME is the primary structure — receiver / hull /
  fuselage / pressure hull. Never call it a small fitting.
- A part at the FRONT-END that is long and thin is the barrel / gun tube / nose or
  radome — never a stock, dust cover or tail.
- A part that HANGS BELOW the centreline near the centre of a firearm is the
  magazine or feed system; on a vehicle it is running gear or the belly plate.
- Parts flagged as a MIRRORED PAIR are a left/right pair (wheels, wings,
  stabilators, sponsons) and must be named as the pair, with the side.
- Parts on the TOPLINE of a firearm are the dust cover, sight line, optic rail or
  reciprocating bolt carrier — not the trigger or grip.
- If the model was auto-split (labels like 'Segment 4' / 'Section 7' / 'C1 3'),
  the split still follows the real seams: name each purely by where it sits.
- disassembly_order = the order a technician actually removes them (1 = first off,
  most accessible; higher = deeper inside).
- confidence: "high" when the mesh name or the geometry is unambiguous, "medium"
  when inferred from position alone, "low" when it is a guess.
- geometry_cue: the specific evidence you used, quoting the row (e.g. "front-end,
  on the topline, long and thin"). If the cue does not support the name, change
  the name.

Output ONLY valid JSON, no prose, no markdown:
{{
  "designation": "the real platform this model depicts",
  "axis_orientation": "which end of the axis is the muzzle/nose/bow — state it",
  "operating_principle": "1-2 sentences on how the machine actually works",
  "components": [
    {{"part_name": "top-level assembly, correct nomenclature",
      "description": "1-2 sentences, grounded in the research",
      "material_dependency": "primary material",
      "risk_score": 1-100, "risk_tier": "CRITICAL|ELEVATED|STABLE"}}
  ],
  "parts": [
    {{"key": "the part key exactly as given",
      "geometry_cue": "the evidence from this part's row that fixes its identity",
      "part_name": "correct engineering name of THIS part",
      "assembly": "which top-level assembly it belongs to",
      "function": "what this part does, one sentence",
      "material_dependency": "primary material",
      "risk_tier": "CRITICAL|ELEVATED|STABLE", "risk_score": 1-100,
      "disassembly_order": INT, "confidence": "high|medium|low"}}
  ]
}}
"components" = 5 to 8 top-level assemblies, ordered from the main body outward.
"parts" = EXACTLY one entry per part key given, none skipped, none invented.
risk_tier reflects supply-chain / mission criticality: CRITICAL for precision
machined or export-controlled items (barrels, bolts, seekers, gun tubes, engines,
guidance), STABLE for stampings, furniture, panels and fasteners."""


def _f(p: dict, field: str) -> float:
    try:
        return float(p.get(field, 0) or 0)
    except (TypeError, ValueError):
        return 0.0


def _describe(p: dict, parts: list) -> str:
    """
    Translate a part's raw coordinates into the cues an engineer actually reads
    off an exploded view. The LLM reliably ignores bare floats — it does not
    ignore "FRONT-MOST, on the topline, long and thin".
    """
    axis, vert, lat = _f(p, "axis_position"), _f(p, "vertical_position"), _f(p, "lateral_position")
    length, vol = _f(p, "length_fraction"), _f(p, "size_fraction")
    cues = []

    if axis <= -0.5:
        cues.append("rear-end")
    elif axis <= -0.15:
        cues.append("rear-of-centre")
    elif axis < 0.15:
        cues.append("centre")
    elif axis < 0.5:
        cues.append("forward-of-centre")
    else:
        cues.append("front-end")

    if vert <= -0.3:
        cues.append("hangs BELOW the centreline (underside)")
    elif vert < -0.08:
        cues.append("just below the centreline")
    elif vert <= 0.35:
        cues.append("on the centreline")
    else:
        cues.append("on the TOPLINE (upper surface)")

    if abs(lat) < 0.15:
        cues.append("on the centreline plane")
    else:
        side = "left" if lat < 0 else "right"
        twin = next((q["key"] for q in parts
                     if q.get("key") != p.get("key")
                     and abs(_f(q, "lateral_position") + lat) < 0.2
                     and abs(_f(q, "axis_position") - axis) < 0.2), None)
        cues.append(f"offset to the {side}" + (f", MIRRORED PAIR with {twin}" if twin else ""))

    if length >= 0.25 and vol <= 0.06:
        cues.append("long and thin")
    elif vol >= 0.06:
        cues.append("bulky")
    elif vol < 0.005:
        cues.append("small fitting")

    # superlatives — the anchors an engineer identifies the machine by
    def rank(field, reverse=True):
        return sorted(parts, key=lambda q: _f(q, field), reverse=reverse)

    if parts:
        if rank("size_fraction")[0].get("key") == p.get("key"):
            cues.append("*** LARGEST VOLUME — the main structural body ***")
        if rank("length_fraction")[0].get("key") == p.get("key"):
            cues.append("*** LONGEST part ***")
        if rank("axis_position")[0].get("key") == p.get("key"):
            cues.append("*** FRONT-MOST part ***")
        if rank("axis_position", reverse=False)[0].get("key") == p.get("key"):
            cues.append("*** REAR-MOST part ***")
        if rank("vertical_position", reverse=False)[0].get("key") == p.get("key"):
            cues.append("*** LOWEST part ***")

    return ", ".join(cues)


def _parts_table(parts: list) -> str:
    rows = ["key     | mesh name            | axis  | vert  | len  | vol  | faces | where it sits",
            "--------|----------------------|-------|-------|------|------|-------|--------------"]
    for p in parts:
        rows.append("{:<7} | {:<20} | {:>5} | {:>5} | {:>4} | {:>4} | {:>5} | {}".format(
            str(p.get("key", ""))[:7],
            str(p.get("label", ""))[:20],
            p.get("axis_position", 0), p.get("vertical_position", 0),
            p.get("length_fraction", 0), p.get("size_fraction", 0),
            p.get("faces", 0), _describe(p, parts)))
    return "\n".join(rows)


def _extract_json(text: str) -> dict:
    text = re.sub(r"<think>.*?</think>", "", text or "", flags=re.DOTALL)
    text = re.sub(r"```(?:json)?", "", text)
    match = re.search(r"\{.*\}", text, re.DOTALL)
    if not match:
        raise ValueError("LLM returned no JSON object")
    return json.loads(match.group())


_TIERS = {"CRITICAL", "ELEVATED", "STABLE"}


def _clean_part(raw: dict, fallback_label: str) -> dict:
    tier = str(raw.get("risk_tier", "")).upper().strip()
    try:
        score = int(raw.get("risk_score", 50))
    except (TypeError, ValueError):
        score = 50
    try:
        order = int(raw.get("disassembly_order", 0))
    except (TypeError, ValueError):
        order = 0
    confidence = str(raw.get("confidence", "medium")).lower().strip()
    return {
        "part_name": str(raw.get("part_name") or fallback_label).strip()[:60],
        "assembly": str(raw.get("assembly") or "").strip()[:60],
        "description": str(raw.get("function") or raw.get("description") or "").strip()[:400],
        "material_dependency": str(raw.get("material_dependency") or "").strip()[:60],
        "risk_tier": tier if tier in _TIERS else "STABLE",
        "risk_score": max(1, min(100, score)),
        "disassembly_order": order,
        "confidence": confidence if confidence in {"high", "medium", "low"} else "medium",
        "geometry_cue": str(raw.get("geometry_cue") or "").strip()[:160],
    }


def analyze_asset_parts(asset_id: str, asset_name: str, parts: list) -> dict:
    """
    Full master-engineer pass for one library asset.

    `parts` is the model's real part table from library_parts.json.
    Returns {designation, platform, axis_orientation, operating_principle,
             components: [...], intel: {key|label: part_intel}}.
    Raises on total research/LLM failure so the caller can report it.
    """
    subject, platform = resolve_subject(asset_id, asset_name)
    doctrine = PLATFORM_DOCTRINE.get(platform, PLATFORM_DOCTRINE["generic"])
    research = deep_research(subject, platform)
    if not research:
        raise RuntimeError("no web research available (Tavily unreachable)")

    system = _SYSTEM.format(axis_hint=doctrine["axis"], assemblies=doctrine["assemblies"])
    user = (
        f"PLATFORM: {subject}\n"
        f"CLASS: {platform}\n\n"
        f"VERIFIED WEB RESEARCH:\n{research}\n\n"
        f"ACTUAL 3D MODEL PARTS ({len(parts)} parts, ordered rear -> front along the long axis):\n"
        f"{_parts_table(parts)}\n\n"
        f"Identify all {len(parts)} parts. Return one 'parts' entry for every key above."
    )

    content = llm_chat(
        [{"role": "system", "content": system}, {"role": "user", "content": user}],
        model=RESEARCH_MODEL,
        max_tokens=6000,
        temperature=0.2,
    )
    data = _extract_json(content)

    # --- components (top-level BOM) ---
    components = []
    for raw in (data.get("components") or [])[:8]:
        if not isinstance(raw, dict) or not raw.get("part_name"):
            continue
        tier = str(raw.get("risk_tier", "")).upper().strip()
        try:
            score = int(raw.get("risk_score", 50))
        except (TypeError, ValueError):
            score = 50
        components.append({
            "part_name": str(raw["part_name"]).strip()[:60],
            "description": str(raw.get("description") or "").strip()[:400],
            "material_dependency": str(raw.get("material_dependency") or "").strip()[:60],
            "risk_score": max(1, min(100, score)),
            "risk_tier": tier if tier in _TIERS else "STABLE",
        })

    # --- per-part intel, keyed by BOTH the viewer's part key and its mesh label
    #     (key is exact; label keeps the existing kit-intel lookup working) ---
    by_key = {}
    for raw in (data.get("parts") or []):
        if not isinstance(raw, dict):
            continue
        key = str(raw.get("key", "")).strip()
        if key:
            by_key[key] = raw

    intel = {}
    identified = 0
    for p in parts:
        key = p.get("key")
        label = p.get("label") or key
        raw = by_key.get(key)
        if raw:
            identified += 1
        entry = _clean_part(raw or {}, label)
        entry["mesh_name"] = label
        intel[key] = entry
        intel.setdefault(label, entry)  # first part wins on duplicate mesh names

    if not components and not identified:
        raise RuntimeError("LLM returned neither components nor part identifications")

    print(f"[Intel] {asset_id}: {identified}/{len(parts)} parts identified, "
          f"{len(components)} assemblies ({subject})")

    return {
        "designation": str(data.get("designation") or subject)[:120],
        "platform": platform,
        "axis_orientation": str(data.get("axis_orientation") or "")[:200],
        "operating_principle": str(data.get("operating_principle") or "")[:400],
        "components": components,
        "intel": intel,
        "identified": identified,
        "part_count": len(parts),
    }
