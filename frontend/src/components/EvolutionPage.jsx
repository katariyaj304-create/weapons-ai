/**
 * EvolutionPage — traces a weapon from its original concept to its current form as a
 * vertical timeline. Every milestone and every individual design change carries a
 * numbered citation that resolves to the source list at the bottom.
 */
import React, { useState, useCallback, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

const PRESETS = ['AK-47', 'M16', 'Glock 17', 'M1 Garand', 'MP5', 'M4 Carbine', 'Colt 1911', 'RPG-7'];

const STAGE_META = {
  CONCEPT:       { icon: 'lightbulb',      tone: 'concept',  label: 'Concept' },
  PROTOTYPE:     { icon: 'construction',   tone: 'proto',    label: 'Prototype' },
  TRIALS:        { icon: 'science',        tone: 'proto',    label: 'Trials' },
  ADOPTION:      { icon: 'verified',       tone: 'adopt',    label: 'Adoption' },
  VARIANT:       { icon: 'call_split',     tone: 'variant',  label: 'Variant' },
  MODERNIZATION: { icon: 'upgrade',        tone: 'modern',   label: 'Modernization' },
  CURRENT:       { icon: 'flag',           tone: 'current',  label: 'Current' },
};

const CHANGE_META = {
  ADDED:   { symbol: '+', cls: 'added',   verb: 'Added' },
  CHANGED: { symbol: '~', cls: 'changed', verb: 'Reworked' },
  REMOVED: { symbol: '−', cls: 'removed', verb: 'Removed' },
};

/** Stage photo that reveals itself only once the image actually loads — DDGS thumbnails are
 *  often hotlink-protected, and a blank placeholder box looks worse than no box at all. */
function StageImage({ src, alt }) {
  const [ok, setOk] = useState(false);
  if (!src) return null;
  return (
    <div className="evo-image" style={ok ? undefined : { display: 'none' }}>
      <img src={src} alt={alt} loading="lazy" onLoad={() => setOk(true)} onError={() => setOk(false)} />
    </div>
  );
}

/** Small superscript citation chips that scroll to the matching source row. */
function Cites({ ids, onJump }) {
  if (!ids || !ids.length) return null;
  return (
    <span className="evo-cites">
      {ids.map((id) => (
        <button key={id} className="evo-cite" onClick={(e) => { e.stopPropagation(); onJump(id); }} title={`Jump to source ${id}`}>
          {id}
        </button>
      ))}
    </span>
  );
}

function StageCard({ stage, index, onJump }) {
  const meta = STAGE_META[stage.stage] || STAGE_META.VARIANT;
  const side = index % 2 === 0 ? 'left' : 'right';
  return (
    <motion.div
      className={`evo-node evo-node-${side}`}
      initial={{ opacity: 0, y: 40 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: '-80px' }}
      transition={{ duration: 0.5, ease: 'easeOut' }}
    >
      <div className="evo-rail-marker">
        <span className={`evo-dot evo-tone-${meta.tone}`}>
          <span className="material-symbols-outlined">{meta.icon}</span>
        </span>
      </div>

      <div className={`evo-card evo-tone-border-${meta.tone}`}>
        <div className="evo-card-head">
          <span className={`evo-stage-badge evo-tone-${meta.tone}`}>{meta.label}</span>
          <span className="evo-year">{stage.year || '—'}</span>
        </div>

        <div className="evo-designation">{stage.designation}</div>
        <h3 className="evo-title">
          {stage.title}
          <Cites ids={stage.sources} onJump={onJump} />
        </h3>

        <StageImage src={stage.image} alt={stage.designation} />

        {stage.summary && <p className="evo-summary">{stage.summary}</p>}

        {(stage.driver || stage.impact) && (
          <div className="evo-meta-row">
            {stage.driver && (
              <div className="evo-meta"><span className="evo-meta-k">Driver</span><span>{stage.driver}</span></div>
            )}
            {stage.impact && (
              <div className="evo-meta"><span className="evo-meta-k">Impact</span><span>{stage.impact}</span></div>
            )}
          </div>
        )}

        {stage.changes?.length > 0 && (
          <div className="evo-changes">
            <div className="evo-changes-label">Design changes</div>
            {stage.changes.map((c, i) => {
              const cm = CHANGE_META[c.type] || CHANGE_META.CHANGED;
              return (
                <div className="evo-change" key={i}>
                  <span className={`evo-change-tag ${cm.cls}`}>{cm.symbol}</span>
                  <span className="evo-change-body">
                    <span className="evo-change-part">{c.part}</span>
                    <span className="evo-change-detail">{c.detail}</span>
                    <Cites ids={c.sources} onJump={onJump} />
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </motion.div>
  );
}

export default function EvolutionPage() {
  const [weapon, setWeapon] = useState('');
  const [doc, setDoc] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const sourceRefs = useRef({});

  const run = useCallback(async (name) => {
    const q = (name || '').trim();
    if (!q) return;
    setLoading(true);
    setError(null);
    setDoc(null);
    try {
      const res = await fetch(`/api/evolution?weapon=${encodeURIComponent(q)}`);
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.detail || `Research failed (${res.status})`);
      }
      setDoc(await res.json());
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  const jumpToSource = useCallback((id) => {
    const el = sourceRefs.current[id];
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      el.classList.add('evo-source-flash');
      setTimeout(() => el.classList.remove('evo-source-flash'), 1400);
    }
  }, []);

  const profile = doc?.profile || {};

  return (
    <div className="main-content" id="evolution-page">
      <div className="main-content-inner">
        <motion.div className="asset-header" initial={{ opacity: 0, y: -20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5 }}>
          <div className="asset-header-text">
            <h1>Evolution — Concept to Current</h1>
            <p>Trace any weapon from its first sketch through every major design change, each grounded in real sources.</p>
          </div>
        </motion.div>

        {/* Search + presets */}
        <div className="evo-search">
          <div className="evo-search-row">
            <span className="material-symbols-outlined">history_edu</span>
            <input
              type="text"
              placeholder="Enter a weapon  ·  e.g. AK-47, M16, Glock 17…"
              value={weapon}
              onChange={(e) => setWeapon(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && run(weapon)}
              id="evo-input"
            />
            <button className="btn-initialize" onClick={() => run(weapon)} disabled={loading || !weapon.trim()}>
              <span>{loading ? 'Researching…' : 'Trace Evolution'}</span>
              <span className="material-symbols-outlined">{loading ? 'sync' : 'timeline'}</span>
            </button>
          </div>
          <div className="evo-presets">
            {PRESETS.map((p) => (
              <button key={p} className="evo-preset" onClick={() => { setWeapon(p); run(p); }} disabled={loading}>
                {p}
              </button>
            ))}
          </div>
        </div>

        {error && <div className="error-banner">⚠️ {error}</div>}

        {loading && (
          <div className="evo-loading">
            <div className="evo-loading-pulse" />
            <p>Tracing the design lineage — searching sources, mapping every major change…</p>
          </div>
        )}

        {!loading && !doc && !error && (
          <div className="evo-empty">
            <span className="material-symbols-outlined">timeline</span>
            <p>Pick a weapon above to reconstruct its journey from concept to today.</p>
          </div>
        )}

        <AnimatePresence>
          {doc && !loading && (
            <motion.div key={doc.weapon} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.4 }}>
              {/* Profile banner */}
              <div className="evo-profile">
                <div className="evo-profile-title">
                  <h2>{doc.weapon}</h2>
                  {profile.status && <span className="evo-status-chip">{profile.status}</span>}
                </div>
                {doc.through_line && <p className="evo-throughline">“{doc.through_line}”</p>}
                <div className="evo-profile-grid">
                  {[
                    ['Designer', profile.designer], ['Origin', profile.origin],
                    ['Class', profile.weapon_class], ['Concept', profile.concept_year],
                    ['In service', profile.service_year], ['Span', profile.span],
                    ['Produced', profile.units],
                  ].filter(([, v]) => v).map(([k, v]) => (
                    <div className="evo-profile-cell" key={k}>
                      <span className="evo-profile-k">{k}</span>
                      <span className="evo-profile-v">{v}</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Timeline */}
              <div className="evo-timeline">
                <div className="evo-rail" />
                {doc.stages.map((s, i) => (
                  <StageCard key={s.id} stage={s} index={i} onJump={jumpToSource} />
                ))}
              </div>

              {/* Sources */}
              {doc.sources?.length > 0 && (
                <div className="evo-sources">
                  <h2 className="tech-section-title">Sources</h2>
                  <div className="evo-sources-list">
                    {doc.sources.map((s) => (
                      <a
                        key={s.id}
                        href={s.url}
                        target="_blank"
                        rel="noreferrer"
                        className="evo-source"
                        ref={(el) => { sourceRefs.current[s.id] = el; }}
                      >
                        <span className="evo-source-num">{s.id}</span>
                        <span className="evo-source-body">
                          <span className="evo-source-title">{s.title}</span>
                          <span className="evo-source-domain">{s.domain}</span>
                        </span>
                        <span className="material-symbols-outlined">open_in_new</span>
                      </a>
                    ))}
                  </div>
                  <p className="evo-disclaimer">
                    Timeline synthesized by Llama-3.3-70B from live Tavily web research. Citations link to the
                    original sources — verify critical facts against them.
                  </p>
                </div>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
