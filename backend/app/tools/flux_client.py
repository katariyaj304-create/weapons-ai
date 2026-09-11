"""
FLUX.1-dev Image Generation Client — generates orthographic 2D images from text prompts.
"""
import os
import time
from pathlib import Path
from huggingface_hub import InferenceClient
from dotenv import load_dotenv

load_dotenv()

MODEL = "black-forest-labs/FLUX.1-dev"
MAX_RETRIES = 2


def generate_image(prompt: str, output_path: str) -> str:
    """
    Generate a 2D image from a text prompt using FLUX.1-dev via HF Inference API.
    Saves the resulting image as PNG to output_path.
    Returns output_path on success, raises on failure.
    """
    api_key = os.getenv("HF_API_KEY")
    if not api_key:
        raise RuntimeError("HF_API_KEY not set in environment")

    client = InferenceClient(api_key=api_key)
    Path(output_path).parent.mkdir(parents=True, exist_ok=True)

    last_error = None
    for attempt in range(MAX_RETRIES + 1):
        try:
            print(f"[FLUX Client] Generating image (attempt {attempt + 1}/{MAX_RETRIES + 1})")
            print(f"[FLUX Client] Prompt: {prompt[:100]}...")

            image = client.text_to_image(
                prompt=prompt,
                model=MODEL,
                width=1024,
                height=1024,
                num_inference_steps=28,
                guidance_scale=3.5,
            )

            # Save the PIL Image
            image.save(output_path, format="PNG")
            print(f"[FLUX Client] ✓ Image saved to {output_path}")
            return output_path

        except Exception as e:
            last_error = e
            print(f"[FLUX Client] ✗ Attempt {attempt + 1} failed: {e}")
            if attempt < MAX_RETRIES:
                wait = 5 * (attempt + 1)
                print(f"[FLUX Client] Retrying in {wait}s...")
                time.sleep(wait)

    raise RuntimeError(f"FLUX image generation failed after {MAX_RETRIES + 1} attempts: {last_error}")
