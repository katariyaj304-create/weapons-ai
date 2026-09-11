# ====================================================================
#  Hunyuan3D-2.1 on Kaggle DUAL-T4 — PBR-TEXTURED image-to-3D
#  (Ivory Command / Weapons.ai backend)
#
#  v10.  Upgrades v9 (Hunyuan3D-2.0) -> 2.1 with production PBR materials
#        (albedo + metallic-roughness + normal), the best open-source
#        image-to-3D quality that fits Kaggle's free tier.
#
#        DUAL-T4 placement: 3.3B shape model on cuda:0 (resident), the 2B PBR
#        paint model on cuda:1 with CPU offload so its ~21GB peak stays under
#        the 16GB card. Keeps every hard-won robustness rule from v9:
#          * NEVER touches numpy/torch/scipy (freeze base, add extras only)
#          * pinned CUDA arch (T4 = sm_75), captured build logs, REAL import
#            verification after each rasterizer build
#          * the endpoint ALWAYS returns a GLB — if the texture rasterizers
#            fail to compile it auto-falls-back to clean SHAPE-ONLY geometry,
#            never a server error.
#
#  IMPORTANT: run this in a BRAND-NEW notebook (pip installs persist on Kaggle
#  across "Restart Kernel"; only a fresh notebook restores a clean baseline).
#
#  HOW TO RUN:
#    1. Kaggle -> Create -> New Notebook  (a FRESH one).
#    2. Session options: Accelerator = GPU T4 x2, Internet = On (phone-verify once).
#    3. Paste THIS WHOLE FILE into the empty cell. Run.
#       (First run ~12-18 min: bigger models download + CUDA compile.)
#    4. Copy the line:  Running on public URL: https://xxxx.gradio.live
#       Paste it into the app (GPU Endpoint panel) or backend/.env KAGGLE_3D_ENDPOINT.
# ====================================================================
import sys, os, subprocess, urllib.request, glob, tempfile
import importlib, importlib.metadata as _im

def _pip(*a): subprocess.run([sys.executable, '-m', 'pip', 'install', '-q', *a], check=True)

# --- 0. Preflight: Internet ----------------------------------------
try:
    urllib.request.urlopen('https://github.com', timeout=15)
    print('[ok] Internet is ON')
except Exception:
    raise SystemExit('[STOP] Internet is OFF -> right sidebar -> Session options -> '
                     'Internet = On (verify phone if asked), then re-run.') from None

# --- 0b. GPUs -------------------------------------------------------
import torch
NGPU = torch.cuda.device_count()
print(f'[info] visible GPUs: {NGPU} ->',
      [torch.cuda.get_device_name(i) for i in range(NGPU)] or 'NONE')
if NGPU == 0:
    print('[warn] No GPU -> set Accelerator = GPU T4 x2 for real speed/quality.')
SHAPE_DEV = 'cuda:0' if NGPU >= 1 else 'cpu'
PAINT_DEV = 'cuda:1' if NGPU >= 2 else SHAPE_DEV   # dedicate the 2nd T4 to paint
print(f'[info] shape -> {SHAPE_DEV}   paint -> {PAINT_DEV}')

# --- 0c. NEVER touch numpy/torch/scipy -----------------------------
# Kaggle ships these internally consistent + ABI-matched. Any reinstall risks the
# 88/96 ABI wall or a mixed .py/.so. We freeze them and only add pure extras.

# --- 1. Get Hunyuan3D-2.1 ------------------------------------------
REPO = '/kaggle/working/Hunyuan3D-2.1'
if not os.path.isdir(REPO):
    subprocess.run(['git', 'clone', '-q',
                    'https://github.com/Tencent-Hunyuan/Hunyuan3D-2.1.git', REPO], check=True)
os.chdir(REPO)
# 2.1 splits into hy3dshape/ + hy3dpaint/ — both must be importable.
for p in (REPO, os.path.join(REPO, 'hy3dshape'), os.path.join(REPO, 'hy3dpaint')):
    if os.path.isdir(p) and p not in sys.path:
        sys.path.insert(0, p)

# --- 2. Freeze base, install extras via a constraints file ---------
def _v(p):
    try: return _im.version(p)
    except Exception: return None

CON = '/kaggle/working/con.txt'
frozen = [f'{p}=={_v(p)}' for p in
          ('numpy', 'scipy', 'torch', 'torchvision', 'transformers',
           'huggingface-hub', 'tokenizers', 'pillow')
          if _v(p)]
open(CON, 'w').write('\n'.join(frozen) + '\n')
print('[info] frozen base:', frozen)

def cpip(*a): _pip('-c', CON, *a)
cpip('diffusers', 'accelerate', 'einops', 'omegaconf', 'trimesh',
     'opencv-python-headless', 'scikit-image', 'pymeshlab', 'rembg', 'onnxruntime',
     'ninja', 'pybind11', 'gradio', 'realesrgan', 'xatlas', 'sentencepiece')
