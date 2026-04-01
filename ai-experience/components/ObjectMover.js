'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { ObjectDetector, FilesetResolver } from '@mediapipe/tasks-vision';

// Lite0 is the fastest and lightest model for low-end devices
const MODEL_PATH = "https://storage.googleapis.com/mediapipe-models/object_detector/efficientdet_lite0/float16/1/efficientdet_lite0.tflite";
const MISSIONS = [
  { label: "cell phone", emoji: "📱" },
  { label: "cup", emoji: "☕" }
];

const TARGET_SIZE = 140; // Slightly smaller for a tighter challenge
const GAME_DURATION = 30;

export default function ObjectMover() {
  const [isLoaded, setIsLoaded] = useState(false);
  const [errorMsg, setErrorMsg] = useState(null);
  
  // Use both state (for UI) and refs (for the requestAnimationFrame loop)
  const [gameStatus, _setGameStatus] = useState('idle'); 
  const gameStatusRef = useRef('idle');
  const setGameStatus = useCallback(status => {
    gameStatusRef.current = status;
    _setGameStatus(status);
  }, []);

  const [score, setScore] = useState(0);
  const [timeLeft, setTimeLeft] = useState(GAME_DURATION);
  
  const [mission, _setMission] = useState(MISSIONS[0]);
  const missionRef = useRef(MISSIONS[0]);
  const setMission = useCallback(m => {
    missionRef.current = m;
    _setMission(m);
  }, []);

  const [targetPos, _setTargetPos] = useState({ x: 100, y: 100 });
  const targetPosRef = useRef({ x: 100, y: 100 });
  const setTargetPos = useCallback(pos => {
    targetPosRef.current = pos;
    _setTargetPos(pos);
  }, []);

  const [isMuted, setIsMuted] = useState(false);
  
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const stageRef = useRef(null);
  const detectorRef = useRef(null);
  const requestRef = useRef(null);
  const audioCtxRef = useRef(null);
  const lastSuccessTimeRef = useRef(0);

  // sound helper
  const playSound = useCallback((freq, duration, type = "sine", volume = 0.1) => {
    if (isMuted) return;
    try {
      if (!audioCtxRef.current) audioCtxRef.current = new (window.AudioContext || window.webkitAudioContext)();
      const ctx = audioCtxRef.current;
      if (ctx.state === 'suspended') ctx.resume();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = type;
      osc.frequency.setValueAtTime(freq, ctx.currentTime);
      gain.gain.setValueAtTime(volume, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + duration);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + duration);
    } catch (e) {}
  }, [isMuted]);

  const triggerSuccessSound = useCallback(() => {
    playSound(587, 0.08); // 레
    setTimeout(() => playSound(739, 0.08), 80); // 파#
    setTimeout(() => playSound(880, 0.1), 160); // 라
  }, [playSound]);

  const triggerGameOverSound = useCallback(() => {
    playSound(440, 0.15); 
    setTimeout(() => playSound(220, 0.3), 150);
  }, [playSound]);

  const triggerConfetti = useCallback(() => {
    if (!stageRef.current) return;
    const colors = ["#4ECDC4", "#FF6B6B", "#FFD93D", "#6BCB77", "#4D96FF"];
    for (let i = 0; i < 15; i++) {
        const p = document.createElement("div");
        p.className = "confetti-piece";
        p.style.backgroundColor = colors[Math.floor(Math.random() * colors.length)];
        p.style.left = (Math.random() * 100) + "%";
        p.style.top = "-20px";
        p.style.width = "10px";
        p.style.height = "10px";
        p.style.animationDuration = (Math.random() * 1 + 1) + "s";
        stageRef.current.appendChild(p);
        setTimeout(() => p.remove(), 1500);
    }
  }, []);

  const getRandomPos = () => {
    const padding = 20;
    const maxX = 640 - TARGET_SIZE - padding;
    const maxY = 480 - TARGET_SIZE - padding;
    const x = Math.floor(Math.random() * (maxX - padding)) + padding;
    const y = Math.floor(Math.random() * (maxY - padding)) + padding;
    return { x, y };
  };

  const nextMission = useCallback(() => {
    setMission(MISSIONS[Math.floor(Math.random() * MISSIONS.length)]);
    setTargetPos(getRandomPos());
  }, [setMission, setTargetPos]);

  const startGame = () => {
    setScore(0);
    setTimeLeft(GAME_DURATION);
    setGameStatus('playing');
    lastSuccessTimeRef.current = 0;
    nextMission();
    playSound(880, 0.1, "sine");
  };

  const handleSuccess = useCallback(() => {
    setScore(s => s + 1);
    triggerSuccessSound();
    triggerConfetti();
    nextMission(); // Instant mission swap
  }, [triggerSuccessSound, triggerConfetti, nextMission]);

  // High-performance detection loop
  const predictLoop = useCallback(async () => {
    if (!videoRef.current || !detectorRef.current || !canvasRef.current) return;
    
    if (videoRef.current.readyState >= 2) {
      const now = performance.now();
      const detections = await detectorRef.current.detectForVideo(videoRef.current, now);
      
      const ctx = canvasRef.current.getContext('2d', { alpha: true });
      ctx.clearRect(0, 0, 640, 480);

      // We read the current game states directly from refs! This fixes the frozen score bug.
      const currentStatus = gameStatusRef.current;
      const currentMission = missionRef.current;
      const currentTarget = targetPosRef.current;

      if (detections.detections) {
        for (const det of detections.detections) {
          const label = det.categories[0].categoryName;
          if (!MISSIONS.some(m => m.label === label)) continue;

          const { originX, originY, width, height } = det.boundingBox;
          const centerX = originX + width / 2;
          const centerY = originY + height / 2;

          // Draw active mission object indicator
          const isTargetObject = label === currentMission.label && currentStatus === 'playing';
          ctx.strokeStyle = isTargetObject ? "#4ECDC4" : "rgba(255, 255, 255, 0.2)";
          ctx.lineWidth = isTargetObject ? 3 : 1;
          ctx.strokeRect(originX, originY, width, height);

          // Center Dot
          ctx.fillStyle = isTargetObject ? "#FF6B6B" : "rgba(255, 255, 255, 0.5)";
          ctx.beginPath();
          ctx.arc(centerX, centerY, 6, 0, Math.PI * 2);
          ctx.fill();

          // Instant collision detection logic
          if (isTargetObject) {
            const inX = centerX >= currentTarget.x && centerX <= currentTarget.x + TARGET_SIZE;
            const inY = centerY >= currentTarget.y && centerY <= currentTarget.y + TARGET_SIZE;
            
            // Success cooling time: 400ms to prevent duplicate scoring
            if (inX && inY && (now - lastSuccessTimeRef.current > 400)) {
              lastSuccessTimeRef.current = now;
              handleSuccess();
            }
          }
        }
      }
    }
    requestRef.current = window.requestAnimationFrame(predictLoop);
  }, [handleSuccess]);

  useEffect(() => {
    async function init() {
      try {
        const vision = await FilesetResolver.forVisionTasks("https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/wasm");
        const detector = await ObjectDetector.createFromOptions(vision, {
          baseOptions: { 
            modelAssetPath: MODEL_PATH, 
            delegate: "GPU" // Ensure GPU acceleration for fast performance
          },
          scoreThreshold: 0.35,
          runningMode: "VIDEO"
        });
        detectorRef.current = detector;
        
        const stream = await navigator.mediaDevices.getUserMedia({ 
          video: { width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { ideal: 30 } } 
        });
        
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          videoRef.current.onloadedmetadata = () => {
            videoRef.current.play();
            setIsLoaded(true);
            requestRef.current = window.requestAnimationFrame(predictLoop);
          };
        }
      } catch (err) {
        setErrorMsg("저사양 모드 로딩 실패: 카메라 및 브라우저 성능을 확인해주세요.");
      }
    }
    init();
    return () => {
      if (requestRef.current) window.cancelAnimationFrame(requestRef.current);
      if (videoRef.current?.srcObject) videoRef.current.srcObject.getTracks().forEach(t => t.stop());
    };
  }, [predictLoop]);

  useEffect(() => {
    let timer;
    if (gameStatus === 'playing' && timeLeft > 0) {
      timer = setInterval(() => setTimeLeft(prev => prev - 1), 1000);
    } else if (timeLeft === 0 && gameStatus === 'playing') {
      setGameStatus('ended');
      triggerGameOverSound();
    }
    return () => clearInterval(timer);
  }, [gameStatus, timeLeft, triggerGameOverSound, setGameStatus]);

  if (errorMsg) return <div className="game-placeholder">{errorMsg}</div>;

  return (
    <div className="mover-wrapper">
      <h2 className="mover-title">📦 초스피드 물건 이동</h2>
      
      <div className="detector-stage" ref={stageRef}>
        {!isLoaded && (
          <div className="game-over-panel" style={{ background: 'var(--background)' }}>
             <div className="spinner-wave">
                <div className="loading-circle" style={{ borderColor: '#4ECDC4 transparent transparent transparent' }}></div>
                <p style={{ color: '#4ECDC4', letterSpacing: '2px' }}>AI ENGINE LOADING...</p>
             </div>
          </div>
        )}

        <button className="mute-toggle" onClick={() => setIsMuted(m => !m)} style={{ opacity: 0.6 }}>
          {isMuted ? "🔇" : "🔊"}
        </button>

        {isLoaded && gameStatus === 'playing' && (
          <>
            <div className="timer-track" style={{ height: '4px' }}>
              <div 
                className={`timer-fill ${timeLeft <= 10 ? 'warning' : ''}`} 
                style={{ width: `${(timeLeft / GAME_DURATION) * 100}%` }}
              />
            </div>
            <div className="game-hud" style={{ top: '20px' }}>
              <div className="mission-card" style={{ background: 'rgba(0,0,0,0.6)', border: '1px solid #4ECDC4' }}>
                {mission.emoji} {mission.label} GO!
              </div>
              <div className="score-display" style={{ fontSize: '3.5rem' }}>{score}</div>
            </div>
            <div 
              className="target-zone" 
              style={{ 
                left: targetPos.x, 
                top: targetPos.y, 
                width: TARGET_SIZE, 
                height: TARGET_SIZE,
                borderWidth: '3px'
              }} 
            />
          </>
        )}

        {gameStatus === 'ended' && (
          <div className="game-over-panel">
            <span className="final-score-title">TOTAL SCORE</span>
            <span className="final-score-val">{score}</span>
            <button className="btn-game-start" onClick={startGame}>RETRY</button>
          </div>
        )}

        {isLoaded && gameStatus === 'idle' && (
          <div className="game-over-panel" style={{ background: 'rgba(0,0,0,0.5)' }}>
            <button className="btn-game-start" onClick={startGame}>START MISSION</button>
          </div>
        )}
        
        <video ref={videoRef} className="detector-video" muted playsInline />
        <canvas ref={canvasRef} className="detector-canvas" width={640} height={480} />
      </div>

      <div style={{ color: '#64748b', fontSize: '0.85rem', textAlign: 'center', marginTop: '1rem' }}>
        <strong>초경량 모델(Lite0)</strong>이 적용되어 저사양 PC에서도 빠르게 동작합니다. <br/>
        중심점을 타겟 영역에 넣으면 즉시 점수가 올라갑니다!
      </div>
    </div>
  );
}
