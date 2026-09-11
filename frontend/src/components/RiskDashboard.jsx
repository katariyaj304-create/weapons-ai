/**
 * RiskDashboard — Supply chain risk analysis panel.
 * Shows risk bars, overall score, and material dependencies.
 */
import React, { useState, useEffect } from 'react';
import { motion } from 'framer-motion';

const RISK_COLORS = {
  CRITICAL: '#ff2d55',
  ELEVATED: '#ff9500',
  STABLE: '#30d158',
};

function getRiskColor(tier) {
  return RISK_COLORS[(tier || '').toUpperCase()] || '#0088ff';
}

function getOverallTier(score) {
  if (score >= 70) return 'CRITICAL';
  if (score >= 40) return 'ELEVATED';
  return 'STABLE';
}

function AnimatedCounter({ target, duration = 1.5 }) {
  const [count, setCount] = useState(0);

  useEffect(() => {
    let start = 0;
    const end = target;
    const stepTime = (duration * 1000) / end;
    const timer = setInterval(() => {
      start += 1;
      setCount(start);
      if (start >= end) clearInterval(timer);
    }, stepTime);
    return () => clearInterval(timer);
  }, [target, duration]);

  return <>{count}</>;
}

export default function RiskDashboard({ components }) {
  if (!components || components.length === 0) {
    return (
      <div className="empty-state">
        <div className="empty-icon">
          <span className="material-symbols-outlined" style={{ fontSize: 48, color: 'var(--outline-variant)' }}>
            shield
          </span>
        </div>
        <p className="tactical-text">
          [ NO RISK DATA ]<br />
          Generate an asset to view supply chain analysis.
        </p>
      </div>
    );
  }

  const validComponents = components.filter(c => c.risk_score !== undefined);
  const overallRisk = validComponents.length > 0
    ? Math.round(validComponents.reduce((sum, c) => sum + (c.risk_score || 0), 0) / validComponents.length)
    : 0;
  const overallTier = getOverallTier(overallRisk);
  const overallColor = getRiskColor(overallTier);

  return (
    <div className="risk-dashboard">
      {/* Overall Risk Score */}
      <motion.div
        className="risk-overall"
        initial={{ opacity: 0, scale: 0.9 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.5 }}
      >
        <div className="risk-overall-score" style={{ color: overallColor }}>
          <AnimatedCounter target={overallRisk} />
        </div>
        <div className="risk-overall-label">OVERALL SUPPLY CHAIN RISK</div>
        <span
          className={`risk-tier-badge ${overallTier.toLowerCase()}`}
          style={{ marginTop: 8, display: 'inline-block' }}
        >
          {overallTier}
        </span>
      </motion.div>

      {/* Individual Component Risk Bars */}
      <div className="risk-bars">
        {validComponents.map((comp, i) => {
          const color = getRiskColor(comp.risk_tier);
          return (
            <motion.div
              key={i}
              className="risk-bar-row"
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: 0.2 + i * 0.1, duration: 0.4 }}
            >
              <div className="risk-bar-header">
                <span className="risk-bar-name">{comp.part_name}</span>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span className={`risk-tier-badge ${(comp.risk_tier || '').toLowerCase()}`}>
                    {comp.risk_tier}
                  </span>
                  <span className="risk-bar-score" style={{ color }}>
                    {comp.risk_score}
                  </span>
                </div>
              </div>
              <div className="risk-bar-track">
                <motion.div
                  className="risk-bar-fill"
                  style={{ background: color }}
                  initial={{ width: 0 }}
                  animate={{ width: `${comp.risk_score}%` }}
                  transition={{ delay: 0.4 + i * 0.1, duration: 0.8, ease: 'easeOut' }}
                />
              </div>
              <div className="risk-bar-material">
                Material: {comp.material_dependency}
              </div>
            </motion.div>
          );
        })}
      </div>
    </div>
  );
}
