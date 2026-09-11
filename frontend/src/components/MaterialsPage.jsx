/**
 * MaterialsPage — a chief materials engineer's dossier for any weapon: per-component
 * materials with real mechanical properties, a strength-of-materials view, the army's
 * cost/selection trade-off matrix, and best-in-class material recommendations. Every
 * material fact carries a numbered citation into the source list at the bottom.
 */
import React, { useState, useCallback, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import MaterialAnalysisView from './MaterialAnalysisView';

const PRESETS = ['AK-47', 'M16', 'M4 Carbine', 'Glock 17', 'M1 Garand', 'Barrett M82', 'FN SCAR', 'MP5'];

// Common materials the army builds weapons from — presets for the "By Material" mode.
const MATERIAL_PRESETS = [
  '4150 Chrome-Moly Steel', '4340 Alloy Steel', '17-4 PH Stainless Steel', '7075-T6 Aluminium',
  'Ti-6Al-4V Titanium', 'Glass-filled Nylon Polymer', 'Carbon Fiber Composite', 'RHA Armor Steel',
];

// Material families → tone class (colour-codes chips + card accents).
const FAMILY_TONE = {
  'alloy steel': 'steel', 'carbon steel': 'steel', 'stainless steel': 'stainless',
  titanium: 'titanium', 'aluminium alloy': 'alu', 'aluminum alloy': 'alu',
  polymer: 'polymer', composite: 'composite', wood: 'wood', brass: 'brass',
};
const familyTone = (f = '') => {
  const k = f.toLowerCase();
  for (const [key, tone] of Object.entries(FAMILY_TONE)) if (k.includes(key.split(' ')[0])) return tone;
  return 'other';
};

const TIER_ORDER = { LOW: 1, MEDIUM: 2, HIGH: 3, PREMIUM: 4 };
const PROP_LABELS = {
  tensile_strength: 'Tensile', yield_strength: 'Yield', hardness: 'Hardness',
  density: 'Density', operating_load: 'Operating load', temp_range: 'Temp range',
};

function Cites({ ids, onJump }) {
  if (!ids || !ids.length) return null;
  return (
    <span className="evo-cites">
      {ids.map((id) => (
        <button key={id} className="evo-cite" onClick={(e) => { e.stopPropagation(); onJump(id); }} title={`Source ${id}`}>
          {id}
        </button>
      ))}
    </span>
  );
}

/** 1–5 importance shown as filled/empty pips. */
function Pips({ n }) {
  return (
    <span className="mat-pips" title={`Importance ${n}/5`}>
      {[1, 2, 3, 4, 5].map((i) => <span key={i} className={`mat-pip ${i <= n ? 'on' : ''}`} />)}
    </span>
  );
}

function ComponentCard({ c, index, onJump }) {
  const tone = familyTone(c.family);
  const props = Object.entries(PROP_LABELS).filter(([k]) => c.properties?.[k]);
  return (
    <motion.div
      className={`mat-comp mat-fam-${tone}`}
      initial={{ opacity: 0, y: 24 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: '-60px' }}
      transition={{ duration: 0.4, delay: Math.min(index * 0.03, 0.3) }}
    >
      <div className="mat-comp-head">
        <div>
          <div className="mat-comp-part">{c.part}<Cites ids={c.sources} onJump={onJump} /></div>
          <div className="mat-comp-material">{c.material}</div>
        </div>
        <span className={`mat-tier mat-tier-${c.cost_tier.toLowerCase()}`}>{c.cost_tier}</span>
      </div>

      <div className="mat-fam-chip">{c.family}</div>

      {c.role && <p className="mat-comp-role"><span className="mat-k">Role</span>{c.role}</p>}
      {c.why && <p className="mat-comp-why"><span className="mat-k">Why this material</span>{c.why}</p>}

      {props.length > 0 && (
        <div className="mat-props">
          {props.map(([k, label]) => (
            <div className="mat-prop" key={k}>
              <span className="mat-prop-k">{label}</span>
              <span className="mat-prop-v">{c.properties[k]}</span>
            </div>
          ))}
        </div>
      )}

      <div className="mat-comp-foot">
        {c.safety_factor && (
          <div className="mat-sf"><span className="material-symbols-outlined">shield</span>FoS {c.safety_factor}</div>
        )}
        {c.failure_mode && (
          <div className="mat-fail"><span className="material-symbols-outlined">warning</span>{c.failure_mode}</div>
        )}
      </div>
    </motion.div>
  );
}

export default function MaterialsPage() {
  const [mode, setMode] = useState('weapon');   // 'weapon' | 'material'
  const [docMode, setDocMode] = useState('weapon'); // which mode produced the current doc
  const [weapon, setWeapon] = useState('');
  const [doc, setDoc] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const sourceRefs = useRef({});

  const run = useCallback(async (name, m) => {
    const q = (name || '').trim();
    if (!q) return;
    const useMode = m || mode;
    setLoading(true); setError(null); setDoc(null);
    try {
      const url = useMode === 'material'
        ? `/api/material-analysis?material=${encodeURIComponent(q)}`
        : `/api/materials?weapon=${encodeURIComponent(q)}`;
      const res = await fetch(url);
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.detail || `Analysis failed (${res.status})`);
      }
      setDoc(await res.json());
      setDocMode(useMode);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [mode]);

  const switchMode = useCallback((m) => {
    if (m === mode) return;
    setMode(m); setDoc(null); setError(null); setWeapon('');
  }, [mode]);

  const jumpToSource = useCallback((id) => {
    const el = sourceRefs.current[id];
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      el.classList.add('evo-source-flash');
      setTimeout(() => el.classList.remove('evo-source-flash'), 1400);
    }
  }, []);

  const ov = doc?.overview || {};
  const maxShare = doc ? Math.max(1, ...(doc.cost?.breakdown || []).map((b) => b.share)) : 1;
  const isMat = mode === 'material';
  const presets = isMat ? MATERIAL_PRESETS : PRESETS;

  return (
    <div className="main-content" id="materials-page">
      <div className="main-content-inner">
        <motion.div className="asset-header" initial={{ opacity: 0, y: -20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5 }}>
          <div className="asset-header-text">
            <h1>Materials & Strength Analysis</h1>
            <p>Chief-engineer breakdown by weapon — or a deep assay of any single material the army builds with.</p>
          </div>
        </motion.div>

        {/* Mode toggle */}
        <div className="mat-mode-toggle" role="tablist">
          <button role="tab" aria-selected={!isMat} className={`mat-mode-btn ${!isMat ? 'active' : ''}`}
            onClick={() => switchMode('weapon')} id="mat-mode-weapon">
            <span className="material-symbols-outlined">build</span>
            <span><b>By Weapon</b><em>Every component's material, cost & strength</em></span>
          </button>
          <button role="tab" aria-selected={isMat} className={`mat-mode-btn ${isMat ? 'active' : ''}`}
            onClick={() => switchMode('material')} id="mat-mode-material">
            <span className="material-symbols-outlined">science</span>
            <span><b>By Material</b><em>Strength & properties of one alloy/polymer</em></span>
          </button>
        </div>

        <div className="evo-search">
          <div className="evo-search-row">
            <span className="material-symbols-outlined">{isMat ? 'biotech' : 'build'}</span>
            <input
              type="text"
              placeholder={isMat
                ? 'Enter a material  ·  e.g. 4150 steel, 7075-T6 aluminium, Ti-6Al-4V…'
                : 'Enter a weapon  ·  e.g. AK-47, M16, Barrett M82…'}
              value={weapon}
              onChange={(e) => setWeapon(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && run(weapon)}
              id="mat-input"
            />
            <button className="btn-initialize" onClick={() => run(weapon)} disabled={loading || !weapon.trim()}>
              <span>{loading ? 'Analyzing…' : isMat ? 'Analyze Material' : 'Analyze Materials'}</span>
              <span className="material-symbols-outlined">{loading ? 'sync' : 'biotech'}</span>
            </button>
          </div>
          <div className="evo-presets">
            {presets.map((p) => (
              <button key={p} className="evo-preset" onClick={() => { setWeapon(p); run(p); }} disabled={loading}>{p}</button>
            ))}
          </div>
        </div>

        {error && <div className="error-banner">⚠️ {error}</div>}

        {loading && (
          <div className="evo-loading">
            <div className="evo-loading-pulse" />
            <p>{isMat
              ? 'Running the material assay — sourcing metallurgy, mechanical properties & strength behaviour…'
              : 'Running the materials assay — sourcing metallurgy, computing strength margins, costing the build…'}</p>
          </div>
        )}

        {!loading && !doc && !error && (
          <div className="evo-empty">
            <span className="material-symbols-outlined">{isMat ? 'biotech' : 'science'}</span>
            <p>{isMat
              ? 'Pick a material to run a full strength & properties analysis.'
              : 'Pick a weapon to run a full materials-engineering analysis.'}</p>
          </div>
        )}

        {/* Material-mode result */}
        {doc && !loading && docMode === 'material' && (
          <MaterialAnalysisView doc={doc} onJump={jumpToSource} sourceRefs={sourceRefs} />
        )}

        {/* Weapon-mode result */}
        <AnimatePresence>
          {doc && !loading && docMode === 'weapon' && (
            <motion.div key={doc.weapon} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.4 }}>
              {/* Overview */}
              <div className="evo-profile">
                <div className="evo-profile-title"><h2>{doc.weapon}</h2>
                  {ov.material_era && <span className="mat-era-chip">{ov.material_era}</span>}
                </div>
                {ov.design_philosophy && <p className="evo-throughline">“{ov.design_philosophy}”</p>}
                {ov.summary && <p className="mat-summary">{ov.summary}</p>}
                <div className="evo-profile-grid">
                  {[['Class', ov.weapon_class], ['Cartridge', ov.cartridge], ['Peak chamber pressure', ov.peak_pressure]]
                    .filter(([, v]) => v).map(([k, v]) => (
                      <div className="evo-profile-cell" key={k}><span className="evo-profile-k">{k}</span><span className="evo-profile-v">{v}</span></div>
                    ))}
                </div>
              </div>

              {/* Component material breakdown */}
              <h2 className="tech-section-title">Component Material Breakdown</h2>
              <div className="mat-grid">
                {doc.components.map((c, i) => <ComponentCard key={c.part + i} c={c} index={i} onJump={jumpToSource} />)}
              </div>

              {/* Strength of materials */}
              {(doc.strength?.critical_parts?.length > 0 || doc.strength?.narrative) && (
                <>
                  <h2 className="tech-section-title">Strength of Materials</h2>
                  <div className="mat-panel">
                    {doc.strength.narrative && <p className="mat-narrative">{doc.strength.narrative}</p>}
                    <div className="mat-crit-list">
                      {doc.strength.critical_parts.map((cp, i) => (
                        <div className="mat-crit" key={i}>
                          <span className="mat-crit-rank">{i + 1}</span>
                          <div className="mat-crit-body">
                            <div className="mat-crit-top"><span className="mat-crit-part">{cp.part}</span>
                              {cp.safety_factor && <span className="mat-crit-sf">FoS {cp.safety_factor}</span>}
                            </div>
                            {cp.stress && <div className="mat-crit-stress">{cp.stress}</div>}
                            {cp.note && <div className="mat-crit-note">{cp.note}</div>}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </>
              )}

              {/* Selection matrix + cost, side by side */}
              <div className="mat-two-col">
                {doc.selection?.criteria?.length > 0 && (
                  <div>
                    <h2 className="tech-section-title">How the Army Selects the Material</h2>
                    <div className="mat-panel">
                      {[...doc.selection.criteria].sort((a, b) => b.importance - a.importance).map((cr, i) => (
                        <div className="mat-criterion" key={i}>
                          <div className="mat-criterion-head">
                            <span className="mat-criterion-name">{cr.factor}</span>
                            <Pips n={cr.importance} />
                          </div>
                          {cr.rationale && <p className="mat-criterion-note">{cr.rationale}</p>}
                        </div>
                      ))}
                      {doc.selection.doctrine && (
                        <div className="mat-doctrine"><span className="mat-k">Doctrine</span>{doc.selection.doctrine}</div>
                      )}
                    </div>
                  </div>
                )}

                {(doc.cost?.breakdown?.length > 0 || doc.cost?.narrative) && (
                  <div>
                    <h2 className="tech-section-title">Cost Analysis</h2>
                    <div className="mat-panel">
                      {doc.cost.narrative && <p className="mat-narrative">{doc.cost.narrative}</p>}
                      {doc.cost.breakdown.map((b, i) => (
                        <div className="mat-cost-row" key={i}>
                          <span className="mat-cost-part">{b.part}</span>
                          <div className="mat-cost-bar-track">
                            <div className={`mat-cost-bar mat-tier-fill-${b.tier.toLowerCase()}`} style={{ width: `${(b.share / maxShare) * 100}%` }} />
                          </div>
                          <span className="mat-cost-share">{b.share}%</span>
                        </div>
                      ))}
                      {doc.cost.drivers?.length > 0 && (
                        <div className="mat-drivers">
                          <span className="mat-k">Cost drivers</span>
                          <div className="mat-driver-chips">
                            {doc.cost.drivers.map((d, i) => <span className="mat-driver-chip" key={i}>{d}</span>)}
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>

              {/* Recommendations */}
              {doc.recommendations?.length > 0 && (
                <>
                  <h2 className="tech-section-title">Engineering Recommendations — Best-in-Class Features</h2>
                  <div className="mat-rec-grid">
                    {doc.recommendations.map((r, i) => (
                      <motion.div className="mat-rec" key={i}
                        initial={{ opacity: 0, y: 16 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }}
                        transition={{ duration: 0.35, delay: Math.min(i * 0.04, 0.3) }}>
                        <div className="mat-rec-head">
                          <span className="mat-rec-title">{r.title}<Cites ids={r.sources} onJump={jumpToSource} /></span>
                          <span className={`mat-maturity mat-mat-${r.maturity.toLowerCase()}`}>{r.maturity}</span>
                        </div>
                        {r.benefit && <div className="mat-rec-line good"><span>+</span>{r.benefit}</div>}
                        {r.tradeoff && <div className="mat-rec-line bad"><span>−</span>{r.tradeoff}</div>}
                      </motion.div>
                    ))}
                  </div>
                </>
              )}

              {/* Sources */}
              {doc.sources?.length > 0 && (
                <div className="evo-sources">
                  <h2 className="tech-section-title">Sources</h2>
                  <div className="evo-sources-list">
                    {doc.sources.map((s) => (
                      <a key={s.id} href={s.url} target="_blank" rel="noreferrer" className="evo-source"
                        ref={(el) => { sourceRefs.current[s.id] = el; }}>
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
                    Analysis synthesized by Llama-3.3-70B from live Tavily research. Mechanical values marked
                    “est.” are accepted textbook figures for the material grade, not from a cited source —
                    verify against the linked references before any engineering use.
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
