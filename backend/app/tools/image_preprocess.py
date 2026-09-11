"""
Image Preprocessor — cleans and normalizes a reference photo before image-to-3D
reconstruction: background removal, tight crop, square padding, and mild enhancement.
"""
from pathlib import Path
from PIL import Image, ImageOps, ImageFilter

TARGET_SIZE = 1024


def preprocess_image(input_path: str, output_path: str) -> str:
    """
    Preprocess an image for the 3D generator:
    1. Remove background (rembg, if installed) so only the subject remains.
    2. Crop tightly to the subject's bounding box.
    3. Pad to a square canvas and resize to TARGET_SIZE.
    4. Flatten onto white + normalize contrast/sharpness.
    Returns output_path.
    """
    Path(output_path).parent.mkdir(parents=True, exist_ok=True)
    image = Image.open(input_path).convert("RGBA")

    image = _remove_background(image)
    image = _crop_to_subject(image)
    image = _pad_to_square(image, TARGET_SIZE)

    flat = Image.new("RGB", image.size, (255, 255, 255))
    flat.paste(image, mask=image.split()[3] if image.mode == "RGBA" else None)
    flat = ImageOps.autocontrast(flat, cutoff=1)
    flat = flat.filter(ImageFilter.SHARPEN)

    flat.save(output_path, format="PNG")
    print(f"[Preprocess] ✓ Cleaned image saved to {output_path}")
    return output_path


def _remove_background(image: Image.Image) -> Image.Image:
    try:
        from rembg import remove
        print("[Preprocess] Removing background (rembg)...")
        return remove(image)
    except ImportError:
        print("[Preprocess] rembg not installed — skipping local background removal "
              "(the 3D generator's own preprocessing will handle it)")
        return image
    except Exception as e:
        print(f"[Preprocess] Background removal failed: {e} — using original image")
        return image


def _crop_to_subject(image: Image.Image) -> Image.Image:
    if image.mode != "RGBA":
        return image
    bbox = image.getbbox()
    if not bbox:
        return image

    left, top, right, bottom = bbox
    margin = int(max(right - left, bottom - top) * 0.06)
    left = max(0, left - margin)
    top = max(0, top - margin)
    right = min(image.width, right + margin)
    bottom = min(image.height, bottom + margin)
    return image.crop((left, top, right, bottom))


def _pad_to_square(image: Image.Image, size: int) -> Image.Image:
    w, h = image.size
    side = max(w, h)
    canvas = Image.new("RGBA", (side, side), (255, 255, 255, 0))
    canvas.paste(image, ((side - w) // 2, (side - h) // 2), image if image.mode == "RGBA" else None)
    return canvas.resize((size, size), Image.LANCZOS)
