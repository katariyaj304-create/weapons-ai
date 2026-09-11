# Project Anti-Gravity 🚀

AI-powered interactive 3D model research and annotation platform.

## Architecture

```
Frontend (React + R3F)  →  FastAPI Backend  →  LangGraph Pipeline
                                                  ├─ User Input Node
                                                  ├─ Deep Research Node (Tavily + DeepSeek)
                                                  └─ 3D Mapping Node
```

## Prerequisites

- **Node.js** v18+ (for frontend)
- **Python** 3.10+ (for backend)

## Quick Start

### 1. Backend Setup

```bash
cd backend
python -m venv venv
venv\Scripts\activate          # Windows
pip install -r requirements.txt
python run.py
```

The backend will start at `http://localhost:8000`

### 2. Frontend Setup

```bash
cd frontend
npm install
npm run dev
```

The frontend will start at `http://localhost:5173`

### 3. Usage

1. Open `http://localhost:5173` in your browser
2. Drag & drop a `.glb` 3D model file
3. Enter the model name (e.g., "Agricultural Spraying Drone")
4. Click **Analyze** — the AI will research and annotate the model
5. Click on parts in the sidebar to focus the camera
6. Switch to the **Research** tab for detailed information

### 4. Direct 3D Model Generator (new)

On the Asset Library screen, use the **3D Model Generator** card: type just a weapon
name (e.g. "AK-47", "Barrett M82") and click **Generate 3D Model**. The pipeline:

1. Searches the web for the best matching reference photo
2. Preprocesses it (background removal, tight crop, square-pad, contrast/sharpen)
3. Converts it to a textured 3D model via **tencent/Hunyuan3D-2.1** (HF Space)
4. Loads the resulting GLB straight into the 3D viewer

### 5. Exploded Assembly Generator (new)

On the Asset Library screen, use the **Exploded Assembly Generator** card: type a
weapon name and click **Generate Assembly**. The pipeline:

1. AI research (DeepSeek-R1) deconstructs the weapon into its 5 major components
2. Fetches + preprocesses a web reference photo for the whole weapon (outer shell)
   and for each of the 5 parts
3. Generates textured 3D models via **microsoft/TRELLIS.2** (TRELLIS.2-4B)
4. Normalizes all 6 meshes with **trimesh** — shell centered at origin, parts
   scaled to fit 75% of the shell volume and slotted along the longitudinal axis —
   and exports a single hierarchical GLB (`Outer_Shell`, `Inner_Part_1..5`)
5. Loads it into an interactive **exploded view**: drag the slider and the shell
   lifts up while the inner parts fan out laterally

A standalone Three.js viewer is also available at
`http://localhost:5173/exploded.html?glb=/generated/models/<assembly>.glb`.

### 6. Run 3D generation on your own Kaggle GPU (optional, fastest)

The public Hugging Face Spaces share a small free ZeroGPU quota that runs out fast.
To sidestep it, host the TripoSR model on Kaggle's free GPU and point the app at it:

1. Upload `kaggle/triposr_kaggle_gpu.ipynb` to a new Kaggle notebook
   (or create a notebook and paste its cells).
2. In the notebook **Settings**: Accelerator = `GPU T4 x2`, Internet = `On`
   (Internet needs a one-time phone verification on your Kaggle account).
3. **Run All**. The last cell prints `Running on public URL: https://xxxx.gradio.live`.
4. Copy that URL into `backend/.env`:  `KAGGLE_3D_ENDPOINT=https://xxxx.gradio.live`
5. Restart the backend. All 3D generation now runs on your Kaggle GPU first
   (no quota, ~15s/model), with the HF Spaces as automatic fallback.

Keep the Kaggle tab open while you use the app — the share URL lives only while the
kernel runs (up to 12h). Re-run the notebook and update `.env` for a fresh URL later.

## Environment Variables

Create `backend/.env`:
```
HF_API_KEY=your_huggingface_key
TAVILY_API_KEY=your_tavily_key
```

`HF_API_KEY` also authenticates the Hunyuan3D-2.1 / TRELLIS.2 / TripoSR HF Spaces used
for 3D generation. Note that HF Spaces for large models are sometimes paused/asleep by
their owners — if generation fails immediately, check the Space's status on Hugging Face.

## Features

- 🎨 Blueprint-themed UI with glassmorphism
- 🔬 AI-powered deep research via Tavily + DeepSeek
- 📐 3D model annotation with floating labels
- 🎯 Click-to-focus camera animation
- 📤 Custom GLB/GLTF model upload
- 🎭 Color-coded part categories
- ⚡ Real-time mesh highlighting with edge outlines
- 🧩 Multi-component asset generation: DeepSeek-R1 → FLUX.1-dev → TRELLIS.2/TripoSR
- 🪄 Direct name-to-3D generator: web image search → auto preprocess → Hunyuan3D-2.1
