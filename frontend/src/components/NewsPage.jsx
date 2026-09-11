/**
 * NewsPage — latest weapons/defense field news with a one-line "bottom line" per story.
 */
import React, { useEffect, useState, useCallback } from 'react';
import { motion } from 'framer-motion';

const TOPICS = [
  { key: 'military weapons defense technology', label: 'All Defense' },
  { key: 'small arms rifles firearms military', label: 'Small Arms' },
  { key: 'missiles drones UAV military', label: 'Missiles & Drones' },
  { key: 'tanks armored vehicles military', label: 'Armor' },
  { key: 'fighter jets military aircraft', label: 'Air' },
  { key: 'naval warships submarines defense', label: 'Naval' },
];

export default function NewsPage() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [topic, setTopic] = useState(TOPICS[0].key);

  const load = useCallback(async (q) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/news?q=${encodeURIComponent(q)}`);
      if (!res.ok) throw new Error(`Feed error ${res.status}`);
      const data = await res.json();
      setItems(data.items || []);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(topic); }, [topic, load]);

  return (
    <div className="main-content" id="news-page">
      <div className="main-content-inner">
        <motion.div
          className="asset-header"
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
        >
          <div className="asset-header-text">
            <h1>Field Intelligence — Weapons News</h1>
            <p>Live open-source reporting from the field, each with a one-line bottom line.</p>
          </div>
          <button className="btn-initialize" onClick={() => load(topic)} disabled={loading}>
            <span>{loading ? 'Refreshing…' : 'Refresh'}</span>
            <span className="material-symbols-outlined">{loading ? 'sync' : 'refresh'}</span>
          </button>
        </motion.div>

        {/* Topic filter chips */}
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 24 }}>
          {TOPICS.map((t) => (
            <button
              key={t.key}
              onClick={() => setTopic(t.key)}
              className={`tab-btn ${topic === t.key ? 'active' : ''}`}
              style={{ padding: '6px 14px', borderRadius: 20, fontSize: 12 }}
            >
              {t.label}
            </button>
          ))}
        </div>

        {error && <div className="error-banner">⚠️ {error}</div>}

        {loading && items.length === 0 ? (
          <div style={{ padding: 48, textAlign: 'center', color: 'var(--outline)', fontFamily: 'var(--font-mono)' }}>
            ⟐ Scanning open-source feeds…
          </div>
        ) : (
          <div className="news-grid">
            {items.map((item, i) => (
              <motion.a
                key={i}
                href={item.url}
                target="_blank"
                rel="noreferrer"
                className="news-card"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: Math.min(i * 0.04, 0.4), duration: 0.4 }}
              >
                {item.image && (
                  <div className="news-card-image">
                    <img
                      src={item.image}
                      alt={item.title}
                      loading="lazy"
                      onError={(e) => { e.target.parentElement.style.display = 'none'; }}
                    />
                  </div>
                )}
                <div className="news-card-body">
                  <div className="news-card-meta">
                    <span>{item.source || 'SOURCE'}</span>
                    {item.date && <span>{new Date(item.date).toLocaleDateString()}</span>}
                  </div>
                  <h3 className="news-card-title">{item.title}</h3>
                  {item.bottom_line && (
                    <div className="news-bottom-line">
                      <span className="news-bottom-label">Bottom line</span>
                      <p>{item.bottom_line}</p>
                    </div>
                  )}
                </div>
              </motion.a>
            ))}
            {!loading && items.length === 0 && !error && (
              <div style={{ padding: 48, textAlign: 'center', color: 'var(--outline)', fontFamily: 'var(--font-mono)' }}>
                No stories found for this topic right now.
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
