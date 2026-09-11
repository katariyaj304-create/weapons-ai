"""
Image Finder — locates the best reference photo for a weapon/asset name via web image search.

Selection is a two-pass process:
  1. Metadata rank: resolution + aspect + TITLE RELEVANCE (does the result actually
     look like the weapon?) minus a junk-keyword penalty (birthday, clipart, meme...).
  2. Pixel verify: download the top few, score how clean/white the background is
     (product shots on white are ideal for image-to-3D), and pick the best combined.
This stops high-res-but-irrelevant images (e.g. a "birthday wishes" page) from winning.
"""
import uuid
import re
from pathlib import Path
import httpx
import numpy as np
from PIL import Image
from dotenv import load_dotenv

load_dotenv()

MIN_DIMENSION = 384
MAX_CANDIDATES = 20
DOWNLOAD_TOPN = 6  # how many top-ranked candidates to actually fetch + pixel-verify

# Generic weapon vocabulary — a title containing any of these is probably on-topic.
WEAPON_KEYWORDS = {
    "rifle", "gun", "pistol", "firearm", "weapon", "carbine", "smg", "revolver",
    "launcher", "cannon", "machine", "assault", "sniper", "shotgun", "handgun",
    "ak", "ar", "m4", "m16", "ak47", "ak-47", "musket", "grenade", "missile",
    "rocket", "bayonet", "tactical", "caliber", "ammo", "magazine", "barrel",
}
# Titles with these are almost certainly NOT a clean weapon reference photo.
JUNK_KEYWORDS = {
    "birthday", "cake", "wish", "quote", "cartoon", "clipart", "clip art", "meme",
    "drawing", "sketch", "coloring", "logo", "icon", "emoji", "wallpaper", "quotes",
    "funny", "anime", "sticker", "tattoo", "svg", "vector", "printable", "poster",
}


def _optimized_query(weapon_name: str) -> str:
    return f"{weapon_name} real firearm product photo studio white background high resolution"


def _tokens(text: str) -> set:
    return set(re.findall(r"[a-z0-9]+", (text or "").lower()))


def _metadata_score(candidate: dict, name_tokens: set) -> float:
    """Rank purely from search metadata (no download): resolution, aspect, relevance."""
    try:
        width = int(candidate.get("width") or 0)
        height = int(candidate.get("height") or 0)
    except (TypeError, ValueError):
        return -1.0
    if not width or not height:
        return -1.0

    title = (candidate.get("title") or "").lower()
    title_tokens = _tokens(title)

    resolution_score = min(min(width, height) / 1024, 1.0)
    aspect = width / height if height else 0
    aspect_score = 1.0 - min(abs(aspect - 1.3), 1.0)

    # relevance: overlap with the weapon name + any weapon vocabulary present
    name_overlap = len(name_tokens & title_tokens) / max(len(name_tokens), 1)
    weapon_hit = 1.0 if (title_tokens & WEAPON_KEYWORDS) else 0.0
    relevance = 0.7 * name_overlap + 0.3 * weapon_hit

    # junk penalty: obviously-off-topic titles get knocked out
    junk = 1.0 if any(k in title for k in JUNK_KEYWORDS) else 0.0

    return (0.30 * resolution_score + 0.15 * aspect_score + 0.55 * relevance) - 1.0 * junk


def _white_bg_score(path: str) -> float:
    """After download: reward a clean near-white background WITH a subject present."""
    try:
        with Image.open(path) as im:
            a = np.asarray(im.convert("RGB").resize((64, 64))).astype(np.float32)
    except Exception:
        return 0.0
    border = np.concatenate([a[0, :], a[-1, :], a[:, 0], a[:, -1]], axis=0)
    whiteness = float(border.mean() / 255.0)              # 1.0 = white border
    center = float(a[20:44, 20:44].mean() / 255.0)        # subject should darken center
    has_subject = center < 0.95
    return whiteness if has_subject else whiteness * 0.25


