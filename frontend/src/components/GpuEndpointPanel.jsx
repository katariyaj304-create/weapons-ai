/**
 * GpuEndpointPanel — paste / verify the Kaggle GPU endpoint from inside the app.
 *
 * The Kaggle notebook prints an ephemeral https://….gradio.live URL each run;
 * this panel lets the user paste it here instead of editing backend/.env.
 * Saving live-probes the Gradio app for /generate_3d, applies it to the running
 * backend immediately, and persists it for future restarts.
 */
import React, { useState, useEffect, useCallback } from 'react';

const API_BASE = '/api';

const STATUS_META = {
  checking:  { label: 'CHECKING…',  color: '#b8860b', bg: 'rgba(184,134,11,0.10)' },
  connected: { label: 'CONNECTED',  color: '#1a7f37', bg: 'rgba(26,127,55,0.10)' },
  offline:   { label: 'OFFLINE',    color: '#c62828', bg: 'rgba(198,40,40,0.10)' },
  unset:     { label: 'NOT SET',    color: '#888888', bg: 'rgba(136,136,136,0.10)' },
};

export default function GpuEndpointPanel() {
  const [url, setUrl] = useState('');
  const [savedUrl, setSavedUrl] = useState('');
  const [status, setStatus] = useState('checking');
  const [message, setMessage] = useState('');
  const [saving, setSaving] = useState(false);

  const refresh = useCallback(async () => {
    setStatus('checking');
    setMessage('');
    try {
      const res = await fetch(`${API_BASE}/settings/kaggle-endpoint?probe=true`);
      const data = await res.json();
      setSavedUrl(data.url || '');
      setUrl(data.url || '');
      if (!data.configured) {
        setStatus('unset');
        setMessage('No GPU endpoint set — generation falls back to HF Spaces (slow, quota-limited).');
      } else if (data.probe?.ok) {
        setStatus('connected');
        setMessage(`Kaggle Hunyuan3D-2 endpoint live (${data.probe.latency_s}s ping).`);
      } else {
        setStatus('offline');
        setMessage(data.probe?.error || 'Endpoint unreachable — the gradio.live URL expires when the Kaggle notebook stops. Re-run the notebook and paste the new URL.');
      }
    } catch {
      setStatus('offline');
      setMessage('Backend unreachable — is the API server running on port 8000?');
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const save = useCallback(async () => {
    setSaving(true);
    setStatus('checking');
    setMessage('Verifying endpoint…');
    try {
      const res = await fetch(`${API_BASE}/settings/kaggle-endpoint`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: url.trim() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || 'Save failed');
      setSavedUrl(data.url);
      setStatus(data.configured ? 'connected' : 'unset');
      setMessage(data.message);
    } catch (err) {
      setStatus('offline');
      setMessage(String(err.message || err));
    } finally {
      setSaving(false);
    }
  }, [url]);

  const meta = STATUS_META[status] || STATUS_META.unset;
  const dirty = url.trim().replace(/\/+$/, '') !== savedUrl;

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
      id="gpu-endpoint-panel"
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <span className="material-symbols-outlined" style={{ fontSize: 18, color: 'var(--outline, #888)' }}>
          memory
        </span>
        <span style={{
          fontFamily: 'var(--font-mono, monospace)', fontSize: 11, letterSpacing: 2,
          textTransform: 'uppercase', color: 'var(--on-surface, #222)', fontWeight: 600,
        }}>
          Kaggle GPU Endpoint
        </span>
        <span style={{
          fontFamily: 'var(--font-mono, monospace)', fontSize: 9, letterSpacing: 1.5,
          padding: '3px 10px', borderRadius: 999,
          color: meta.color, background: meta.bg, border: `1px solid ${meta.color}33`,
          display: 'inline-flex', alignItems: 'center', gap: 5,
        }} id="gpu-endpoint-status">
          <span style={{
            width: 6, height: 6, borderRadius: '50%', background: meta.color,
            animation: status === 'checking' ? 'pulse 1s infinite' : 'none',
          }} />
          {meta.label}
        </span>
        <button
          onClick={refresh}
          disabled={saving || status === 'checking'}
          title="Re-check endpoint"
          style={{
            marginLeft: 'auto', border: 'none', background: 'transparent', cursor: 'pointer',
            color: 'var(--outline, #888)', display: 'flex', alignItems: 'center', padding: 2,
          }}
          id="gpu-endpoint-refresh"
        >
          <span className="material-symbols-outlined" style={{ fontSize: 16 }}>refresh</span>
        </button>
      </div>

      <div style={{ display: 'flex', gap: 8 }}>
        <input
          type="text"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && dirty && !saving && save()}
          placeholder="Paste the https://…gradio.live URL printed by the Kaggle notebook"
          spellCheck={false}
          style={{
            flex: 1, padding: '8px 12px', borderRadius: 8,
            border: '1px solid var(--outline-variant, #d0d0d0)',
            fontFamily: 'var(--font-mono, monospace)', fontSize: 11,
            color: 'var(--on-surface, #222)', background: 'var(--surface, #fafafa)',
            outline: 'none',
          }}
          id="gpu-endpoint-input"
        />
        <button
          onClick={save}
          disabled={saving || !dirty}
          style={{
            padding: '8px 16px', borderRadius: 8, border: 'none', cursor: dirty ? 'pointer' : 'default',
            background: dirty ? 'var(--primary, #0066ff)' : 'var(--outline-variant, #d0d0d0)',
            color: '#fff', fontFamily: 'var(--font-mono, monospace)', fontSize: 10,
            letterSpacing: 1.5, textTransform: 'uppercase',
            display: 'flex', alignItems: 'center', gap: 6,
          }}
          id="gpu-endpoint-save"
        >
          <span className="material-symbols-outlined" style={{ fontSize: 15 }}>
            {saving ? 'sync' : 'link'}
          </span>
          {saving ? 'Verifying…' : 'Verify & Save'}
        </button>
      </div>

      {message && (
        <div style={{
          fontFamily: 'var(--font-mono, monospace)', fontSize: 10,
          color: status === 'offline' ? '#c62828' : 'var(--outline, #888)',
          lineHeight: 1.5,
        }} id="gpu-endpoint-message">
          {message}
        </div>
      )}
    </div>
  );
}
