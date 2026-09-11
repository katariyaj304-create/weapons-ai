/**
 * AssetLibraryPanel — connect the free Sketchfab asset library.
 *
 * With a token set, "Generate Assembly" first searches Sketchfab's free
 * CC-licensed downloadable models: a library hit delivers artist-made,
 * fully textured modular-kit quality for the requested weapon instantly;
 * the AI pipeline only runs when no suitable asset exists.
 * Token: sketchfab.com -> Settings -> Password & API -> API token (free account).
 */
import React, { useState, useEffect, useCallback } from 'react';

const API_BASE = '/api';

const STATUS_META = {
  checking:  { label: 'CHECKING…', color: '#b8860b', bg: 'rgba(184,134,11,0.10)' },
  connected: { label: 'CONNECTED', color: '#1a7f37', bg: 'rgba(26,127,55,0.10)' },
  offline:   { label: 'INVALID',   color: '#c62828', bg: 'rgba(198,40,40,0.10)' },
  unset:     { label: 'NOT SET',   color: '#888888', bg: 'rgba(136,136,136,0.10)' },
};

export default function AssetLibraryPanel() {
  const [token, setToken] = useState('');
  const [status, setStatus] = useState('checking');
  const [message, setMessage] = useState('');
  const [saving, setSaving] = useState(false);

  const refresh = useCallback(async () => {
    setStatus('checking');
    try {
      const res = await fetch(`${API_BASE}/settings/sketchfab-token?probe=true`);
      const data = await res.json();
      if (!data.configured) {
        setStatus('unset');
        setMessage('No library token — weapons are AI-generated. Add a free Sketchfab API token to use artist-made kit models.');
      } else if (data.probe?.ok) {
        setStatus('connected');
        setMessage(`Asset library connected (account: ${data.probe.username}). Library models are used automatically when available.`);
      } else {
        setStatus('offline');
        setMessage(data.probe?.error || 'Saved token no longer valid — paste a fresh one.');
      }
    } catch {
      setStatus('offline');
      setMessage('Backend unreachable — is the API server running?');
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const save = useCallback(async () => {
    setSaving(true);
    setStatus('checking');
    setMessage('Validating token with Sketchfab…');
    try {
      const res = await fetch(`${API_BASE}/settings/sketchfab-token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: token.trim() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || 'Save failed');
      setStatus(data.configured ? 'connected' : 'unset');
      setMessage(data.message);
      setToken('');
    } catch (err) {
      setStatus('offline');
      setMessage(String(err.message || err));
    } finally {
      setSaving(false);
    }
  }, [token]);

  const meta = STATUS_META[status] || STATUS_META.unset;

  return (
    <div
      style={{
        border: '1px solid var(--outline-variant, #d0d0d0)',
        borderRadius: 12,
        padding: '14px 18px',
        background: 'var(--surface-container-lowest, #fff)',
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
      }}
      id="asset-library-panel"
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <span className="material-symbols-outlined" style={{ fontSize: 18, color: 'var(--outline, #888)' }}>
          inventory_2
        </span>
        <span style={{
          fontFamily: 'var(--font-mono, monospace)', fontSize: 11, letterSpacing: 2,
          textTransform: 'uppercase', color: 'var(--on-surface, #222)', fontWeight: 600,
        }}>
          3D Asset Library
        </span>
        <span style={{
          fontFamily: 'var(--font-mono, monospace)', fontSize: 9, letterSpacing: 1.5,
          padding: '3px 10px', borderRadius: 999,
          color: meta.color, background: meta.bg, border: `1px solid ${meta.color}33`,
          display: 'inline-flex', alignItems: 'center', gap: 5,
        }} id="asset-library-status">
          <span style={{ width: 6, height: 6, borderRadius: '50%', background: meta.color }} />
          {meta.label}
        </span>
        <button
          onClick={refresh}
          disabled={saving || status === 'checking'}
          title="Re-check token"
          style={{
            marginLeft: 'auto', border: 'none', background: 'transparent', cursor: 'pointer',
            color: 'var(--outline, #888)', display: 'flex', alignItems: 'center', padding: 2,
          }}
        >
          <span className="material-symbols-outlined" style={{ fontSize: 16 }}>refresh</span>
        </button>
      </div>

      <div style={{ display: 'flex', gap: 8 }}>
        <input
          type="password"
          value={token}
          onChange={(e) => setToken(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && token.trim() && !saving && save()}
          placeholder="Paste your Sketchfab API token (free: Settings → Password & API)"
          spellCheck={false}
          autoComplete="off"
          style={{
            flex: 1, padding: '8px 12px', borderRadius: 8,
            border: '1px solid var(--outline-variant, #d0d0d0)',
            fontFamily: 'var(--font-mono, monospace)', fontSize: 11,
            color: 'var(--on-surface, #222)', background: 'var(--surface, #fafafa)',
            outline: 'none',
          }}
          id="asset-library-input"
        />
        <button
          onClick={save}
          disabled={saving || !token.trim()}
          style={{
            padding: '8px 16px', borderRadius: 8, border: 'none',
            cursor: token.trim() ? 'pointer' : 'default',
            background: token.trim() ? 'var(--primary, #0066ff)' : 'var(--outline-variant, #d0d0d0)',
            color: '#fff', fontFamily: 'var(--font-mono, monospace)', fontSize: 10,
            letterSpacing: 1.5, textTransform: 'uppercase',
            display: 'flex', alignItems: 'center', gap: 6,
          }}
          id="asset-library-save"
        >
          <span className="material-symbols-outlined" style={{ fontSize: 15 }}>
            {saving ? 'sync' : 'key'}
          </span>
          {saving ? 'Validating…' : 'Connect'}
        </button>
      </div>

      {message && (
        <div style={{
          fontFamily: 'var(--font-mono, monospace)', fontSize: 10,
          color: status === 'offline' ? '#c62828' : 'var(--outline, #888)',
          lineHeight: 1.5,
        }} id="asset-library-message">
          {message}
        </div>
      )}
    </div>
  );
}
