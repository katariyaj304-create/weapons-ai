"""Weapon materials & strength analysis — a chief materials engineer's dossier.

For a given weapon this produces, grounded in cited web research:
  - per-component material breakdown with real mechanical properties,
  - a strength-of-materials view (peak loads, critical parts, safety factors, failure modes),
  - the army's material-selection trade-off matrix (performance vs cost vs weight vs logistics),
  - a cost breakdown, and
  - engineering recommendations for best-in-class material upgrades.

Same plumbing as tools/evolution.py: parallel Tavily research, one nitro-routed Llama-3.3-70B
synthesis call, then a strict schema clamp so the UI can trust every field and citation.
"""
import json
import re
from concurrent.futures import ThreadPoolExecutor
from urllib.parse import urlparse

from app.tools.llm import chat
from app.tools.search import search_structured

# Same model+routing trick as evolution: nitro finishes in ~13s vs ~100s on the default route.
_SYNTH_MODEL = "meta-llama/llama-3.3-70b-instruct:nitro"

COST_TIERS = ["LOW", "MEDIUM", "HIGH", "PREMIUM"]
MATURITY = ["PROVEN", "FIELDED", "EMERGING", "EXPERIMENTAL"]

_MAX_SOURCES = 18


def _queries(name: str) -> list:
    return [
        f"{name} barrel receiver bolt materials used steel alloy construction what is it made of",
        f"{name} manufacturing materials specifications metallurgy heat treatment coating",
        f"{name} chamber pressure operating pressure barrel steel strength stress",
        f"{name} production cost material selection military procurement weight",
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


_SYSTEM = """You are a Chief Materials & Testing Engineer for a national army's small-arms and ordnance
directorate. You are writing a materials-engineering dossier on a weapon for a defense console.

You are given numbered SOURCES. Use them to ground facts and CITE them by number (only numbers you were
given). Where a source is silent on a standard engineering value (e.g. the yield strength of a known steel
grade, typical chamber pressure of a cartridge), you MAY supply the accepted textbook figure — mark those
with "est." and do not fabricate a citation for them. Be concrete and quantitative: give MPa, HRC, g/cm3,
degrees C, and factors of safety, not adjectives.

Cover the full materials-engineering picture:
1. Per COMPONENT: what material and grade, why that material, its mechanical properties, the load it carries,
   how it fails, and its factor of safety.
2. STRENGTH OF MATERIALS: peak operating load (chamber pressure), the most stressed parts, their safety margins.
3. MATERIAL SELECTION: the weighted trade-off the army actually makes (strength-to-weight, cost, manufacturability,
   corrosion/field durability, strategic supply) and the doctrine behind it.
4. COST: what drives unit cost and the rough share per major component.
5. RECOMMENDATIONS: best-in-class material upgrades, with the benefit and the trade-off of each.

Output ONLY this JSON, no prose, no markdown fence:

{
  "weapon": "canonical name",
  "overview": {
    "weapon_class": "e.g. gas-operated assault rifle",
    "cartridge": "e.g. 7.62x39mm",
    "peak_pressure": "peak chamber pressure with units, e.g. 355 MPa (est.)",
    "material_era": "one phrase, e.g. 'stamped steel + polymer'",
    "design_philosophy": "one sentence on the materials philosophy",
    "summary": "2-3 sentences overview of the materials story"
  },
  "components": [
    {
      "part": "Barrel",
      "material": "Chrome-lined 4150 chrome-moly steel",
      "family": "alloy steel|stainless steel|carbon steel|aluminium alloy|titanium|polymer|composite|wood|brass|other",
      "role": "what the part does structurally",
      "why": "why this material was chosen here",
      "properties": {
        "tensile_strength": "e.g. 1000 MPa (est.)",
        "yield_strength": "e.g. 700 MPa (est.)",
        "hardness": "e.g. 28-32 HRC",
        "density": "e.g. 7.85 g/cm3",
        "operating_load": "the load this part carries, e.g. 355 MPa internal pressure",
        "temp_range": "e.g. sustained 400-600 C in rapid fire"
      },
      "failure_mode": "how it fails, e.g. bore erosion then throat wear",
      "safety_factor": "e.g. ~2.5x on burst",
      "cost_tier": "LOW|MEDIUM|HIGH|PREMIUM",
      "sources": [1]
    }
  ],
  "selection": {
    "criteria": [
      {"factor": "Strength-to-weight", "importance": 5, "rationale": "why it matters here"}
    ],
    "doctrine": "2-3 sentences: how THIS army/era balanced these to pick materials"
  },
  "cost": {
    "drivers": ["raw alloy", "machining hours", "heat treatment", "coating"],
    "breakdown": [{"part": "Barrel", "share": 25, "tier": "HIGH"}],
    "narrative": "2 sentences on the cost picture"
  },
  "strength": {
    "critical_parts": [
      {"part": "Locking lugs", "stress": "shear + bearing at lock-up", "safety_factor": "~2x", "note": "one line"}
    ],
    "narrative": "3-4 sentences of strength-of-materials analysis: load paths, weakest link, margins"
  },
  "recommendations": [
    {"title": "Cold hammer-forged barrel", "benefit": "longer bore life + accuracy", "tradeoff": "high tooling cost", "maturity": "PROVEN", "sources": [2]}
  ]
}

Give 5-8 components (the load-bearing and wear parts), 4-6 selection criteria, 3-5 critical parts,
and 3-5 recommendations. Import parts before decoration."""


def _num(v, lo, hi, default):
    try:
        n = int(float(v))
        return max(lo, min(hi, n))
    except (TypeError, ValueError):
        return default


def _coerce(doc: dict, sources: list, name: str) -> dict:
    """Clamp the LLM output to the schema the UI renders: valid enums, in-range citations."""
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

    # --- components ---
    prop_keys = ["tensile_strength", "yield_strength", "hardness", "density",
                 "operating_load", "temp_range"]
    components = []
    for c in doc.get("components") or []:
        if not isinstance(c, dict) or not (c.get("part") and c.get("material")):
            continue
        props = c.get("properties") if isinstance(c.get("properties"), dict) else {}
        tier = s(c.get("cost_tier")).upper()
        components.append({
            "part": s(c.get("part")),
            "material": s(c.get("material")),
            "family": s(c.get("family")) or "other",
            "role": s(c.get("role")),
            "why": s(c.get("why")),
            "properties": {k: s(props.get(k)) for k in prop_keys},
            "failure_mode": s(c.get("failure_mode")),
            "safety_factor": s(c.get("safety_factor")),
            "cost_tier": tier if tier in COST_TIERS else "MEDIUM",
            "sources": cites(c.get("sources")),
        })

    # --- selection ---
    sel = doc.get("selection") if isinstance(doc.get("selection"), dict) else {}
    criteria = []
    for cr in sel.get("criteria") or []:
        if not isinstance(cr, dict) or not cr.get("factor"):
            continue
        criteria.append({
            "factor": s(cr.get("factor")),
            "importance": _num(cr.get("importance"), 1, 5, 3),
            "rationale": s(cr.get("rationale")),
        })

    # --- cost ---
    cost = doc.get("cost") if isinstance(doc.get("cost"), dict) else {}
    breakdown = []
    for b in cost.get("breakdown") or []:
        if not isinstance(b, dict) or not b.get("part"):
            continue
        tier = s(b.get("tier")).upper()
        breakdown.append({
            "part": s(b.get("part")),
            "share": _num(b.get("share"), 0, 100, 0),
            "tier": tier if tier in COST_TIERS else "MEDIUM",
        })

    # --- strength ---
    strength = doc.get("strength") if isinstance(doc.get("strength"), dict) else {}
    critical = []
    for cp in strength.get("critical_parts") or []:
        if not isinstance(cp, dict) or not cp.get("part"):
            continue
        critical.append({
            "part": s(cp.get("part")),
            "stress": s(cp.get("stress")),
            "safety_factor": s(cp.get("safety_factor")),
            "note": s(cp.get("note")),
        })

    # --- recommendations ---
    recs = []
    for r in doc.get("recommendations") or []:
        if not isinstance(r, dict) or not r.get("title"):
            continue
        mat = s(r.get("maturity")).upper()
        recs.append({
            "title": s(r.get("title")),
            "benefit": s(r.get("benefit")),
            "tradeoff": s(r.get("tradeoff")),
            "maturity": mat if mat in MATURITY else "FIELDED",
            "sources": cites(r.get("sources")),
        })

    overview = doc.get("overview") if isinstance(doc.get("overview"), dict) else {}
    over_keys = ["weapon_class", "cartridge", "peak_pressure", "material_era",
                 "design_philosophy", "summary"]

    # Only surface sources that were actually cited somewhere.
    cited = {cid for c in components for cid in c["sources"]}
    cited |= {cid for r in recs for cid in r["sources"]}

    return {
        "weapon": s(doc.get("weapon")) or name,
        "overview": {k: s(overview.get(k)) for k in over_keys},
        "components": components,
        "selection": {"criteria": criteria, "doctrine": s(sel.get("doctrine"))},
        "cost": {
            "drivers": [s(d) for d in (cost.get("drivers") or []) if s(d)][:8],
            "breakdown": breakdown,
            "narrative": s(cost.get("narrative")),
        },
        "strength": {"critical_parts": critical, "narrative": s(strength.get("narrative"))},
        "recommendations": recs,
        "sources": [{k: src[k] for k in ("id", "title", "url", "domain")}
                    for src in sources if src["id"] in cited],
    }


def build_materials(name: str) -> dict:
    """Research `name` and return its full materials-engineering dossier.

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
            {"role": "user", "content": f"WEAPON: {name}\n\nSOURCES:\n{block}"},
        ],
        model=_SYNTH_MODEL,
        max_tokens=4096,
        temperature=0.2,
    )

    match = re.search(r"\{.*\}", raw, re.DOTALL)
    if not match:
        raise RuntimeError("The materials engineer model did not return an analysis.")
    doc = _coerce(json.loads(match.group()), sources, name)

    if not doc["components"]:
        raise RuntimeError(f"Could not assemble a materials analysis for '{name}'.")
    return doc
