"""
Sketchfab Client — acquires artist-made, textured, multi-part weapon models
from Sketchfab's library of FREE downloadable (Creative Commons) assets.

This is how the app reaches "modular kit" presentation quality for ANY weapon:
search the library first, and only fall back to AI image-to-3D generation when
no suitable asset exists.

Search is public (no auth). Downloading requires a free account's API token:
sketchfab.com -> Settings -> Password & API -> API token, pasted into the app
(stored as SKETCHFAB_API_TOKEN in backend/.env).

License note: downloadable models are CC-licensed — the author and license
returned by `pick_best` MUST be displayed with the model (the frontend shows
them in the viewer badge).
"""
import os
import re
import json
import time
import shutil
import zipfile
import urllib.parse
import urllib.request
import urllib.error
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

from dotenv import load_dotenv

load_dotenv()

SEARCH_URL = "https://api.sketchfab.com/v3/search"
DOWNLOAD_URL = "https://api.sketchfab.com/v3/models/{uid}/download"
MODEL_URL = "https://api.sketchfab.com/v3/models/{uid}"
ME_URL = "https://api.sketchfab.com/v3/me"

# NOTE: Sketchfab's WAF blocks httpx/requests by TLS fingerprint (returns an
# empty HTTP 202) but allows stdlib urllib — all HTTP here must use urllib.
_HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
    "Accept": "application/json",
}


def _request(url: str, params: dict = None, token: str = None,
             timeout: int = 30) -> urllib.request.addinfourl:
    if params:
        url = f"{url}?{urllib.parse.urlencode(params)}"
    headers = dict(_HEADERS)
    if token:
        headers["Authorization"] = f"Token {token}"
    return urllib.request.urlopen(
        urllib.request.Request(url, headers=headers), timeout=timeout)


def _get_json(url: str, params: dict = None, token: str = None,
              timeout: int = 30) -> dict:
    with _request(url, params, token, timeout) as resp:
        return json.loads(resp.read().decode("utf-8"))

# Sanity window for usable meshes: below = toy, above = won't load in a browser
MIN_FACES = 3_000
MAX_FACES = 3_000_000
MAX_ARCHIVE_MB = 150          # interactive picks: bigger archives take minutes
DOWNLOAD_DEADLINE_S = 300     # hard cap on one archive download
DOWNLOAD_STALL_S = 45         # abort when the CDN sends nothing for this long


def is_configured() -> bool:
    return bool(os.getenv("SKETCHFAB_API_TOKEN", "").strip())


def validate_token(token: str) -> dict:
    """Check a token against /v3/me. Returns {ok, username?, error?}."""
    token = (token or "").strip()
    if not token:
        return {"ok": False, "error": "No token provided"}
    try:
        data = _get_json(ME_URL, token=token, timeout=20)
        return {"ok": True, "username": data.get("username", "?")}
    except urllib.error.HTTPError as e:
        return {"ok": False, "error": f"Sketchfab rejected the token (HTTP {e.code})"}
    except Exception as e:
        return {"ok": False, "error": f"Could not reach Sketchfab: {e}"}


# Repeat searches (retry after a failed download, browse-then-fetch, the
# same weapon typed twice) should not re-pay Sketchfab latency.
_SEARCH_CACHE: dict = {}
_SEARCH_CACHE_TTL_S = 600


def search_models(query: str, count: int = 16,
                  sort_by: str = "-likeCount") -> list:
    """Public search for downloadable models. Returns raw result dicts."""
    key = (query.lower(), sort_by, count)
    hit = _SEARCH_CACHE.get(key)
    if hit and time.monotonic() - hit[0] < _SEARCH_CACHE_TTL_S:
        return hit[1]
    try:
        data = _get_json(SEARCH_URL, params={
            "type": "models", "q": query, "downloadable": "true",
            "sort_by": sort_by, "count": count,
        }, timeout=25)
        results = data.get("results", [])
        _SEARCH_CACHE[key] = (time.monotonic(), results)
        return results
    except Exception as e:
        print(f"[Sketchfab] search failed: {e}")
        return []


def _tokens(text: str) -> set:
    # Letter/digit boundaries split ("AK47" -> ak, 47) so "AK-47", "AK 47"
    # and "AK47" all match each other.
    return set(re.findall(r"[a-z]+|[0-9]+", (text or "").lower()))


