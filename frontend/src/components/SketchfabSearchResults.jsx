/**
 * SketchfabSearchResults — card grid of free downloadable Sketchfab models
 * for a weapon query. The user picks one and it opens in the exploded viewer.
 * Author + CC license are shown on every card (attribution requirement).
 */
import React from 'react';
import { motion } from 'framer-motion';

const mono = 'var(--font-mono, ui-monospace, monospace)';

const fmt = (n) => (n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n));

export default function SketchfabSearchResults({ results, query, fetchingUid, onPick, onClose }) {
  if (!results) return null;

  return (
    <motion.div
      initial={{ opacity: 0, y: -8 }}
      animate={{ opacity: 1, y: 0 }}
      style={{
        marginTop: 12, padding: 14, borderRadius: 12,
        border: '1px solid var(--outline-variant, #d0d0d0)',
        background: 'var(--surface-container-lowest, #fff)',
      }}
      id="sketchfab-results"
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
        <div style={{ fontFamily: mono, fontSize: 10, letterSpacing: 2, textTransform: 'uppercase', color: 'var(--outline, #888)' }}>
          Sketchfab — {results.length} free model{results.length === 1 ? '' : 's'} for “{query}”
        </div>
        <button
          onClick={onClose}
          id="btn-close-sketchfab-results"
          style={{
            display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer',
            background: 'transparent', border: 'none', color: 'var(--outline, #888)',
            fontFamily: mono, fontSize: 10, letterSpacing: 1, textTransform: 'uppercase',
          }}
        >
          <span className="material-symbols-outlined" style={{ fontSize: 15 }}>close</span>
          Close
        </button>
      </div>

      {fetchingUid && (
        <div style={{
          fontFamily: mono, fontSize: 10, color: 'var(--primary, #0066ff)',
          marginBottom: 10, display: 'flex', alignItems: 'center', gap: 6,
        }}>
          <span className="material-symbols-outlined" style={{ fontSize: 14 }}>downloading</span>
          Downloading from Sketchfab — detailed models can take a minute. A stalled
          download stops on its own; just pick another card.
        </div>
      )}

      {results.length === 0 ? (
        <div style={{ fontFamily: mono, fontSize: 11, color: 'var(--outline, #888)', padding: '10px 0' }}>
          No downloadable models matched — try fewer words (e.g. “deagle” instead of
          “Desert Eagle pistol”), or use the AI Exploded Assembly generator instead.
        </div>
      ) : (
        <div style={{
          display: 'grid', gap: 12,
          gridTemplateColumns: 'repeat(auto-fill, minmax(210px, 1fr))',
        }}>
          {results.map((m) => {
            const busy = fetchingUid === m.uid;
            const anyBusy = !!fetchingUid;
            return (
              <div
                key={m.uid}
                style={{
                  border: '1px solid var(--outline-variant, #e0e0e0)', borderRadius: 10,
                  overflow: 'hidden', display: 'flex', flexDirection: 'column',
                  background: '#fff',
                  opacity: anyBusy && !busy ? 0.55 : 1,
                }}
              >
                <a href={m.page_url} target="_blank" rel="noreferrer" title="Open on Sketchfab">
                  {m.thumbnail ? (
                    <img
                      src={m.thumbnail}
                      alt={m.name}
                      style={{ width: '100%', aspectRatio: '4/3', objectFit: 'cover', display: 'block', background: '#f2f2f2' }}
                    />
                  ) : (
                    <div style={{
                      width: '100%', aspectRatio: '4/3', background: '#f2f2f2',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                    }}>
                      <span className="material-symbols-outlined" style={{ fontSize: 34, color: '#bbb' }}>view_in_ar</span>
                    </div>
                  )}
                </a>
                <div style={{ padding: '8px 10px', display: 'flex', flexDirection: 'column', gap: 4, flex: 1 }}>
                  <div style={{
                    fontFamily: mono, fontSize: 11, fontWeight: 700, color: '#1a1a1a',
                    lineHeight: 1.35, overflow: 'hidden', display: '-webkit-box',
                    WebkitLineClamp: 2, WebkitBoxOrient: 'vertical',
                  }}>
                    {m.name}
                  </div>
                  <div style={{ fontFamily: mono, fontSize: 9, color: '#888' }}>
                    by {m.author} · {m.license}
                  </div>
                  <div style={{ fontFamily: mono, fontSize: 9, color: '#aaa', display: 'flex', gap: 10, alignItems: 'center' }}>
                    <span>♥ {fmt(m.likes)}</span>
                    <span>{fmt(m.faces)} tris</span>
                    {m.textured && (
                      <span style={{
                        color: '#1a7f37', border: '1px solid #1a7f3755', borderRadius: 999,
                        padding: '1px 6px', fontWeight: 700, letterSpacing: 0.5,
                      }} title="Ships with real texture maps — realistic in the viewer">
                        {m.tex_res >= 1024 ? `${Math.round(m.tex_res / 1024)}K TEXTURED` : 'TEXTURED'}
                      </span>
                    )}
                  </div>
                  <button
                    onClick={() => onPick(m)}
                    disabled={anyBusy}
                    id={`btn-pick-skfb-${m.uid}`}
                    style={{
                      marginTop: 'auto', padding: '7px 10px', borderRadius: 7,
                      border: 'none', cursor: anyBusy ? 'default' : 'pointer',
                      background: busy ? 'var(--outline, #999)' : 'var(--primary, #0066ff)',
                      color: '#fff', fontFamily: mono, fontSize: 9.5,
                      letterSpacing: 1.2, textTransform: 'uppercase',
                      display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5,
                    }}
                  >
                    <span className="material-symbols-outlined" style={{ fontSize: 14 }}>
                      {busy ? 'downloading' : 'open_with'}
                    </span>
                    {busy ? 'Fetching…' : 'Fetch & Explode'}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </motion.div>
  );
}
