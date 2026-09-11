/**
 * TopNav — Ivory Command top navigation bar.
 */
import React from 'react';

const NAV_SECTIONS = ['Intelligence', 'Assets', 'Deployment', 'Tactical'];

export default function TopNav({ activeSection = 'Assets', onSectionChange, onBrandClick }) {
  return (
    <header className="topnav" id="topnav">
      <div className="topnav-left">
        <span
          className="topnav-brand"
          onClick={onBrandClick}
          role="button"
          tabIndex={0}
        >
          IVORY COMMAND
        </span>
        <nav className="topnav-links">
          {NAV_SECTIONS.map((section) => (
            <button
              key={section}
              className={`topnav-link ${activeSection === section ? 'active' : ''}`}
              onClick={() => onSectionChange?.(section)}
              id={`nav-${section.toLowerCase()}`}
            >
              {section}
            </button>
          ))}
        </nav>
      </div>
      <div className="topnav-right">
        <button className="topnav-icon-btn" aria-label="Notifications" id="btn-notifications">
          <span className="material-symbols-outlined">notifications</span>
        </button>
        <button className="topnav-icon-btn" aria-label="Settings" id="btn-settings">
          <span className="material-symbols-outlined">settings</span>
        </button>
        <div className="topnav-avatar" id="user-avatar">
          <span className="material-symbols-outlined" style={{ fontSize: 18 }}>person</span>
        </div>
      </div>
    </header>
  );
}
