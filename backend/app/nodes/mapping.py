"""
3D Mapping Node — maps research data to 3D model parts with mesh IDs.
"""
import json
from app.tools.llm import chat_simple


# Blueprint color palette for different part categories
CATEGORY_COLORS = {
    "structural": "#00d4ff",      # Cyan blue
    "mechanical": "#ff6b35",      # Orange
    "electronic": "#ffd700",      # Gold
    "fluid": "#00ff88",           # Neon green
    "propulsion": "#ff3366",      # Hot pink
    "control": "#aa55ff",         # Purple
    "sensor": "#00ffff",          # Aqua
    "protective": "#4488ff",      # Blue
    "power": "#ff4444",           # Red
    "storage": "#44ff44",         # Green
    "communication": "#ffaa00",   # Amber
    "optical": "#ff00ff",         # Magenta
    "thermal": "#ff8800",         # Deep orange
    "default": "#0088ff"          # Default blue
}


def _call_llm(prompt: str, system_prompt: str = "") -> str:
    """Map parts with the LLM gateway. Returns '' if every provider is down."""
    try:
        return chat_simple(prompt, system_prompt, temperature=0.2)
    except Exception as e:
        print(f"[Mapping] LLM unavailable ({e.__class__.__name__}: {e}); using mesh-name fallback")
        return ""


def mapping_node(state: dict) -> dict:
    """
    Third node: maps research to 3D model parts with mesh IDs and colors.
    """
    if state.get("status") == "error":
        return state

    model_name = state.get("model_name", "")
    research_data = state.get("research_data", {})
    mesh_names = state.get("mesh_names", [])

    system_prompt = """You are an expert at analyzing 3D models and identifying their physical components.
You must output ONLY valid JSON, no other text. No markdown, no code blocks, just raw JSON."""

    # Build mesh context for the prompt
    mesh_context = ""
    if mesh_names:
        mesh_context = f"""
CRITICAL: The 3D model file contains these exact mesh names: {json.dumps(mesh_names)}
You MUST use these EXACT mesh names in your mesh_id fields. Match each part to the most
appropriate mesh name from this list. Every mesh_id you output MUST be one of these names."""
    else:
        mesh_context = """
No mesh names were provided. Generate reasonable mesh_id names using this convention:
- Use lowercase with underscores
- Prefix with the component type (e.g., frame_main, rotor_left, tank_center)
- Be specific and descriptive"""

    mapping_prompt = f"""Analyze this object: **{model_name}**

Research data:
- History: {research_data.get('history', 'N/A')[:500]}
- Materials: {research_data.get('materials', 'N/A')[:500]}
- Functionality: {research_data.get('functionality', 'N/A')[:500]}

{mesh_context}

Identify ALL major physical parts/components of this object. For each part, provide:
- part_name: Human-readable name
- mesh_id: The mesh identifier (MUST match a real mesh name if provided above)
- description: 2-3 sentence educational description of what this part does
- category: One of: structural, mechanical, electronic, fluid, propulsion, control, sensor, protective, power, storage, communication, optical, thermal

Return a JSON object with this EXACT structure:
{{
  "parts": [
    {{
      "part_name": "Example Part",
      "mesh_id": "example_mesh_name",
      "description": "Description of what this part does.",
      "category": "structural"
    }}
  ]
}}

Identify at least 5-8 major parts. Be thorough and educational."""

    print(f"[Mapping] Generating 3D part mappings for: {model_name}")
    llm_response = _call_llm(mapping_prompt, system_prompt)

    # Parse the parts JSON
    parts = []
    try:
        json_str = llm_response.strip()
        if "```json" in json_str:
            json_str = json_str.split("```json")[1].split("```")[0]
        elif "```" in json_str:
            json_str = json_str.split("```")[1].split("```")[0]

        parsed = json.loads(json_str.strip())
        raw_parts = parsed.get("parts", [])

        for part in raw_parts:
            category = part.get("category", "default")
            color = CATEGORY_COLORS.get(category, CATEGORY_COLORS["default"])
            parts.append({
                "part_name": part.get("part_name", "Unknown Part"),
                "mesh_id": part.get("mesh_id", "unknown"),
                "description": part.get("description", "No description available."),
                "color": color,
                "category": category
            })

    except (json.JSONDecodeError, KeyError, IndexError) as e:
        print(f"[Mapping] JSON parse error: {e}")
        print(f"[Mapping] Raw response: {llm_response[:500]}")
        # Generate fallback parts
        parts = _generate_fallback_parts(model_name, mesh_names)

    return {
        **state,
        "parts": parts,
        "status": "mapping_complete"
    }