print('[ok] python deps installed')

# --- 2b. RealESRGAN weight the 2.1 paint pipeline expects ----------
CKPT = os.path.join(REPO, 'hy3dpaint', 'ckpt'); os.makedirs(CKPT, exist_ok=True)
_rp = os.path.join(CKPT, 'RealESRGAN_x4plus.pth')
if not os.path.exists(_rp):
    try:
        urllib.request.urlretrieve(
            'https://github.com/xinntao/Real-ESRGAN/releases/download/v0.1.0/RealESRGAN_x4plus.pth',
            _rp)
        print('[ok] RealESRGAN weight fetched')
    except Exception as e:
        print('[warn] RealESRGAN fetch failed (texture upscale may skip):', e)

# --- 3. Compile the two texture CUDA extensions (the risky part) ----
# If either fails to build, we serve SHAPE-ONLY. T4 = compute capability 7.5;
# without this pin nvcc may guess arches wrong and fail (or build a kernel that
# won't load).
os.environ.setdefault('TORCH_CUDA_ARCH_LIST', '7.5+PTX')
if not os.environ.get('CUDA_HOME') and os.path.isdir('/usr/local/cuda'):
    os.environ['CUDA_HOME'] = '/usr/local/cuda'
os.environ.setdefault('MAX_JOBS', '4')

def _tail(path, n=25):
    try:
        return '\n'.join(open(path, errors='replace').read().splitlines()[-n:])
    except Exception:
        return '(no log)'

def _build(subdir, verify, prefer_script=None):
    """Build one extension; capture the full log; PROVE it works via verify()."""
    d = os.path.join(REPO, 'hy3dpaint', subdir)
    if not os.path.isdir(d):
        print(f'  [skip] {subdir} not present'); return False
    log = f'/kaggle/working/build_{subdir.replace("/", "_")}.log'
    attempts = []
    if prefer_script and os.path.exists(os.path.join(d, prefer_script)):
        attempts.append(['bash', prefer_script])
    if os.path.exists(os.path.join(d, 'setup.py')):
        attempts.append([sys.executable, 'setup.py', 'install'])
        attempts.append([sys.executable, '-m', 'pip', 'install', '-c', CON,
                         '--no-build-isolation', '.'])
    for cmd in attempts:
        try:
            with open(log, 'a') as lf:
                lf.write(f'\n===== {" ".join(cmd)} =====\n'); lf.flush()
                subprocess.run(cmd, cwd=d, check=True, stdout=lf, stderr=lf)
            ok, why = verify()
            if ok:
                print(f'  [ok] built + verified {subdir}'); return True
            print(f'  [retry] {subdir} built but verify failed: {why}')
        except Exception as e:
            print(f'  [retry] {subdir} via {cmd[0]}: {e}')
    print(f'  [FAIL] {subdir} — last 25 log lines ({log}):')
    print(_tail(log))
    return False

def _verify_rasterizer():
    """The paint pipeline does `import custom_rasterizer` — test exactly that."""
    try:
        importlib.invalidate_caches()
        importlib.import_module('custom_rasterizer')
        return True, ''
    except Exception as e:
        return False, f'{type(e).__name__}: {e}'

def _verify_mesh_painter():
    """compile_mesh_painter.sh drops a mesh_processor*.so next to the script."""
    d = os.path.join(REPO, 'hy3dpaint', 'DifferentiableRenderer')
    if glob.glob(os.path.join(d, 'mesh_processor*.so')) or \
       glob.glob(os.path.join(d, '*.so')) or \
       glob.glob(os.path.join(d, 'build', '**', 'mesh_*'), recursive=True):
        return True, ''
    return False, 'mesh_processor extension not found after build'

# Run BOTH builds even if the first fails, so one run's logs show every problem.
_ras_ok = _build('custom_rasterizer', _verify_rasterizer)
_dr_ok = _build('DifferentiableRenderer', _verify_mesh_painter,
                prefer_script='compile_mesh_painter.sh')
TEX_OK = _ras_ok and _dr_ok
print(f'[TEXTURE] custom_rasterizer={_ras_ok}  DifferentiableRenderer={_dr_ok}  '
      f'=> PBR texture {"ENABLED" if TEX_OK else "DISABLED (shape-only geometry)"}')

# --- 4. Load pipelines ---------------------------------------------
try:
    import trimesh
    from PIL import Image
    from hy3dshape.pipelines import Hunyuan3DDiTFlowMatchingPipeline
    print('[ok] hy3dshape imported')
except Exception as e:
    raise SystemExit(f'[STOP] import failed: {type(e).__name__}: {e}\n'
                     '        -> use a BRAND-NEW notebook and re-run.') from None

