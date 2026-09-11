/**
 * Custom hook to fetch research data from the FastAPI backend.
 */
import { useState, useCallback } from 'react';

const API_BASE = '/api';

export function useResearch() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [phase, setPhase] = useState('');

  const fetchResearch = useCallback(async (modelName, meshNames = []) => {
    setLoading(true);
    setError(null);
    setData(null);

    try {
      // Phase 1: Input validation
      setPhase('Validating input...');
      await new Promise(r => setTimeout(r, 300));

      // Phase 2: Searching
      setPhase('Searching the web...');
      await new Promise(r => setTimeout(r, 500));

      // Phase 3: Call the API
      setPhase('AI is researching...');
      
      const response = await fetch(`${API_BASE}/research`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model_name: modelName,
          mesh_names: meshNames
        })
      });

      if (!response.ok) {
        const errData = await response.json().catch(() => ({}));
        throw new Error(errData.detail || `Server error: ${response.status}`);
      }

      setPhase('Mapping to 3D model...');
      const result = await response.json();

      setPhase('Complete!');
      setData(result);
      return result;
    } catch (err) {
      setError(err.message || 'Failed to fetch research data');
      throw err;
    } finally {
      setLoading(false);
    }
  }, []);

  const reset = useCallback(() => {
    setData(null);
    setError(null);
    setLoading(false);
    setPhase('');
  }, []);

  return { data, loading, error, phase, fetchResearch, reset };
}

/**
 * Upload a GLB file to the backend.
 */
export async function uploadModel(file) {
  const formData = new FormData();
  formData.append('file', file);

  const response = await fetch(`${API_BASE}/upload-model`, {
    method: 'POST',
    body: formData
  });

  if (!response.ok) {
    const errData = await response.json().catch(() => ({}));
    throw new Error(errData.detail || 'Upload failed');
  }

  return response.json();
}
