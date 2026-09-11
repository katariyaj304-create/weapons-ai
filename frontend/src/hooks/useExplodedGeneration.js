/**
 * useExplodedGeneration — React hook for the exploded-assembly pipeline.
 * SSE phases: research (5 parts) -> shell -> part×5 (image + 3D) -> assembly -> complete.
 */
import { useState, useCallback, useRef } from 'react';

const API_BASE = '/api';

export function useExplodedGeneration() {
  const [components, setComponents] = useState([]);
  const [shellImageUrl, setShellImageUrl] = useState(null);
  const [assemblyUrl, setAssemblyUrl] = useState(null);
  const [kitInfo, setKitInfo] = useState(null); // library-asset attribution
  const [kitIntel, setKitIntel] = useState({}); // kit part label -> component intel
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [phase, setPhase] = useState('');
  const [message, setMessage] = useState('');
  const [currentComponent, setCurrentComponent] = useState(-1);
  const eventSourceRef = useRef(null);

  const generate = useCallback(async (weaponName) => {
    setLoading(true);
    setError(null);
    setComponents([]);
    setShellImageUrl(null);
    setAssemblyUrl(null);
    setKitInfo(null);
    setKitIntel({});
    setPhase('research');
    setMessage('');
    setCurrentComponent(-1);

    try {
      const eventSource = new EventSource(
        `${API_BASE}/generate-exploded/stream/${encodeURIComponent(weaponName)}`
      );
      eventSourceRef.current = eventSource;

      eventSource.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          setPhase(data.phase);
          if (data.message) setMessage(data.message);
          if (data.component !== undefined) setCurrentComponent(data.component);

          if (data.phase === 'research' && data.status === 'complete') {
            setComponents(
              (data.data?.components || []).map(c => ({
                ...c,
                image_url: null,
                glb_url: null,
                status: 'pending',
              }))
            );
          }

          if (data.phase === 'shell') {
            if (data.status === 'image_ready') setShellImageUrl(data.image_url);
          }

          if (data.phase === 'part') {
            setComponents(prev =>
              prev.map((c, i) => {
                if (i !== data.component) return c;
                if (data.status === 'complete') {
                  return { ...c, glb_url: data.glb_url, model_source: data.model_source, status: 'complete' };
                }
                if (data.status === 'failed') {
                  return { ...c, status: 'failed' };
                }
                return {
                  ...c,
                  status: 'running',
                  image_url: data.image_url || c.image_url,
                };
              })
            );
          }

          if (data.phase === 'assembly' && data.status === 'complete') {
            setAssemblyUrl(data.glb_url);
          }

          if (data.phase === 'complete') {
            if (data.data) {
              setAssemblyUrl(data.data.assembly_url);
              setShellImageUrl(data.data.shell_image_url);
              setKitInfo(data.data.kit || null);
              setKitIntel(data.data.kit_intel || {});
              if (data.data.components) {
                setComponents(data.data.components.map(c => ({
                  ...c,
                  status: c.glb_url ? 'complete' : 'failed',
                })));
              }
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
    setComponents([]);
    setShellImageUrl(null);
    setAssemblyUrl(null);
    setKitInfo(null);
    setKitIntel({});
    setLoading(false);
    setError(null);
    setPhase('');
    setMessage('');
    setCurrentComponent(-1);
  }, []);

  return {
    components,
    shellImageUrl,
    assemblyUrl,
    kitInfo,
    kitIntel,
    loading,
    error,
    phase,
    message,
    currentComponent,
    generate,
    reset,
    isComplete: phase === 'complete',
  };
}
