/**
 * Direct3DProgress — progress overlay for the direct name -> image -> 3D pipeline.
 * Shows 3 phases (Find Image -> Preprocess -> Generate) with a live image preview.
 */
import React from 'react';
import { motion } from 'framer-motion';

const PHASES = [
  { key: 'search', label: 'Find Image', icon: 'travel_explore', desc: 'Best Web Match' },
  { key: 'preprocess', label: 'Preprocess', icon: 'auto_fix_high', desc: 'BG Removal + Normalize' },
  { key: 'model', label: '3D Generation', icon: 'view_in_ar', desc: 'Hunyuan3D-2.1' },
];

const PHASE_ORDER = { search: 0, preprocess: 1, model: 2, complete: 3, error: -1 };

function getPhaseStatus(phaseKey, currentPhase) {
  const current = PHASE_ORDER[currentPhase] ?? -1;
  const target = PHASE_ORDER[phaseKey] ?? 0;
  if (current > target) return 'complete';
  if (current === target) return 'active';
  return 'pending';
}

export default function Direct3DProgress({ phase, sourceImageUrl, preprocessedImageUrl, weaponName, isVisible }) {
  if (!isVisible) return null;

  const previewImage = preprocessedImageUrl || sourceImageUrl;

  return (
    <div className="gen-progress-overlay">
      <motion.div
        className="gen-progress-title"
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
      >
        IVORY COMMAND — DIRECT 3D MODEL GENERATOR
      </motion.div>

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
        {phase === 'search' && `⟐ Searching the web for the best reference photo of ${weaponName}...`}
        {phase === 'preprocess' && '⟐ Removing background and normalizing the image...'}
        {phase === 'model' && '⟐ Generating textured 3D model with Hunyuan3D-2.1 (this can take a few minutes)...'}
        {phase === 'complete' && '✓ Model ready — loading viewer...'}
      </motion.div>

      {previewImage && (
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.3, duration: 0.5 }}
          style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}
        >
          <img
            src={previewImage}
            alt={weaponName}
            style={{
              width: 220,
              height: 220,
              objectFit: 'contain',
              borderRadius: 12,
              border: '1px solid var(--outline-variant)',
              background: 'var(--surface-container-lowest)',
            }}
          />
          <div style={{
            fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--outline)',
            textTransform: 'uppercase', letterSpacing: 0.5,
          }}>
            {preprocessedImageUrl ? 'Preprocessed Reference' : 'Source Reference'}
          </div>
        </motion.div>
      )}
    </div>
  );
}