# Words that describe the CATEGORY rather than the specific weapon. Sketchfab's
# downloadable search ANDs every query word, so "arjun tank" finds nothing while
# "arjun" finds several downloadable Arjun MBTs — stripping these as a variant
# makes acquisition far more likely to hit. Stripping is iterative from the
# end, so "arjun main battle tank" reduces all the way to "arjun". The raw
# name is always searched too, so extra suffixes only ever ADD recall.
_CATEGORY_SUFFIXES = {
    "tank", "rifle", "pistol", "gun", "jet", "weapon", "model", "3d",
    "aircraft", "helicopter", "submarine", "ship", "drone", "missile", "mbt",
    "battle", "main", "assault", "sniper", "combat", "fighter", "bomber",
    "carbine", "shotgun", "revolver", "launcher", "howitzer", "apc", "ifv",
    "vehicle", "boat", "destroyer", "frigate", "carrier", "machine", "smg",
}


def _query_variants(weapon_name: str) -> list:
    """2-4 search phrasings for one weapon name (raw, suffix-stripped, '3d model')."""
    name = re.sub(r"\s+", " ", (weapon_name or "")).strip()
    variants = [name]
    words = name.split()
    while len(words) > 1 and words[-1].lower() in _CATEGORY_SUFFIXES:
        words.pop()
    stripped = " ".join(words)
    if stripped.lower() != name.lower():
        variants.append(stripped)
    variants.append(f"{name} 3d model")
    seen, out = set(), []
    for v in variants:
        if v.lower() not in seen:
            seen.add(v.lower())
            out.append(v)
    return out[:4]


def search_models_pooled(weapon_name: str, count: int = 16) -> list:
    """
    Search every query variant under BOTH sort orders and pool the raw
    results, deduped by uid, preserving variant order (most-specific query
    first). Like-sorted retrieval favors popular assets but buries niche
    weapons behind author-name matches (a user called "Arjun" outranks the
    Arjun MBT); relevance-sorted retrieval surfaces those — our own
    rank_candidates() re-scores the pool, so recall is what matters here.
    """
    jobs = [(q, sort_by)
            for q in _query_variants(weapon_name)
            for sort_by in ("-likeCount", "-relevance")]
    # All variants hit Sketchfab concurrently — the pooled search costs one
    # round-trip instead of len(jobs) sequential ones. Results are merged in
    # job order so ranking input stays deterministic.
    with ThreadPoolExecutor(max_workers=len(jobs)) as pool:
        batches = list(pool.map(
            lambda j: search_models(j[0], count, j[1]), jobs))
    pooled, seen = [], set()
    for batch in batches:
        for m in batch:
            uid = m.get("uid")
            if uid and uid not in seen:
                seen.add(uid)
                pooled.append(m)
    return pooled


def _thumbnail_url(m: dict) -> str:
    """Mid-size preview image for a raw search result (empty when none)."""
    imgs = ((m.get("thumbnails") or {}).get("images") or [])
    best = None
    for img in imgs:
        w = int(img.get("width") or 0)
        if best is None or abs(w - 420) < abs(int(best.get("width") or 0) - 420):
            best = img
    return (best or {}).get("url", "")


# Titles/tags that mark a model as deliberately NON-realistic. One hit is
# enough to sink it below any textured realistic match of the same weapon.
_STYLIZED_RE = re.compile(
    r"\b(low[\s_-]?poly|cartoon|stylized|stylised|toon|voxel|minecraft|"
    r"roblox|papercraft|origami|chibi|anime|blocky|toy|lego|pixel)\b",
    re.IGNORECASE)
# Positive realism markers artists put on their best work.
_REALISTIC_RE = re.compile(
    r"\b(realistic|photoreal\w*|pbr|4k|8k|scan(?:ned)?|photogrammetry|"
    r"game[\s_-]?ready|high[\s_-]?poly)\b", re.IGNORECASE)


def _archive_info(m: dict) -> dict:
    """Texture stats from the downloadable archive metadata (empty if absent)."""
    archives = m.get("archives") or {}
    a = archives.get("glb") or archives.get("gltf") or {}
    return {
        "textures": int(a.get("textureCount") or 0),
        "tex_res": int(a.get("textureMaxResolution") or 0),
    }


def _kw_text(m: dict) -> str:
    tags = " ".join(t.get("name", "") if isinstance(t, dict) else str(t)
                    for t in (m.get("tags") or []))
    return f"{m.get('name', '')} {tags}"


