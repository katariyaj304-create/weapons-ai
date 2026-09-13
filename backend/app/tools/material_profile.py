"""Single-material deep analysis — a master materials engineer's assay of one alloy/polymer/composite
as used in military small arms and ordnance.

Given a material (e.g. "4150 chrome-moly steel", "7075-T6 aluminium", "Ti-6Al-4V"), produce a sourced
report: composition, mechanical properties with real numbers, a strength-of-materials workup (load
behaviour, failure modes, fatigue, temperature), an 8-axis engineering rating profile for the radar
chart, where it is used in weapons, processing/heat-treatment, pros/cons and alternatives.

Same plumbing as tools/materials.py.
"""
import json
import re
from concurrent.futures import ThreadPoolExecutor
from urllib.parse import urlparse

from app.tools.llm import chat
from app.tools.search import search_structured

_SYNTH_MODEL = "meta-llama/llama-3.3-70b-instruct:nitro"

# Fixed radar axes so every material renders on the same chart (higher = better on each).
RATING_AXES = ["Strength", "Toughness", "Hardness", "Corrosion resistance",
               "Lightness", "Heat resistance", "Machinability", "Cost efficiency"]

_MAX_SOURCES = 16


def _queries(name: str) -> list:
    return [
        f"{name} mechanical properties tensile yield strength hardness density elongation",
        f"{name} used in firearms weapons military applications gun barrel receiver components",
        f"{name} heat treatment processing manufacturing metallurgy composition alloy",
        f"{name} advantages disadvantages compared to alternatives cost fatigue corrosion",
    ]


def _gather_sources(name: str) -> list:
    with ThreadPoolExecutor(max_workers=4) as pool:
        results = list(pool.map(lambda q: search_structured(q, max_results=5), _queries(name)))

    seen, sources = set(), []
    for res in results:
        for src in res.get("sources", []):
            url = src.get("url", "")
            if not url or url in seen:
                continue
            seen.add(url)
            sources.append({
                "id": len(sources) + 1,
                "title": src.get("title") or urlparse(url).netloc,
                "url": url,
                "domain": urlparse(url).netloc.replace("www.", ""),
                "content": src.get("content", "")[:1200],
            })
            if len(sources) >= _MAX_SOURCES:
                return sources
    return sources


_SYSTEM = """You are a Chief Materials & Testing Engineer for a national army's ordnance directorate,
writing a materials-science assay of ONE material as it is used to build weapons.

You are given numbered SOURCES. Ground facts in them and CITE by number (only numbers you were given).
For standard, well-established property values of a known material grade you MAY give the accepted
textbook figure marked "est." (no fake citation). Be quantitative: MPa, HRC/HB, g/cm3, %, degrees C, MPa*m^0.5.

Cover it like a master engineer:
- Composition & metallurgy.
- Mechanical properties with real numbers.
- Strength-of-materials behaviour: how it carries load, its failure modes, fatigue, temperature limits.
- An 8-axis rating profile (0-100, higher = better on that axis) for a radar chart.
- Where in weapons it is used and why.
- Processing / heat treatment / coatings.
- Honest pros and cons, and the materials it competes with.

The 8 rating axes are EXACTLY these (score each 0-100): Strength, Toughness, Hardness,
Corrosion resistance, Lightness, Heat resistance, Machinability, Cost efficiency.
(Lightness = higher for lower density; Cost efficiency = higher for cheaper/easier to source.)

Output ONLY this JSON, no prose, no markdown fence:

{
  "material": "canonical material name + grade",
  "overview": {
    "family": "alloy steel|stainless steel|carbon steel|aluminium alloy|titanium alloy|polymer|composite|other",
    "designation": "standard designation, e.g. AISI 4150 / UNS G41500",
    "composition": "key alloying elements with %, e.g. Fe base, 0.50%C, 0.95%Cr, 0.20%Mo",
    "military_use": "one line: the headline weapons role",
    "summary": "2-3 sentences on the material's engineering character"
  },
  "properties": [
    {"property": "Ultimate tensile strength", "value": "1000 MPa (est.)", "sources": [1]},
    {"property": "Yield strength", "value": "700 MPa (est.)", "sources": []},
    {"property": "Hardness", "value": "28-32 HRC", "sources": []},
    {"property": "Density", "value": "7.85 g/cm3", "sources": []},
    {"property": "Elongation", "value": "~15%", "sources": []},
    {"property": "Fracture toughness", "value": "~60 MPa*m^0.5 (est.)", "sources": []}
  ],
  "ratings": [
    {"axis": "Strength", "score": 90, "note": "one short line"}
  ],
  "strength_analysis": {
    "load_behaviour": "how it responds to load (elastic/plastic, ductile vs brittle)",
    "failure_modes": ["fatigue cracking at stress risers", "..."],
    "fatigue": "fatigue behaviour / endurance note",
    "temperature": "behaviour at elevated temp / limits",
    "narrative": "3-4 sentence strength-of-materials assessment for weapon use"
  },
  "applications": [
    {"component": "Rifle barrels", "examples": "M4, AK pattern", "why": "one line"}
  ],
  "processing": {
    "heat_treatment": "e.g. quench & temper to 28-32 HRC",
    "forming": "e.g. hammer forging, machining",
    "coating": "e.g. chrome lining / nitride"
  },
  "pros": ["...", "..."],
  "cons": ["...", "..."],
  "alternatives": [
    {"material": "17-4 PH stainless", "tradeoff": "better corrosion resistance, higher cost"}
  ]
}

Give all 8 rating axes, 5-8 properties, 3-6 applications, 3-5 pros, 3-5 cons, 2-4 alternatives."""