# Keyword -> (display name, category, description). Lets the fallback name real
# components from the GLB's own mesh names when the mapping LLM is unavailable.
_PART_KEYWORDS = [
    ("barrel", "Barrel", "mechanical", "Guides the projectile and contains the pressure of firing; its rifling imparts the spin that stabilizes the round in flight."),
    ("muzzle", "Muzzle Device", "mechanical", "Sits at the end of the barrel, redirecting escaping gas to reduce recoil, muzzle rise, and flash."),
    ("suppress", "Suppressor", "mechanical", "Traps and cools expanding propellant gas to reduce the report and flash of each shot."),
    ("magazine", "Magazine", "storage", "Holds the ammunition under spring tension and feeds each round into the chamber as the action cycles."),
    ("mag", "Magazine", "storage", "Holds the ammunition under spring tension and feeds rounds into the chamber."),
    ("bolt", "Bolt / Carrier", "mechanical", "The heart of the action: locks the breech, extracts and ejects spent cases, and strips the next round from the magazine."),
    ("carrier", "Bolt Carrier", "mechanical", "Carries the bolt through its cycle, driven rearward by gas or recoil to reload the weapon."),
    ("charg", "Charging Handle", "control", "Manually retracts the action to chamber the first round or clear a stoppage."),
    ("trigger", "Trigger Group", "control", "The fire-control interface — releases the hammer or striker to fire the chambered round."),
    ("hammer", "Hammer", "mechanical", "Driven by the mainspring, it strikes the firing pin to ignite the primer."),
    ("receiver", "Receiver", "structural", "The structural core of the weapon; every other assembly mounts to it and it houses the action."),
    ("stock", "Stock", "structural", "Braces the weapon against the shoulder, controlling recoil and stabilizing the shooter's aim."),
    ("grip", "Pistol Grip", "control", "The primary control surface, positioning the firing hand for trigger manipulation."),
    ("handguard", "Handguard", "protective", "Shields the support hand from barrel heat and provides mounting space for accessories."),
    ("fore", "Foregrip / Handguard", "protective", "Supports the shooter's leading hand and insulates it from the hot barrel."),
    ("sight", "Sights", "optical", "The aiming system, aligning the shooter's eye with the bore to place rounds on target."),
    ("scope", "Optic", "optical", "Magnified or reflex aiming optic for precise target engagement at distance."),
    ("optic", "Optic", "optical", "Aiming optic that projects or magnifies the sight picture for faster, more accurate engagement."),
    ("piston", "Gas Piston", "propulsion", "Captures propellant gas tapped from the barrel and drives the action rearward to cycle the weapon."),
    ("gas", "Gas System", "propulsion", "Bleeds high-pressure gas from the fired round to power the weapon's automatic cycle."),
    ("spring", "Recoil Spring", "mechanical", "Stores the energy of the recoiling action and drives it forward again to chamber the next round."),
    ("turret", "Turret", "structural", "The rotating armored housing carrying the main armament and its crew."),
    ("track", "Tracks", "propulsion", "Distribute the vehicle's weight and deliver drive torque to the ground, enabling off-road mobility."),
    ("wheel", "Road Wheels", "propulsion", "Carry the hull along the track and absorb terrain shock through the suspension."),
    ("hull", "Hull", "protective", "The armored body of the vehicle, protecting crew and systems from fire."),
    ("armor", "Armor", "protective", "Layered protection designed to defeat incoming projectiles and fragments."),
    ("cannon", "Main Gun", "mechanical", "The primary armament — a high-velocity cannon for engaging armored targets."),
    ("wing", "Wing", "structural", "Generates lift and carries control surfaces and external stores."),
    ("fuselage", "Fuselage", "structural", "The main body of the aircraft, carrying crew, fuel, avionics, and payload."),
    ("engine", "Engine", "propulsion", "Converts fuel into thrust, providing the power that drives the platform."),
    ("nozzle", "Exhaust Nozzle", "propulsion", "Accelerates exhaust gas to produce thrust; may vector to enhance maneuverability."),
    ("cockpit", "Cockpit", "control", "The crew station, housing flight controls, displays, and life-support systems."),
    ("canopy", "Canopy", "protective", "The transparent shell over the cockpit, protecting the pilot while preserving visibility."),
    ("rotor", "Rotor", "propulsion", "Rotating airfoils that generate the lift and thrust for vertical flight."),
    ("missile", "Missile", "mechanical", "A guided munition carrying its own propulsion and warhead to the target."),
    ("warhead", "Warhead", "power", "The payload section, carrying the explosive charge delivered to the target."),
    ("fin", "Fins", "control", "Aerodynamic surfaces that stabilize and steer the body in flight."),
]


def _match_part(mesh_name: str):
    low = mesh_name.lower()
    for key, label, category, desc in _PART_KEYWORDS:
        if key in low:
            return label, category, desc
    return None


def _generate_fallback_parts(model_name: str, mesh_names: list) -> list:
    """Name the model's real meshes when the mapping LLM is unavailable.

    Mesh names come from the loaded GLB, so these are genuine components; the keyword
    table supplies a human label, a category color, and an educational description.
    """
    if not mesh_names:
        return [
            {
                "part_name": f"{model_name} - Main Body",
                "mesh_id": "main_body",
                "description": f"The primary structure of the {model_name}.",
                "color": CATEGORY_COLORS["structural"],
                "category": "structural",
            }
        ]

    parts, seen = [], set()
    for name in mesh_names:
        hit = _match_part(name)
        if hit:
            label, category, desc = hit
        else:
            label = name.replace("_", " ").replace("-", " ").strip().title()
            category, desc = "structural", f"A structural component of the {model_name}."
        if label in seen:
            continue
        seen.add(label)
        parts.append({
            "part_name": label,
            "mesh_id": name,
            "description": desc,
            "color": CATEGORY_COLORS.get(category, CATEGORY_COLORS["default"]),
            "category": category,
        })
        if len(parts) >= 10:
            break
    return parts
