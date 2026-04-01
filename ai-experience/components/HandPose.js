'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { HandLandmarker, FilesetResolver } from '@mediapipe/tasks-vision';

const MODEL_PATH = "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task";
const GAME_DURATION = 30;
const HOLD_TARGET = 3000; // 3 seconds to hold a gesture

export default function HandPose() {
  const [isLoaded, setIsLoaded] = useState(false);
  const [errorMsg, setErrorMsg] = useState(null);
  const [debugData, setDebugData] = useState([]);

  // Game States
  const [gameStatus, setGameStatus] = useState('idle'); // idle, playing, ended
  const [score, setScore] = useState(0);
  const [timeLeft, setTimeLeft] = useState(GAME_DURATION);
  const [activeTab, setActiveTab] = useState('basic');
  const [mission, setMission] = useState(null);
  const [holdProgress, setHoldProgress] = useState(0);
  const [isSuccessEffect, setIsSuccessEffect] = useState(false);

  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const stageRef = useRef(null);
  const landmarkerRef = useRef(null);
  const requestRef = useRef(null);
  const audioCtxRef = useRef(null);
  
  const historyRef = useRef({});
  const gestureHistoryRef = useRef({});
  const lastTimeRef = useRef(0);
  const holdTimeRef = useRef(0);

  const GESTURES = {
    OK: { label: "OK", emoji: "👌" },
    V: { label: "V", emoji: "✌️" },
    THUMBS_UP: { label: "엄지척", emoji: "👍" },
    FIST: { label: "주먹", emoji: "✊" },
    PAPER: { label: "보", emoji: "🖐" },
    FREE: { label: "자유 제스처", emoji: "✨" }
  };

  const MISSIONS = ["OK", "V", "THUMBS_UP", "FIST", "PAPER"];

  const playSound = useCallback((freq, duration, type = "sine", volume = 0.1) => {
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
  }, []);

  const triggerSuccessSound = useCallback(() => {
    playSound(523, 0.1); // 도
    setTimeout(() => playSound(659, 0.1), 100); // 미
    setTimeout(() => playSound(784, 0.15), 200); // 솔
  }, [playSound]);

  const triggerConfetti = useCallback(() => {
    if (!stageRef.current) return;
    const colors = ["#00AFFF", "#7B61FF", "#FFD93D", "#6BCB77", "#FF6B6B"];
    for (let i = 0; i < 20; i++) {
        const p = document.createElement("div");
        p.className = "confetti-piece";
        p.style.backgroundColor = colors[Math.floor(Math.random() * colors.length)];
        p.style.left = (Math.random() * 100) + "%";
        p.style.top = "-20px";
        p.style.animationDuration = (Math.random() * 1 + 1) + "s";
        stageRef.current.appendChild(p);
        setTimeout(() => p.remove(), 1500);
    }
  }, []);

  const pickNewMission = useCallback(() => {
    const next = MISSIONS[Math.floor(Math.random() * MISSIONS.length)];
    setMission(next);
    holdTimeRef.current = 0;
    setHoldProgress(0);
  }, []);

  const startGame = () => {
    setScore(0);
    setTimeLeft(GAME_DURATION);
    setGameStatus('playing');
    pickNewMission();
    playSound(880, 0.1);
  };

  const HAND_CONNECTIONS = [
    [0, 1], [1, 2], [2, 3], [3, 4],
    [0, 5], [5, 6], [6, 7], [7, 8],
    [0, 9], [9, 10], [10, 11], [11, 12],
    [0, 13], [13, 14], [14, 15], [15, 16],
    [0, 17], [17, 18], [18, 19], [19, 20],
    [5, 9], [9, 13], [13, 17]
  ];

  const getStableResult = (hIndex, currentResult) => {
    if (!historyRef.current[hIndex]) historyRef.current[hIndex] = [];
    const history = historyRef.current[hIndex];
    history.push(currentResult);
    if (history.length > 3) history.shift();
    if (history.length < 3) return currentResult;
    const stable = {};
    ['thumb', 'index', 'middle', 'ring', 'pinky'].forEach(key => {
      stable[key] = history.filter(h => h[key] === true).length >= 2;
    });
    return stable;
  };

  const getStableGesture = (hIndex, currentGesture) => {
    if (!gestureHistoryRef.current[hIndex]) gestureHistoryRef.current[hIndex] = [];
    const gHistory = gestureHistoryRef.current[hIndex];
    gHistory.push(currentGesture);
    if (gHistory.length > 5) gHistory.shift();
    const counts = {};
    gHistory.forEach(g => { counts[g] = (counts[g] || 0) + 1; });
    const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]);
    return { gesture: sorted[0][0], count: sorted[0][1], total: gHistory.length };
  };

  const predictLoop = useCallback(async (time) => {
    if (!videoRef.current || !landmarkerRef.current || !canvasRef.current) return;
    
    if (videoRef.current.readyState >= 2) {
      const delta = time - lastTimeRef.current;
      lastTimeRef.current = time;

      const video = videoRef.current;
      const canvas = canvasRef.current;
      const ctx = canvas.getContext('2d');
      if (canvas.width !== 640) { canvas.width = 640; canvas.height = 480; }
      
      const results = await landmarkerRef.current.detectForVideo(video, performance.now());
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      const currentDebug = [];

      if (results.landmarks && results.landmarks.length > 0) {
        results.landmarks.forEach((landmarks, i) => {
          const handedness = results.handednesses[i][0].categoryName;
          const isPalm = handedness === "Right" ? landmarks[5].x > landmarks[17].x : landmarks[5].x < landmarks[17].x;
          
          const indexOpen = landmarks[8].y < landmarks[6].y;
          const middleOpen = landmarks[12].y < landmarks[10].y;
          const ringOpen = landmarks[16].y < landmarks[14].y;
          const pinkyOpen = landmarks[20].y < landmarks[18].y;
          const t4 = landmarks[4], t3 = landmarks[3];
          let thumbOpen = (handedness === "Right") ? (isPalm ? t4.x > t3.x : t4.x < t3.x) : (isPalm ? t4.x < t3.x : t4.x > t3.x);

          const stableResult = getStableResult(i, { thumb: thumbOpen, index: indexOpen, middle: middleOpen, ring: ringOpen, pinky: pinkyOpen });

          let currentKey = "FREE";
          const distTI = Math.sqrt(Math.pow(landmarks[4].x - landmarks[8].x, 2) + Math.pow(landmarks[4].y - landmarks[8].y, 2));
          if (distTI <= 0.06 && stableResult.middle && stableResult.ring && stableResult.pinky) currentKey = "OK";
          else if (stableResult.index && stableResult.middle && !stableResult.thumb && !stableResult.ring && !stableResult.pinky) currentKey = "V";
          else if (stableResult.thumb && !stableResult.index && !stableResult.middle && !stableResult.ring && !stableResult.pinky) currentKey = "THUMBS_UP";
          else if (!stableResult.thumb && !stableResult.index && !stableResult.middle && !stableResult.ring && !stableResult.pinky) currentKey = "FIST";
          else if (stableResult.thumb && stableResult.index && stableResult.middle && stableResult.ring && stableResult.pinky) currentKey = "PAPER";

          const stableGesture = getStableGesture(i, currentKey);
          const activeGestureData = GESTURES[stableGesture.gesture];

          currentDebug.push({
            handedness, side: isPalm ? "손바닥" : "손등", openCount: Object.values(stableResult).filter(v => v).length,
            gesture: activeGestureData, stability: stableGesture,
            fingers: [
              { name: "엄지", c1: `x:${t4.x.toFixed(2)}`, c2: `x:${t3.x.toFixed(2)}`, comp: "X-Axis", res: stableResult.thumb ? "펴짐" : "접힘" },
              { name: "검지", c1: `y:${landmarks[8].y.toFixed(2)}`, c2: `y:${landmarks[6].y.toFixed(2)}`, comp: "Y-Axis", res: stableResult.index ? "펴짐" : "접힘" },
              { name: "중지", c1: `y:${landmarks[12].y.toFixed(2)}`, c2: `y:${landmarks[10].y.toFixed(2)}`, comp: "Y-Axis", res: stableResult.middle ? "펴짐" : "접힘" },
              { name: "약지", c1: `y:${landmarks[16].y.toFixed(2)}`, c2: `y:${landmarks[14].y.toFixed(2)}`, comp: "Y-Axis", res: stableResult.ring ? "펴짐" : "접힘" },
              { name: "새끼", c1: `y:${landmarks[20].y.toFixed(2)}`, c2: `y:${landmarks[18].y.toFixed(2)}`, comp: "Y-Axis", res: stableResult.pinky ? "펴짐" : "접힘" },
            ]
          });

          // Game Logic
          if (gameStatus === 'playing' && stableGesture.gesture === mission) {
            holdTimeRef.current += delta;
            setHoldProgress(Math.min(100, (holdTimeRef.current / HOLD_TARGET) * 100));
            if (holdTimeRef.current >= HOLD_TARGET) {
              setScore(s => s + 1);
              triggerSuccessSound();
              triggerConfetti();
              setIsSuccessEffect(true);
              setTimeout(() => setIsSuccessEffect(false), 1000);
              pickNewMission();
            }
          } else if (gameStatus === 'playing') {
            holdTimeRef.current = Math.max(0, holdTimeRef.current - delta * 0.5);
            setHoldProgress((holdTimeRef.current / HOLD_TARGET) * 100);
          }

          // Visuals
          ctx.strokeStyle = '#7B61FF'; ctx.lineWidth = 2;
          for (const [s, e] of HAND_CONNECTIONS) {
            ctx.beginPath(); ctx.moveTo(landmarks[s].x*640, landmarks[s].y*480); ctx.lineTo(landmarks[e].x*640, landmarks[e].y*480); ctx.stroke();
          }
          ctx.fillStyle = '#00AFFF';
          for (const p of landmarks) { ctx.beginPath(); ctx.arc(p.x*640, p.y*480, 5, 0, 7); ctx.fill(); }

          const wrist = landmarks[0];
          ctx.save();
          ctx.translate(wrist.x*640, wrist.y*480 - 80);
          ctx.scale(-1, 1);
          ctx.font = 'bold 32px "Noto Sans KR"'; ctx.textAlign = 'center';
          ctx.fillStyle = '#FFF'; ctx.fillText(`${activeGestureData.emoji} ${activeGestureData.label}`, 0, 0);
          ctx.restore();
        });
      } else {
        historyRef.current = {}; gestureHistoryRef.current = {};
        if (gameStatus === 'playing') {
          holdTimeRef.current = Math.max(0, holdTimeRef.current - 16 * 0.5);
          setHoldProgress((holdTimeRef.current / HOLD_TARGET) * 100);
        }
      }
      setDebugData(currentDebug);
    }
    requestRef.current = window.requestAnimationFrame(predictLoop);
  }, [gameStatus, mission, pickNewMission, triggerSuccessSound, triggerConfetti]);

  useEffect(() => {
    async function init() {
      try {
        const v = await FilesetResolver.forVisionTasks("https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/wasm");
        landmarkerRef.current = await HandLandmarker.createFromOptions(v, {
          baseOptions: { modelAssetPath: MODEL_PATH, delegate: "GPU" },
          runningMode: "VIDEO", numHands: 2
        });
        const stream = await navigator.mediaDevices.getUserMedia({ video: { width: 640, height: 480 } });
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          videoRef.current.onloadedmetadata = () => { videoRef.current.play(); setIsLoaded(true); requestRef.current = window.requestAnimationFrame(predictLoop); };
        }
      } catch (err) { setErrorMsg("로딩 실패: 카메라 권한을 확인하세요."); }
    }
    init();
    return () => { if (requestRef.current) window.cancelAnimationFrame(requestRef.current); };
  }, [predictLoop]);

  useEffect(() => {
    if (gameStatus === 'playing' && timeLeft > 0) {
      const t = setInterval(() => setTimeLeft(prev => prev - 1), 1000);
      return () => clearInterval(t);
    } else if (timeLeft === 0 && gameStatus === 'playing') {
      setGameStatus('ended');
    }
  }, [gameStatus, timeLeft]);

  if (errorMsg) return <div className="game-placeholder">{errorMsg}</div>;

  return (
    <div className="mover-wrapper" style={{ maxWidth: '1000px' }}>
      <h2 className="mover-title">✋ 핸드포즈 챌린지</h2>
      
      <div className="game-container" style={{ gap: '1.5rem', alignItems: 'stretch' }}>
        {/* Left: Webcam (65%) */}
        <div className="webcam-section" ref={stageRef} style={{ flex: 1.8, height: 'auto' }}>
          {!isLoaded && <div className="game-over-panel"><div className="loading-circle"></div></div>}
          <video ref={videoRef} className="detector-video" muted playsInline />
          <canvas ref={canvasRef} className="detector-canvas" width={640} height={480} />
          {isSuccessEffect && <div className="success-overlay" style={{ fontSize: '4rem' }}>🎉 SUCCESS!</div>}
        </div>

        {/* Right: Game Panel (35%) */}
        <div className="game-panel" style={{ flex: 1, background: 'rgba(23, 25, 30, 0.4)', borderRadius: '24px', padding: '1.5rem', border: '1px solid var(--card-border)' }}>
          <div className="tabs-header" style={{ marginBottom: '1.5rem', borderBottom: 'none' }}>
            <button className={`tab-btn ${activeTab === 'basic' ? 'active' : ''}`} onClick={() => setActiveTab('basic')} style={{ fontSize: '0.9rem', padding: '0.5rem 1rem' }}>🎯 기본</button>
            <button className={`tab-btn ${activeTab === 'custom' ? 'active' : ''}`} onClick={() => setActiveTab('custom')} style={{ fontSize: '0.9rem', padding: '0.5rem 1rem', opacity: 0.5 }}>✨ 커스텀</button>
          </div>

          <div className="battle-area" style={{ background: 'transparent', padding: 0 }}>
            {gameStatus === 'idle' && (
              <div style={{ textAlign: 'center' }}>
                <p style={{ fontSize: '0.9rem', marginBottom: '1.5rem', letterSpacing: 'normal', color: '#94a3b8' }}>30초 동안 랜덤하게 나오는<br/>제스처 미션을 수행하세요!</p>
                <button className="btn-game-start" onClick={startGame}>게임 시작</button>
              </div>
            )}

            {gameStatus === 'playing' && (
              <div style={{ width: '100%', display: 'flex', flexKey: 'column', gap: '1.5rem', flexDirection: 'column' }}>
                <div style={{ textAlign: 'center' }}>
                  <span style={{ color: '#94a3b8', fontSize: '0.8rem', textTransform: 'uppercase' }}>현재 미션</span>
                  <div style={{ fontSize: '3.5rem', margin: '0.5rem 0' }}>{GESTURES[mission]?.emoji}</div>
                  <div style={{ fontSize: '1.2rem', fontWeight: 'bold' }}>{GESTURES[mission]?.label}를 유지하세요!</div>
                </div>

                <div style={{ width: '100%' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.5rem', fontSize: '0.8rem' }}>
                    <span>유지 게이지</span>
                    <span>{(holdProgress).toFixed(0)}%</span>
                  </div>
                  <div className="progress-track" style={{ height: '12px' }}>
                    <div className="progress-fill" style={{ 
                      width: `${holdProgress}%`, 
                      background: 'linear-gradient(90deg, #7B61FF, #00AFFF)',
                      boxShadow: holdProgress > 80 ? '0 0 15px #00AFFF' : 'none'
                    }} />
                  </div>
                </div>

                <div className="scoreboard" style={{ padding: '1rem' }}>
                   <div className="score-box">
                      <span className="score-label">SCORE</span>
                      <span className="score-value" style={{ fontSize: '2rem' }}>{score}</span>
                   </div>
                   <div style={{ width: '1px', background: 'rgba(255,255,255,0.1)', height: '40px' }}></div>
                   <div className="score-box">
                      <span className="score-label">TIME</span>
                      <span className={`score-value ${timeLeft <= 10 ? 'animate-pulse text-red' : ''}`} style={{ fontSize: '2rem', color: timeLeft <= 10 ? '#ef4444' : '#fff' }}>{timeLeft}s</span>
                   </div>
                </div>
              </div>
            )}

            {gameStatus === 'ended' && (
              <div style={{ textAlign: 'center' }}>
                <span className="final-score-title">최종 점수</span>
                <span className="final-score-val" style={{ fontSize: '3.5rem', display: 'block' }}>{score}</span>
                <button className="btn-game-start" onClick={startGame}>다시 하기</button>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Debug Table Below (Existing) */}
      {debugData.length > 0 && debugData.map((hand, idx) => (
        <div key={idx} style={{ width: '100%', marginTop: '1.5rem', padding: '12px', background: 'rgba(15, 23, 42, 0.8)', borderRadius: '16px', border: '1px solid rgba(255, 255, 255, 0.1)', fontFamily: 'monospace', fontSize: '11px', color: '#00ff00', overflowX: 'auto' }}>
          <table style={{ width: '100%', tableLayout: 'fixed', borderCollapse: 'collapse' }}>
            <thead><tr style={{ borderBottom: '1px solid rgba(255, 255, 255, 0.1)' }}><th style={{ textAlign: 'left' }}>Finger</th><th>P1</th><th>P2</th><th>Comp</th><th style={{ textAlign: 'right' }}>State</th></tr></thead>
            <tbody>{hand.fingers.map((f, i) => (<tr key={i}><td>{f.name}</td><td>{f.c1}</td><td>{f.c2}</td><td style={{ color: '#888' }}>{f.comp}</td><td style={{ textAlign: 'right', color: f.res==='펴짐'?'#00ff00':'#ff4444' }}>{f.res}</td></tr>))}</tbody>
          </table>
          <div style={{ marginTop: '10px', paddingTop: '8px', borderTop: '1px solid rgba(255, 255, 255, 0.1)', display: 'flex', justifyContent: 'space-between' }}>
            <span>{hand.side} | 펴짐: {hand.openCount}/5</span>
            <span style={{ color: '#facc15' }}>확정: {hand.gesture.emoji} {hand.gesture.label} ({hand.stability.count}/{hand.stability.total}f)</span>
          </div>
        </div>
      ))}

      <div style={{ color: '#64748b', fontSize: '0.85rem', textAlign: 'center', marginTop: '1rem' }}>
        <strong>주먹, 보, V, 엄지척, OK</strong> 등의 제스처를 인식합니다.<br/>
        5프레임 다수결 방식으로 판별이 안정적입니다.
      </div>
    </div>
  );
}
