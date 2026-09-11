"""
DeepSeek-R1 BOM Analysis Client — deconstructs tactical assets into a 5-part Bill of Materials.
Falls back to Meta Llama 3.3 70B if DeepSeek-R1 is unavailable.
"""
import re
import json
from dotenv import load_dotenv

from app.tools.llm import chat as llm_chat

load_dotenv()

SYSTEM_PROMPT = """You are the Lead Systems Architect and Intelligence Analyst for "Project Anti-Gravity" (Ivory Command), an industry-grade Tactical 3D Asset platform.
Your objective is to deconstruct tactical hardware requests into a 5-part Bill of Materials (BOM), formulate deterministic prompts for Hugging Face image-to-3D models, and calculate geopolitical supply chain risks.

When a user requests a tactical asset, execute the following:
1. COMPONENT BREAKDOWN: Deconstruct the asset into exactly 5 primary structural components.
2. HF VISUAL PROMPTING: Write a visual generation prompt for the FLUX.1-dev model using this syntax:
"[Exact Part Name] of [Asset Name], orthographic side profile, isolated pure white background, hard-surface topology, rigid body mechanical engineering, industrial design, perfect symmetry, flat lighting."
3. RISK ANALYSIS: Identify the primary critical material required for each component. Assign a Risk Score (1-100) based on current global supply chain choke points.

Output ONLY a valid JSON object matching this exact schema:
{
  "asset_name": "STRING",
  "components": [
    {
      "part_name": "STRING",
      "hf_flux_prompt": "STRING",
      "material_dependency": "STRING",
      "risk_score": INT,
      "risk_tier": "CRITICAL | ELEVATED | STABLE"
    }
  ]
}"""

PRIMARY_MODEL = "deepseek-ai/DeepSeek-R1"
FALLBACK_MODEL = "meta-llama/Llama-3.3-70B-Instruct"


def _clean_response(text: str) -> str:
    """Strip markdown code fences and <think> tags from LLM output."""
    # Remove <think>...</think> blocks (DeepSeek-R1 chain-of-thought)
    text = re.sub(r"<think>.*?</think>", "", text, flags=re.DOTALL)
    # Remove markdown code fences
    text = re.sub(r"```(?:json)?\s*", "", text)
    text = re.sub(r"```", "", text)
    return text.strip()


def _call_model(model: str, asset_name: str) -> dict:
    """Call a specific model through the LLM gateway and parse the JSON response."""
    print(f"[DeepSeek Client] Calling model: {model}")
    raw = llm_chat(
        [
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": f"Deconstruct the following tactical asset: {asset_name}"},
        ],
        model=model,
        max_tokens=4096,
        temperature=0.3,
    )
    print(f"[DeepSeek Client] Raw response length: {len(raw)} chars")

    cleaned = _clean_response(raw)

    # Find JSON object in response
    json_match = re.search(r"\{.*\}", cleaned, re.DOTALL)
    if not json_match:
        raise ValueError(f"No JSON object found in model response. Cleaned text: {cleaned[:500]}")

    data = json.loads(json_match.group())
    return data


def analyze_asset(asset_name: str) -> dict:
    """
    Analyze a tactical asset using DeepSeek-R1 via HF Inference API.
    Returns a BOM dict with asset_name and components list.
    Falls back to Llama 3.3 70B if DeepSeek-R1 fails.
    """
    # Try primary model (DeepSeek-R1)
    try:
        result = _call_model(PRIMARY_MODEL, asset_name)
        print(f"[DeepSeek Client] ✓ DeepSeek-R1 returned {len(result.get('components', []))} components")
        return result
    except Exception as e:
        print(f"[DeepSeek Client] ✗ DeepSeek-R1 failed: {e}")
        print(f"[DeepSeek Client] Falling back to {FALLBACK_MODEL}...")

    # Fallback to Llama 3.3
    try:
        result = _call_model(FALLBACK_MODEL, asset_name)
        print(f"[DeepSeek Client] ✓ Llama fallback returned {len(result.get('components', []))} components")
        return result
    except Exception as e:
        print(f"[DeepSeek Client] ✗ Fallback also failed: {e}")
        raise RuntimeError(f"Both DeepSeek-R1 and Llama fallback failed for '{asset_name}': {e}")
