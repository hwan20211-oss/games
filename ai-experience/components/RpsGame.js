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
    }, 2000);
  };

  if (!isLoaded) {
    return <div className="game-placeholder">AI 모델 및 카메라 준비 중...</div>;
  }

  return (
    <div className="game-container">
      {/* Webcam View */}
      <div className="webcam-section">
        <div ref={containerRef} />
        {countdown && (
          <div className="overlay-countdown">
            <div className="count-val">{countdown}</div>
          </div>
        )}
      </div>

      {/* Control Panel */}
      <div className="game-panel">
        <div className="scoreboard">
          <div className="score-box">
            <div className="score-label">나</div>
            <div className={`score-value ${resultType === 'win' ? 'pulse-win' : ''}`}>{playerScore}</div>
          </div>
          <div className="vs-badge">VS</div>
          <div className="score-box">
            <div className="score-label">AI</div>
            <div className="score-value">{computerScore}</div>
          </div>
        </div>

        <div className={`battle-area ${resultType === 'lose' ? 'animate-shake' : ''}`}>
          <div className="emoji-battle">
            <div className={isPlaying ? 'animate-bounce' : ''}>{playerEmoji}</div>
            <div className="vs-icon">⚡</div>
            <div className={isPlaying ? 'animate-bounce' : ''}>{computerEmoji}</div>
          </div>
          <div className={`result-msg ${resultType}`}>{resultText}</div>
          
          <div className="history-strip">
            {history.map((h, i) => (
              <div key={i} className={`history-dot ${h}`}>
                {h === 'win' ? '⭕' : h === 'lose' ? '❌' : '➖'}
              </div>
            ))}
          </div>
        </div>

        <div className="prediction-tray">
          <div className="prediction-meta">
            <span>실시간 AI 분석</span>
            <span>{currentLabel}</span>
          </div>
          {predictions.map((p, i) => {
            const classKey = p.className.includes("가위") ? "scissors" : p.className.includes("바위") ? "rock" : "paper";
            return (
              <div key={i} className="prediction-item">
                <div className="prediction-meta">
                  <small>{p.className}</small>
                  <small>{(p.probability * 100).toFixed(0)}%</small>
                </div>
                <div className="progress-track">
                  <div 
                    className={`progress-fill ${classKey}`} 
                    style={{ width: `${(p.probability * 100)}%` }} 
                  />
                </div>
              </div>
            );
          })}
        </div>

        <button 
          className="btn-game-start" 
          onClick={playGame} 
          disabled={isPlaying}
        >
          🎮 대결 시작하기
        </button>
        <button 
          style={{ background: 'transparent', color: '#64748b', border: 'none', cursor: 'pointer', fontSize: '0.8rem' }}
          onClick={resetGame}
        >
          🔄 점수 초기화
        </button>
      </div>
    </div>
  );
}
