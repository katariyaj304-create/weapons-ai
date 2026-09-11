"""Shared text-LLM gateway.

Tries OpenRouter first (OPENROUTER_API_KEY), then falls back to the HuggingFace
Inference API (HF_API_KEY). Call sites pass HF-style model ids; the map below
translates them to their OpenRouter equivalents.
"""
import os

import httpx
from dotenv import load_dotenv

load_dotenv()

OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions"

# HF model id -> OpenRouter model id
_OR_MODELS = {
    "meta-llama/Llama-3.3-70B-Instruct": "meta-llama/llama-3.3-70b-instruct",
    "deepseek-ai/DeepSeek-R1": "deepseek/deepseek-r1",
    "Qwen/Qwen2.5-VL-72B-Instruct": "qwen/qwen2.5-vl-72b-instruct",
    "meta-llama/Llama-4-Scout-17B-16E-Instruct": "meta-llama/llama-4-scout",
    "google/gemma-3-27b-it": "google/gemma-3-27b-it",
}
_OR_DEFAULT = "meta-llama/llama-3.3-70b-instruct"

# OpenRouter routing suffixes (:nitro/:floor/…) and lowercased slugs aren't valid HF
# model ids — normalize them back to a canonical HF id for the HuggingFace fallback.
_HF_CANON = {
    "meta-llama/llama-3.3-70b-instruct": "meta-llama/Llama-3.3-70B-Instruct",
    "meta-llama/llama-3.1-70b-instruct": "meta-llama/Llama-3.1-70B-Instruct",
}


def openrouter_available() -> bool:
    return bool(os.getenv("OPENROUTER_API_KEY"))


def _openrouter(messages: list, model: str, max_tokens: int, temperature: float, timeout: float) -> str:
    key = os.getenv("OPENROUTER_API_KEY")
    if not key:
        raise RuntimeError("OPENROUTER_API_KEY not set")

    or_model = _OR_MODELS.get(model, model if "/" in model and model.islower() else _OR_DEFAULT)
    resp = httpx.post(
        OPENROUTER_URL,
        headers={
            "Authorization": f"Bearer {key}",
            "Content-Type": "application/json",
            "HTTP-Referer": "http://localhost:5173",
            "X-Title": "Weapons.ai",
        },
        json={
            "model": or_model,
            "messages": messages,
            "max_tokens": max_tokens,
            "temperature": temperature,
        },
        timeout=timeout,
    )
    resp.raise_for_status()
    data = resp.json()
    if "choices" not in data:
        raise RuntimeError(f"OpenRouter returned no choices: {str(data)[:300]}")
    return data["choices"][0]["message"]["content"] or ""


def _huggingface(messages: list, model: str, max_tokens: int, temperature: float) -> str:
    from huggingface_hub import InferenceClient

    key = os.getenv("HF_API_KEY")
    if not key:
        raise RuntimeError("HF_API_KEY not set")
    model = model.split(":")[0]  # drop OpenRouter routing suffix (:nitro/:floor/…)
    model = _HF_CANON.get(model, model)
    client = InferenceClient(api_key=key)
    completion = client.chat.completions.create(
        model=model,
        messages=messages,
        max_tokens=max_tokens,
        temperature=temperature,
    )
    return completion.choices[0].message.content or ""


def chat(
    messages: list,
    model: str = "meta-llama/Llama-3.3-70B-Instruct",
    max_tokens: int = 4096,
    temperature: float = 0.3,
    timeout: float = 180.0,
) -> str:
    """Run a chat completion through the first provider that answers.

    Raises the last provider error if every provider fails.
    """
    errors = []

    if openrouter_available():
        try:
            out = _openrouter(messages, model, max_tokens, temperature, timeout)
            if out.strip():
                return out
            errors.append("openrouter returned empty content")
        except Exception as e:
            print(f"[LLM] OpenRouter failed ({e.__class__.__name__}: {e}); trying HuggingFace")
            errors.append(f"openrouter: {e}")

    try:
        return _huggingface(messages, model, max_tokens, temperature)
    except Exception as e:
        errors.append(f"huggingface: {e}")

    raise RuntimeError("All LLM providers failed -> " + " | ".join(errors))


def chat_simple(prompt: str, system_prompt: str = "", **kwargs) -> str:
    messages = []
    if system_prompt:
        messages.append({"role": "system", "content": system_prompt})
    messages.append({"role": "user", "content": prompt})
    return chat(messages, **kwargs)

def chat_with_vision(messages: list, image_base64: str, model: str = "qwen/qwen2.5-vl-72b-instruct") -> str:
    """Send text + image to Vision model."""
    if not image_base64:
        return chat(messages, model=model)
        
    vision_messages = []
    for msg in messages:
        if msg["role"] == "user":
            vision_messages.append({
                "role": "user",
                "content": [
                    {"type": "text", "text": msg["content"]},
                    {"type": "image_url", "image_url": {"url": f"data:image/png;base64,{image_base64}"}}
                ]
            })
        else:
            vision_messages.append(msg)
            
    try:
        if openrouter_available():
            return _openrouter(vision_messages, model, max_tokens=2048, temperature=0.3, timeout=120.0)
    except Exception as e:
        print(f"Vision failed: {e}")
    
    return chat(messages, model=model)

def chat_deepseek_reasoning(prompt: str, system_prompt: str = "") -> dict:
    """Use DeepSeek R1 to get separated reasoning and answer."""
    messages = []
    if system_prompt:
        messages.append({"role": "system", "content": system_prompt})
    messages.append({"role": "user", "content": prompt})
    
    out = chat(messages, model="deepseek-ai/DeepSeek-R1", max_tokens=8192, temperature=0.6)
    
    reasoning = ""
    answer = out
    if "<think>" in out and "</think>" in out:
        parts = out.split("</think>")
        reasoning = parts[0].replace("<think>", "").strip()
        answer = parts[1].strip()
        
    return {"reasoning": reasoning, "answer": answer}
