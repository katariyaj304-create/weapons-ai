/**
 * useAssetGeneration — React hook for the multi-model generation pipeline.
 * Manages SSE connection for real-time progress from DeepSeek-R1 → FLUX → TRELLIS.
 */
import { useState, useCallback, useRef } from 'react';

const API_BASE = '/api';

export function useAssetGeneration() {
  const [bomData, setBomData] = useState(null);
  const [components, setComponents] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [phase, setPhase] = useState('');
  const [progress, setProgress] = useState([]);
  const [currentComponent, setCurrentComponent] = useState(-1);
  const eventSourceRef = useRef(null);

  const generate = useCallback(async (assetName) => {
    setLoading(true);
    setError(null);
    setBomData(null);
    setComponents([]);
    setProgress([]);
    setPhase('bom');
    setCurrentComponent(-1);

    try {
      const eventSource = new EventSource(
        `${API_BASE}/generate-asset/stream/${encodeURIComponent(assetName)}`
      );
      eventSourceRef.current = eventSource;

      eventSource.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          setProgress(prev => [...prev, data]);
          setPhase(data.phase);

          if (data.component !== undefined) {
            setCurrentComponent(data.component);
          }

          // BOM Analysis complete
          if (data.phase === 'bom' && data.status === 'complete') {
            setBomData(data.data);
            setComponents(
              data.data.components.map(c => ({
                ...c,
                image_url: null,
                glb_url: null,
                image_status: 'pending',
                model_status: 'pending',
              }))
            );
          }

          // Image generation events
          if (data.phase === 'image' && data.status === 'complete') {
            setComponents(prev =>
              prev.map((c, i) =>
                i === data.component
                  ? { ...c, image_url: data.image_url, image_status: 'complete' }
                  : c
              )
            );
          }
          if (data.phase === 'image' && data.status === 'running') {
            setComponents(prev =>
              prev.map((c, i) =>
                i === data.component ? { ...c, image_status: 'running' } : c
              )
            );
          }
          if (data.phase === 'image' && data.status === 'failed') {
            setComponents(prev =>
              prev.map((c, i) =>
                i === data.component ? { ...c, image_status: 'failed' } : c
              )
            );
          }

          // Model generation events
          if (data.phase === 'model' && data.status === 'complete') {
            setComponents(prev =>
              prev.map((c, i) =>
                i === data.component
                  ? {
                      ...c,
                      glb_url: data.glb_url,
                      model_status: 'complete',
                      model_source: data.model_source,
                    }
                  : c
              )
            );
          }
          if (data.phase === 'model' && data.status === 'running') {
            setComponents(prev =>
              prev.map((c, i) =>
                i === data.component ? { ...c, model_status: 'running' } : c
              )
            );
          }
          if (data.phase === 'model' && (data.status === 'failed' || data.status === 'skipped')) {
            setComponents(prev =>
              prev.map((c, i) =>
                i === data.component ? { ...c, model_status: 'failed' } : c
              )
            );
          }

          // Pipeline complete
          if (data.phase === 'complete') {
            if (data.data && data.data.components) {
              setComponents(data.data.components.map(c => ({
                ...c,
                image_status: c.image_url ? 'complete' : 'failed',
                model_status: c.glb_url ? 'complete' : 'failed',
              })));
            }
            setLoading(false);
            eventSource.close();
          }

          // Pipeline error
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
        setError('Connection lost. Pipeline may still be running.');
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
    setBomData(null);
    setComponents([]);
    setLoading(false);
    setError(null);
    setPhase('');
    setProgress([]);
    setCurrentComponent(-1);
  }, []);

  return {
    bomData,
    components,
    loading,
    error,
    phase,
    progress,
    currentComponent,
    generate,
    reset,
    isComplete: phase === 'complete',
  };
}
