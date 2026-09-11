/**
 * GenerationProgress — Real-time pipeline progress overlay.
 * Shows 3 phases (BOM → Image → 3D) with per-component status cards.
 */
import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';

const PHASES = [
  { key: 'bom', label: 'BOM Analysis', icon: 'analytics', desc: 'DeepSeek-R1' },
  { key: 'image', label: 'Image Gen', icon: 'image', desc: 'FLUX.1-dev' },
  { key: 'model', label: '3D Conversion', icon: 'view_in_ar', desc: 'TRELLIS.2' },
];

const PHASE_ORDER = { bom: 0, image: 1, model: 2, complete: 3, error: -1 };

function getPhaseStatus(phaseKey, currentPhase) {
  const current = PHASE_ORDER[currentPhase] ?? -1;
  const target = PHASE_ORDER[phaseKey] ?? 0;
  if (current > target) return 'complete';
  if (current === target) return 'active';
  return 'pending';
}

function getComponentStatus(component, currentPhase) {
  if (currentPhase === 'complete') return 'complete';
  if (component?.model_status === 'complete') return 'complete';
  if (component?.model_status === 'running') return 'running';
  if (component?.image_status === 'complete' && currentPhase === 'model') return 'waiting';
  if (component?.image_status === 'running') return 'running';
  if (component?.image_status === 'complete') return 'complete';
  return 'pending';
}

export default function GenerationProgress({ phase, components, currentComponent, bomData, isVisible }) {
  if (!isVisible) return null;

  return (
    <div className="gen-progress-overlay">
      <motion.div
        className="gen-progress-title"
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
      >
        IVORY COMMAND — ASSET GENERATION PIPELINE
      </motion.div>

      {/* Pipeline Phase Indicators */}
      <motion.div
        className="gen-pipeline-phases"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.2, duration: 0.5 }}
      >
        {PHASES.map((p, idx) => {
          const status = getPhaseStatus(p.key, phase);
          return (
            <React.Fragment key={p.key}>
              <div className="gen-phase">
                <motion.div
                  className={`gen-phase-icon ${status}`}
                  initial={{ scale: 0.8 }}
                  animate={{ scale: 1 }}
                  transition={{ delay: idx * 0.15, type: 'spring' }}
                >
                  <span className="material-symbols-outlined" style={{ fontSize: 24 }}>
                    {status === 'complete' ? 'check' : p.icon}
                  </span>
                </motion.div>
                <div className={`gen-phase-label ${status}`}>
                  {p.label}
                  <div style={{ fontSize: 8, opacity: 0.6, marginTop: 2 }}>{p.desc}</div>
                </div>
              </div>
              {idx < PHASES.length - 1 && (
                <div className={`gen-phase-connector ${status === 'complete' ? 'complete' : status === 'active' ? 'active' : ''}`} />
              )}
            </React.Fragment>
          );
        })}
      </motion.div>

      {/* Current Phase Message */}
      <motion.div
        style={{
          fontFamily: 'var(--font-mono)',
          fontSize: 12,
          letterSpacing: 1,
          color: 'var(--on-surface)',
          marginBottom: 32,
          textAlign: 'center',
        }}
        key={phase}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
      >
        {phase === 'bom' && '⟐ Deconstructing asset into 5-part Bill of Materials...'}
        {phase === 'image' && `⟐ Generating orthographic views... (${components.filter(c => c?.image_status === 'complete').length}/${components.length})`}
        {phase === 'model' && `⟐ Converting to 3D models... (${components.filter(c => c?.model_status === 'complete').length}/${components.length})`}
        {phase === 'complete' && '✓ Pipeline complete — Loading viewer...'}
      </motion.div>

      {/* Component Cards */}
      <AnimatePresence>
        {components.length > 0 && (
          <motion.div
            className="gen-components-grid"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.3, duration: 0.5 }}
          >
            {components.map((comp, i) => {
              const status = getComponentStatus(comp, phase);
              return (
                <motion.div
                  key={i}
                  className={`gen-component-card ${status === 'running' ? 'active' : ''} ${status === 'complete' ? 'complete' : ''}`}
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.4 + i * 0.08 }}
                >
                  {comp.image_url ? (
                    <img
                      src={comp.image_url}
                      alt={comp.part_name}
                      className="gen-component-thumb"
                    />
                  ) : (
                    <div className="gen-component-thumb" style={{
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                    }}>
                      <span className="material-symbols-outlined" style={{ fontSize: 28, color: 'var(--outline-variant)' }}>
                        {status === 'running' ? 'sync' : 'image'}
                      </span>
                    </div>
                  )}
                  <div className="gen-component-name">{comp.part_name || `Component ${i + 1}`}</div>
                  {comp.risk_tier && (
                    <span className={`risk-tier-badge ${(comp.risk_tier || '').toLowerCase()}`} style={{ marginTop: 4 }}>
                      {comp.risk_tier}
                    </span>
                  )}
                  <div className={`gen-component-status ${status}`}>
                    {status === 'pending' && 'QUEUED'}
                    {status === 'running' && 'PROCESSING'}
                    {status === 'complete' && 'READY'}
                    {status === 'waiting' && 'WAITING'}
                    {status === 'failed' && 'FAILED'}
                  </div>
                </motion.div>
              );
            })}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
