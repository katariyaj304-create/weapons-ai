"""
Deep Research Node — uses Tavily search + an LLM to compile research.

If the synthesis LLM is unavailable (quota/credits/outage), the node falls back to an
extractive synthesis built from Tavily's grounded answers and source snippets, so the
user still gets real, source-backed research instead of an error string.
"""
import json
import re

from app.tools.llm import chat_simple
from app.tools.search import multi_search_structured

# Sentence-ish split that keeps abbreviations mostly intact.
_MIN_SECTION_CHARS = 240


def _call_llm(prompt: str, system_prompt: str = "") -> str:
    """Synthesize with the LLM gateway. Returns '' if every provider is down."""
    try:
        return chat_simple(prompt, system_prompt, temperature=0.3)
    except Exception as e:
        print(f"[Research] LLM synthesis unavailable ({e.__class__.__name__}: {e}); using extractive fallback")
        return ""


def _flatten(section: dict) -> str:
    """Tavily answer + source snippets for one section, as a single blob."""
    parts = []
    if section.get("answer"):
        parts.append(section["answer"])
    for src in section.get("sources", []):
        parts.append(src["content"])
    return "\n".join(parts)


def _compose(section: dict, limit: int = 1400) -> str:
    """Build readable prose for one section out of Tavily's answer + top sources."""
    answer = (section.get("answer") or "").strip()
    text = answer
    # Top up short answers with source snippets until the section reads substantively.
    for src in section.get("sources", []):
        if len(text) >= _MIN_SECTION_CHARS:
            break
        snippet = src["content"].strip()
        if snippet and snippet not in text:
            text = f"{text}\n\n{snippet}" if text else snippet
    text = text.strip()
    if len(text) > limit:
        cut = text.rfind(". ", 0, limit)
        text = text[: cut + 1] if cut > limit * 0.6 else text[:limit].rstrip() + "..."
    return text


def _cite(section: dict, n: int = 3) -> str:
    urls = [s["url"] for s in section.get("sources", []) if s.get("url")][:n]
    return "\n\nSources: " + " · ".join(urls) if urls else ""


def _extractive(sections: dict) -> dict:
    """Assemble the 4 research sections directly from live Tavily results."""
    general = sections.get("general", {})
    parts = sections.get("parts", {})
    general_text = _compose(general)
    parts_text = _compose(parts, limit=700)
    if parts_text:
        general_text = f"{general_text}\n\nComponent breakdown: {parts_text}".strip()

    return {
        "history": _compose(sections.get("history", {})) + _cite(sections.get("history", {})),
        "materials": _compose(sections.get("materials", {})) + _cite(sections.get("materials", {})),
        "functionality": _compose(sections.get("functionality", {})) + _cite(sections.get("functionality", {})),
        "general_info": general_text + _cite(general),
    }


_SECTION_KEYS = ("history", "materials", "functionality", "general_info")


def _parse_report(text: str) -> dict:
    """Pull the 4 report sections out of an LLM response.

    Handles fenced JSON, bare JSON, and prose with **HISTORY:**-style headings.
    """
    body = re.sub(r"```(?:json)?", "", text).strip()

    match = re.search(r"\{.*\}", body, re.DOTALL)
    if match:
        try:
            data = json.loads(match.group(), strict=False)
            out = {k: str(data[k]).strip() for k in _SECTION_KEYS if data.get(k)}
            if out:
                return out
        except json.JSONDecodeError:
            pass

    # Heading-delimited prose fallback: **HISTORY** ... **MATERIALS** ...
    out = {}
    headings = list(re.finditer(
        r"^[#*\s]*(HISTORY|MATERIALS|FUNCTIONALITY|GENERAL[_ ]INFO)[:*\s]*$",
        body, re.IGNORECASE | re.MULTILINE))
    for i, h in enumerate(headings):
        key = h.group(1).lower().replace(" ", "_")
        end = headings[i + 1].start() if i + 1 < len(headings) else len(body)
        out[key] = body[h.end():end].strip()
    return {k: v for k, v in out.items() if v}


def _looks_empty(data: dict) -> bool:
    return not any((data.get(k) or "").strip() for k in ("history", "materials", "functionality", "general_info"))


def deep_research_node(state: dict) -> dict:
    """Second node: performs web research and synthesizes it."""
    model_name = state.get("model_name", "")

    if state.get("status") == "error":
        return state

    print(f"[Research] Searching for: {model_name}")
    sections = multi_search_structured(model_name)
    # Flat text kept for downstream nodes / prompts that expect the old shape.
    search_results = {key: _flatten(sec) for key, sec in sections.items()}

    system_prompt = """You are an expert researcher and technical writer. Your task is to synthesize
web search results into a comprehensive, educational report about a physical object or machine.
Be thorough, accurate, and educational. Write in clear, engaging prose."""

    research_prompt = f"""I need a comprehensive research report on: **{model_name}**

Here are the web search results I've gathered:

## History Research:
{search_results.get('history', 'No data')}

## Materials Research:
{search_results.get('materials', 'No data')}

## Functionality Research:
{search_results.get('functionality', 'No data')}

## Parts Research:
{search_results.get('parts', 'No data')}

## General Information:
{search_results.get('general', 'No data')}

Please synthesize this into a structured report with these sections:
1. **HISTORY**: The complete history and evolution (2-3 paragraphs)
2. **MATERIALS**: Materials used in construction and manufacturing (1-2 paragraphs)
3. **FUNCTIONALITY**: How it works, mechanisms, technical operation (2-3 paragraphs)
4. **GENERAL_INFO**: Interesting facts, applications, modern uses (1-2 paragraphs)

Format your response as JSON with keys: history, materials, functionality, general_info
Each value should be a string with the full paragraph text."""

    print("[Research] Synthesizing with LLM...")
    llm_response = _call_llm(research_prompt, system_prompt)

    research_data = {}
    synthesis = "llm"
    if llm_response.strip():
        research_data = _parse_report(llm_response)

    if not research_data or _looks_empty(research_data):
        research_data = _extractive(sections)
        synthesis = "tavily-extractive"
        print("[Research] Compiled report from live Tavily sources (extractive).")

    research_data["synthesis"] = synthesis

    return {
        **state,
        "search_results": search_results,
        "search_sections": sections,
        "research_data": research_data,
        "status": "research_complete",
    }
