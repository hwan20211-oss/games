'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import * as tmImage from '@teachablemachine/image';

const MODEL_URL = "https://teachablemachine.withgoogle.com/models/_8thCeqrK/";

export default function RpsGame() {
  const [isLoaded, setIsLoaded] = useState(false);
  const [playerScore, setPlayerScore] = useState(0);
  const [computerScore, setComputerScore] = useState(0);
  const [history, setHistory] = useState([]);
  const [isPlaying, setIsPlaying] = useState(false);
  const [countdown, setCountdown] = useState(null);
  const [resultText, setResultText] = useState('준비 완료!');
  const [resultType, setResultType] = useState(''); // 'win', 'lose', 'draw'
  const [playerEmoji, setPlayerEmoji] = useState('❓');
  const [computerEmoji, setComputerEmoji] = useState('❓');
  const [predictions, setPredictions] = useState([]);
  const [currentLabel, setCurrentLabel] = useState('대기 중...');
  
  const containerRef = useRef(null);
  const modelRef = useRef(null);
  const webcamRef = useRef(null);
  const audioCtxRef = useRef(null);
  const requestRef = useRef(null);

  // sound helper
  const playSound = useCallback((freq, duration, type = "sine", volume = 0.2) => {
    try {
      if (!audioCtxRef.current) {
        audioCtxRef.current = new (window.AudioContext || window.webkitAudioContext)();
      }
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
    } catch (e) {
      console.warn("Audio playback failed", e);
    }
  }, []);

  const sounds = {
    beep: () => playSound(800, 0.1),
    shutter: () => playSound(1200, 0.05, "square", 0.15),
    click: () => playSound(600, 0.05),
    win: () => {
      playSound(523.25, 0.15); 
      setTimeout(() => playSound(659.25, 0.15), 150);
      setTimeout(() => playSound(783.99, 0.3), 300);
    },
    lose: () => {
      playSound(783.99, 0.15); 
      setTimeout(() => playSound(659.25, 0.15), 150);
      setTimeout(() => playSound(523.25, 0.3), 300);
    },
    draw: () => {
      playSound(440, 0.1); 
      setTimeout(() => playSound(440, 0.2), 150);
    }
  };

  const predict = useCallback(async () => {
    if (!modelRef.current || !webcamRef.current) return;
    
    webcamRef.current.update();
    const prediction = await modelRef.current.predict(webcamRef.current.canvas);
    setPredictions(prediction);

    let highestIndex = 0;
    let highestProb = 0;
    for (let i = 0; i < prediction.length; i++) {
        if (prediction[i].probability > highestProb) {
            highestProb = prediction[i].probability;
            highestIndex = i;
        }
    }

    if (highestProb > 0.5) {
        setCurrentLabel(prediction[highestIndex].className);
    } else {
        setCurrentLabel("대기 중...");
    }
  }, []);

  const loop = useCallback(async () => {
    await predict();
    requestRef.current = window.requestAnimationFrame(loop);
  }, [predict]);

  useEffect(() => {
    async function init() {
      const modelURL = MODEL_URL + "model.json";
      const metadataURL = MODEL_URL + "metadata.json";

      try {
        const model = await tmImage.load(modelURL, metadataURL);
        modelRef.current = model;

        const webcam = new tmImage.Webcam(400, 400, true);
        await webcam.setup();
        await webcam.play();
        webcamRef.current = webcam;

        if (containerRef.current) {
          containerRef.current.innerHTML = '';
          containerRef.current.appendChild(webcam.canvas);
        }

        setIsLoaded(true);
        requestRef.current = window.requestAnimationFrame(loop);
      } catch (err) {
        console.error("AI Init error", err);
        alert("카메라 사용 권한이 필요합니다.");
      }
    }

    init();

    return () => {
      if (requestRef.current) window.cancelAnimationFrame(requestRef.current);
      if (webcamRef.current) webcamRef.current.stop();
    };
  }, [loop]);

  const mapToMove = (choice) => {
    if (choice.includes("가위")) return { label: "가위", emoji: "✌️" };
    if (choice.includes("바위")) return { label: "바위", emoji: "✊" };
    if (choice.includes("보")) return { label: "보", emoji: "🖐" };
    return { label: "알수없음", emoji: "❓" };
  };

  const resetGame = () => {
    setPlayerScore(0);
    setComputerScore(0);
    setHistory([]);
    setResultText('준비 완료!');
    setResultType('');
    setPlayerEmoji('❓');
    setComputerEmoji('❓');
  };

  const playGame = async () => {
    if (isPlaying || !isLoaded) return;
    setIsPlaying(true);
    sounds.click();

    // 3, 2, 1 Countdown
    const countdownValues = ["3", "2", "1", "찰칵!"];
    for (const val of countdownValues) {
      setCountdown(val);
      if (val === "찰칵!") sounds.shutter();
      else sounds.beep();
      await new Promise(r => setTimeout(r, 800));
    }
    setCountdown(null);

    // AI Check at 'snapshot'
    const prediction = await modelRef.current.predict(webcamRef.current.canvas);
    let highestIndex = 0;
    let highestProb = 0;
    for (let i = 0; i < prediction.length; i++) {
        if (prediction[i].probability > highestProb) {
            highestProb = prediction[i].probability;
            highestIndex = i;
        }
    }

    if (highestProb < 0.6) {
        setResultText("인식 실패! 다시 무브해주세요");
        setResultType('lose');
        setIsPlaying(false);
        return;
    }

    const pMove = mapToMove(prediction[highestIndex].className);
    const moves = [
        { label: "바위", emoji: "✊" },
        { label: "가위", emoji: "✌️" },
        { label: "보", emoji: "🖐" }
    ];
    const cMove = moves[Math.floor(Math.random() * moves.length)];

    setPlayerEmoji(pMove.emoji);
    setComputerEmoji(cMove.emoji);

    // Determine result
    let res = 'draw';
    if (pMove.label === cMove.label) {
        res = 'draw';
    } else if (
        (pMove.label === "바위" && cMove.label === "가위") ||
        (pMove.label === "가위" && cMove.label === "보") ||
        (pMove.label === "보" && cMove.label === "바위")
    ) {
        res = 'win';
    } else {
        res = 'lose';
    }

    setResultType(res);
    if (res === 'win') {
        setResultText("🎉 당신의 승리!");
        setPlayerScore(s => s + 1);
        sounds.win();
    } else if (res === 'lose') {
        setResultText("💻 AI의 승리!");
        setComputerScore(s => s + 1);
        sounds.lose();
    } else {
        setResultText("🤝 무승부입니다!");
        sounds.draw();
    }

    setHistory(h => [res, ...h].slice(0, 5));

    // Finish
    setTimeout(() => {
        setIsPlaying(false);
        setCountdown(null);
    }, 2000);
  };

  if (!isLoaded) {
    return <div className="game-placeholder">AI 모델 및 카메라 준비 중...</div>;
  }

  return (
    <div className="game-container" style={{ display: 'flex', gap: '2rem', width: '100%', maxWidth: '1000px', alignItems: 'flex-start' }}>
      {/* Webcam View */}
      <div className="video-card" style={{ flex: 1.2 }}>
        <div ref={containerRef} className="video-wrapper mirrored" />
        {countdown && (
          <div className="overlay-countdown" style={{ 
            position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
            background: 'rgba(255,255,255,0.4)', backdropFilter: 'blur(10px)', zIndex: 10
          }}>
            <div className="count-val" style={{ fontSize: '8rem', fontWeight: 900, color: '#1e293b' }}>{countdown}</div>
          </div>
        )}
      </div>

      {/* Control Panel */}
      <div className="game-panel" style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '1.2rem' }}>
        <div className="panel-card" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '1.5rem 2rem' }}>
          <div className="score-box">
            <div style={{ fontSize: '0.75rem', color: '#94a3b8', fontWeight: 700, textTransform: 'uppercase', marginBottom: '0.2rem' }}>나</div>
            <div style={{ fontSize: '2.5rem', fontWeight: 800, color: '#1e293b' }}>{playerScore}</div>
          </div>
          <div style={{ fontSize: '1rem', fontWeight: 800, color: '#e2e8f0', background: '#f8fafc', padding: '0.5rem 1rem', borderRadius: '12px' }}>VS</div>
          <div className="score-box">
            <div style={{ fontSize: '0.75rem', color: '#94a3b8', fontWeight: 700, textTransform: 'uppercase', marginBottom: '0.2rem' }}>AI</div>
            <div style={{ fontSize: '2.5rem', fontWeight: 800, color: '#1e293b' }}>{computerScore}</div>
          </div>
        </div>

        <div className="panel-card" style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: '180px' }}>
          <div className="emoji-battle" style={{ display: 'flex', alignItems: 'center', gap: '1.5rem', fontSize: '4.5rem', marginBottom: '1rem' }}>
            <div className={isPlaying ? 'animate-bounce' : ''}>{playerEmoji}</div>
            <div style={{ fontSize: '1.2rem', opacity: 0.2 }}>⚡</div>
            <div className={isPlaying ? 'animate-bounce' : ''}>{computerEmoji}</div>
          </div>
          <div style={{ fontSize: '1.5rem', fontWeight: 800, color: resultType === 'win' ? '#facc15' : resultType === 'lose' ? '#f43f5e' : '#1e293b', minHeight: '2rem' }}>
            {resultText}
          </div>
          
          <div style={{ display: 'flex', gap: '0.5rem', marginTop: '1rem' }}>
            {history.map((h, i) => (
              <div key={i} style={{ 
                width: '10px', height: '10px', borderRadius: '50%',
                background: h === 'win' ? '#4ECDC4' : h === 'lose' ? '#f43f5e' : '#e2e8f0'
              }} />
            ))}
          </div>
        </div>

        <div className="panel-card" style={{ background: '#f8fafc', border: 'none' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.75rem', fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', marginBottom: '1rem' }}>
            <span>실시간 AI 분석</span>
            <span style={{ color: '#4ECDC4' }}>{currentLabel}</span>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.8rem' }}>
            {predictions.map((p, i) => {
              const colors = { "가위": "#fb7185", "바위": "#38bdf8", "보": "#818cf8" };
              const color = colors[p.className] || "#cbd5e1";
              return (
                <div key={i}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.8rem', marginBottom: '0.3rem', color: '#64748b', fontWeight: 600 }}>
                    <span>{p.className}</span>
                    <span>{(p.probability * 100).toFixed(0)}%</span>
                  </div>
                  <div style={{ height: '6px', background: '#e2e8f0', borderRadius: '3px', overflow: 'hidden' }}>
                    <div style={{ height: '100%', background: color, width: `${p.probability * 100}%`, transition: 'width 0.2s' }} />
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.8rem' }}>
          <button className="btn-game-start" onClick={playGame} disabled={isPlaying}>
            🎮 대결 시작하기
          </button>
          <button 
            style={{ padding: '0.8rem', background: 'transparent', color: '#94a3b8', border: 'none', cursor: 'pointer', fontSize: '0.85rem', fontWeight: 600 }}
            onClick={resetGame}
          >
            🔄 점수 초기화
          </button>
        </div>
      </div>
    </div>
  );
}