# background remover (2.1 keeps it under hy3dshape.rembg)
try:
    from hy3dshape.rembg import BackgroundRemover
    rembg = BackgroundRemover()
except Exception as e:
    print('[warn] BackgroundRemover unavailable, using input as-is:', e)
    rembg = None

print('[info] downloading + loading 3.3B shape model onto', SHAPE_DEV, '...')
shape_pipe = Hunyuan3DDiTFlowMatchingPipeline.from_pretrained(
    'tencent/Hunyuan3D-2.1', subfolder='hunyuan3d-dit-v2-1')
try:
    shape_pipe = shape_pipe.to(SHAPE_DEV)
except Exception as e:
    print('[warn] shape .to(device) skipped:', e)

# topology cleanup (optional; wrapped so a pymeshlab hiccup can't kill generation)
_post = []
for modpath in ('hy3dshape.postprocessors', 'hy3dshape.shapegen', 'hy3dshape'):
    try:
        m = importlib.import_module(modpath)
        _post = [m.FloaterRemover(), m.DegenerateFaceRemover(), m.FaceReducer()]
        print('[ok] postprocessors from', modpath); break
    except Exception:
        continue
if not _post:
    print('[warn] postprocessors unavailable — meshes exported without cleanup')

# PBR texture pipeline (only if the rasterizers built)
paint_pipe = None
if TEX_OK:
    try:
        from textureGenPipeline import Hunyuan3DPaintPipeline, Hunyuan3DPaintConfig
        cfg = Hunyuan3DPaintConfig(max_num_view=6, resolution=512)
        # TUNE POINT A: force paint onto the dedicated 2nd T4.
        if hasattr(cfg, 'device'):
            cfg.device = PAINT_DEV
        if hasattr(cfg, 'realesrgan_ckpt_path'):
            cfg.realesrgan_ckpt_path = _rp
        paint_pipe = Hunyuan3DPaintPipeline(cfg)
        # TUNE POINT B: keep peak <16GB. If it OOMs, this offload is what fits it.
        for meth in ('enable_model_cpu_offload', 'enable_sequential_cpu_offload'):
            if hasattr(paint_pipe, meth):
                try:
                    getattr(paint_pipe, meth)(); print('[ok] paint offload:', meth); break
                except Exception:
                    pass
        print('[ok] PBR paint pipeline loaded on', PAINT_DEV)
    except Exception as e:
        print(f'[warn] paint load failed -> shape-only mode: {e}')
        paint_pipe = None
print('[ok] Model ready. textured =', bool(paint_pipe))

STEPS = 40  # shape inference steps — quality bump; time ~proportional

# --- 5. Endpoint (stable api_name the backend calls) ---------------
import gradio as gr

def generate_3d(image_path, octree_resolution=256):
    """image filepath + octree resolution -> textured GLB filepath.
    ALWAYS returns a GLB: PBR when the paint pipeline is live, else clean shape."""
    img = Image.open(image_path).convert('RGB')
    prepped = img
    if rembg is not None:
        try: prepped = rembg(img)          # -> RGBA, background removed
        except Exception as e: print('[warn] rembg skipped:', e)

    mesh = shape_pipe(image=prepped,
                      num_inference_steps=STEPS,
                      octree_resolution=int(octree_resolution),
                      num_chunks=8000)[0]
    for step in _post:
        try: mesh = step(mesh)
        except Exception as e: print('[warn] postproc step skipped:', e)

    out = tempfile.mktemp(suffix='.glb')

    if paint_pipe is not None:
        try:
            tmp_obj = tempfile.mktemp(suffix='.obj'); mesh.export(tmp_obj)
            textured = paint_pipe(tmp_obj, image_path=image_path)
            if isinstance(textured, str) and os.path.exists(textured):
                torch.cuda.empty_cache(); return textured
            if hasattr(textured, 'export'):
                textured.export(out); torch.cuda.empty_cache(); return out
        except Exception as e:
            print('[warn] PBR paint failed at runtime, returning shape:', e)

    mesh.export(out)
    torch.cuda.empty_cache()
    return out

with gr.Blocks(title='Hunyuan3D-2.1 PBR (dual-T4)') as demo:
    gr.Markdown('### Hunyuan3D-2.1 image-to-3D — PBR textured (Ivory Command backend)')
    with gr.Row():
        inp = gr.Image(type='filepath', label='Input image')
        out = gr.Model3D(label='Output GLB (PBR)')
    res = gr.Slider(128, 384, value=256, step=64, label='Octree resolution')
    btn = gr.Button('Generate 3D', variant='primary')
    btn.click(generate_3d, inputs=[inp, res], outputs=out, api_name='generate_3d')

demo.queue(max_size=6).launch(share=True)
