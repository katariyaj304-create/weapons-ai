/**
 * SideNav — STRATCOM left sidebar navigation.
 */
import React from 'react';
import VoiceAgent from './VoiceAgent';

const NAV_ITEMS = [
  { key: 'library', label: 'Library', icon: 'folder_open' },
  { key: 'freecad', label: 'FreeCAD AI Studio', icon: 'precision_manufacturing' },
  { key: 'evolution', label: 'Evolution', icon: 'timeline' },
  { key: 'materials', label: 'Materials', icon: 'science' },
  { key: 'live-ops', label: 'Live Ops', icon: 'sensors' },
  { key: 'news', label: 'Field News', icon: 'feed' },
  { key: 'stack', label: 'Tech Stack', icon: 'hub' },
  { key: 'archive', label: 'Archive', icon: 'inventory_2' },
];

const FOOTER_ITEMS = [
  { key: 'support', label: 'Support', icon: 'help_outline' },
  { key: 'logout', label: 'Logout', icon: 'logout' },
];

export default function SideNav({ activeItem = 'library', onItemClick }) {
  return (
    <aside className="sidenav" id="sidenav">
      <div className="sidenav-header">
        <h2 className="sidenav-title">STRATCOM</h2>
        <p className="sidenav-subtitle">Sector 7G</p>
      </div>

      <nav className="sidenav-links">
        {NAV_ITEMS.map((item) => (
          <button
            key={item.key}
            className={`sidenav-link ${activeItem === item.key ? 'active' : ''}`}
            onClick={() => onItemClick?.(item.key)}
            id={`sidenav-${item.key}`}
          >
            <span
              className="material-symbols-outlined"
              style={
                activeItem === item.key
                  ? { fontVariationSettings: "'FILL' 1, 'wght' 400, 'GRAD' 0, 'opsz' 24" }
                  : undefined
              }
            >
              {item.icon}
            </span>
            <span>{item.label}</span>
          </button>
        ))}
      </nav>

      <div style={{ marginTop: 'auto' }}>
        <VoiceAgent />
      </div>

      <div className="sidenav-footer">
        {FOOTER_ITEMS.map((item) => (
          <button
            key={item.key}
            className="sidenav-link"
            onClick={() => onItemClick?.(item.key)}
            id={`sidenav-${item.key}`}
          >
            <span className="material-symbols-outlined">{item.icon}</span>
            <span>{item.label}</span>
          </button>
        ))}
      </div>
    </aside>
  );
}