def _num(v, lo, hi, default):
    try:
        n = int(float(v))
        return max(lo, min(hi, n))
    except (TypeError, ValueError):
        return default


def _coerce(doc: dict, sources: list, name: str) -> dict:
    valid_ids = {s["id"] for s in sources}

    def cites(raw) -> list:
        out = []
        for c in raw if isinstance(raw, list) else []:
            try:
                cid = int(c)
            except (TypeError, ValueError):
                continue
            if cid in valid_ids and cid not in out:
                out.append(cid)
        return out

    def s(v):
        return str(v).strip() if v is not None else ""

    def strlist(raw, cap):
        return [s(x) for x in raw if s(x)][:cap] if isinstance(raw, list) else []

    # properties
    properties = []
    for p in doc.get("properties") or []:
        if not isinstance(p, dict) or not p.get("property"):
            continue
        properties.append({
            "property": s(p.get("property")),
            "value": s(p.get("value")),
            "sources": cites(p.get("sources")),
        })

    # ratings — force the fixed 8 axes, keep the LLM's score/note where present
    by_axis = {}
    for r in doc.get("ratings") or []:
        if isinstance(r, dict) and r.get("axis"):
            by_axis[s(r.get("axis")).lower()] = r
    ratings = []
    for axis in RATING_AXES:
        r = by_axis.get(axis.lower(), {})
        ratings.append({
            "axis": axis,
            "score": _num(r.get("score"), 0, 100, 50),
            "note": s(r.get("note")),
        })

    sa = doc.get("strength_analysis") if isinstance(doc.get("strength_analysis"), dict) else {}
    strength = {
        "load_behaviour": s(sa.get("load_behaviour")),
        "failure_modes": strlist(sa.get("failure_modes"), 6),
        "fatigue": s(sa.get("fatigue")),
        "temperature": s(sa.get("temperature")),
        "narrative": s(sa.get("narrative")),
    }

    applications = []
    for a in doc.get("applications") or []:
        if not isinstance(a, dict) or not a.get("component"):
            continue
        applications.append({
            "component": s(a.get("component")),
            "examples": s(a.get("examples")),
            "why": s(a.get("why")),
        })

    proc = doc.get("processing") if isinstance(doc.get("processing"), dict) else {}
    processing = {k: s(proc.get(k)) for k in ["heat_treatment", "forming", "coating"]}

    alternatives = []
    for alt in doc.get("alternatives") or []:
        if not isinstance(alt, dict) or not alt.get("material"):
            continue
        alternatives.append({"material": s(alt.get("material")), "tradeoff": s(alt.get("tradeoff"))})

    overview = doc.get("overview") if isinstance(doc.get("overview"), dict) else {}
    over_keys = ["family", "designation", "composition", "military_use", "summary"]

    cited = {cid for p in properties for cid in p["sources"]}

    return {
        "material": s(doc.get("material")) or name,
        "overview": {k: s(overview.get(k)) for k in over_keys},
        "properties": properties,
        "ratings": ratings,
        "strength_analysis": strength,
        "applications": applications,
        "processing": processing,
        "pros": strlist(doc.get("pros"), 6),
        "cons": strlist(doc.get("cons"), 6),
        "alternatives": alternatives,
        "sources": [{k: src[k] for k in ("id", "title", "url", "domain")}
                    for src in sources if src["id"] in cited],
    }


def build_material_profile(name: str) -> dict:
    """Research `name` (a material) and return its full engineering assay.

    Raises RuntimeError if research or synthesis produced nothing usable.
    """
    sources = _gather_sources(name)
    if not sources:
        raise RuntimeError(f"No research sources found for '{name}'. Check TAVILY_API_KEY.")

    block = "\n\n".join(
        f"[{s['id']}] {s['title']} ({s['domain']})\n{s['content']}" for s in sources
    )
    raw = chat(
        [
            {"role": "system", "content": _SYSTEM},
            {"role": "user", "content": f"MATERIAL: {name}\n\nSOURCES:\n{block}"},
        ],
        model=_SYNTH_MODEL,
        max_tokens=4096,
        temperature=0.2,
    )

    match = re.search(r"\{.*\}", raw, re.DOTALL)
    if not match:
        raise RuntimeError("The materials engineer model did not return an analysis.")
    doc = _coerce(json.loads(match.group()), sources, name)

    if not doc["properties"] and not doc["applications"]:
        raise RuntimeError(f"Could not assemble a materials analysis for '{name}'.")
    return doc
