/**
 * ResearchPanel — Ivory Command light-theme intelligence sections.
 */
import React from 'react';
import { motion } from 'framer-motion';

export default function ResearchPanel({ data }) {
  if (!data) {
    return (
      <div className="empty-state">
        <div className="empty-icon">
          <span className="material-symbols-outlined" style={{ fontSize: 48, color: 'var(--outline-variant)' }}>satellite_alt</span>
        </div>
        <p className="tactical-text">
          [ AWAITING INTELLIGENCE LINK ]<br />
          Initialize AI analysis to retrieve classified specs.
        </p>
      </div>
    );
  }

  const sections = [
    { key: 'history', title: 'History & Evolution', icon: 'history_edu', content: data.history },
    { key: 'materials', title: 'Materials & Construction', icon: 'construction', content: data.materials },
    { key: 'functionality', title: 'How It Works', icon: 'settings', content: data.functionality },
    { key: 'general_info', title: 'Key Information', icon: 'info', content: data.general_info },
  ];

  return (
    <div style={{ padding: '0' }}>
      {sections.map((section, index) => (
        <motion.div
          key={section.key}
          className="research-section"
          initial={{ opacity: 0, y: 15 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: index * 0.1, duration: 0.4 }}
        >
          <h3 className="research-title">
            <span className="material-symbols-outlined" style={{ fontSize: 16 }}>{section.icon}</span>
            {section.title}
          </h3>
          <div className="research-content">
            {section.content || 'Data not available.'}
          </div>
        </motion.div>
      ))}
    </div>
  );
}
