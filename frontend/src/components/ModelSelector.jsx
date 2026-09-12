/**
 * ModelSelector — Ivory Command Asset Selection Library.
 * Matches the reference design with image-rich cards, status badges,
 * serial numbers, spec grids, and drag-and-drop upload zone.
 */
import React, { useCallback, useState } from 'react';
import { useDropzone } from 'react-dropzone';
import { motion } from 'framer-motion';

import { PREDEFINED_ASSETS } from '../assets_data';

export default function ModelSelector({ onModelSelected, onUpload, onExplodeAsset, generateSection }) {
  const [modelName, setModelName] = useState('');
  const [uploading, setUploading] = useState(false);
  const [uploadedFile, setUploadedFile] = useState(null);

  const onDrop = useCallback(async (acceptedFiles) => {
    const file = acceptedFiles[0];
    if (!file) return;

    setUploading(true);
    try {
      const result = await onUpload(file);
      setUploadedFile({
        ...result,
        localUrl: URL.createObjectURL(file),
        file
      });
      const baseName = file.name.replace(/\.(glb|gltf)$/i, '').replace(/[_-]/g, ' ');
      setModelName(baseName);
    } catch (err) {
      console.error('Upload failed:', err);
    } finally {
      setUploading(false);
    }
  }, [onUpload]);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: {
      'model/gltf-binary': ['.glb'],
      'model/gltf+json': ['.gltf'],
    },
    maxFiles: 1,
    multiple: false
  });

  const handleAssetSelect = (asset) => {
    onModelSelected({
      name: asset.name,
      url: asset.url,
      uploadData: null
    });
  };

  const handleUploadSubmit = () => {
    if (!modelName.trim() || !uploadedFile) return;
    onModelSelected({
      name: modelName.trim(),
      url: uploadedFile.url || null,
      uploadData: uploadedFile
    });
  };

  return (
    <div className="main-content" id="asset-selection">
      <div className="main-content-inner">
        {/* Header */}
        <motion.div
          className="asset-header"
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
        >
          <div className="asset-header-text">
            <h1>Tactical Hardware Library</h1>
            <p>
              Verified defense inventory ({PREDEFINED_ASSETS.length} operational models ready). Click any weapon to launch interactive 3D tactical analysis.
            </p>
          </div>
          {uploadedFile && modelName.trim() && (
            <button
              className="btn-initialize"
              onClick={handleUploadSubmit}
              id="btn-initialize-analysis"
            >
              <span>Initialize Analysis</span>
              <span className="material-symbols-outlined">analytics</span>
            </button>
          )}
        </motion.div>

        {/* Asset Grid */}
        <motion.div
          className="asset-grid"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1, duration: 0.5 }}
        >
          {/* Upload Zone */}
          <div
            {...getRootProps()}
            className={`upload-zone ${isDragActive ? 'drag-active' : ''}`}
            id="upload-zone"
          >
            <input {...getInputProps()} />
            {uploading ? (
              <>
                <div className="upload-zone-icon">
                  <span className="material-symbols-outlined">hourglass_top</span>
                </div>
                <p className="upload-zone-title">Uploading Asset...</p>
              </>
            ) : uploadedFile ? (
              <>
                <div className="upload-zone-icon">
                  <span className="material-symbols-outlined">check_circle</span>
                </div>
                <p className="upload-zone-title">{uploadedFile.original_name || uploadedFile.file?.name}</p>
                <p className="upload-zone-desc">Click or drop to replace</p>
                <div style={{ marginTop: 16, width: '100%', maxWidth: 280 }}>
                  <input
                    type="text"
                    placeholder="Identify asset name..."
                    value={modelName}
                    onChange={(e) => setModelName(e.target.value)}
                    onClick={(e) => e.stopPropagation()}
                    style={{
                      width: '100%',
                      padding: '10px 16px',
                      border: '1px solid var(--outline-variant)',
                      borderRadius: 4,
                      fontFamily: 'var(--font-display)',
                      fontSize: 14,
                      color: 'var(--on-surface)',
                      background: 'var(--surface-container-lowest)',
                      outline: 'none',
                    }}
                  />
                </div>
              </>
            ) : (
              <>
                <div className="upload-zone-icon">
                  <span className="material-symbols-outlined">upload_file</span>
                </div>
                <p className="upload-zone-title">New Configuration</p>
                <p className="upload-zone-desc">
                  Drag hardware telemetry files here to ingest into Ivory Intelligence.
                </p>
              </>
            )}
          </div>
          {/* Asset Cards */}
          {PREDEFINED_ASSETS.map((asset, index) => (
            <motion.article
              key={asset.id}
              className="asset-card"
              onClick={() => handleAssetSelect(asset)}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.1 + index * 0.06, duration: 0.4 }}
              id={`asset-card-${asset.id}`}
            >
              <div className="asset-card-image">
                <img
                  src={asset.image}
                  alt={asset.name}
                  loading="lazy"
                  onError={(e) => {
                    e.target.onerror = null;
                    e.target.src = '/images/fallback.png';
                  }}
                />
                <span className={`asset-card-badge badge-${asset.statusType}`}>
                  {asset.status}
                </span>
                {onExplodeAsset && asset.url && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onExplodeAsset(asset);
                    }}
                    id={`btn-explode-${asset.id}`}
                    title="Open interactive exploded view — disassemble / assemble"
                    style={{
                      position: 'absolute', left: 10, bottom: 10,
                      display: 'flex', alignItems: 'center', gap: 5,
                      padding: '5px 10px', borderRadius: 6, cursor: 'pointer',
                      border: '1px solid rgba(255,255,255,0.35)',
                      background: 'rgba(10,10,10,0.62)', color: '#fff',
                      backdropFilter: 'blur(6px)',
                      fontFamily: 'var(--font-mono, ui-monospace, monospace)',
                      fontSize: 9.5, letterSpacing: 1.2, textTransform: 'uppercase',
                    }}
                  >
                    <span className="material-symbols-outlined" style={{ fontSize: 14 }}>open_with</span>
                    Explode
                  </button>
                )}
              </div>
              <div className="asset-card-body">
                <span className="asset-card-serial">SERIAL: {asset.serial}</span>
                <h3 className="asset-card-name">{asset.name}</h3>
                <div className="asset-card-specs">
                  {asset.specs.map((spec, i) => (
                    <div key={i} className="asset-spec">
                      <p className="asset-spec-label">{spec.label}</p>
                      {spec.isStatus ? (
                        <div className="asset-spec-status">
                          <div className="status-dot" />
                          <p className="asset-spec-value">{spec.value}</p>
                        </div>
                      ) : (
                        <p className="asset-spec-value">{spec.value}</p>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            </motion.article>
          ))}
        </motion.div>

        {/* AI Generation Pipelines Section */}
        <div style={{ marginTop: 60, paddingTop: 40, borderTop: '1px solid var(--outline-variant, rgba(255,255,255,0.1))' }}>
          <div style={{ marginBottom: 24 }}>
            <h2 style={{ fontSize: 22, fontWeight: 700, margin: '0 0 6px 0', color: 'var(--on-surface, #fff)', display: 'flex', alignItems: 'center', gap: 10 }}>
              <span className="material-symbols-outlined" style={{ color: 'var(--primary, #00d4ff)' }}>auto_awesome</span>
              AI Weapon Generation & Custom Ingestion
            </h2>
            <p style={{ margin: 0, color: 'var(--outline, #888)', fontSize: 13.5 }}>
              Create custom 3D hardware assets, multi-part CAD assemblies, or import community models.
            </p>
          </div>
          {generateSection}
        </div>

        {/* Footer */}
        <footer className="ivory-footer">
          <div className="footer-brand">
            <span className="footer-brand-name">IVORY COMMAND</span>
            <div className="footer-divider" />
            <span className="footer-node">System Node: Alpha-7</span>
          </div>
          <nav className="footer-links">
            <button className="footer-link">Privacy Protocol</button>
            <button className="footer-link">Security Clearance</button>
            <button className="footer-link">Terminal Log</button>
          </nav>
        </footer>
      </div>
    </div>
  );
}
