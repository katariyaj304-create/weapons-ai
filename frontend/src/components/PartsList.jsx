/**
 * PartsList — Ivory Command diagnostic status cards.
 * Matches the reference AI Analysis panel with health bars and status badges.
 */
import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';

// Map colors / categories to status types
function getStatus(part) {
  const cat = (part.category || '').toLowerCase();
  const color = (part.color || '').toLowerCase();

  if (color.includes('ff3366') || color.includes('ff4444') || cat.includes('propulsion') || cat.includes('power')) {
    return { label: 'Critical', type: 'critical', health: 22 };
  }
  if (color.includes('00ff88') || color.includes('00ffff') || cat.includes('sensor') || cat.includes('electronic')) {
    return { label: 'Optimal', type: 'optimal', health: 98 };
  }
  return { label: 'Stable', type: 'stable', health: 70 + Math.floor(Math.random() * 20) };
}

// Generate a serial-like ID
function getSerial(part, index) {
  const prefix = (part.part_name || 'CMP').substring(0, 2).toUpperCase();
  const num = String(index * 11 + 44).padStart(2, '0');
  const suffix = String.fromCharCode(65 + index);
  return `#${prefix}-${num}${suffix}`;
}

export default function PartsList({ parts, activePart, onPartClick }) {
  if (!parts || parts.length === 0) {
    return (
      <div className="empty-state">
        <div className="empty-icon">
          <span className="material-symbols-outlined" style={{ fontSize: 48, color: 'var(--outline-variant)' }}>sensors_off</span>
        </div>
        <p className="tactical-text">
          [ NO TARGET DATA ]<br />
          Click "Run Full Intelligence Sweep" to scan the asset.
        </p>
      </div>
    );
  }

  const formatName = (name) => {
    return (name || 'UNKNOWN_PART')
      .replace(/[_-\s]+/g, ' ')
      .trim()
      .toUpperCase();
  };

  return (
    <div className="parts-list">
      <AnimatePresence>
        {parts.map((part, index) => {
          const isActive = activePart?.mesh_id === part.mesh_id;
          const status = getStatus(part);
          const serial = getSerial(part, index);
          const displayName = formatName(part.part_name);

          return (
            <motion.div
              key={part.mesh_id + index}
              className={`part-card ${isActive ? 'active' : ''}`}
              onClick={() => onPartClick(part)}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              transition={{ delay: index * 0.05, duration: 0.3 }}
            >
              <div className="part-card-header">
                <div>
                  <div className="part-name">{displayName}</div>
                  <div className="part-serial">SERIAL: {serial}</div>
                </div>
                <span className={`part-status-badge part-status-${status.type}`}>
                  {status.label}
                </span>
              </div>
              <div className="part-health-bar">
                <div
                  className={`part-health-fill health-${status.type}`}
                  style={{ width: `${status.health}%` }}
                />
              </div>
              <div className="part-description">{part.description}</div>
            </motion.div>
          );
        })}
      </AnimatePresence>
    </div>
  );
}