def rank_candidates(results: list, weapon_name: str, limit: int = 3) -> list:
    """
    Rank search results for `weapon_name`, best first. Each candidate is
    {uid, name, author, license, likes, faces, textured, tex_res, score,
    page_url, thumbnail}. Relevance (name overlap) dominates; REALISM decides
    among matches: textured archives (an untextured mesh can never look real),
    texture resolution, geometric detail (log face count), likes, staff picks,
    and explicit realism keywords — while "low poly"/"cartoon"/"voxel"-style
    models are hard-penalized. Face count must be in the usable window.
    """
    import math
    name_tokens = _tokens(weapon_name)
    cands = []
    for m in results:
        faces = int(m.get("faceCount") or 0)
        if not (MIN_FACES <= faces <= MAX_FACES):
            continue
        title_tokens = _tokens(m.get("name", ""))
        overlap = len(name_tokens & title_tokens) / max(len(name_tokens), 1)
        likes = int(m.get("likeCount") or 0)
        # 3k faces -> 0.0, 3M faces -> 1.0 (log scale)
        detail = min(math.log10(max(faces, MIN_FACES) / MIN_FACES) / 3.0, 1.0)
        arch = _archive_info(m)
        # Texture signal: textured at all, plus resolution up to 2k+
        tex = 0.0
        if arch["textures"] > 0:
            tex = 0.6 + 0.4 * min(arch["tex_res"] / 2048.0, 1.0)
        score = (0.50 * overlap
                 + 0.18 * min(math.log10(likes + 1) / 3.0, 1.0)
                 + 0.12 * detail
                 + 0.15 * tex)
        if m.get("staffpickedAt"):
            score += 0.05  # curated by Sketchfab — reliable quality signal
        kw = _kw_text(m)
        if _REALISTIC_RE.search(kw):
            score += 0.04
        if _STYLIZED_RE.search(kw):
            score *= 0.35  # explicitly stylized — never beat a realistic match
        if overlap == 0:
            score *= 0.25  # title shares nothing with the request — deprioritize
        cands.append({
            "uid": m.get("uid"),
            "name": m.get("name", ""),
            "author": (m.get("user") or {}).get("displayName", "unknown"),
            "license": (m.get("license") or {}).get("label", "unknown"),
            "likes": likes,
            "faces": faces,
            "textured": arch["textures"] > 0,
            "tex_res": arch["tex_res"],
            "score": round(score, 3),
            "page_url": m.get("viewerUrl") or f"https://sketchfab.com/3d-models/{m.get('uid')}",
            "thumbnail": _thumbnail_url(m),
        })
    cands.sort(key=lambda c: c["score"], reverse=True)
    return cands[:limit]


def pick_best(results: list, weapon_name: str) -> dict:
    """Best single candidate for `weapon_name`, or None."""
    top = rank_candidates(results, weapon_name, limit=1)
    return top[0] if top else None


def model_info(uid: str) -> dict:
    """
    Public metadata for one model (no auth needed). Returns the same shape
    as pick_best plus "downloadable". Raises RuntimeError when the model
    does not exist or Sketchfab is unreachable.
    """
    try:
        m = _get_json(MODEL_URL.format(uid=uid), timeout=25)
    except urllib.error.HTTPError as e:
        if e.code == 404:
            raise RuntimeError("No Sketchfab model with that id") from None
        raise RuntimeError(f"Sketchfab refused the lookup (HTTP {e.code})") from None
    except Exception as e:
        raise RuntimeError(f"Could not reach Sketchfab: {e}") from None
    return {
        "uid": uid,
        "name": m.get("name", ""),
        "author": (m.get("user") or {}).get("displayName", "unknown"),
        "license": (m.get("license") or {}).get("label", "unknown"),
        "likes": int(m.get("likeCount") or 0),
        "faces": int(m.get("faceCount") or 0),
        "page_url": m.get("viewerUrl") or f"https://sketchfab.com/3d-models/{uid}",
        "downloadable": bool(m.get("isDownloadable")),
    }


