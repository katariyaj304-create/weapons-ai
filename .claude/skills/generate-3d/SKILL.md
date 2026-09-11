---
name: generate-3d
description: >
  Generate a 3D weapon model from a name through the Weapons.ai / Ivory Command
  app pipeline (web image search -> preprocess -> Hunyuan3D-2 on the Kaggle GPU),
  then render a turntable preview so the result is visible. Use when the user asks
  to "generate a 3D model", "make a weapon", "test the 3D pipeline", or show a
  generation result for a named weapon (AK-47, M4, Glock, etc.).
---

# Generate a weapon 3D model (end to end)

The app converts a weapon **name** into a textured GLB. Order of the generator
chain (`backend/app/nodes/direct3d.py` -> `generate_best_3d`):
1. **kaggle-hunyuan3d** (the user's Kaggle GPU, Hunyuan3D-2.1 PBR on dual T4) —
   tried FIRST, textured, no HF quota. Cell: `kaggle/ONE_CELL_paste_into_kaggle.py`.
2. hunyuan3d / trellis-2 / triposr HF Spaces — fallbacks (quota-limited).

`generate_best_3d` grades every candidate with `pipeline_monitor.qc_quality`
against the whole-weapon rubric and keeps the highest scorer (see the quality
bar section below), stopping early once one clears the bar.

A result tagged `model_source: "kaggle-hunyuan3d"` means it ran on the Kaggle GPU.

## Steps

### 1. Make sure the Kaggle endpoint is live
The Kaggle model is exposed via an **ephemeral** `gradio.live` URL stored in
`backend/.env` as `KAGGLE_3D_ENDPOINT`. It dies when the Kaggle notebook stops.
If generation returns a non-kaggle `model_source` (or is slow), the URL is stale —
run the **kaggle-3d-endpoint** skill to refresh it. Quick check:
```powershell
$u = (Select-String -Path "backend\.env" -Pattern "KAGGLE_3D_ENDPOINT=(.+)").Matches.Groups[1].Value
if ($u) { try { Invoke-WebRequest "$u" -TimeoutSec 8 -UseBasicParsing | Out-Null; "endpoint UP: $u" } catch { "endpoint DOWN -> refresh it" } } else { "no endpoint set" }
```

### 2. Start the backend if it isn't running
```powershell
$h = try { (Invoke-RestMethod "http://127.0.0.1:8000/api/health" -TimeoutSec 3).status } catch { $null }
if ($h -ne "healthy") {
  Set-Location "backend"
  Start-Process ".\venv\Scripts\python.exe" -ArgumentList "run.py" -WindowStyle Hidden
}
```
Poll `http://127.0.0.1:8000/api/health` until `status = healthy`.

### 3. Drive a generation through the REAL app endpoint
```powershell
$body = @{ weapon_name = "AK-47" } | ConvertTo-Json
Invoke-RestMethod -Uri "http://127.0.0.1:8000/api/generate-3d-direct" -Method Post -Body $body -ContentType "application/json" -TimeoutSec 300
```
This is the exact path the frontend uses. It returns `source_image_url`,
`preprocessed_image_url`, `glb_url`, and `model_source`. Hunyuan textured takes
~60-150s. GLB lands in `backend/generated/models/`.

### 4. Preview the result (so the user can SEE it)
The app venv has **no matplotlib** — do NOT install it. Use the self-contained
numpy + PIL + trimesh software renderer at `scripts/render_glb_preview.py`
(created by this skill; painter's algorithm, Lambert shade, honors vertex colors).
Run it with the backend venv python on the produced GLB, then Read the output PNG
plus the source/preprocessed images to display them inline.

## The quality bar — match the best WHOLE weapons in the library
The output must look like a **complete, real, well-textured weapon** at the level of
the library's exterior "hero" models — **never a cutaway / exploded / internals
view**. The gold references (whole weapons only, no `*-internals`) live in
`scripts/quality/extract_rubric.py` -> `GOLD`:
- firearm: `call-of-duty-black-ops-6-as-val`, `arx-pounder`, `ak-47`, `tommy-gun`
- aircraft: `sukhoi-su-57-felon-fighter-jet-free`, `kf-21a-boramae-fighter-jet`
- vehicle: `japanese-type-87-rcv`, `arx-apc`

How the bar is enforced (already wired in):
1. `scripts/quality/extract_rubric.py` distills those gold models into
   `backend/generated/quality_rubric.json` (per-class weighted criteria + geometric
   floors). Re-run it whenever the gold set changes:
   `backend\venv\Scripts\python.exe scripts\quality\extract_rubric.py` (needs `HF_API_KEY`).
2. `backend/app/tools/pipeline_monitor.py:qc_quality()` renders 4 views of each
   generated GLB and grades it against that rubric. A cutaway look, an untextured
   gray blob, or a score below `QUALITY_BAR` (0.62) is **rejected**.
3. `backend/app/nodes/direct3d.py:generate_best_3d()` grades every generator's
   candidate and keeps the **highest scorer**, stopping early once one clears the
   bar — so a good textured Kaggle result costs nothing extra, but a poor one
   automatically falls through to the next generator.

When you drive a generation, check the backend log for the
`[Direct3D] <source>: quality=… approved=…` line to see the score the winning
model got, and report it.

## Quality notes
- **Hunyuan3D-2.1 = PBR-textured, detailed.** If a result comes back gray/untextured,
  the Kaggle notebook fell back to shape-only (texture rasterizers didn't compile);
  re-run the Kaggle cell in a fresh notebook. Untextured output can't clear the bar.
- Octree resolution is set in `backend/app/tools/kaggle_client.py` (`OCTREE_RESOLUTION`,
  default 256). Raise toward 384 for finer geometry at the cost of time.
- To view live in the browser: start the frontend (`cd frontend; npm run dev`,
  Vite on :5173) and use the Direct 3D Generator page.
