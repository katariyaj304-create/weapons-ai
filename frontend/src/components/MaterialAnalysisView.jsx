/**
 * MaterialAnalysisView — renders a single-material engineering assay (the "By Material" mode of
 * the Materials page): an 8-axis radar profile, mechanical properties, a strength-of-materials
 * workup, weapon applications, processing, pros/cons and alternatives. Citations link to sources.
 */
import React from 'react';
import { motion } from 'framer-motion';

function Cites({ ids, onJump }) {
  if (!ids || !ids.length) return null;
  return (
    <span className="evo-cites">
      {ids.map((id) => (
        <button key={id} className="evo-cite" onClick={(e) => { e.stopPropagation(); onJump(id); }} title={`Source ${id}`}>{id}</button>
      ))}
    </span>
  );
}

// Radar charts read best with terse axis labels; the full names stay in the data/notes.
const AXIS_SHORT = {
  'Corrosion resistance': 'Corrosion', 'Heat resistance': 'Heat',
  Machinability: 'Machining', 'Cost efficiency': 'Cost',
};

/** SVG radar (spider) chart over the fixed 8 engineering axes, scores 0–100. */
function RadarChart({ ratings }) {
  const size = 300, cx = size / 2, cy = size / 2, R = 104;
  const n = ratings.length || 1;
  const ang = (i) => (Math.PI * 2 * i) / n - Math.PI / 2;
  const pt = (i, r) => [cx + Math.cos(ang(i)) * r, cy + Math.sin(ang(i)) * r];
  const rings = [0.25, 0.5, 0.75, 1];

  const dataPoly = ratings.map((r, i) => pt(i, (Math.max(0, Math.min(100, r.score)) / 100) * R).join(',')).join(' ');

  return (
    <svg viewBox={`0 0 ${size} ${size}`} className="mat-radar" role="img" aria-label="Material rating radar">
      {/* grid rings */}
      {rings.map((f, ri) => (
        <polygon key={ri}
          points={ratings.map((_, i) => pt(i, R * f).join(',')).join(' ')}
          className="mat-radar-ring" />
      ))}
      {/* axis spokes */}
      {ratings.map((_, i) => {
        const [x, y] = pt(i, R);
        return <line key={i} x1={cx} y1={cy} x2={x} y2={y} className="mat-radar-spoke" />;
      })}
      {/* data polygon */}
      <polygon points={dataPoly} className="mat-radar-data" />
      {/* data vertices */}
      {ratings.map((r, i) => {
        const [x, y] = pt(i, (Math.max(0, Math.min(100, r.score)) / 100) * R);
        return <circle key={i} cx={x} cy={y} r={3} className="mat-radar-dot" />;
      })}
      {/* axis labels */}
      {ratings.map((r, i) => {
        const [x, y] = pt(i, R + 20);
        const a = ang(i);
        const anchor = Math.abs(Math.cos(a)) < 0.3 ? 'middle' : Math.cos(a) > 0 ? 'start' : 'end';
        return (
          <text key={i} x={x} y={y} textAnchor={anchor} dominantBaseline="middle" className="mat-radar-label">
            {AXIS_SHORT[r.axis] || r.axis}
            <tspan className="mat-radar-score" dx="4">{r.score}</tspan>
          </text>
        );
      })}
    </svg>
  );
}