def download_model(uid: str, out_dir: str) -> str:
    """
    Download a model's glTF/GLB archive and return a LOCAL FILE PATH to the
    loadable asset (.glb preferred, else the extracted scene.gltf).
    Raises RuntimeError with a human-readable message on failure.
    """
    token = os.getenv("SKETCHFAB_API_TOKEN", "").strip()
    if not token:
        raise RuntimeError("No Sketchfab API token configured")

    try:
        formats = _get_json(DOWNLOAD_URL.format(uid=uid), token=token, timeout=30)
    except urllib.error.HTTPError as e:
        if e.code == 401:
            raise RuntimeError("Sketchfab token invalid or expired") from None
        raise RuntimeError(f"Download request refused (HTTP {e.code})") from None

    # Prefer a direct glb archive when offered; otherwise the gltf zip.
    chosen = formats.get("glb") or formats.get("gltf")
    if not chosen or not chosen.get("url"):
        raise RuntimeError("Model offers no glTF/GLB download format")
    size_mb = (chosen.get("size") or 0) / 1e6
    if size_mb > MAX_ARCHIVE_MB:
        raise RuntimeError(f"Archive too large ({size_mb:.0f} MB)")

    out = Path(out_dir)
    out.mkdir(parents=True, exist_ok=True)
    archive = out / "asset_download"
    # The archive URL is a pre-signed S3/CloudFront link — no auth header
    # needed. Sketchfab's CDN sometimes stalls at 0 bytes indefinitely; a
    # short socket timeout + overall deadline turns that into a fast, clear
    # error (the UI then lets the user pick a different model) instead of a
    # request that hangs forever.
    import time
    start = time.monotonic()
    try:
        with _request(chosen["url"], timeout=DOWNLOAD_STALL_S) as resp:
            with open(archive, "wb") as f:
                while True:
                    if time.monotonic() - start > DOWNLOAD_DEADLINE_S:
                        raise RuntimeError(
                            f"Download exceeded {DOWNLOAD_DEADLINE_S}s — "
                            "Sketchfab is serving this file too slowly; try another model")
                    chunk = resp.read(1 << 20)
                    if not chunk:
                        break
                    f.write(chunk)
    except (TimeoutError, OSError) as e:
        archive.unlink(missing_ok=True)
        raise RuntimeError(
            "Sketchfab stopped sending data for this model — its download "
            "server stalled; try another model") from e
    except RuntimeError:
        archive.unlink(missing_ok=True)
        raise

    # A .glb may arrive raw or zipped; gltf format always arrives zipped.
    head = open(archive, "rb").read(4)
    if head[:4] == b"glTF":
        final = out / "model.glb"
        archive.replace(final)
        return str(final)
    if head[:2] != b"PK":
        raise RuntimeError("Downloaded file is neither GLB nor ZIP")

    with zipfile.ZipFile(archive) as z:
        z.extractall(out)
    archive.unlink(missing_ok=True)

    globs = list(out.rglob("*.glb")) or list(out.rglob("*.gltf"))
    if not globs:
        raise RuntimeError("Archive contained no .glb/.gltf")
    return str(globs[0])


_GENERIC_PART_RE = re.compile(
    r"^(defaultmaterial|material|mesh|node|object|geometry|primitive|scene|root)[_.\-\d]*$"
    r"|^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$",
    re.IGNORECASE)


def extract_part_names(glb_path: str, cap: int = 40) -> list:
    """
    Read the human-meaningful sub-part names out of a kit GLB — the geometry
    node names, or their material names when the nodes are generically named
    (artist kits often name materials 'Handguard_M4', 'Magazine_Default'...).
    Cleaning mirrors the frontend viewer's partLabel() so intel mapping keys
    line up with what the user sees.
    """
    import trimesh
    try:
        scene = trimesh.load(glb_path, force="scene")
    except Exception as e:
        print(f"[Sketchfab] could not read kit parts: {e}")
        return []
    clean = lambda s: re.sub(r"\s+", " ", re.sub(r"[_.\-]+", " ", s)).strip()
    names, seen = [], set()
    for gname, geom in scene.geometry.items():
        label = gname or ""
        if _GENERIC_PART_RE.match(label):
            mat = getattr(geom.visual, "material", None)
            mname = getattr(mat, "name", None)
            if mname and not _GENERIC_PART_RE.match(mname):
                label = mname
        label = clean(label)
        if label and label.lower() not in seen:
            seen.add(label.lower())
            names.append(label)
        if len(names) >= cap:
            break
    return names


def acquire(weapon_name: str, kits_dir: str) -> dict:
    """
    Full acquisition: search -> pick -> download into kits_dir/<uid>/.
    Returns {"file_path", "name", "author", "license", "likes", "faces",
    "page_url"} or None when no suitable asset exists. Raises RuntimeError
    only for download-stage failures (so callers can report them).
    """
    results = search_models_pooled(weapon_name)
    candidates = [c for c in rank_candidates(results, weapon_name)
                  if c["score"] >= 0.15]
    if not candidates:
        print(f"[Sketchfab] no suitable asset for '{weapon_name}'")
        return None

    last_err = None
    for best in candidates:
        target = Path(kits_dir) / best["uid"]
        existing = (list(target.rglob("*.glb")) or list(target.rglob("*.gltf"))) \
            if target.exists() else []
        try:
            file_path = str(existing[0]) if existing \
                else download_model(best["uid"], str(target))
        except RuntimeError as e:
            print(f"[Sketchfab] candidate {best['name']!r} failed ({e}) — "
                  f"trying next")
            last_err = e
            continue
        print(f"[Sketchfab] acquired: {best['name']!r} by {best['author']} "
              f"({best['likes']} likes, {best['faces']} faces, score {best['score']})")
        return {**best, "file_path": file_path}
    raise last_err  # every candidate failed at the download stage
