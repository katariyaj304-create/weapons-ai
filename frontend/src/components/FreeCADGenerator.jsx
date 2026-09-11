import React, { useState, useEffect, useRef, useCallback } from 'react';

export default function FreeCADGenerator({ onOpenExplodedView }) {
  const [status, setStatus] = useState({ installed: false, version: '', executable: '' });
  const [mcpStatus, setMcpStatus] = useState({ freecad_found: false, mcp_addon_installed: false, mcp_server_running: false });
  const [hfModels, setHfModels] = useState([]);
  const [prompt, setPrompt] = useState('Arjun Main Battle Tank (Arjun MBT Mk-1A)');
  const [useWebSearch, setUseWebSearch] = useState(true);
  const [timeLimit, setTimeLimit] = useState(360);
  const [qualityThreshold, setQualityThreshold] = useState(75);
  const [isGenerating, setIsGenerating] = useState(false);
  const [currentPhase, setCurrentPhase] = useState('');
  const [currentIteration, setCurrentIteration] = useState(0);
  const [iterations, setIterations] = useState([]);
  const [latestScore, setLatestScore] = useState(null);
  const [latestFeedback, setLatestFeedback] = useState('');
  const [latestScreenshot, setLatestScreenshot] = useState(null);
  const [aiReasoning, setAiReasoning] = useState('');
  const [showReasoning, setShowReasoning] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const [showScriptModal, setShowScriptModal] = useState(false);
  const [elapsedTime, setElapsedTime] = useState(0);
  const [setupLoading, setSetupLoading] = useState(false);
  const eventSourceRef = useRef(null);
  const timerRef = useRef(null);

  const presets = [
    "Arjun Main Battle Tank (Arjun MBT Mk-1A) 🇮🇳",
    "DRDO Rustom-2 MALE UAV (TAPAS) 🇮🇳",
    "M1A2 Abrams SEPv3 Heavy MBT 🇺🇸",
    "AK-47 Tactical Rifle (With Internals) 💥",
    "Sukhoi Su-57 Felon Stealth Fighter 🚀",
    "Scud-B Ballistic Missile Launcher 🚀",
    "D-30 122mm Heavy Howitzer 💥"
  ];

  const phases = [
    { id: 'planning', label: 'DeepSeek R1 Planning', icon: 'psychology' },
    { id: 'building', label: 'Building Geometry', icon: 'precision_manufacturing' },
    { id: 'evaluating', label: 'Vision AI Evaluation', icon: 'visibility' },
    { id: 'refining', label: 'Iterative Refinement', icon: 'auto_fix_high' },
    { id: 'exporting', label: 'Multi-Format Export', icon: 'download' }
  ];

  useEffect(() => {
    fetch('/api/freecad/status')
      .then(r => r.json())
      .then(data => setStatus(data))
      .catch(() => {});
    fetch('/api/freecad/mcp-status')
      .then(r => r.json())
      .then(data => setMcpStatus(data))
      .catch(() => {});
    fetch('/api/freecad/hf-models')
      .then(r => r.json())
      .then(data => setHfModels(data.models || data || []))
      .catch(() => setHfModels([]));
    return () => {
      if (eventSourceRef.current) eventSourceRef.current.close();
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, []);

  const handleSetupMCP = async () => {
    setSetupLoading(true);
    try {
      const res = await fetch('/api/freecad/mcp-setup', { method: 'POST' });
      const data = await res.json();
      if (data.status) setMcpStatus(data.status);
      else {
        const s = await fetch('/api/freecad/mcp-status');
        setMcpStatus(await s.json());
      }
    } catch (e) { setError(e.message); }
    setSetupLoading(false);
  };

  const handleGenerate = useCallback((assetPrompt) => {
    const targetPrompt = (assetPrompt || prompt).trim();
    if (!targetPrompt || isGenerating) return;

    setIsGenerating(true);
    setResult(null);
    setError(null);
    setCurrentPhase('planning');
    setCurrentIteration(0);
    setIterations([]);
    setLatestScore(null);
    setLatestFeedback('');
    setLatestScreenshot(null);
    setAiReasoning('');
    setElapsedTime(0);

    const startTs = Date.now();
    timerRef.current = setInterval(() => setElapsedTime(Math.floor((Date.now() - startTs) / 1000)), 1000);

    // Try SSE streaming first, fall back to POST
    const params = new URLSearchParams({
      time_limit: timeLimit,
      quality_threshold: qualityThreshold,
      max_iterations: 8,
      enable_web_search: useWebSearch
    });
    const encodedName = encodeURIComponent(targetPrompt);
    const es = new EventSource(`/api/freecad/generate/stream/${encodedName}?${params}`);
    eventSourceRef.current = es;

    es.onmessage = (event) => {
      try {
        const d = JSON.parse(event.data);
        if (d.phase) setCurrentPhase(d.phase);
        if (d.iteration !== undefined) setCurrentIteration(d.iteration);
        if (d.reasoning) setAiReasoning(prev => prev + '\n' + d.reasoning);
        if (d.score !== undefined) setLatestScore(d.score);
        if (d.feedback) setLatestFeedback(d.feedback);
        if (d.screenshot_url) setLatestScreenshot(d.screenshot_url);
        if (d.phase === 'evaluating' && d.score !== undefined) {
          setIterations(prev => [...prev, {
            iteration: d.iteration || prev.length + 1,
            score: d.score,
            feedback: d.feedback || '',
            screenshot: d.screenshot_url || null
          }]);
        }
        if (d.phase === 'complete' && d.data) {
          setResult(d.data);
          setIsGenerating(false);
          clearInterval(timerRef.current);
          es.close();
        }
        if (d.phase === 'error') {
          setError(d.message || 'Generation failed');
          setIsGenerating(false);
          clearInterval(timerRef.current);
          es.close();
        }
      } catch (parseErr) { /* ignore */ }
    };
    es.onerror = () => {
      es.close();
      // Fallback to POST
      fetch('/api/freecad/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          asset_name: targetPrompt,
          enable_web_search: useWebSearch,
          time_limit: timeLimit,
          quality_threshold: qualityThreshold,
          max_iterations: 8
        })
      })
        .then(r => r.json())
        .then(data => { setResult(data); setCurrentPhase('complete'); })
        .catch(e => setError(e.message))
        .finally(() => { setIsGenerating(false); clearInterval(timerRef.current); });
    };
  }, [prompt, isGenerating, useWebSearch, timeLimit, qualityThreshold]);

  const getScoreColor = (s) => {
    if (s >= 75) return '#4caf50';
    if (s >= 60) return '#ff9800';
    if (s >= 40) return '#ff5722';
    return '#f44336';
  };
  const formatTime = (s) => `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, '0')}s`;
  const phaseIndex = phases.findIndex(p => p.id === currentPhase);

  const deepseekCard = {
    name: 'DeepSeek R1 Reasoning Engine', id: 'deepseek/deepseek-r1',
    provider: 'OpenRouter / DeepSeek', category: 'Master CAD Geometry Reasoning',
    description: 'Deep chain-of-thought reasoning that thinks through weapon geometry, dimensions, part hierarchy, and CSG operations before generating FreeCAD commands.',
    tier: 'primary', url: 'https://openrouter.ai/deepseek/deepseek-r1'
  };
  const allModels = [deepseekCard, ...hfModels.filter(m => m.id !== 'deepseek/deepseek-r1')];

  return (
    <div className="main-content">
      <div className="main-content-inner">

        {/* ===== HEADER + STATUS BAR ===== */}
        <div className="generate-section" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '1rem' }}>
          <div className="generate-header">
            <h2>FreeCAD Master AI Studio</h2>
            <p>Army-grade 3D CAD weapons designed by AI working inside FreeCAD — with visual feedback & iterative mastery</p>
          </div>
          <div style={{ display: 'flex', gap: '1rem', alignItems: 'center', flexWrap: 'wrap' }}>
            {[
              { label: 'FreeCAD 1.1', ok: status.installed || mcpStatus.freecad_found },
              { label: 'MCP Bridge', ok: mcpStatus.mcp_server_running },
              { label: 'DeepSeek R1', ok: true }
            ].map(s => (
              <div key={s.label} style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontFamily: 'var(--font-mono)', fontSize: '0.8rem', background: 'var(--surface-container-high)', padding: '0.4rem 0.9rem', borderRadius: '4px', border: '1px solid var(--outline-variant)' }}>
                <span className="status-dot" style={{ background: s.ok ? '#4caf50' : '#f44336', width: 8, height: 8, borderRadius: '50%', display: 'inline-block' }} />
                <span style={{ color: s.ok ? 'var(--secondary)' : 'var(--on-surface-variant)' }}>{s.label}</span>
              </div>
            ))}
            {!mcpStatus.mcp_server_running && (
              <button className="btn-tactical" onClick={handleSetupMCP} disabled={setupLoading}
                style={{ padding: '0.4rem 0.8rem', fontSize: '0.75rem' }}>
                <span className="material-symbols-outlined" style={{ fontSize: 14, marginRight: 4 }}>build</span>
                {setupLoading ? 'Setting up...' : 'Setup MCP'}
              </button>
            )}
          </div>
        </div>

        {error && <div className="error-banner" style={{ margin: '1rem 0' }}>⚠️ {error}</div>}

        {/* ===== AI ENGINE CARDS ===== */}
        <div className="generate-section">
          <div className="generate-header">
            <h2>AI Neural Engines</h2>
            <p>DeepSeek R1 reasoning + Hugging Face models for parametric CAD synthesis.</p>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: '1rem', marginTop: '1rem' }}>
            {allModels.map((model, idx) => (
              <a key={idx} href={model.url || '#'} target="_blank" rel="noreferrer" className="asset-card" style={{ textDecoration: 'none' }}>
                <div className="asset-card-body">
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                    <div className="asset-card-name" style={{ fontSize: '1rem' }}>{model.name || model.id}</div>
                    {model.tier === 'primary' && <span className="ai-agent-badge" style={{ fontSize: '0.7rem' }}>PRIMARY ENGINE</span>}
                  </div>
                  <p style={{ color: 'var(--on-surface-variant)', fontSize: '0.85rem', marginTop: '0.5rem', lineHeight: '1.4' }}>{model.description}</p>
                  <div className="asset-card-specs" style={{ marginTop: '0.75rem' }}>
                    <div className="asset-spec">
                      <span className="asset-spec-label">CATEGORY</span>
                      <span className="asset-spec-value" style={{ fontSize: '0.75rem' }}>{model.category || 'N/A'}</span>
                    </div>
                    <div className="asset-spec">
                      <span className="asset-spec-label">PROVIDER</span>
                      <span className="asset-spec-value" style={{ fontSize: '0.75rem' }}>{model.provider || 'HuggingFace'}</span>
                    </div>
                  </div>
                </div>
              </a>
            ))}
          </div>
        </div>

        {/* ===== SYNTHESIS CONTROLS ===== */}
        <div className="generate-section">
          <div className="generate-header">
            <h2>Military Asset Synthesis</h2>
            <p>Select a preset or specify custom hardware. AI will work inside FreeCAD until master-level output.</p>
          </div>

          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', margin: '1.25rem 0' }}>
            {presets.map(p => (
              <button key={p} onClick={() => { setPrompt(p); handleGenerate(p); }} disabled={isGenerating}
                style={{
                  background: prompt === p ? 'var(--primary)' : 'var(--surface)',
                  border: `1px solid ${prompt === p ? 'var(--primary)' : 'var(--outline-variant)'}`,
                  color: prompt === p ? '#fff' : 'var(--on-surface)',
                  padding: '0.6rem 1.1rem', borderRadius: '4px',
                  cursor: isGenerating ? 'not-allowed' : 'pointer',
                  fontFamily: 'var(--font-display)', fontSize: '0.875rem', fontWeight: 600,
                  transition: 'all 150ms ease-in-out'
                }}>
                {p}
              </button>
            ))}
          </div>

          {/* Controls Row */}
          <div style={{ display: 'flex', gap: '2rem', flexWrap: 'wrap', margin: '1rem 0', alignItems: 'flex-end' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', fontFamily: 'var(--font-mono)', fontSize: '0.8rem', color: 'var(--on-surface-variant)', cursor: 'pointer' }}>
              <input type="checkbox" checked={useWebSearch} onChange={e => setUseWebSearch(e.target.checked)}
                style={{ accentColor: 'var(--secondary)', width: 16, height: 16 }} />
              LIVE INTERNET RESEARCH
            </label>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem' }}>
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.7rem', color: 'var(--on-surface-variant)' }}>
                TIME BUDGET: {formatTime(timeLimit)}
              </span>
              <input type="range" min={60} max={360} step={30} value={timeLimit}
                onChange={e => setTimeLimit(Number(e.target.value))}
                style={{ accentColor: 'var(--secondary)', width: 140 }} />
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem' }}>
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.7rem', color: 'var(--on-surface-variant)' }}>
                QUALITY THRESHOLD: {qualityThreshold}/100
              </span>
              <input type="range" min={50} max={95} step={5} value={qualityThreshold}
                onChange={e => setQualityThreshold(Number(e.target.value))}
                style={{ accentColor: 'var(--secondary)', width: 140 }} />
            </div>
          </div>

          <div className="generate-input-row">
            <input type="text" className="generate-input" placeholder="E.g., Arjun Main Battle Tank Mk-1A..."
              value={prompt} onChange={e => setPrompt(e.target.value)} disabled={isGenerating} />
            <button className="btn-generate" onClick={() => handleGenerate()} disabled={isGenerating || !prompt.trim()}>
              <span className="material-symbols-outlined" style={{ fontSize: 18, marginRight: 6 }}>precision_manufacturing</span>
              {isGenerating ? 'AI WORKING IN FREECAD...' : 'SYNTHESIZE ARMY MODEL'}
            </button>
          </div>

          {/* ===== LIVE ITERATION VIEWER ===== */}
          {(isGenerating || result) && (
            <div style={{ marginTop: '2rem', background: 'var(--surface-container)', padding: '1.5rem', borderRadius: '6px', border: '1px solid var(--outline-variant)' }}>

              {/* Phase Stepper */}
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '1.5rem' }}>
                {phases.map((p, idx) => (
                  <div key={p.id} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', flex: 1, position: 'relative' }}>
                    <div style={{
                      width: 32, height: 32, borderRadius: '50%',
                      background: phaseIndex > idx ? 'var(--secondary)' : phaseIndex === idx ? 'var(--primary)' : 'var(--outline-variant)',
                      color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center',
                      marginBottom: '0.4rem', transition: 'all 300ms ease',
                      boxShadow: phaseIndex === idx ? '0 0 12px var(--primary)' : 'none'
                    }}>
                      <span className="material-symbols-outlined" style={{ fontSize: 16 }}>
                        {phaseIndex > idx ? 'check' : p.icon}
                      </span>
                    </div>
                    <span style={{
                      fontSize: '0.65rem', fontFamily: 'var(--font-mono)', textAlign: 'center',
                      color: phaseIndex >= idx ? 'var(--on-surface)' : 'var(--on-surface-variant)',
                      fontWeight: phaseIndex === idx ? 700 : 400
                    }}>
                      {p.label}
                    </span>
                  </div>
                ))}
              </div>

              {/* Live Content Grid */}
              {isGenerating && (
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', marginBottom: '1rem' }}>

                  {/* Viewport Screenshot */}
                  <div style={{
                    background: 'var(--surface-container-low)', borderRadius: '6px',
                    border: '1px solid var(--outline-variant)', overflow: 'hidden', minHeight: 220
                  }}>
                    <div style={{ padding: '0.5rem 0.8rem', borderBottom: '1px solid var(--outline-variant)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.7rem', color: 'var(--secondary)', fontWeight: 700 }}>
                        AI VIEWPORT — ITERATION {currentIteration || 1}
                      </span>
                      <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.65rem', color: 'var(--on-surface-variant)' }}>
                        {mcpStatus.mcp_server_running ? 'MCP LIVE' : 'FALLBACK MODE'}
                      </span>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1.5rem', minHeight: 180 }}>
                      {latestScreenshot ? (
                        <img src={latestScreenshot} alt="FreeCAD viewport" style={{ maxWidth: '100%', maxHeight: 200, borderRadius: 4 }} />
                      ) : (
                        <div style={{ textAlign: 'center', color: 'var(--on-surface-variant)' }}>
                          <span className="material-symbols-outlined" style={{ fontSize: 48, opacity: 0.3, display: 'block', marginBottom: '0.5rem' }}>view_in_ar</span>
                          <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.75rem' }}>
                            {currentPhase === 'planning' ? 'DeepSeek R1 reasoning about geometry...' :
                             currentPhase === 'building' ? 'Building 3D geometry in FreeCAD...' :
                             'Geometry validation mode'}
                          </span>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Score + Feedback */}
                  <div style={{
                    background: 'var(--surface-container-low)', borderRadius: '6px',
                    border: '1px solid var(--outline-variant)', padding: '1rem', display: 'flex', flexDirection: 'column', gap: '0.8rem'
                  }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                      <div style={{
                        width: 80, height: 80, borderRadius: '50%',
                        border: `4px solid ${latestScore !== null ? getScoreColor(latestScore) : 'var(--outline-variant)'}`,
                        display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column',
                        background: 'var(--surface-container)', transition: 'border-color 300ms ease'
                      }}>
                        <span style={{
                          fontFamily: 'var(--font-mono)', fontSize: '1.6rem', fontWeight: 800,
                          color: latestScore !== null ? getScoreColor(latestScore) : 'var(--on-surface-variant)'
                        }}>
                          {latestScore !== null ? latestScore : '—'}
                        </span>
                        <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.55rem', color: 'var(--on-surface-variant)' }}>/100</span>
                      </div>
                      <div>
                        <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.75rem', color: 'var(--secondary)', fontWeight: 700 }}>QUALITY SCORE</div>
                        <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.65rem', color: 'var(--on-surface-variant)', marginTop: 2 }}>
                          Target: {qualityThreshold}/100 | Iteration {currentIteration || 0}/8
                        </div>
                      </div>
                    </div>
                    {latestFeedback && (
                      <div style={{
                        background: 'var(--surface-container)', padding: '0.8rem', borderRadius: '4px',
                        fontFamily: 'var(--font-mono)', fontSize: '0.75rem', color: 'var(--on-surface-variant)',
                        lineHeight: '1.5', maxHeight: 100, overflowY: 'auto', border: '1px solid var(--outline-variant)'
                      }}>
                        <span style={{ color: 'var(--secondary)', fontWeight: 700 }}>VISION AI: </span>{latestFeedback}
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Iteration History */}
              {iterations.length > 0 && (
                <div style={{ marginBottom: '1rem' }}>
                  <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.7rem', color: 'var(--secondary)', fontWeight: 700, marginBottom: '0.5rem' }}>
                    ITERATION HISTORY
                  </div>
                  <div style={{ display: 'flex', gap: '0.5rem', overflowX: 'auto', paddingBottom: '0.3rem' }}>
                    {iterations.map((it, i) => (
                      <div key={i} style={{
                        background: 'var(--surface-container-low)', border: '1px solid var(--outline-variant)',
                        borderRadius: '4px', padding: '0.5rem 0.8rem', minWidth: 100, flexShrink: 0
                      }}>
                        <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.65rem', color: 'var(--on-surface-variant)' }}>
                          ITER {it.iteration}
                        </div>
                        <div style={{ fontFamily: 'var(--font-mono)', fontSize: '1.1rem', fontWeight: 800, color: getScoreColor(it.score) }}>
                          {it.score}
                        </div>
                        <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.55rem', color: 'var(--on-surface-variant)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 120 }}>
                          {it.feedback || 'Evaluated'}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* DeepSeek R1 Thinking Panel */}
              {aiReasoning && (
                <div style={{ marginBottom: '1rem' }}>
                  <button onClick={() => setShowReasoning(!showReasoning)}
                    style={{
                      background: 'none', border: '1px solid var(--outline-variant)', borderRadius: '4px',
                      padding: '0.4rem 0.8rem', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '0.4rem',
                      fontFamily: 'var(--font-mono)', fontSize: '0.7rem', color: 'var(--secondary)', fontWeight: 700
                    }}>
                    <span className="material-symbols-outlined" style={{ fontSize: 14 }}>
                      {showReasoning ? 'expand_less' : 'expand_more'}
                    </span>
                    DEEPSEEK R1 REASONING PROCESS
                  </button>
                  {showReasoning && (
                    <pre style={{
                      background: '#0d1117', color: '#c9d1d9', padding: '1rem', borderRadius: '0 0 6px 6px',
                      border: '1px solid var(--outline-variant)', borderTop: 'none',
                      fontFamily: 'var(--font-mono)', fontSize: '0.75rem', lineHeight: '1.5',
                      maxHeight: 200, overflowY: 'auto', whiteSpace: 'pre-wrap', wordBreak: 'break-word'
                    }}>
                      {aiReasoning}
                    </pre>
                  )}
                </div>
              )}

              {/* Time Progress Bar */}
              {isGenerating && (
                <div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.3rem' }}>
                    <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.65rem', color: 'var(--on-surface-variant)' }}>
                      TIME BUDGET
                    </span>
                    <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.65rem', color: 'var(--secondary)' }}>
                      {formatTime(elapsedTime)} / {formatTime(timeLimit)}
                    </span>
                  </div>
                  <div style={{ height: 4, background: 'var(--outline-variant)', borderRadius: 2, overflow: 'hidden' }}>
                    <div style={{
                      height: '100%', width: `${Math.min((elapsedTime / timeLimit) * 100, 100)}%`,
                      background: elapsedTime / timeLimit > 0.9 ? '#f44336' : 'var(--secondary)',
                      borderRadius: 2, transition: 'width 1s linear'
                    }} />
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ===== FINAL RESULT ===== */}
          {result && !isGenerating && (
            <div className="asset-card" style={{ marginTop: '2rem', border: '1.5px solid var(--secondary)' }}>
              <div className="asset-card-body">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem', flexWrap: 'wrap', gap: '0.5rem' }}>
                  <div>
                    <h3 className="asset-card-name" style={{ margin: 0, fontSize: '1.4rem' }}>{result.asset_name || prompt}</h3>
                    <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.8rem', color: 'var(--secondary)', fontWeight: 600, marginTop: 2 }}>
                      {result.kit_info?.fidelity || 'ARMY-GRADE CAD ASSEMBLY'}
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                    {result.final_score !== null && result.final_score !== undefined && (
                      <span style={{
                        fontFamily: 'var(--font-mono)', fontSize: '0.8rem', fontWeight: 700, padding: '4px 10px',
                        borderRadius: '4px', background: getScoreColor(result.final_score) + '22',
                        color: getScoreColor(result.final_score), border: `1px solid ${getScoreColor(result.final_score)}`
                      }}>
                        SCORE: {result.final_score}/100
                      </span>
                    )}
                    {result.mcp_connected && (
                      <span className="ai-agent-badge" style={{ fontSize: '0.65rem' }}>MCP NATIVE</span>
                    )}
                    <span className="asset-card-badge badge-ready" style={{ fontSize: '0.75rem', padding: '6px 12px' }}>
                      PRESENTATION READY
                    </span>
                  </div>
                </div>

                {result.web_specs && (
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '1rem', marginBottom: '1.5rem', background: 'var(--surface-container-low)', padding: '1.2rem', borderRadius: '6px', border: '1px solid var(--outline-variant)' }}>
                    {result.web_specs.main_gun && (
                      <div className="asset-spec" style={{ borderTop: 'none' }}>
                        <span className="asset-spec-label">WEAPON / GUN</span>
                        <span className="asset-spec-value" style={{ fontSize: '0.85rem' }}>{result.web_specs.main_gun}</span>
                      </div>
                    )}
                    {result.web_specs.armor_type && (
                      <div className="asset-spec" style={{ borderTop: 'none' }}>
                        <span className="asset-spec-label">ARMOR / SHIELD</span>
                        <span className="asset-spec-value" style={{ fontSize: '0.85rem' }}>{result.web_specs.armor_type}</span>
                      </div>
                    )}
                    {result.web_specs.length_overall_m && (
                      <div className="asset-spec" style={{ borderTop: 'none' }}>
                        <span className="asset-spec-label">LENGTH</span>
                        <span className="asset-spec-value">{result.web_specs.length_overall_m}m</span>
                      </div>
                    )}
                    {result.web_specs.origin && (
                      <div className="asset-spec" style={{ borderTop: 'none' }}>
                        <span className="asset-spec-label">ORIGIN</span>
                        <span className="asset-spec-value">{result.web_specs.origin}</span>
                      </div>
                    )}
                    {result.web_specs.engine && (
                      <div className="asset-spec" style={{ borderTop: 'none' }}>
                        <span className="asset-spec-label">ENGINE</span>
                        <span className="asset-spec-value" style={{ fontSize: '0.85rem' }}>{result.web_specs.engine}</span>
                      </div>
                    )}
                    {result.web_specs.weight_tons && (
                      <div className="asset-spec" style={{ borderTop: 'none' }}>
                        <span className="asset-spec-label">WEIGHT</span>
                        <span className="asset-spec-value">{result.web_specs.weight_tons} tons</span>
                      </div>
                    )}
                    {result.kit_info?.parts_count && (
                      <div className="asset-spec" style={{ borderTop: 'none' }}>
                        <span className="asset-spec-label">COMPONENTS</span>
                        <span className="asset-spec-value" style={{ color: 'var(--secondary)' }}>{result.kit_info.parts_count} Parts</span>
                      </div>
                    )}
                    {result.iterations?.length > 0 && (
                      <div className="asset-spec" style={{ borderTop: 'none' }}>
                        <span className="asset-spec-label">AI ITERATIONS</span>
                        <span className="asset-spec-value" style={{ color: 'var(--secondary)' }}>{result.iterations.length} Passes</span>
                      </div>
                    )}
                  </div>
                )}

                <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
                  <button className="btn-engage" style={{ padding: '0.8rem 1.5rem', fontSize: '0.85rem' }}
                    onClick={() => onOpenExplodedView?.(result.glb_url, result.asset_name || prompt, result.kit_info)}>
                    <span className="material-symbols-outlined" style={{ fontSize: 20, marginRight: 8 }}>view_in_ar</span>
                    Open 3D Exploded Viewer
                  </button>
                  <button className="btn-tactical" style={{ padding: '0.8rem 1.5rem', fontSize: '0.85rem' }}
                    onClick={() => setShowScriptModal(true)}>
                    <span className="material-symbols-outlined" style={{ fontSize: 20, marginRight: 8 }}>code</span>
                    View FreeCAD Script
                  </button>
                  {result.step_url && (
                    <a href={result.step_url} download className="btn-tactical" style={{ textDecoration: 'none', display: 'inline-flex', alignItems: 'center', padding: '0.8rem 1.5rem', fontSize: '0.85rem' }}>
                      <span className="material-symbols-outlined" style={{ fontSize: 20, marginRight: 8 }}>draft</span>
                      Download STEP
                    </a>
                  )}
                  {result.stl_url && (
                    <a href={result.stl_url} download className="btn-tactical" style={{ textDecoration: 'none', display: 'inline-flex', alignItems: 'center', padding: '0.8rem 1.5rem', fontSize: '0.85rem' }}>
                      <span className="material-symbols-outlined" style={{ fontSize: 20, marginRight: 8 }}>print</span>
                      Download STL
                    </a>
                  )}
                  {result.glb_url && (
                    <a href={result.glb_url} download className="btn-tactical" style={{ textDecoration: 'none', display: 'inline-flex', alignItems: 'center', padding: '0.8rem 1.5rem', fontSize: '0.85rem' }}>
                      <span className="material-symbols-outlined" style={{ fontSize: 20, marginRight: 8 }}>download</span>
                      Download GLB
                    </a>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ===== SCRIPT MODAL ===== */}
      {showScriptModal && result && (
        <div style={{
          position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
          background: 'rgba(0,0,0,0.65)', display: 'flex', alignItems: 'center', justifyContent: 'center',
          zIndex: 1000, padding: '2rem'
        }}>
          <div style={{
            background: 'var(--surface)', width: '100%', maxWidth: 900, maxHeight: '90vh',
            borderRadius: '8px', display: 'flex', flexDirection: 'column',
            boxShadow: 'var(--shadow-float)', border: '1px solid var(--outline-variant)'
          }}>
            <div style={{ padding: '1.2rem', borderBottom: '1px solid var(--outline-variant)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <h3 style={{ margin: 0, fontFamily: 'var(--font-display)', color: 'var(--on-surface)', fontSize: '1.2rem' }}>FreeCAD Python Script</h3>
                <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.75rem', color: 'var(--on-surface-variant)', marginTop: 2 }}>
                  {result.asset_name || prompt} — {result.mcp_connected ? 'Generated via MCP Bridge' : 'Generated via AI Engine'}
                </div>
              </div>
              <button onClick={() => setShowScriptModal(false)}
                style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '1.5rem', color: 'var(--on-surface)' }}>
                &times;
              </button>
            </div>
            <div style={{ padding: '1.2rem', overflowY: 'auto', flex: 1 }}>
              <pre style={{
                fontFamily: 'var(--font-mono)', fontSize: '0.8rem',
                background: '#0d1117', color: '#c9d1d9',
                padding: '1.2rem', borderRadius: '6px',
                whiteSpace: 'pre-wrap', lineHeight: '1.5', wordBreak: 'break-word'
              }}>
                {result.freecad_script_content || result.script_content || `# FreeCAD Master AI Script — ${result.asset_name || prompt}\n# Generated by DeepSeek R1 + FreeCAD MCP Bridge\n# Standards: ISO 1101 / MIL-STD-1472G\n#\n# Score: ${result.final_score || 'N/A'}/100\n# Iterations: ${result.iterations?.length || 0}\n# Engine: ${result.mcp_connected ? 'FreeCAD MCP Native' : 'FreeCAD AI Engine'}\n#\nimport FreeCAD as App\nimport Part\n\ndoc = App.newDocument("${(result.asset_name || prompt).replace(/[^a-zA-Z0-9]/g, '_')}")\n\n# Script URL: ${result.script_url || 'N/A'}\n# Download the full .py file for FreeCAD Desktop execution.`}
              </pre>
            </div>
            <div style={{ padding: '1.2rem', borderTop: '1px solid var(--outline-variant)', display: 'flex', justifyContent: 'flex-end', gap: '1rem' }}>
              <button className="btn-tactical" onClick={() => setShowScriptModal(false)}>Close</button>
              {result.script_url && (
                <a href={result.script_url} download className="btn-engage" style={{ textDecoration: 'none' }}>
                  Download .py Script
                </a>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
