/**
 * ExplodedProgress — progress overlay for the exploded-assembly pipeline.
 * Phases: Research (5 parts) -> Shell 3D -> Part 3D ×5 -> Assembly build.
 */
import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';

const PHASES = [
  { key: 'research', label: 'Research', icon: 'science', desc: 'DeepSeek-R1 · 5 parts' },
  { key: 'shell', label: 'Outer Shell', icon: 'shield', desc: 'Web Image → 3D' },
  { key: 'part', label: 'Inner Parts', icon: 'category', desc: '5× Image → 3D' },
  { key: 'assembly', label: 'Assembly', icon: 'view_in_ar', desc: 'trimesh normalize' },
];

const PHASE_ORDER = { research: 0, shell: 1, part: 2, assembly: 3, complete: 4, error: -1 };

function getPhaseStatus(phaseKey, currentPhase) {
  const current = PHASE_ORDER[currentPhase] ?? -1;
  const target = PHASE_ORDER[phaseKey] ?? 0;
  if (current > target) return 'complete';
  if (current === target) return 'active';
  return 'pending';
}

export default function ExplodedProgress({ phase, message, components, shellImageUrl, weaponName, isVisible }) {
  if (!isVisible) return null;

  return (
    <div className="gen-progress-overlay">
      <motion.div
        className="gen-progress-title"
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
      >
        IVORY COMMAND — EXPLODED ASSEMBLY PIPELINE
      </motion.div>

      {/* Pipeline phase indicators */}
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

      {/* Live status line */}
      <motion.div
        style={{
          fontFamily: 'var(--font-mono)',
          fontSize: 12,
          letterSpacing: 1,
          color: 'var(--on-surface)',
          marginBottom: 24,
          textAlign: 'center',
          maxWidth: 640,
        }}
        key={message || phase}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
      >
        {phase === 'complete'
          ? '✓ Assembly complete — loading exploded viewer...'
          : `⟐ ${message || 'Working...'}`}
      </motion.div>

      {/* Shell preview */}
      {shellImageUrl && (
        <motion.img
          src={shellImageUrl}
          alt={weaponName}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          style={{
            width: 140, height: 140, objectFit: 'contain',
            borderRadius: 10, border: '1px solid var(--outline-variant)',
            background: 'var(--surface-container-lowest)', marginBottom: 20,
          }}
        />
      )}

      {/* Component cards (the 5 researched parts) */}
      <AnimatePresence>
        {components.length > 0 && (
          <motion.div
            className="gen-components-grid"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2, duration: 0.5 }}
          >
            {components.map((comp, i) => (
              <motion.div
                key={i}
                className={`gen-component-card ${comp.status === 'running' ? 'active' : ''} ${comp.status === 'complete' ? 'complete' : ''}`}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.3 + i * 0.08 }}
              >
                {comp.image_url ? (
                  <img src={comp.image_url} alt={comp.part_name} className="gen-component-thumb" />
                ) : (
                  <div className="gen-component-thumb" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <span className="material-symbols-outlined" style={{ fontSize: 28, color: 'var(--outline-variant)' }}>
                      {comp.status === 'running' ? 'sync' : 'category'}
                    </span>
                  </div>
                )}
                <div className="gen-component-name">{comp.part_name || `Part ${i + 1}`}</div>
                {comp.risk_tier && (
                  <span className={`risk-tier-badge ${(comp.risk_tier || '').toLowerCase()}`} style={{ marginTop: 4 }}>
                    {comp.risk_tier}
                  </span>
                )}
                <div className={`gen-component-status ${comp.status || 'pending'}`}>
                  {(comp.status === 'pending' || !comp.status) && 'QUEUED'}
                  {comp.status === 'running' && 'PROCESSING'}
                  {comp.status === 'complete' && 'READY'}
                  {comp.status === 'failed' && 'FAILED'}
                </div>
              </motion.div>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