export default function MaterialAnalysisView({ doc, onJump, sourceRefs }) {
  const ov = doc.overview || {};
  const sa = doc.strength_analysis || {};
  const proc = doc.processing || {};
  const procRows = [
    ['Heat treatment', proc.heat_treatment], ['Forming', proc.forming], ['Coating', proc.coating],
  ].filter(([, v]) => v);

  return (
    <motion.div key={doc.material} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.4 }}>
      {/* Overview */}
      <div className="evo-profile">
        <div className="evo-profile-title"><h2>{doc.material}</h2>
          {ov.family && <span className="mat-era-chip">{ov.family}</span>}
        </div>
        {ov.military_use && <p className="evo-throughline">“{ov.military_use}”</p>}
        {ov.summary && <p className="mat-summary">{ov.summary}</p>}
        <div className="evo-profile-grid">
          {[['Designation', ov.designation], ['Composition', ov.composition]]
            .filter(([, v]) => v).map(([k, v]) => (
              <div className="evo-profile-cell" key={k}><span className="evo-profile-k">{k}</span><span className="evo-profile-v">{v}</span></div>
            ))}
        </div>
      </div>

      {/* Radar + properties, side by side */}
      <div className="mat-assay">
        <div className="mat-panel mat-radar-panel">
          <div className="mat-panel-title">Engineering Profile</div>
          <RadarChart ratings={doc.ratings} />
        </div>
        <div className="mat-panel">
          <div className="mat-panel-title">Mechanical Properties</div>
          <table className="mat-prop-table">
            <tbody>
              {doc.properties.map((p, i) => (
                <tr key={i}>
                  <td className="mat-prop-name">{p.property}</td>
                  <td className="mat-prop-val">{p.value}<Cites ids={p.sources} onJump={onJump} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Strength of materials */}
      {(sa.narrative || sa.load_behaviour || sa.failure_modes?.length > 0) && (
        <>
          <h2 className="tech-section-title">Strength of Materials</h2>
          <div className="mat-panel">
            {sa.narrative && <p className="mat-narrative">{sa.narrative}</p>}
            <div className="mat-som-grid">
              {sa.load_behaviour && (
                <div className="mat-som-cell"><span className="mat-k">Load behaviour</span><p>{sa.load_behaviour}</p></div>
              )}
              {sa.fatigue && (
                <div className="mat-som-cell"><span className="mat-k">Fatigue</span><p>{sa.fatigue}</p></div>
              )}
              {sa.temperature && (
                <div className="mat-som-cell"><span className="mat-k">Temperature</span><p>{sa.temperature}</p></div>
              )}
            </div>
            {sa.failure_modes?.length > 0 && (
              <div className="mat-failures">
                <span className="mat-k">Failure modes</span>
                <div className="mat-failure-chips">
                  {sa.failure_modes.map((f, i) => (
                    <span className="mat-failure-chip" key={i}><span className="material-symbols-outlined">warning</span>{f}</span>
                  ))}
                </div>
              </div>
            )}
          </div>
        </>
      )}

      {/* Applications + processing */}
      <div className="mat-two-col">
        {doc.applications?.length > 0 && (
          <div>
            <h2 className="tech-section-title">Weapon Applications</h2>
            <div className="mat-panel">
              {doc.applications.map((a, i) => (
                <div className="mat-app" key={i}>
                  <div className="mat-app-head"><span className="mat-app-comp">{a.component}</span>
                    {a.examples && <span className="mat-app-ex">{a.examples}</span>}
                  </div>
                  {a.why && <p className="mat-app-why">{a.why}</p>}
                </div>
              ))}
            </div>
          </div>
        )}
        {procRows.length > 0 && (
          <div>
            <h2 className="tech-section-title">Processing & Treatment</h2>
            <div className="mat-panel">
              {procRows.map(([k, v]) => (
                <div className="mat-proc-row" key={k}><span className="mat-k">{k}</span><p>{v}</p></div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Pros / cons */}
      {(doc.pros?.length > 0 || doc.cons?.length > 0) && (
        <div className="mat-two-col mat-proscons">
          {doc.pros?.length > 0 && (
            <div className="mat-panel mat-pros">
              <div className="mat-panel-title good">Advantages</div>
              {doc.pros.map((p, i) => <div className="mat-pc-line good" key={i}><span>+</span>{p}</div>)}
            </div>
          )}
          {doc.cons?.length > 0 && (
            <div className="mat-panel mat-cons">
              <div className="mat-panel-title bad">Limitations</div>
              {doc.cons.map((c, i) => <div className="mat-pc-line bad" key={i}><span>−</span>{c}</div>)}
            </div>
          )}
        </div>
      )}

      {/* Alternatives */}
      {doc.alternatives?.length > 0 && (
        <>
          <h2 className="tech-section-title">Competing Materials</h2>
          <div className="mat-alt-grid">
            {doc.alternatives.map((a, i) => (
              <div className="mat-alt" key={i}>
                <div className="mat-alt-name"><span className="material-symbols-outlined">swap_horiz</span>{a.material}</div>
                {a.tradeoff && <p className="mat-alt-trade">{a.tradeoff}</p>}
              </div>
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
                ref={(el) => { if (sourceRefs) sourceRefs.current[s.id] = el; }}>
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
            Analysis synthesized by Llama-3.3-70B from live Tavily research. Values marked “est.” are
            accepted textbook figures for the material grade — verify against the linked references
            before any engineering use.
          </p>
        </div>
      )}
    </motion.div>
  );
}
