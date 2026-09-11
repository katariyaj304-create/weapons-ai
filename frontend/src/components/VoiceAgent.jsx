import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import './VoiceAgent.css';

function ElevenLabsAgent() {
  useEffect(() => {
    if (!document.querySelector('script[src="https://elevenlabs.io/convai-widget/index.js"]')) {
      const script = document.createElement('script');
      script.src = "https://elevenlabs.io/convai-widget/index.js";
      script.async = true;
      script.type = "text/javascript";
      document.body.appendChild(script);
    }
  }, []);

  return (
    <div className="elevenlabs-container" style={{ minHeight: '200px', display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column' }}>
      <elevenlabs-convai agent-id=""></elevenlabs-convai>
      <div style={{ marginTop: '16px', fontSize: '11px', color: '#666' }}>
        Powered by <a href="#" style={{ color: '#666' }}>ElevenLabs ConversationalAI</a>
      </div>
    </div>
  );
}

export default function VoiceAgent() {
  const [useElevenLabs, setUseElevenLabs] = useState(false);
  const [isOpen, setIsOpen] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [transcript, setTranscript] = useState('');
  
  const recognitionRef = useRef(null);
  const synthRef = useRef(window.speechSynthesis);

  useEffect(() => {
    // Setup Speech Recognition
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (SpeechRecognition) {
      recognitionRef.current = new SpeechRecognition();
      recognitionRef.current.continuous = false;
      recognitionRef.current.interimResults = true;

      recognitionRef.current.onresult = (event) => {
        let currentTranscript = '';
        for (let i = event.resultIndex; i < event.results.length; i++) {
          currentTranscript += event.results[i][0].transcript;
        }
        setTranscript(currentTranscript);
      };

      recognitionRef.current.onend = async () => {
        setIsListening(false);
        if (transcript.trim()) {
          await handleChatQuery(transcript);
        }
      };
    }
    
    return () => {
      if (recognitionRef.current) {
        recognitionRef.current.abort();
      }
      if (synthRef.current) {
        synthRef.current.cancel();
      }
    };
  }, [transcript]);

  const handleChatQuery = async (query) => {
    setIsSpeaking(true);
    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: query })
      });
      const data = await res.json();
      
      if (data.response) {
        speakResponse(data.response);
      }
    } catch (error) {
      console.error("Chat error:", error);
      speakResponse("Comms link offline. Check your connection.");
    }
  };

  const speakResponse = (text) => {
    if (!synthRef.current) return;
    synthRef.current.cancel();
    
    const utterance = new SpeechSynthesisUtterance(text);
    const voices = synthRef.current.getVoices();
    const preferredVoice = voices.find(v => v.name.includes('Google UK English Female') || v.name.includes('Samantha') || v.lang.includes('en-'));
    if (preferredVoice) utterance.voice = preferredVoice;
    
    utterance.pitch = 0.9;
    utterance.rate = 1.05;
    
    utterance.onend = () => {
      setIsSpeaking(false);
      setTranscript('');
    };
    
    synthRef.current.speak(utterance);
  };

  const toggleListening = (e) => {
    if (e) e.stopPropagation();
    if (isListening) {
      recognitionRef.current?.stop();
      setIsListening(false);
    } else {
      if (synthRef.current) synthRef.current.cancel();
      setIsSpeaking(false);
      setTranscript('');
      recognitionRef.current?.start();
      setIsListening(true);
    }
  };

  return (
    <div className="voice-agent-sidebar-widget" style={{ padding: '24px 16px', background: 'transparent', border: 'none', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
      <div className="voice-agent-header" style={{ width: '100%', display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
        <h3 style={{ fontSize: '13px', fontWeight: 'bold', textTransform: 'uppercase', color: '#000', margin: 0 }}>Ivory Intelligence</h3>
        <button 
          onClick={() => setUseElevenLabs(!useElevenLabs)}
          style={{ background: 'none', border: '1px solid #ccc', borderRadius: '4px', padding: '4px 8px', fontSize: '10px', cursor: 'pointer' }}
        >
          {useElevenLabs ? 'Use Native AI' : 'Use ElevenLabs'}
        </button>
      </div>
      
      {useElevenLabs ? (
        <ElevenLabsAgent />
      ) : (
        <div className="voice-agent-body" style={{ width: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
          {/* Native Globe Animation */}
          <div className={`globe-container ${isSpeaking ? 'speaking' : isListening ? 'listening' : 'idle'}`}>
            <div className="globe-orb"></div>
            <div className="globe-ring ring-1"></div>
            <div className="globe-ring ring-2"></div>
            <div className="globe-ring ring-3"></div>
            
            <button className="call-btn" onClick={toggleListening}>
              <span className="material-symbols-outlined">
                {isListening ? 'graphic_eq' : isSpeaking ? 'volume_up' : 'mic'}
              </span>
              <span>{isListening ? 'Listening...' : isSpeaking ? 'Speaking...' : 'Call AI'}</span>
            </button>
          </div>
          
          <div className="voice-transcript" style={{ marginTop: '16px', fontSize: '12px', color: '#666', textAlign: 'center', minHeight: '40px' }}>
            {transcript || (isSpeaking ? "Analyzing intelligence..." : "Tap 'Call AI' to speak.")}
          </div>
        </div>
      )}
    </div>
  );
}
