"""
Deep-research every weapon in the library and give each one a master-engineer
exploded view.

For each of the PREDEFINED_ASSETS:
  library_parts.json (the model's REAL exploded parts + geometry, produced by
  frontend/scripts/dump_library_parts.mjs)
      -> Tavily deep research on the platform it actually depicts
      -> LLM assigns every part its engineering identity, assembly, material,
         risk tier and disassembly order
      -> written to backend/generated/intel/<slug>.json, exactly where
         /api/asset-intel looks — so the app serves it instantly on click.

    python scripts/build_library_intel.py                # fill in what's missing
    python scripts/build_library_intel.py --force        # re-research everything
    python scripts/build_library_intel.py --only ak-47 t-72a-obr-1980
"""
import argparse
import json
import re
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
BACKEND = ROOT / "backend"
sys.path.insert(0, str(BACKEND))
sys.stdout.reconfigure(encoding="utf-8")

from dotenv import load_dotenv  # noqa: E402

load_dotenv(BACKEND / ".env")

from app.main import _intel_cache_path, _INTEL_PROFILE_KEYS  # noqa: E402
from app.tools.engineering_intel import analyze_asset_parts  # noqa: E402

ASSETS_JS = ROOT / "frontend" / "src" / "assets_data.js"
PARTS_JSON = BACKEND / "generated" / "library_parts.json"


def load_assets() -> list:
    text = ASSETS_JS.read_text(encoding="utf-8")
    return json.loads(re.search(r"=\s*(\[.*\]);", text, re.DOTALL).group(1))


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--force", action="store_true", help="re-research assets that already have intel")
    ap.add_argument("--only", nargs="*", default=None, help="asset ids to (re)process")
    args = ap.parse_args()

    if not PARTS_JSON.exists():
        print(f"[STOP] {PARTS_JSON} is missing — run:  cd frontend && node scripts/dump_library_parts.mjs")
        return 1
    parts_table = json.loads(PARTS_JSON.read_text(encoding="utf-8"))

    assets = load_assets()
    if args.only:
        assets = [a for a in assets if a["id"] in set(args.only)]
        if not assets:
            print(f"[STOP] no library asset matches {args.only}")
            return 1

    rows, failures = [], []
    for i, asset in enumerate(assets, 1):
        aid, name, url = asset["id"], asset.get("name", ""), asset.get("url", "")
        entry = parts_table.get(url)
        if not entry:
            print(f"[{i:2}/{len(assets)}] {aid:<40} SKIP — no part table")
            continue

        cache_path = _intel_cache_path(name, url)
        if cache_path.exists() and not args.force:
            data = json.loads(cache_path.read_text(encoding="utf-8"))
            # Caches written before the master-engineer pass hold the old
            # 5-bucket intel (no per-part identification) — redo those.
            if "identified" in data:
                rows.append((aid, data.get("part_count", 0), data.get("identified", 0),
                             len(data.get("components", [])), data.get("designation", ""), "cached"))
                print(f"[{i:2}/{len(assets)}] {aid:<40} cached")
                continue
            print(f"[{i:2}/{len(assets)}] {aid:<40} pre-upgrade intel — re-researching")

        print(f"[{i:2}/{len(assets)}] {aid:<40} researching ({entry['part_count']} parts)...", flush=True)
        result = None
        for attempt in (1, 2):
            try:
                result = analyze_asset_parts(aid, name, entry["parts"])
                break
            except Exception as e:
                print(f"           attempt {attempt} failed: {e}")
                if attempt == 1:
                    time.sleep(5)
        if not result:
            failures.append(aid)
            continue

        profile = {k: result[k] for k in _INTEL_PROFILE_KEYS if k in result}
        cache_path.write_text(
            json.dumps({"name": name, "url": url, **profile,
                        "components": result["components"], "intel": result["intel"]}, indent=1),
            encoding="utf-8")
        rows.append((aid, result["part_count"], result["identified"],
                     len(result["components"]), result["designation"], "fresh"))
        time.sleep(1)  # be kind to the APIs

    print("\n" + "=" * 100)
    print(f"{'asset':<40} {'parts':>5} {'named':>6} {'asm':>4}  designation")
    print("-" * 100)
    for aid, count, identified, comps, designation, state in rows:
        flag = "" if identified == count else "  <-- partial"
        print(f"{aid:<40} {count:>5} {identified:>6} {comps:>4}  {designation[:44]}{flag}")
    print("=" * 100)
    print(f"{len(rows)} assets with engineering intel, {len(failures)} failed")
    if failures:
        print("failed: " + ", ".join(failures))
    return 1 if failures else 0


if __name__ == "__main__":
    raise SystemExit(main())
