"""Weapon evolution timeline — concept sketch through prototypes, adoption, variants, current form.

Grounds every milestone and every individual design change in a real Tavily source, so the
UI can print a citation next to each claim. Shape of the returned document:

    {
      "weapon": "AK-47",
      "profile": {designer, origin, weapon_class, concept_year, service_year, span, units, status},
      "through_line": "one sentence on what never changed",
      "stages": [{id, stage, designation, year, title, summary, driver, impact,
                  changes: [{type, part, detail, sources: [1, 3]}],
                  sources: [1, 3], image}],
      "sources": [{id, title, url, domain}],
    }
"""
import json
import re
from concurrent.futures import ThreadPoolExecutor
from urllib.parse import urlparse

from app.tools.llm import chat
from app.tools.search import search_structured

# Same Llama-3.3-70B, but pinned to OpenRouter's fastest-throughput ("nitro") routing —
# the default provider streams this at ~15 tok/s (~100s), nitro finishes in ~13s.
# The HF fallback in llm.py strips the ":nitro" suffix back to a valid HF id.
_SYNTH_MODEL = "meta-llama/llama-3.3-70b-instruct:nitro"

# Milestone kinds the UI knows how to colour. Anything else is coerced to VARIANT.
STAGES = ["CONCEPT", "PROTOTYPE", "TRIALS", "ADOPTION", "VARIANT", "MODERNIZATION", "CURRENT"]

# Change kinds rendered as a diff ledger (added / reworked / deleted).
CHANGE_TYPES = ["ADDED", "CHANGED", "REMOVED"]

_MAX_SOURCES = 18


def _queries(name: str) -> list:
    return [
        f"{name} design history original concept who designed it first prototype year",
        f"{name} prototype development trials competition changes before adoption",
        f"{name} variants and improvements over time differences between models",
        f"{name} modernization latest variant current production version in service today",
    ]


def _gather_sources(name: str) -> list:
    """Run the evolution queries in parallel and return a deduped, numbered source list."""
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


_SYSTEM = """You are a weapons historian building a sourced evolution timeline for a defense-intelligence console.

You are given numbered SOURCES. Trace the weapon from its ORIGINAL CONCEPT to its CURRENT form and
report every MAJOR design change along the way. Rules:

- Ground every claim in the sources. Cite them by number. Never cite a number you were not given.
- If the sources genuinely do not cover a milestone, omit it rather than inventing it.
- 5 to 8 stages. Always start with the concept/origin and end with the current or final form.
- Each stage needs 2-4 concrete engineering changes — the mechanism, material, or layout that
  actually changed (e.g. "milled receiver replaced by stamped sheet steel"), not vague praise.
- "driver" = WHY it changed: combat feedback, cost, doctrine, treaty, manufacturing limits.

Output ONLY this JSON, no prose, no markdown fence:

{
  "weapon": "canonical name",
  "profile": {
    "designer": "", "origin": "country", "weapon_class": "e.g. gas-operated assault rifle",
    "concept_year": "", "service_year": "", "span": "e.g. 1945-present",
    "units": "approx produced or 'unknown'", "status": "e.g. In service"
  },
  "through_line": "one sentence: the design idea that survived every revision",
  "stages": [
    {
      "stage": "CONCEPT|PROTOTYPE|TRIALS|ADOPTION|VARIANT|MODERNIZATION|CURRENT",
      "designation": "model designation at this point, e.g. AK-46",
      "year": "1946",
      "title": "short milestone title",
      "summary": "2 sentences on what this stage was",
      "driver": "why the change happened",
      "impact": "what it unlocked or cost",
      "changes": [
        {"type": "ADDED|CHANGED|REMOVED", "part": "subsystem", "detail": "the specific engineering change", "sources": [1]}
      ],
      "sources": [1, 2]
    }
  ]
}"""


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

    stages = []
    for i, st in enumerate(doc.get("stages") or []):
        if not isinstance(st, dict):
            continue
        stage_kind = str(st.get("stage", "")).upper().strip()
        changes = []
        for ch in st.get("changes") or []:
            if not isinstance(ch, dict) or not ch.get("detail"):
                continue
            ctype = str(ch.get("type", "")).upper().strip()
            changes.append({
                "type": ctype if ctype in CHANGE_TYPES else "CHANGED",
                "part": ch.get("part", "") or "Design",
                "detail": ch.get("detail", ""),
                "sources": cites(ch.get("sources")),
            })
        stages.append({
            "id": i + 1,
            "stage": stage_kind if stage_kind in STAGES else "VARIANT",
            "designation": st.get("designation", "") or name,
            "year": str(st.get("year", "") or ""),
            "title": st.get("title", "") or "Milestone",
            "summary": st.get("summary", ""),
            "driver": st.get("driver", ""),
            "impact": st.get("impact", ""),
            "changes": changes,
            "sources": cites(st.get("sources")),
        })

    profile = doc.get("profile") if isinstance(doc.get("profile"), dict) else {}
    # Sources go to the client without the scraped body text.
    cited = {cid for st in stages for cid in st["sources"]}
    cited |= {cid for st in stages for ch in st["changes"] for cid in ch["sources"]}

    return {
        "weapon": doc.get("weapon") or name,
        "profile": {k: str(profile.get(k, "") or "") for k in
                    ["designer", "origin", "weapon_class", "concept_year", "service_year", "span", "units", "status"]},
        "through_line": doc.get("through_line", ""),
        "stages": stages,
        "sources": [{k: s[k] for k in ("id", "title", "url", "domain")} for s in sources if s["id"] in cited],
    }


def _stage_image(query: str) -> str:
    """Best-effort period photo for a milestone. Never raises — the page reads fine without it."""
    try:
        from ddgs import DDGS

        with DDGS() as ddgs:
            for r in ddgs.images(query, safesearch="off", max_results=4):
                url = r.get("image") or ""
                if url.startswith("http"):
                    return url
    except Exception as e:
        print(f"[Evolution] image lookup failed for '{query}': {e}")
    return ""


def _attach_images(doc: dict):
    """Fill stage['image'] in parallel; a stage keeps an empty string if nothing is found."""
    stages = doc.get("stages") or []
    queries = [f"{s['designation'] or doc['weapon']} {s['year']} weapon".strip() for s in stages]
    try:
        with ThreadPoolExecutor(max_workers=4) as pool:
            for stage, img in zip(stages, pool.map(_stage_image, queries)):
                stage["image"] = img
    except Exception as e:
        print(f"[Evolution] image pass failed: {e}")
        for stage in stages:
            stage.setdefault("image", "")


def build_evolution(name: str, with_images: bool = True) -> dict:
    """Research `name` and return its sourced concept-to-current evolution timeline.

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
        raise RuntimeError("The historian model did not return a timeline.")
    doc = _coerce(json.loads(match.group()), sources, name)

    if not doc["stages"]:
        raise RuntimeError(f"Could not assemble an evolution timeline for '{name}'.")

    if with_images:
        _attach_images(doc)
    else:
        for stage in doc["stages"]:
            stage["image"] = ""
    return doc