def find_best_images(weapon_name: str, output_dir: str, query: str = None,
                     k: int = 3) -> list:
    """
    Search the web for reference images of `weapon_name`; download + validate
    the top-ranked few and return UP TO `k` of them, best first, each as
    {"path", "source_url", "query", "score"}. Multiple candidates let a
    downstream QC monitor reject the first pick and retry with the next.
    """
    try:
        from ddgs import DDGS
    except ImportError:
        try:
            from duckduckgo_search import DDGS
        except ImportError:
            print("[Image Finder] ddgs not installed. Run: pip install ddgs")
            return []

    Path(output_dir).mkdir(parents=True, exist_ok=True)
    if not query:
        query = _optimized_query(weapon_name)
    print(f"[Image Finder] Searching for: {query}")

    results = []
    try:
        with DDGS() as ddgs:
            results = list(ddgs.images(query, safesearch="moderate", max_results=MAX_CANDIDATES))
    except Exception as e:
        print(f"[Image Finder] Search failed: {e}")

    if not results:
        try:
            with DDGS() as ddgs:
                results = list(ddgs.images(f"{weapon_name} firearm", safesearch="moderate",
                                           max_results=MAX_CANDIDATES))
        except Exception as e:
            print(f"[Image Finder] Fallback search failed: {e}")

    if not results:
        print("[Image Finder] No candidate images found")
        return []

    name_tokens = _tokens(weapon_name)
    ranked = sorted(results, key=lambda c: _metadata_score(c, name_tokens), reverse=True)

    # Pass 2: download the top-ranked few, pixel-verify, keep every survivor.
    kept = []  # (combined_score, path, source_url)
    for rank, candidate in enumerate(ranked[:DOWNLOAD_TOPN]):
        url = candidate.get("image")
        if not url:
            continue
        try:
            resp = httpx.get(
                url, timeout=20, follow_redirects=True,
                headers={"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"},
            )
            if resp.status_code != 200 or not resp.content:
                continue

            filename = f"{uuid.uuid4().hex[:8]}_source.png"
            temp_path = Path(output_dir) / filename
            with open(temp_path, "wb") as f:
                f.write(resp.content)

            with Image.open(temp_path) as img:
                img.verify()
            with Image.open(temp_path) as img:
                if img.width < MIN_DIMENSION or img.height < MIN_DIMENSION:
                    temp_path.unlink(missing_ok=True)
                    continue
                img.convert("RGB").save(temp_path, format="PNG")

            meta = _metadata_score(candidate, name_tokens)
            white = _white_bg_score(str(temp_path))
            # metadata already relevance-weighted; combine with the white-bg proof.
            combined = 0.6 * max(meta, 0.0) + 0.4 * white
            print(f"[Image Finder] candidate #{rank}: meta={meta:.2f} white={white:.2f} "
                  f"-> {combined:.2f}  {url}".encode("ascii", "replace").decode())

            kept.append((combined, str(temp_path), candidate.get("url") or url))
            # Enough confidently good candidates — stop downloading.
            if len(kept) >= k and kept[0][0] >= 0.75:
                break
        except Exception as e:
            print(f"[Image Finder] Candidate failed ({url}): {e}")
            continue

    if not kept:
        print("[Image Finder] All candidates failed validation")
        return []

    kept.sort(key=lambda c: c[0], reverse=True)
    # Drop files beyond k so we don't leak temp images
    for score, path, src in kept[k:]:
        Path(path).unlink(missing_ok=True)
    kept = kept[:k]
    print(f"[Image Finder] Kept {len(kept)} candidates, best score {kept[0][0]:.2f}")
    return [{"path": p, "source_url": s, "query": query, "score": sc}
            for sc, p, s in kept]


def find_best_image(weapon_name: str, output_dir: str, query: str = None) -> dict:
    """Back-compat single-image wrapper around find_best_images()."""
    candidates = find_best_images(weapon_name, output_dir, query=query, k=1)
    return candidates[0] if candidates else None
