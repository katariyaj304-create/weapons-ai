/**
 * BOMTable — Bill of Materials table with thumbnails, risk badges, and sort.
 */
import React, { useState } from 'react';
import { motion } from 'framer-motion';

const RISK_COLORS = {
  CRITICAL: '#ff2d55',
  ELEVATED: '#ff9500',
  STABLE: '#30d158',
};

export default function BOMTable({ components, activeComponent, onComponentClick }) {
  const [sortBy, setSortBy] = useState(null);
  const [sortDir, setSortDir] = useState('desc');

  if (!components || components.length === 0) {
    return (
      <div className="empty-state">
        <div className="empty-icon">
          <span className="material-symbols-outlined" style={{ fontSize: 48, color: 'var(--outline-variant)' }}>
            table_chart
          </span>
        </div>
        <p className="tactical-text">
          [ NO BOM DATA ]<br />
          Generate an asset to view the Bill of Materials.
        </p>
      </div>
    );
  }

  const handleSort = (column) => {
    if (sortBy === column) {
      setSortDir(prev => prev === 'asc' ? 'desc' : 'asc');
    } else {
      setSortBy(column);
      setSortDir('desc');
    }
  };

  let sorted = [...components];
  if (sortBy === 'risk_score') {
    sorted.sort((a, b) => sortDir === 'desc' ? (b.risk_score || 0) - (a.risk_score || 0) : (a.risk_score || 0) - (b.risk_score || 0));
  } else if (sortBy === 'name') {
    sorted.sort((a, b) => sortDir === 'desc' ? (b.part_name || '').localeCompare(a.part_name || '') : (a.part_name || '').localeCompare(b.part_name || ''));
  }

  const getStatusLabel = (comp) => {
    if (comp.model_status === 'complete') return 'READY';
    if (comp.model_status === 'running') return 'PROCESSING';
    if (comp.image_status === 'complete') return 'IMAGE DONE';
    if (comp.image_status === 'running') return 'IMAGING';
    return 'QUEUED';
  };

  return (
    <div className="bom-table-container">
      <table className="bom-table">
        <thead>
          <tr>
            <th style={{ width: 30 }}>#</th>
            <th onClick={() => handleSort('name')} style={{ cursor: 'pointer' }}>
              Part Name {sortBy === 'name' && (sortDir === 'asc' ? '↑' : '↓')}
            </th>
            <th>Material</th>
            <th onClick={() => handleSort('risk_score')} style={{ cursor: 'pointer' }}>
              Risk {sortBy === 'risk_score' && (sortDir === 'asc' ? '↑' : '↓')}
            </th>
            <th>Image</th>
            <th>3D Model</th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((comp, i) => {
            const isActive = activeComponent?.part_name === comp.part_name;
            const tierColor = RISK_COLORS[(comp.risk_tier || '').toUpperCase()] || '#999';

            return (
              <motion.tr
                key={i}
                className={isActive ? 'active' : ''}
                onClick={() => onComponentClick?.(isActive ? null : comp)}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.05 }}
                style={{ cursor: 'pointer' }}
              >
                <td style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--outline)' }}>
                  {String(i + 1).padStart(2, '0')}
                </td>
                <td style={{ fontWeight: 600, fontSize: 12 }}>
                  {(comp.part_name || '').toUpperCase()}
                </td>
                <td style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--outline)' }}>
                  {comp.material_dependency}
                </td>
                <td>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, fontWeight: 700, color: tierColor }}>
                      {comp.risk_score}
                    </span>
                    <span className={`risk-tier-badge ${(comp.risk_tier || '').toLowerCase()}`}>
                      {comp.risk_tier}
                    </span>
                  </div>
                </td>
                <td>
                  {comp.image_url ? (
                    <img src={comp.image_url} alt="" className="bom-thumb" />
                  ) : (
                    <div className="bom-thumb" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      <span className="material-symbols-outlined" style={{ fontSize: 16, color: 'var(--outline-variant)' }}>
                        {comp.image_status === 'running' ? 'sync' : 'image'}
                      </span>
                    </div>
                  )}
                </td>
                <td>
                  {comp.glb_url ? (
                    <span className="bom-model-badge" style={{ background: comp.model_source === 'trellis' ? 'rgba(0, 136, 255, 0.1)' : 'rgba(255, 149, 0, 0.1)' }}>
                      {comp.model_source?.toUpperCase() || '3D'}
                    </span>
                  ) : (
                    <span style={{ fontFamily: 'var(--font-mono)', fontSize: 9, color: 'var(--outline)', letterSpacing: 1 }}>
                      {getStatusLabel(comp)}
                    </span>
                  )}
                </td>
              </motion.tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
