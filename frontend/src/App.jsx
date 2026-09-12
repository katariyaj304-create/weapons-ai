/**
 * App.jsx — Ivory Command main application.
 * Orchestrates the TopNav, SideNav, asset selection, 3D viewer, AI analysis panel,
 * and the new 3D asset generation pipeline.
 */
import React, { useState, useCallback, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import TopNav from './components/TopNav';
import SideNav from './components/SideNav';
import Canvas3D from './components/Canvas3D';
import ModelSelector from './components/ModelSelector';
import PartsList from './components/PartsList';
import ResearchPanel from './components/ResearchPanel';
import LoadingOverlay from './components/LoadingOverlay';
import VoiceAgent from './components/VoiceAgent';
import AutoSnapshot from './components/AutoSnapshot';
import ExplodedViewer from './components/ExplodedViewer';
import RiskDashboard from './components/RiskDashboard';
import GenerationProgress from './components/GenerationProgress';
import Direct3DProgress from './components/Direct3DProgress';
import ExplodedProgress from './components/ExplodedProgress';
import ExplodedAssemblyViewer from './components/ExplodedAssemblyViewer';
import NewsPage from './components/NewsPage';
import GpuEndpointPanel from './components/GpuEndpointPanel';
import AssetLibraryPanel from './components/AssetLibraryPanel';
import TechStackPage from './components/TechStackPage';
import EvolutionPage from './components/EvolutionPage';
import MaterialsPage from './components/MaterialsPage';
import BOMTable from './components/BOMTable';
import SketchfabSearchResults from './components/SketchfabSearchResults';
import DetectedPartsTable from './components/DetectedPartsTable';
import FreeCADGenerator from './components/FreeCADGenerator';
import { useResearch, uploadModel } from './hooks/useResearch';
import { useAssetGeneration } from './hooks/useAssetGeneration';
import { useDirect3DGeneration } from './hooks/useDirect3DGeneration';
import { useExplodedGeneration } from './hooks/useExplodedGeneration';

const VIEW = {
  SELECT: 'select',
  VIEWER: 'viewer',
  GENERATE: 'generate',
  DIRECT3D: 'direct3d',
  EXPLODED: 'exploded',
  FREECAD: 'freecad',
  NEWS: 'news',
  STACK: 'stack',
  EVOLUTION: 'evolution',
  MATERIALS: 'materials',
};

export default function App() {
  const [view, setView] = useState(VIEW.SELECT);
  const [activeTab, setActiveTab] = useState('parts');
  const [activeSection, setActiveSection] = useState('Assets');
  const [activeSideItem, setActiveSideItem] = useState('library');

  // Model state
  const [modelUrl, setModelUrl] = useState(null);
  const [modelName, setModelName] = useState('');
  const [meshNames, setMeshNames] = useState([]);
  const [activePart, setActivePart] = useState(null);
  const [generatingSnapshots, setGeneratingSnapshots] = useState(false);

  // Generation pipeline state
  const {
    bomData, components: genComponents, loading: genLoading,
    error: genError, phase: genPhase, currentComponent,
    generate, reset: resetGen, isComplete
  } = useAssetGeneration();
  const [activeGenComponent, setActiveGenComponent] = useState(null);
  const [genAssetName, setGenAssetName] = useState('');

  // Direct 3D generator state (name -> best web image -> Hunyuan3D-2.1)
  const {
    sourceImageUrl, sourceUrl, preprocessedImageUrl, glbUrl: directGlbUrl,
    modelSource: directModelSource,
    loading: directLoading, error: directError, phase: directPhase,
    generate: generateDirect3D, reset: resetDirect3D, isComplete: isDirectComplete
  } = useDirect3DGeneration();
  const [directWeaponName, setDirectWeaponName] = useState('');

  // Exploded assembly state (research 5 parts -> web images -> 3D -> assembly)
  const {
    components: expComponents, shellImageUrl: expShellImage,
    assemblyUrl: expAssemblyUrl, kitInfo: expKitInfo, kitIntel: expKitIntel,
    loading: expLoading, error: expError,
    phase: expPhase, message: expMessage,
    generate: generateExploded, reset: resetExploded, isComplete: isExpComplete
  } = useExplodedGeneration();
  const [explodedWeaponName, setExplodedWeaponName] = useState('');
  // Custom multi-part GLB opened directly in the exploded viewer (artist kits etc.)
  const [customGlb, setCustomGlb] = useState(null); // { url, name, kit? }

  // Paste-anything box: .glb URL / Sketchfab link / weapon name -> exploded view
  const [pasteSource, setPasteSource] = useState('');
  const [pasteBusy, setPasteBusy] = useState(false);
  const [pasteError, setPasteError] = useState(null);
  // Sketchfab browse results (null = hidden, [] = searched but empty)
  const [skfbResults, setSkfbResults] = useState(null);
  const [skfbQuery, setSkfbQuery] = useState('');
  const [skfbBusy, setSkfbBusy] = useState(false);
  const [skfbFetchingUid, setSkfbFetchingUid] = useState(null);
  // Plain name that 404'd in the library — offered as an explicit AI-generation fallback
  const [pendingGenName, setPendingGenName] = useState(null);
  // Parts the exploded viewer detected from the model geometry (no AI) —
  // drives the side-panel component sheet and the COMPONENTS badge.
  const [detectedParts, setDetectedParts] = useState([]);

  // Expose function to window to trigger snapshot generation
  useEffect(() => {
    window.generateSnapshots = () => setGeneratingSnapshots(true);
    if (window.location.search.includes('generate=1')) {
      setGeneratingSnapshots(true);
    }
    // Deep link: ?glb=/uploads/xxx.glb&name=M4%20Kit opens the exploded viewer
    // (with the same deep-research intel a library Explode click would load).
    const params = new URLSearchParams(window.location.search);
    const glb = params.get('glb');
    if (glb) {
      handleExplodeAsset({ url: glb, name: params.get('name') || 'Imported Assembly' });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Upload any .glb/.gltf and open it in the exploded viewer
  const handleOpenGlb = useCallback(async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    try {
      const fd = new FormData();
      fd.append('file', file);
      const res = await fetch('/api/upload-model', { method: 'POST', body: fd });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || 'Upload failed');
      setCustomGlb({
        url: data.url,
        name: file.name.replace(/\.(glb|gltf)$/i, '').replace(/[_-]+/g, ' ').trim(),
      });
      setView(VIEW.EXPLODED);
      setActiveSideItem('live-ops');
    } catch (err) {
      alert(`Could not open GLB: ${err.message || err}`);
    }
  }, []);

  // Resolve any source (pasted or picked from search) through the backend
  // and open the exploded view. Shared by the paste box and Sketchfab cards.
  const openModelSource = useCallback(async (src) => {
    const res = await fetch('/api/open-model', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ source: src }),
    });
    const data = await res.json();
    if (!res.ok) {
      const err = new Error(data.detail || 'Could not open the model');
      err.status = res.status;
      throw err;
    }
    setDetectedParts([]);
    setCustomGlb({
      url: data.url, name: data.name, kit: data.kit || null,
      intel: data.intel || {}, components: data.components || [],
    });
    setView(VIEW.EXPLODED);
    setActiveSideItem('live-ops');
    setPasteSource('');
    setSkfbResults(null);
  }, []);

  const handleOpenSource = useCallback(async () => {
    const src = pasteSource.trim();
    if (!src || pasteBusy) return;
    setPasteBusy(true);
    setPasteError(null);
    setPendingGenName(null);
    try {
      await openModelSource(src);
    } catch (err) {
      // No library model for a plain weapon name -> surface the backend's
      // message and offer AI generation as an explicit, opt-in action.
      if (err.status === 404 && !/^https?:\/\//i.test(src)) {
        setPendingGenName(src);
      }
      setPasteError(err.message || String(err));
    } finally {
      setPasteBusy(false);
    }
  }, [pasteSource, pasteBusy, openModelSource]);

  // Browse Sketchfab for a weapon name — shows a picker instead of
  // auto-fetching the top match.
  const handleSketchfabSearch = useCallback(async () => {
    const q = pasteSource.trim();
    if (!q || skfbBusy) return;
    if (/^https?:\/\//i.test(q)) {
      setPasteError('Search takes a weapon name — links open directly with Fetch & Explode.');
      return;
    }
    setSkfbBusy(true);
    setPasteError(null);
    setPendingGenName(null);
    try {
      const res = await fetch(`/api/sketchfab-search?q=${encodeURIComponent(q)}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || 'Sketchfab search failed');
      setSkfbQuery(q);
      setSkfbResults(data.results || []);
      if (!data.token_configured) {
        setPasteError('Note: downloading a picked model needs a free Sketchfab API token (Asset Library panel).');
      }
    } catch (err) {
      setPasteError(err.message || String(err));
    } finally {
      setSkfbBusy(false);
    }
  }, [pasteSource, skfbBusy]);

  // Fetch a specific model the user picked from the search results
  const handlePickSketchfab = useCallback(async (model) => {
    if (skfbFetchingUid) return;
    setSkfbFetchingUid(model.uid);
    setPasteError(null);
    try {
      await openModelSource(model.page_url);
    } catch (err) {
      setPasteError(err.message || String(err));
    } finally {
      setSkfbFetchingUid(null);
    }
  }, [skfbFetchingUid, openModelSource]);

  // Explicit opt-in: generate the exploded assembly with AI for a name
  // that had no library match. Only runs when the user clicks the button.
  const handleGenerateFallback = useCallback(() => {
    const src = (pendingGenName || '').trim();
    if (!src) return;
    setPasteError(null);
    setPendingGenName(null);
    setPasteSource('');
    setExplodedWeaponName(src);
    setView(VIEW.EXPLODED);
    setActiveSideItem('live-ops');
    generateExploded(src);
  }, [pendingGenName, generateExploded]);

  // Open any library asset (or the currently viewed model) in the exploded
  // viewer. No AI anywhere in this path: the viewer detects, labels, and
  // measures every part from the model file's own geometry and materials.
  const handleExplodeAsset = useCallback((asset) => {
    if (!asset?.url) return;
    setDetectedParts([]);
    setCustomGlb({ url: asset.url, name: asset.name || 'Library Asset' });
    setView(VIEW.EXPLODED);
    setActiveSideItem('live-ops');
  }, []);

  // Research hook
  const { data: researchData, loading, error, phase, fetchResearch, reset } = useResearch();

  const handleUpload = useCallback(async (file) => {
    const result = await uploadModel(file);
    return result;
  }, []);

  const handleModelSelected = useCallback(async (selection) => {
    const { name, url, uploadData } = selection;
    setModelName(name);

    if (url) {
      setModelUrl(url);
    } else if (uploadData?.url) {
      setModelUrl(uploadData.url);
    }

    setView(VIEW.VIEWER);
    setActiveSideItem('live-ops');
    reset();
  }, [reset]);

  const handleMeshNamesFound = useCallback((names) => {
    setMeshNames(names);
  }, []);

  const handlePartClick = useCallback((part) => {
    setActivePart(prev =>
      prev?.mesh_id === part.mesh_id ? null : part
    );
  }, []);

  const handleBack = useCallback(() => {
    setView(VIEW.SELECT);
    setModelUrl(null);
    setModelName('');
    setMeshNames([]);
    setActivePart(null);
    setActiveSideItem('library');
    setActiveGenComponent(null);
    reset();
    resetGen();
    resetDirect3D();
    resetExploded();
    setCustomGlb(null);
    setDetectedParts([]);
  }, [reset, resetGen, resetDirect3D, resetExploded]);

  const handleBrandClick = useCallback(() => {
    handleBack();
  }, [handleBack]);

  const handleSectionChange = useCallback((section) => {
    setActiveSection(section);
    if (section === 'Assets') {
      handleBack();
    } else if (section === 'Intelligence') {
      setView(VIEW.NEWS);
      setActiveSideItem('news');
    } else if (section === 'Deployment') {
      setView(VIEW.FREECAD);
      setActiveSideItem('freecad');
    } else if (section === 'Tactical') {
      if (modelUrl) {
        setView(VIEW.VIEWER);
        setActiveSideItem('live-ops');
      } else {
        setView(VIEW.SELECT);
        setActiveSideItem('library');
      }
    }
  }, [handleBack, modelUrl]);

  // Generation handler
  const handleGenerate = useCallback(async () => {
    if (!genAssetName.trim()) return;
    setView(VIEW.GENERATE);
    setActiveSideItem('live-ops');
    setActiveTab('parts');
    generate(genAssetName.trim());
  }, [genAssetName, generate]);

  // Direct 3D generation handler (name -> best web image -> Hunyuan3D-2.1)
  const handleDirect3DGenerate = useCallback(async () => {
    if (!directWeaponName.trim()) return;
    setView(VIEW.DIRECT3D);
    setActiveSideItem('live-ops');
    generateDirect3D(directWeaponName.trim());
  }, [directWeaponName, generateDirect3D]);

  // Exploded assembly handler (research -> parts -> 3D -> exploded view)
  const handleExplodedGenerate = useCallback(async () => {
    if (!explodedWeaponName.trim()) return;
    setView(VIEW.EXPLODED);
    setActiveSideItem('live-ops');
    generateExploded(explodedWeaponName.trim());
  }, [explodedWeaponName, generateExploded]);

  const tabs = [
    { key: 'parts', label: view === VIEW.GENERATE ? 'BOM Table' : 'Diagnostics' },
    { key: 'research', label: view === VIEW.GENERATE ? 'Risk Analysis' : 'Intelligence' },
  ];

  return (
    <div className="app-container" data-theme="ivory-command">
      {generatingSnapshots && <AutoSnapshot onComplete={() => setGeneratingSnapshots(false)} />}
      
      {/* Top Navigation */}
      <TopNav
        activeSection={activeSection}
        onSectionChange={handleSectionChange}
        onBrandClick={handleBrandClick}
      />

      <div className="app-body">
        {/* Side Navigation */}
        <SideNav
          activeItem={activeSideItem}
          onItemClick={(key) => {
            setActiveSideItem(key);
            if (key === 'library') {
              handleBack();
            } else if (key === 'freecad') {
              setView(VIEW.FREECAD);
            } else if (key === 'news') {
              setView(VIEW.NEWS);
            } else if (key === 'stack') {
              setView(VIEW.STACK);
            } else if (key === 'evolution') {
              setView(VIEW.EVOLUTION);
            } else if (key === 'materials') {
              setView(VIEW.MATERIALS);
            }
          }}
        />

        {/* ---- Selection Screen ---- */}
        <AnimatePresence mode="wait">
          {view === VIEW.SELECT && (
            <motion.div
              key="select"
              style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.3 }}
            >
              {/* Standalone Generate Section */}
              <ModelSelector
                onModelSelected={handleModelSelected}
                onUpload={handleUpload}
                onExplodeAsset={handleExplodeAsset}
                generateSection={
                  <>
                    <motion.div
                      className="generate-section"
                      initial={{ opacity: 0, y: -20 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ duration: 0.5 }}
                      style={{
                        marginBottom: 24,
                        background: 'linear-gradient(135deg, rgba(0, 212, 255, 0.15) 0%, rgba(0, 255, 136, 0.1) 100%)',
                        border: '1px solid rgba(0, 212, 255, 0.3)',
                        borderRadius: 16,
                        padding: 20
                      }}
                    >
                      <div className="generate-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
                        <div>
                          <h2 style={{ margin: 0, color: '#fff', fontSize: 20 }}>⚙️ FreeCAD Master AI 3D Studio</h2>
                          <p style={{ margin: '4px 0 0', color: '#94a3b8', fontSize: 13 }}>
                            5-pass iterative CAD refinement engine with live web research & Arjun Main Battle Tank presets.
                          </p>
                        </div>
                        <button
                          onClick={() => {
                            setView(VIEW.FREECAD);
                            setActiveSideItem('freecad');
                          }}
                          style={{
                            background: 'linear-gradient(90deg, #00d4ff 0%, #00ff88 100%)',
                            color: '#000',
                            fontWeight: 800,
                            fontSize: 14,
                            border: 'none',
                            borderRadius: 10,
                            padding: '10px 20px',
                            cursor: 'pointer',
                            display: 'flex',
                            alignItems: 'center',
                            gap: 8
                          }}
                        >
                          <span className="material-symbols-outlined">precision_manufacturing</span>
                          Launch FreeCAD AI Studio
                        </button>
                      </div>
                    </motion.div>

                    <motion.div
                      className="generate-section"
                      initial={{ opacity: 0, y: -20 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ duration: 0.5, delay: 0.02 }}
                      style={{ marginBottom: 24 }}
                    >
                      <div className="generate-header">
                        <h2>Generate 3D Asset</h2>
                        <p>AI-powered tactical asset deconstruction — DeepSeek R1 → FLUX.1 → TRELLIS.2 / TripoSR</p>
                      </div>
                      <div className="generate-input-row">
                        <input
                          type="text"
                          className="generate-input"
                          placeholder="Enter asset name (e.g. AK-47 Rifle, M1 Abrams Tank, F-22 Raptor)..."
                          value={genAssetName}
                          onChange={(e) => setGenAssetName(e.target.value)}
                          onKeyDown={(e) => e.key === 'Enter' && handleGenerate()}
                          id="generate-input"
                        />
                        <button
                          className="btn-generate"
                          onClick={handleGenerate}
                          disabled={!genAssetName.trim() || genLoading}
                          id="btn-generate"
                        >
                          <span className="material-symbols-outlined">auto_awesome</span>
                          {genLoading ? 'Generating...' : 'Generate Asset'}
                        </button>
                      </div>
                    </motion.div>

                    <motion.div
                      initial={{ opacity: 0, y: -20 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ duration: 0.5, delay: 0.03 }}
                      style={{
                        marginBottom: 24, display: 'grid', gap: 12,
                        gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))',
                      }}
                    >
                      <AssetLibraryPanel />
                      <GpuEndpointPanel />
                    </motion.div>

                    <motion.div
                      className="generate-section"
                      initial={{ opacity: 0, y: -20 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ duration: 0.5, delay: 0.05 }}
                      style={{ marginBottom: 24 }}
                    >
                      <div className="generate-header">
                        <h2>3D Model Generator</h2>
                        <p>Just a name → best web reference photo → auto preprocess → Hunyuan3D-2.1</p>
                      </div>
                      <div className="generate-input-row">
                        <input
                          type="text"
                          className="generate-input"
                          placeholder="Enter a weapon name (e.g. AK-47, Barrett M82, M1 Abrams)..."
                          value={directWeaponName}
                          onChange={(e) => setDirectWeaponName(e.target.value)}
                          onKeyDown={(e) => e.key === 'Enter' && handleDirect3DGenerate()}
                          id="direct3d-input"
                        />
                        <button
                          className="btn-generate"
                          onClick={handleDirect3DGenerate}
                          disabled={!directWeaponName.trim() || directLoading}
                          id="btn-direct3d-generate"
                        >
                          <span className="material-symbols-outlined">view_in_ar</span>
                          {directLoading ? 'Generating...' : 'Generate 3D Model'}
                        </button>
                      </div>
                    </motion.div>

                    <motion.div
                      className="generate-section"
                      initial={{ opacity: 0, y: -20 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ duration: 0.5, delay: 0.1 }}
                      style={{ marginBottom: 24 }}
                    >
                      <div className="generate-header">
                        <h2>Exploded Assembly Generator</h2>
                        <p>AI research → 5 major parts → web images → textured 3D (TRELLIS.2) → interactive exploded view</p>
                      </div>
                      <div className="generate-input-row">
                        <input
                          type="text"
                          className="generate-input"
                          placeholder="Enter a weapon name for full assembly deconstruction..."
                          value={explodedWeaponName}
                          onChange={(e) => setExplodedWeaponName(e.target.value)}
                          onKeyDown={(e) => e.key === 'Enter' && handleExplodedGenerate()}
                          id="exploded-input"
                        />
                        <button
                          className="btn-generate"
                          onClick={handleExplodedGenerate}
                          disabled={!explodedWeaponName.trim() || expLoading}
                          id="btn-exploded-generate"
                        >
                          <span className="material-symbols-outlined">open_with</span>
                          {expLoading ? 'Generating...' : 'Generate Assembly'}
                        </button>
                        <input
                          type="file"
                          id="glb-open-input"
                          accept=".glb,.gltf"
                          style={{ display: 'none' }}
                          onChange={handleOpenGlb}
                        />
                        <button
                          className="btn-generate"
                          style={{ background: 'transparent', color: 'var(--on-surface, #222)', border: '1px solid var(--outline-variant, #d0d0d0)' }}
                          onClick={() => document.getElementById('glb-open-input').click()}
                          id="btn-open-glb"
                          title="Open any multi-part .glb (artist kits, downloaded models) in the exploded viewer"
                        >
                          <span className="material-symbols-outlined">folder_open</span>
                          Open GLB
                        </button>
                      </div>

                      {/* Paste-anything: direct .glb URL, Sketchfab page, or a name */}
                      <div className="generate-input-row" style={{ marginTop: 10 }}>
                        <input
                          type="text"
                          className="generate-input"
                          placeholder="Paste a .glb link or Sketchfab model URL — or type a weapon name to fetch one..."
                          value={pasteSource}
                          onChange={(e) => setPasteSource(e.target.value)}
                          onKeyDown={(e) => e.key === 'Enter' && handleOpenSource()}
                          id="paste-source-input"
                        />
                        <button
                          className="btn-generate"
                          onClick={handleOpenSource}
                          disabled={!pasteSource.trim() || pasteBusy}
                          id="btn-open-source"
                          title="Fetches the model (direct link or Sketchfab) and opens the interactive exploded view"
                        >
                          <span className="material-symbols-outlined">travel_explore</span>
                          {pasteBusy ? 'Fetching…' : 'Fetch & Explode'}
                        </button>
                        <button
                          className="btn-generate"
                          style={{ background: 'transparent', color: 'var(--on-surface, #222)', border: '1px solid var(--outline-variant, #d0d0d0)' }}
                          onClick={handleSketchfabSearch}
                          disabled={!pasteSource.trim() || skfbBusy}
                          id="btn-sketchfab-search"
                          title="Browse the free Sketchfab models matching this name and pick one yourself"
                        >
                          <span className="material-symbols-outlined">search</span>
                          {skfbBusy ? 'Searching…' : 'Search Sketchfab'}
                        </button>
                      </div>

                      <SketchfabSearchResults
                        results={skfbResults}
                        query={skfbQuery}
                        fetchingUid={skfbFetchingUid}
                        onPick={handlePickSketchfab}
                        onClose={() => setSkfbResults(null)}
                      />
                      {pasteError && (
                        <div style={{
                          marginTop: 8, fontFamily: 'var(--font-mono)', fontSize: 11,
                          color: '#c62828',
                        }}>
                          ⚠️ {pasteError}
                          {pendingGenName && (
                            <button
                              id="btn-generate-fallback"
                              onClick={handleGenerateFallback}
                              style={{
                                display: 'inline-flex', alignItems: 'center', gap: 4,
                                marginLeft: 10, padding: '3px 10px', cursor: 'pointer',
                                fontFamily: 'var(--font-mono)', fontSize: 10,
                                letterSpacing: '0.05em', textTransform: 'uppercase',
                                background: 'transparent',
                                color: 'var(--on-surface, #222)',
                                border: '1px solid var(--outline-variant, #d0d0d0)',
                                borderRadius: 4,
                              }}
                              title={`Run the AI exploded-assembly pipeline for "${pendingGenName}"`}
                            >
                              <span className="material-symbols-outlined" style={{ fontSize: 13 }}>auto_awesome</span>
                              Generate with AI instead
                            </button>
                          )}
                        </div>
                      )}
                    </motion.div>
                  </>
                }
              />
            </motion.div>
          )}
        </AnimatePresence>

        {/* ---- 3D Viewer Screen (existing) ---- */}
        {view === VIEW.VIEWER && (
          <div className="viewer-layout">
            {/* Canvas Area */}
            <div className="canvas-container">
              <Canvas3D
                modelUrl={modelUrl}
                parts={researchData?.parts || []}
                activePart={activePart}
                onPartClick={handlePartClick}
                onMeshNamesFound={handleMeshNamesFound}
              />

              {/* Back button */}
              <button className="back-btn" onClick={handleBack} id="btn-back">
                <span className="material-symbols-outlined" style={{ fontSize: 18 }}>arrow_back</span>
                Library
              </button>

              {/* Jump to the interactive exploded view of this model */}
              <button
                className="back-btn"
                style={{ top: 68 }}
                onClick={() => handleExplodeAsset({ url: modelUrl, name: modelName })}
                id="btn-explode-current"
              >
                <span className="material-symbols-outlined" style={{ fontSize: 18 }}>open_with</span>
                Exploded View
              </button>

              {/* Model info badge */}
              <div className="model-info-badge" id="model-info-badge">
                <div>
                  <div className="badge-label">ASSET_IDENTIFIER</div>
                  <div className="badge-value">{modelName}</div>
                  <div className="asset-id-type">TACTICAL ANALYSIS</div>
                </div>
                {researchData?.parts && (
                  <div>
                    <div className="badge-label">COMPONENTS</div>
                    <div className="badge-value">{researchData.parts.length}</div>
                  </div>
                )}
              </div>

              {/* Controls hint */}
              <div className="controls-hint">
                <span className="hint">🖱 Rotate</span>
                <span className="hint">⚲ Scroll to zoom</span>
                <span className="hint">⇧+🖱 Pan</span>
              </div>

              {/* Loading overlay */}
              <LoadingOverlay isVisible={loading} phase={phase} />
            </div>

            {/* AI Analysis Side Panel */}
            <div className="side-panel" id="ai-panel">
              <div className="panel-header">
                <div className="panel-header-top">
                  <span className="ai-agent-badge">AI_AGENT: ASTRA</span>
                  {loading && (
                    <span className="material-symbols-outlined ai-sync-icon" style={{ fontSize: 18 }}>sync</span>
                  )}
                </div>
                <h1>Diagnostic Analysis</h1>
                <div className="subtitle">
                  Scanning airframe integrity and internal subsystems. Detecting variance in secondary propulsion lines.
                </div>
              </div>

              {/* Tab navigation */}
              <div className="tab-nav">
                {tabs.map(tab => (
                  <button
                    key={tab.key}
                    className={`tab-btn ${activeTab === tab.key ? 'active' : ''}`}
                    onClick={() => setActiveTab(tab.key)}
                    id={`tab-${tab.key}`}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>

              {/* Tab content */}
              <div className="panel-content">
                {error && (
                  <div className="error-banner">
                    ⚠️ {error}
                  </div>
                )}

                <AnimatePresence mode="wait">
                  {activeTab === 'parts' && (
                    <motion.div
                      key="parts"
                      initial={{ opacity: 0, x: -10 }}
                      animate={{ opacity: 1, x: 0 }}
                      exit={{ opacity: 0, x: 10 }}
                      transition={{ duration: 0.2 }}
                    >
                      <PartsList
                        parts={researchData?.parts || []}
                        activePart={activePart}
                        onPartClick={handlePartClick}
                      />
                    </motion.div>
                  )}

                  {activeTab === 'research' && (
                    <motion.div
                      key="research"
                      initial={{ opacity: 0, x: -10 }}
                      animate={{ opacity: 1, x: 0 }}
                      exit={{ opacity: 0, x: 10 }}
                      transition={{ duration: 0.2 }}
                    >
                      <ResearchPanel data={researchData} />
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>

              {/* Footer Action */}
              <div className="panel-footer">
                <button
                  className="btn-sweep"
                  onClick={() => fetchResearch(modelName, meshNames)}
                  disabled={loading || !modelName}
                  id="btn-sweep"
                >
                  <span className="material-symbols-outlined">auto_fix</span>
                  {loading ? 'Running Intelligence Sweep...' : 'Run Full Intelligence Sweep'}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ---- Generation Pipeline Screen (NEW) ---- */}
        {view === VIEW.GENERATE && (
          <div className="viewer-layout">
            {/* Canvas Area / Progress */}
            <div className="canvas-container">
              {isComplete ? (
                <ExplodedViewer
                  components={genComponents}
                  onComponentClick={setActiveGenComponent}
                  activeComponent={activeGenComponent}
                />
              ) : (
                <GenerationProgress
                  phase={genPhase}
                  components={genComponents}
                  currentComponent={currentComponent}
                  bomData={bomData}
                  isVisible={true}
                />
              )}

              {/* Back button */}
              <button className="back-btn" onClick={handleBack} id="btn-back-gen">
                <span className="material-symbols-outlined" style={{ fontSize: 18 }}>arrow_back</span>
                Library
              </button>

              {/* Model info badge */}
              <div className="model-info-badge">
                <div>
                  <div className="badge-label">ASSET_IDENTIFIER</div>
                  <div className="badge-value">{genAssetName}</div>
                  <div className="asset-id-type">3D GENERATION PIPELINE</div>
                </div>
                {genComponents.length > 0 && (
                  <div>
                    <div className="badge-label">COMPONENTS</div>
                    <div className="badge-value">{genComponents.length}</div>
                  </div>
                )}
              </div>

              {/* Controls hint (only when viewer is shown) */}
              {isComplete && (
                <div className="controls-hint">
                  <span className="hint">🖱 Rotate</span>
                  <span className="hint">⚲ Scroll to zoom</span>
                  <span className="hint">⇧+🖱 Pan</span>
                </div>
              )}
            </div>

            {/* Side Panel */}
            <div className="side-panel" id="gen-panel">
              <div className="panel-header">
                <div className="panel-header-top">
                  <span className="ai-agent-badge">AI_AGENT: IVORY</span>
                  {genLoading && (
                    <span className="material-symbols-outlined ai-sync-icon" style={{ fontSize: 18 }}>sync</span>
                  )}
                </div>
                <h1>Asset Intelligence</h1>
                <div className="subtitle">
                  Multi-model AI pipeline: DeepSeek-R1 → FLUX.1-dev → TRELLIS.2
                </div>
              </div>

              {/* Tab navigation */}
              <div className="tab-nav">
                {tabs.map(tab => (
                  <button
                    key={tab.key}
                    className={`tab-btn ${activeTab === tab.key ? 'active' : ''}`}
                    onClick={() => setActiveTab(tab.key)}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>

              {/* Tab content */}
              <div className="panel-content">
                {genError && (
                  <div className="error-banner">⚠️ {genError}</div>
                )}

                <AnimatePresence mode="wait">
                  {activeTab === 'parts' && (
                    <motion.div
                      key="bom"
                      initial={{ opacity: 0, x: -10 }}
                      animate={{ opacity: 1, x: 0 }}
                      exit={{ opacity: 0, x: 10 }}
                      transition={{ duration: 0.2 }}
                    >
                      <BOMTable
                        components={genComponents}
                        activeComponent={activeGenComponent}
                        onComponentClick={setActiveGenComponent}
                      />
                    </motion.div>
                  )}

                  {activeTab === 'research' && (
                    <motion.div
                      key="risk"
                      initial={{ opacity: 0, x: -10 }}
                      animate={{ opacity: 1, x: 0 }}
                      exit={{ opacity: 0, x: 10 }}
                      transition={{ duration: 0.2 }}
                    >
                      <RiskDashboard components={genComponents} />
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            </div>
          </div>
        )}

        {/* ---- Direct 3D Generator Screen (NEW) ---- */}
        {view === VIEW.DIRECT3D && (
          <div className="viewer-layout">
            {/* Canvas Area / Progress */}
            <div className="canvas-container">
              {isDirectComplete && directGlbUrl ? (
                <Canvas3D
                  modelUrl={directGlbUrl}
                  parts={[]}
                  activePart={null}
                  onPartClick={() => {}}
                  onMeshNamesFound={() => {}}
                />
              ) : (
                <Direct3DProgress
                  phase={directPhase}
                  sourceImageUrl={sourceImageUrl}
                  preprocessedImageUrl={preprocessedImageUrl}
                  weaponName={directWeaponName}
                  isVisible={true}
                />
              )}

              {/* Back button */}
              <button className="back-btn" onClick={handleBack} id="btn-back-direct3d">
                <span className="material-symbols-outlined" style={{ fontSize: 18 }}>arrow_back</span>
                Library
              </button>

              {/* Model info badge */}
              <div className="model-info-badge">
                <div>
                  <div className="badge-label">ASSET_IDENTIFIER</div>
                  <div className="badge-value">{directWeaponName}</div>
                  <div className="asset-id-type">DIRECT 3D GENERATOR</div>
                </div>
                {directGlbUrl && (
                  <div>
                    <div className="badge-label">MODEL_SOURCE</div>
                    <div className="badge-value">{(directModelSource || 'HUNYUAN3D-2.1').toUpperCase()}</div>
                  </div>
                )}
              </div>

              {/* Controls hint (only when viewer is shown) */}
              {isDirectComplete && directGlbUrl && (
                <div className="controls-hint">
                  <span className="hint">🖱 Rotate</span>
                  <span className="hint">⚲ Scroll to zoom</span>
                  <span className="hint">⇧+🖱 Pan</span>
                </div>
              )}
            </div>

            {/* Side Panel */}
            <div className="side-panel" id="direct3d-panel">
              <div className="panel-header">
                <div className="panel-header-top">
                  <span className="ai-agent-badge">AI_AGENT: IVORY</span>
                  {directLoading && (
                    <span className="material-symbols-outlined ai-sync-icon" style={{ fontSize: 18 }}>sync</span>
                  )}
                </div>
                <h1>Direct 3D Generator</h1>
                <div className="subtitle">
                  Name → best web reference image → auto preprocess → Hunyuan3D-2.1
                </div>
              </div>

              <div className="panel-content">
                {directError && (
                  <div className="error-banner">⚠️ {directError}</div>
                )}

                {sourceUrl && (
                  <div style={{ padding: '16px 0', fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--outline)', wordBreak: 'break-all' }}>
                    <div className="badge-label" style={{ marginBottom: 4 }}>SOURCE_IMAGE</div>
                    <a href={sourceUrl} target="_blank" rel="noreferrer" style={{ color: 'var(--primary)' }}>{sourceUrl}</a>
                  </div>
                )}

                {isDirectComplete && directGlbUrl && (
                  <div style={{ padding: '16px 0', fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--outline)' }}>
                    <div className="badge-label" style={{ marginBottom: 4 }}>STATUS</div>
                    ✓ 3D model generated successfully. Use the viewer to rotate, zoom, and inspect.
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* ---- Exploded Assembly Screen (NEW) ---- */}
        {view === VIEW.EXPLODED && (
          <div className="viewer-layout">
            {/* Canvas Area / Progress */}
            <div className="canvas-container">
              {customGlb ? (
                <ExplodedAssemblyViewer
                  assemblyUrl={customGlb.url}
                  components={customGlb.components || []}
                  intel={customGlb.intel || {}}
                  assetName={customGlb.name}
                  profile={customGlb.profile || null}
                  onPartsDetected={setDetectedParts}
                />
              ) : isExpComplete && expAssemblyUrl ? (
                <ExplodedAssemblyViewer
                  assemblyUrl={expAssemblyUrl}
                  components={expComponents}
                  intel={expKitIntel}
                  assetName={expKitInfo?.name || explodedWeaponName}
                  onPartsDetected={setDetectedParts}
                />
              ) : (
                <ExplodedProgress
                  phase={expPhase}
                  message={expMessage}
                  components={expComponents}
                  shellImageUrl={expShellImage}
                  weaponName={explodedWeaponName}
                  isVisible={true}
                />
              )}

              {/* Back button */}
              <button className="back-btn" onClick={handleBack} id="btn-back-exploded">
                <span className="material-symbols-outlined" style={{ fontSize: 18 }}>arrow_back</span>
                Library
              </button>

              {/* Model info badge */}
              <div className="model-info-badge">
                <div>
                  <div className="badge-label">ASSET_IDENTIFIER</div>
                  <div className="badge-value">{customGlb ? customGlb.name : (expKitInfo?.name || explodedWeaponName)}</div>
                  <div className="asset-id-type">
                    {customGlb ? (customGlb.kit ? 'LIBRARY 3D KIT' : 'IMPORTED 3D KIT')
                      : expKitInfo ? 'LIBRARY 3D KIT' : 'EXPLODED ASSEMBLY'}
                  </div>
                </div>
                {(() => {
                  const credit = customGlb ? customGlb.kit : expKitInfo;
                  return credit ? (
                    <div>
                      <div className="badge-label">CREDIT</div>
                      <div className="badge-value" style={{ fontSize: 11 }}>
                        <a href={credit.page_url} target="_blank" rel="noreferrer" style={{ color: 'inherit' }}>
                          {credit.author}
                        </a>
                      </div>
                      <div className="asset-id-type">{credit.license}</div>
                    </div>
                  ) : null;
                })()}
                {(() => {
                  const n = customGlb
                    ? (customGlb.components?.length || detectedParts.length)
                    : (expComponents.length || detectedParts.length);
                  return n > 0 ? (
                    <div>
                      <div className="badge-label">COMPONENTS</div>
                      <div className="badge-value">{n}</div>
                    </div>
                  ) : null;
                })()}
              </div>

              {/* Controls hint (only when viewer is shown) */}
              {isExpComplete && expAssemblyUrl && (
                <div className="controls-hint">
                  <span className="hint">🖱 Rotate</span>
                  <span className="hint">⚲ Scroll to zoom</span>
                  <span className="hint">⇕ Slider to explode</span>
                </div>
              )}
            </div>

            {/* Side Panel */}
            <div className="side-panel" id="exploded-panel">
              <div className="panel-header">
                <div className="panel-header-top">
                  <span className="ai-agent-badge">AI_AGENT: IVORY</span>
                  {expLoading && (
                    <span className="material-symbols-outlined ai-sync-icon" style={{ fontSize: 18 }}>sync</span>
                  )}
                </div>
                <h1>Assembly Intelligence</h1>
                <div className="subtitle">
                  {customGlb
                    ? 'Geometric part detection → labeled exploded view — computed from the model file, no AI'
                    : 'Research → 5 parts → web images → textured 3D → trimesh assembly'}
                </div>
              </div>

              <div className="panel-content">
                {expError && (
                  <div className="error-banner">⚠️ {expError}</div>
                )}

                {(customGlb?.components?.length || expComponents.length) ? (
                  <BOMTable
                    components={customGlb?.components?.length ? customGlb.components : expComponents}
                    activeComponent={null}
                    onComponentClick={() => {}}
                  />
                ) : (
                  <DetectedPartsTable parts={detectedParts} />
                )}
              </div>
            </div>
          </div>
        )}

        {/* ---- FreeCAD Master AI Studio Screen ---- */}
        {view === VIEW.FREECAD && (
          <FreeCADGenerator
            onOpenExplodedView={(glbUrl, name, kitInfo) => {
              setCustomGlb({
                url: glbUrl,
                name: name,
                kit: kitInfo,
                components: (kitInfo?.parts_breakdown || []).map(p => ({
                  part_name: p.name,
                  material_dependency: p.material,
                  risk_tier: 'STABLE',
                  risk_score: 10,
                  glb_url: glbUrl
                }))
              });
              setView(VIEW.EXPLODED);
              setActiveSideItem('live-ops');
            }}
          />
        )}

        {/* ---- Field News Page ---- */}
        {view === VIEW.NEWS && <NewsPage />}

        {/* ---- Tech Stack Page ---- */}
        {view === VIEW.STACK && <TechStackPage />}

        {/* ---- Weapon Evolution Page ---- */}
        {view === VIEW.EVOLUTION && <EvolutionPage />}

        {/* ---- Materials Analysis Page ---- */}
        {view === VIEW.MATERIALS && <MaterialsPage />}
      </div>
    </div>
  );
}
