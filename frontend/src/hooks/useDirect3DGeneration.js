/**
 * useDirect3DGeneration — React hook for the direct name -> image -> 3D pipeline.
 * Manages SSE connection for real-time progress: web image search -> preprocess -> Hunyuan3D-2.1.
 */
import { useState, useCallback, useRef } from 'react';

const API_BASE = '/api';

export function useDirect3DGeneration() {
  const [sourceImageUrl, setSourceImageUrl] = useState(null);
  const [sourceUrl, setSourceUrl] = useState(null);
  const [preprocessedImageUrl, setPreprocessedImageUrl] = useState(null);
  const [glbUrl, setGlbUrl] = useState(null);
  const [modelSource, setModelSource] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [phase, setPhase] = useState('');
  const eventSourceRef = useRef(null);

  const generate = useCallback(async (weaponName) => {
    setLoading(true);
    setError(null);
    setSourceImageUrl(null);
    setSourceUrl(null);
    setPreprocessedImageUrl(null);
    setGlbUrl(null);
    setModelSource(null);
    setPhase('search');

    try {
      const eventSource = new EventSource(
        `${API_BASE}/generate-3d-direct/stream/${encodeURIComponent(weaponName)}`
      );
      eventSourceRef.current = eventSource;

      eventSource.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          setPhase(data.phase);

          if (data.phase === 'search' && data.status === 'complete') {
            setSourceImageUrl(data.image_url);
            setSourceUrl(data.source_url);
          }

          if (data.phase === 'preprocess' && data.status === 'complete') {
            setPreprocessedImageUrl(data.image_url);
          }

          if (data.phase === 'model' && data.status === 'complete') {
            setGlbUrl(data.glb_url);
            setModelSource(data.model_source);
          }

          if (data.phase === 'complete') {
            if (data.data) {
              setSourceImageUrl(data.data.source_image_url);
              setSourceUrl(data.data.source_url);
              setPreprocessedImageUrl(data.data.preprocessed_image_url);
              setGlbUrl(data.data.glb_url);
              setModelSource(data.data.model_source);
            }
            setLoading(false);
            eventSource.close();
          }

          if (data.phase === 'error') {
            setError(data.message);
            setLoading(false);
            eventSource.close();
          }
        } catch (parseErr) {
          console.error('[SSE] Parse error:', parseErr, event.data);
        }
      };

      eventSource.onerror = () => {
        if (eventSource.readyState === EventSource.CLOSED) return;
        setError('Connection lost. Generation may still be running.');
        setLoading(false);
        eventSource.close();
      };
    } catch (err) {
      setError(err.message);
      setLoading(false);
    }
  }, []);

  const reset = useCallback(() => {
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
    }
    setSourceImageUrl(null);
    setSourceUrl(null);
    setPreprocessedImageUrl(null);
    setGlbUrl(null);
    setModelSource(null);
    setLoading(false);
    setError(null);
    setPhase('');
  }, []);

  return {
    sourceImageUrl,
    sourceUrl,
    preprocessedImageUrl,
    glbUrl,
    modelSource,
    loading,
    error,
    phase,
    generate,
    reset,
    isComplete: phase === 'complete',
  };
}
