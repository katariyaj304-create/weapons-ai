/**
 * LoadingOverlay — Ivory Command light-theme loading state.
 */
import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';

const PHASES = [
  { key: 'validate', label: 'Validating' },
  { key: 'search', label: 'Web Search' },
  { key: 'research', label: 'AI Research' },
  { key: 'mapping', label: '3D Mapping' },
];

export default function LoadingOverlay({ visible, phase }) {
  const getStepState = (stepKey) => {
    const phaseIndex = getPhaseIndex(phase);
    const stepIndex = PHASES.findIndex(p => p.key === stepKey);
    if (stepIndex < phaseIndex) return 'done';
    if (stepIndex === phaseIndex) return 'active';
    return '';
  };

  const getPhaseIndex = (p) => {
    if (!p) return 0;
    const lower = p.toLowerCase();
    if (lower.includes('validat')) return 0;
    if (lower.includes('search')) return 1;
    if (lower.includes('research') || lower.includes('ai')) return 2;
    if (lower.includes('map') || lower.includes('complete')) return 3;
    return 0;
  };

  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          className="loading-overlay"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.4 }}
        >
          {/* Spinner */}
          <div className="loading-spinner">
            <div className="ring" />
            <div className="ring" />
            <div className="ring" />
            <div className="core" />
          </div>

          <div className="loading-text">AI Agent Working...</div>
          <div className="loading-status">{phase || 'Initializing...'}</div>

          {/* Progress steps */}
          <div className="loading-steps">
            {PHASES.map((step) => (
              <div
                key={step.key}
                className={`loading-step ${getStepState(step.key)}`}
              >
                <span className="step-dot" />
                {step.label}
              </div>
            ))}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
