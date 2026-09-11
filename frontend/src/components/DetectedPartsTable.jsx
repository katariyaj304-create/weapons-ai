/**
 * DetectedPartsTable — deterministic component sheet for the exploded view.
 * Every row comes straight from the model file's geometry (labels from node/
 * material names, triangle counts, measured dimensions). No AI involved.
 */
import React from 'react';
import { motion } from 'framer-motion';

const fmtFaces = (n) => (n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n));
const fmtDims = (d) =>
  d ? d.map((v) => (v >= 10 ? Math.round(v) : v.toFixed(2))).join(' × ') : '—';

export default function DetectedPartsTable({ parts }) {
  if (!parts || parts.length === 0) {
    return (
      <div className="empty-state">
        <div className="empty-icon">
          <span className="material-symbols-outlined" style={{ fontSize: 48, color: 'var(--outline-variant)' }}>
            deployed_code
          </span>
        </div>
        <p className="tactical-text">
          [ ANALYZING GEOMETRY ]<br />
          Component sheet appears once the assembly loads.
        </p>
      </div>
    );
  }

  return (
    <div className="bom-table-container">
      <div style={{
        fontFamily: 'var(--font-mono)', fontSize: 9, letterSpacing: 1.5,
        textTransform: 'uppercase', color: 'var(--outline, #888)',
        padding: '10px 2px 8px',
      }}>
        {parts.length} components — measured from model geometry
      </div>
      <table className="bom-table">
        <thead>
          <tr>
            <th style={{ width: 30 }}>#</th>
            <th>Part</th>
            <th>Triangles</th>
            <th>Size (rel.)</th>
          </tr>
        </thead>
        <tbody>
          {parts.map((p, i) => (
            <motion.tr
              key={p.key || i}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: Math.min(i * 0.03, 0.6) }}
            >
              <td style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--outline)' }}>
                {p.isShell ? 'S' : String((p.slot ?? p.index + 1)).padStart(2, '0')}
              </td>
              <td style={{ fontWeight: 600, fontSize: 12 }}>
                {(p.label || 'Part').toUpperCase()}
              </td>
              <td style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--outline)' }}>
                {fmtFaces(p.faces || 0)}
              </td>
              <td style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--outline)' }}>
                {fmtDims(p.dims)}
              </td>
            </motion.tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
