import React, { useEffect, useState } from 'react';
import { Canvas, useThree } from '@react-three/fiber';
import { Center } from '@react-three/drei';
import { PREDEFINED_ASSETS } from '../assets_data';
import ModelViewer from './ModelViewer';

class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false };
  }
  static getDerivedStateFromError(error) {
    return { hasError: true };
  }
  componentDidCatch(error, errorInfo) {
    console.error("ModelViewer ErrorBoundary caught error:", error);
    this.props.onCatch();
  }
  render() {
    if (this.state.hasError) {
      return null;
    }
    return this.props.children;
  }
}

function SnapshotCapture({ asset, onCaptured, modelLoaded, setModelLoaded }) {
  const { gl, scene, camera } = useThree();

  useEffect(() => {
    // Reset loaded state when asset changes
    setModelLoaded(false);
  }, [asset.id, setModelLoaded]);

  useEffect(() => {
    if (!modelLoaded) return;
    
    // Wait a little bit for the model to render after it's loaded
    const timer = setTimeout(() => {
      try {
        const dataUrl = gl.domElement.toDataURL('image/png', 1.0);
        fetch(`/api/save-image/${asset.id}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ image: dataUrl })
        }).then(res => {
          if (!res.ok) throw new Error('Network response was not ok');
          console.log(`Saved snapshot for ${asset.id}`);
          onCaptured();
        }).catch(err => {
          console.error(`Failed to save ${asset.id}`, err);
          onCaptured();
        });
      } catch (err) {
        console.error("Error capturing snapshot", err);
        onCaptured();
      }
    }, 1500); // 1.5s after load to ensure textures and materials are fully processed

    return () => clearTimeout(timer);
  }, [modelLoaded, gl, asset.id, onCaptured]);

  return null;
}

export default function AutoSnapshot({ onComplete }) {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [modelLoaded, setModelLoaded] = useState(false);
  const modelsToProcess = PREDEFINED_ASSETS;

  if (currentIndex >= modelsToProcess.length) {
    if (onComplete) onComplete();
    return <div style={{position: 'absolute', zIndex: 9999, background: 'black', color: 'lime', padding: 20}}>Snapshot generation complete!</div>;
  }

  const currentAsset = modelsToProcess[currentIndex];
  const handleCaptured = () => setCurrentIndex(i => i + 1);

  return (
    <div style={{ position: 'absolute', top: 0, left: 0, width: '400px', height: '400px', zIndex: 9999, pointerEvents: 'none', background: '#FFFFFF', opacity: 1 }}>
      <div style={{ position: 'absolute', top: 10, left: 10, color: 'black', zIndex: 10000 }}>
        Processing {currentIndex + 1} / {modelsToProcess.length}: {currentAsset.name}
      </div>
      <Canvas
        camera={{ position: [5, 3, 5], fov: 50 }}
        gl={{ preserveDrawingBuffer: true, antialias: true }}
      >
        <color attach="background" args={['#FFFFFF']} />
        <ambientLight intensity={1.5} color="#ffffff" />
        <directionalLight position={[8, 12, 8]} intensity={1.5} color="#ffffff" />
        <directionalLight position={[-5, 6, -5]} intensity={0.8} color="#e8eae7" />
        <directionalLight position={[0, 5, 10]} intensity={1.0} color="#ffffff" />
        
        <Center>
           <ErrorBoundary key={currentAsset.id} onCatch={handleCaptured}>
             <ModelViewer
               modelUrl={currentAsset.url}
               parts={[]}
               activePart={null}
               onPartClick={() => {}}
               onMeshNamesFound={() => setModelLoaded(true)}
             />
           </ErrorBoundary>
        </Center>
        <SnapshotCapture 
          asset={currentAsset} 
          onCaptured={handleCaptured} 
          modelLoaded={modelLoaded} 
          setModelLoaded={setModelLoaded} 
        />
      </Canvas>
    </div>
  );
}
