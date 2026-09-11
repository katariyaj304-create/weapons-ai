---
name: kaggle-3d-endpoint
description: >
  Refresh or health-check the Kaggle-hosted Hunyuan3D-2 GPU endpoint that powers
  3D generation for Weapons.ai / Ivory Command. Use when 3D generation is slow or
  falling back to HF Spaces, when the user pastes a new gradio.live URL, or when
  they mention the Kaggle notebook / KAGGLE_3D_ENDPOINT is dead or expired.
---

# Kaggle 3D endpoint — refresh & health check

The Kaggle GPU runs Hunyuan3D-2 and exposes a **public `gradio.live` URL** that the
backend calls (env var `KAGGLE_3D_ENDPOINT` in `backend/.env`). This URL is
**ephemeral** — it dies when the Kaggle notebook session stops (idle timeout or the
~12h cap). When it's dead, generation silently falls back to the slower,
quota-limited HF Spaces.

## Health check
```powershell
$u = (Select-String -Path "backend\.env" -Pattern "KAGGLE_3D_ENDPOINT=(.+)").Matches.Groups[1].Value
if (-not $u) { "no endpoint set -> ask user to run the Kaggle cell and paste the URL" }
else { try { Invoke-WebRequest "$u" -TimeoutSec 8 -UseBasicParsing | Out-Null; "UP: $u" } catch { "DOWN: $u -> refresh" } }
```

## Refresh (when the user gives a new URL)
1. Ask the user to run `kaggle/ONE_CELL_paste_into_kaggle.py` in a **BRAND-NEW**
   Kaggle notebook (GPU T4 x2, Internet On) and paste the
   `Running on public URL: https://xxxx.gradio.live` line.
   - SECURITY: never accept the user's Kaggle password/credentials. Only the public
     gradio.live URL flows back, pasted by the user.
2. Write it into `backend/.env`:
   ```
   KAGGLE_3D_ENDPOINT=https://<new>.gradio.live
   ```
   (edit the existing line; keep other keys intact).
3. Restart the backend so it reloads `.env`, then smoke-test:
   ```powershell
   & "backend\venv\Scripts\python.exe" -c "import sys; sys.path.insert(0,'backend'); from app.tools import kaggle_client as k; print('configured', k.is_configured()); print(k.generate_3d_model(r'<some.png>', r'backend\generated\models\_smoke.glb'))"
   ```
   Success returns the output path and writes a GLB. Then a full app generation
   should come back tagged `model_source: "kaggle-hunyuan3d"`.

## Notes / gotchas (hard-won)
- The Kaggle cell **NEVER touches numpy/torch/scipy** — reinstalling them causes the
  88/96 ABI wall or a mixed `.py/.so` `_center` ImportError. Keep it that way.
- A fresh notebook is required after any failed run (pip installs persist on disk
  across "Restart Kernel"; only a new notebook restores a clean baseline).
- If the returned meshes are gray/untextured, Hunyuan's texture rasterizers didn't
  compile on Kaggle and it served shape-only — re-run the cell in a fresh notebook.
