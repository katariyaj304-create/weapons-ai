/**
 * TechStackPage — documents every AI model, API, and pipeline stage the platform uses.
 */
import React from 'react';
import { motion } from 'framer-motion';

const MODELS = [
  {
    name: 'microsoft/TRELLIS.2 (TRELLIS.2-4B)',
    role: 'Primary Image → 3D',
    kind: 'HF Space',
    desc: 'Converts a preprocessed reference image into a fully textured GLB mesh (PBR materials baked at 2048px). Session-based API: preprocess → image_to_3d → extract_glb.',
    where: 'Direct 3D Generator · Exploded Assembly (shell + parts)',
  },
  {
    name: 'tencent/Hunyuan3D-2.1 / Hunyuan3D-2',
    role: 'Image → 3D (fallback)',
    kind: 'HF Space',
    desc: 'High-fidelity image-to-3D. The 2.1 Space is often paused by its owner, so we auto-fall back to the live Hunyuan3D-2 Space with the identical /generation_all API.',
    where: 'Fallback when TRELLIS.2 is busy',
  },
  {
    name: 'stabilityai/TripoSR',
    role: 'Image → 3D (last resort)',
    kind: 'HF Space',
    desc: 'Fast single-image 3D reconstruction. Used only if both TRELLIS.2 and Hunyuan3D fail, so an assembly can still be built.',
    where: 'Final fallback in the generator chain',
  },
  {
    name: 'black-forest-labs/FLUX.1-dev',
    role: 'Text → Image',
    kind: 'HF Inference',
    desc: 'Generates clean orthographic component images from text prompts for the multi-component asset pipeline (BOM route).',
    where: 'Generate 3D Asset (BOM) pipeline',
  },
  {
    name: 'deepseek-ai/DeepSeek-R1',
    role: 'Reasoning / BOM',
    kind: 'HF Inference',
    desc: 'Deconstructs a tactical asset into a 5-part Bill of Materials with material dependencies and supply-chain risk scores.',
    where: 'Generate 3D Asset (BOM) pipeline',
  },
  {
    name: 'meta-llama/Llama-3.3-70B-Instruct',
    role: 'Analysis / captions',
    kind: 'HF Inference',
    desc: 'Distills Tavily research into the 5 major components, writes part mappings, and generates the one-line "bottom line" captions on the news feed. Also the fallback for DeepSeek-R1.',
    where: 'Exploded research · 3D mapping · News captions',
  },
];

const APIS = [
  {
    name: 'Tavily Search API',
    kind: 'REST',
    desc: 'Advanced web research with AI answers. Grounds the exploded-assembly component breakdown and the deep intelligence sweep in real sources.',
    where: 'Exploded research · Intelligence sweep',
  },
  {
    name: 'DuckDuckGo (ddgs)',
    kind: 'Library',
    desc: 'Image search for the best reference photo of a weapon or component, and news search for the live weapons feed.',
    where: 'Image finder · News feed · Voice assistant',
  },
  {
    name: 'Hugging Face Inference API',
    kind: 'REST',
    desc: 'Hosts the LLM and text-to-image endpoints (DeepSeek-R1, Llama-3.3, FLUX.1-dev) behind one authenticated client.',
    where: 'All LLM + image-gen calls',
  },
  {
    name: 'gradio_client',
    kind: 'Library',
    desc: 'Drives the image-to-3D Hugging Face Spaces (TRELLIS.2, Hunyuan3D, TripoSR) over their Gradio APIs.',
    where: 'All 3D generation',
  },
  {
    name: 'trimesh + numpy',
    kind: 'Library',
    desc: 'Normalizes and assembles the 6 generated meshes: centers the shell at origin, scales parts to 75% of the shell volume, slots them along the longitudinal axis, and exports one hierarchical GLB.',
    where: 'Exploded assembly builder',
  },
  {
    name: 'Three.js / React-Three-Fiber',
    kind: 'WebGL',
    desc: 'Renders every 3D model in the browser with orbit controls, studio lighting, and the interactive exploded-view slider with Assemble / Disassemble animations.',
    where: 'All 3D viewers',
  },
];

const PIPELINES = [
  {
    title: 'Direct 3D Generator',
    steps: ['Weapon name', 'DDGS image search', 'Preprocess (bg removal, crop, normalize)', 'TRELLIS.2 → Hunyuan3D → TripoSR', 'Textured GLB in viewer'],
  },
  {
    title: 'Exploded Assembly',
    steps: ['Weapon name', 'Tavily research → 5 parts (Llama-3.3)', 'Shell + 5 part images (parallel)', '6× textured 3D (parallel)', 'trimesh master assembly', 'Interactive exploded view'],
  },
  {
    title: 'Generate 3D Asset (BOM)',
    steps: ['Asset name', 'DeepSeek-R1 → 5-part BOM + risk', 'FLUX.1-dev component images', 'TRELLIS.2 / TripoSR 3D', 'Risk dashboard + models'],
  },
];

function Card({ item, i }) {
  return (
    <motion.div
      className="tech-card"
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: Math.min(i * 0.04, 0.4), duration: 0.4 }}
    >
      <div className="tech-card-head">
        <h3>{item.name}</h3>
        <span className="tech-kind">{item.kind}</span>
      </div>
      {item.role && <div className="tech-role">{item.role}</div>}
      <p className="tech-desc">{item.desc}</p>
      <div className="tech-where"><span className="material-symbols-outlined" style={{ fontSize: 13 }}>bolt</span>{item.where}</div>
    </motion.div>
  );
}

export default function TechStackPage() {
  return (
    <div className="main-content" id="techstack-page">
      <div className="main-content-inner">
        <motion.div
          className="asset-header"
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
        >
          <div className="asset-header-text">
            <h1>Platform Stack — Models & APIs</h1>
            <p>Every AI model, external API, and pipeline powering Ivory Command.</p>
          </div>
        </motion.div>

        <h2 className="tech-section-title">Pipelines</h2>
        <div className="tech-pipelines">
          {PIPELINES.map((p, i) => (
            <motion.div
              key={p.title}
              className="tech-pipeline"
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.08, duration: 0.4 }}
            >
              <h3>{p.title}</h3>
              <div className="tech-flow">
                {p.steps.map((s, j) => (
                  <React.Fragment key={j}>
                    <span className="tech-step">{s}</span>
                    {j < p.steps.length - 1 && <span className="tech-arrow">→</span>}
                  </React.Fragment>
                ))}
              </div>
            </motion.div>
          ))}
        </div>

        <h2 className="tech-section-title">AI Models</h2>
        <div className="tech-grid">
          {MODELS.map((m, i) => <Card key={m.name} item={m} i={i} />)}
        </div>

        <h2 className="tech-section-title">APIs & Libraries</h2>
        <div className="tech-grid">
          {APIS.map((a, i) => <Card key={a.name} item={a} i={i} />)}
        </div>
      </div>
    </div>
  );
}
