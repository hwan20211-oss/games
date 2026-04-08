'use client';

import { useEffect, useRef, useState } from 'react';

const MODEL_PATH = "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task";
const WASM_PATH  = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/wasm";

const FACE_OVAL = [10,338,297,332,284,251,389,356,454,323,361,288,397,365,379,378,400,377,152,148,176,149,150,136,172,58,132,93,234,127,162,21,54,103,67,109,10];
const LEFT_EYE  = [33,7,163,144,145,153,154,155,133,173,157,158,159,160,161,246,33];
const RIGHT_EYE = [362,382,381,380,374,373,390,249,263,466,388,387,386,385,384,398,362];
const LEFT_EYEBROW  = [70,63,105,66,107,55,65,52,53,46];
const RIGHT_EYEBROW = [300,293,334,296,336,285,295,282,283,276];
const NOSE_BRIDGE   = [168,6,197,195,5];
const LIPS_OUTER    = [61,146,91,181,84,17,314,405,321,375,291,409,270,269,267,0,37,39,40,185,61];
const LIPS_INNER    = [78,191,80,81,82,13,312,311,310,415,308,324,318,402,317,14,87,178,88,95,78];

// 주요 포인트: 눈(33,133,362,263), 코(1,4), 입(61,291,0,17), 턱(152,377,148,234,454)
const MAJOR_POINTS = [33, 133, 362, 263, 1, 4, 61, 291, 0, 17, 152, 377, 148, 234, 454];

function drawPolyline(ctx, lm, indices, w, h, close = false) {
  if (!lm || indices.length < 2) return;
  ctx.beginPath();
  ctx.moveTo(lm[indices[0]].x * w, lm[indices[0]].y * h);
  for (let i = 1; i < indices.length; i++) ctx.lineTo(lm[indices[i]].x * w, lm[indices[i]].y * h);
  if (close) ctx.closePath();
  ctx.stroke();
}

export default function SecurityGate({ onUnlockSuccess, isUnlocked }) {
  const videoRef    = useRef(null);
  const canvasRef   = useRef(null);
  const detectorRef = useRef(null);
  const rafRef      = useRef();
  const captureCanvasRef = useRef(null);

  const [isLoaded, setIsLoaded]         = useState(false);
  const [error, setError]               = useState(null);
  const [faceDetected, setFaceDetected] = useState(false);
  const landmarksRef = useRef(null);
  
  // 얼굴 등록 관련 상태
  const [registeredUsers, setRegisteredUsers] = useState([]);
  const [userName, setUserName] = useState('');
  const [showNameModal, setShowNameModal] = useState(false);
  const [countdown, setCountdown] = useState(0);
  const [completionMsg, setCompletionMsg] = useState('');

  // 입장 시도(잠금해제) 관련 상태
  const [scanStatus, setScanStatus] = useState('idle'); // idle, scanning, success, failure
  const [similarityScore, setSimilarityScore] = useState(0);
  const [identifiedUser, setIdentifiedUser] = useState(null);

  const initDetector = async () => {
    try {
      const vision = await import(/* webpackIgnore: true */ "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/vision_bundle.mjs");
      const { FaceLandmarker, FilesetResolver } = vision;
      const visionTasks = await FilesetResolver.forVisionTasks(WASM_PATH);
      detectorRef.current = await FaceLandmarker.createFromOptions(visionTasks, {
        baseOptions: { modelAssetPath: MODEL_PATH, delegate: "GPU" },
        runningMode: "VIDEO",
        numFaces: 1,
      });
      startCamera();
    } catch (err) {
      setError("Face model loading failed: " + err.message);
    }
  };

  const startCamera = async () => {
    if (!videoRef.current) return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { width: 640, height: 360 } });
      videoRef.current.srcObject = stream;
      videoRef.current.onloadedmetadata = async () => {
        try { await videoRef.current.play(); } catch (e) { if (e.name !== 'AbortError') throw e; }
        setIsLoaded(true);
        rafRef.current = requestAnimationFrame(predictLoop);
      };
    } catch (err) {
      setError("Camera access denied");
    }
  };

  const predictLoop = () => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!detectorRef.current || !video || video.readyState < 2 || !video.videoWidth) {
      rafRef.current = requestAnimationFrame(predictLoop);
      return;
    }
    try {
      const result = detectorRef.current.detectForVideo(video, performance.now());
      if (result) {
        drawLandmarks(result, canvas, video);
        const detected = result.faceLandmarks && result.faceLandmarks.length > 0;
        setFaceDetected(detected);
        if (detected) {
          landmarksRef.current = result.faceLandmarks[0];
        } else {
          landmarksRef.current = null;
        }
      }
    } catch (e) {
      console.error("Detection error:", e);
    }
    rafRef.current = requestAnimationFrame(predictLoop);
  };

  const drawLandmarks = (result, canvas, video) => {
    if (!canvas || !video || !result.faceLandmarks) return;
    const w = video.videoWidth, h = video.videoHeight;
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w; canvas.height = h;
    }
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, w, h);
    if (result.faceLandmarks.length === 0) return;
    const landmarks = result.faceLandmarks[0];

    ctx.fillStyle = 'rgba(255, 182, 193, 0.6)';
    for (const p of landmarks) { ctx.beginPath(); ctx.arc(p.x * w, p.y * h, 1, 0, Math.PI * 2); ctx.fill(); }

    ctx.strokeStyle = 'rgba(255, 182, 193, 0.85)';
    ctx.lineWidth = 1.2;
    drawPolyline(ctx, landmarks, FACE_OVAL, w, h, true);
    drawPolyline(ctx, landmarks, LEFT_EYE, w, h, true);
    drawPolyline(ctx, landmarks, RIGHT_EYE, w, h, true);
    drawPolyline(ctx, landmarks, LEFT_EYEBROW, w, h);
    drawPolyline(ctx, landmarks, RIGHT_EYEBROW, w, h);
    drawPolyline(ctx, landmarks, NOSE_BRIDGE, w, h);
    drawPolyline(ctx, landmarks, LIPS_OUTER, w, h, true);
    drawPolyline(ctx, landmarks, LIPS_INNER, w, h, true);
  };

  const extractFeatureVector = (landmarks) => {
    if (!landmarks) return null;
    const nose = landmarks[1];
    return MAJOR_POINTS.map(idx => {
      const p = landmarks[idx];
      return {
        x: p.x - nose.x,
        y: p.y - nose.y,
        z: p.z - nose.z
      };
    });
  };

  const calculateSimilarity = (v1, v2) => {
    if (!v1 || !v2) return 0;
    let distSq = 0;
    for (let i = 0; i < v1.length; i++) {
      distSq += Math.pow(v1[i].x - v2[i].x, 2);
      distSq += Math.pow(v1[i].y - v2[i].y, 2);
      distSq += Math.pow(v1[i].z - v2[i].z, 2);
    }
    const dist = Math.sqrt(distSq);
    // 거리를 0~100 점수로 변환 (스케일 200 적용)
    const score = Math.max(0, 100 - (dist * 200));
    return Math.round(score);
  };

  const handleRegisterStart = () => {
    if (registeredUsers.length >= 5) {
      alert("최대 5명까지 등록 가능합니다.");
      return;
    }
    setUserName('');
    setShowNameModal(true);
  };

  const handleUnlockAttempt = () => {
    if (registeredUsers.length === 0) return;
    setScanStatus('scanning');
    let count = 3;
    setCountdown(count);
    const timer = setInterval(() => {
      count -= 1;
      setCountdown(count);
      if (count <= 0) {
        clearInterval(timer);
        performScan();
      }
    }, 1000);
  };

  const performScan = () => {
    const currentLandmarks = landmarksRef.current;
    if (!currentLandmarks) {
      setScanStatus('failure');
      setSimilarityScore(0);
      setIdentifiedUser(null);
      setTimeout(() => setScanStatus('idle'), 3000);
      return;
    }

    const currentVector = extractFeatureVector(currentLandmarks);
    let bestMatch = null;
    let maxScore = -1;

    registeredUsers.forEach(user => {
      const score = calculateSimilarity(currentVector, user.vector);
      if (score > maxScore) {
        maxScore = score;
        bestMatch = user;
      }
    });

    setSimilarityScore(maxScore);
    if (maxScore >= 70) {
      setScanStatus('success');
      setIdentifiedUser(bestMatch);
      if (onUnlockSuccess) onUnlockSuccess(); // VIP 해금
    } else {
      setScanStatus('failure');
      setIdentifiedUser(null);
    }

    setTimeout(() => {
      setScanStatus('idle');
      setIdentifiedUser(null);
      setSimilarityScore(0);
    }, 4000);
  };

  const handleNameSubmit = (e) => {
    e.preventDefault();
    if (!userName.trim()) return;
    setShowNameModal(false);
    startCountdown();
  };

  const startCountdown = () => {
    let count = 3;
    setCountdown(count);
    const timer = setInterval(() => {
      count -= 1;
      setCountdown(count);
      if (count <= 0) {
        clearInterval(timer);
        completeRegistration();
      }
    }, 1000);
  };

  const completeRegistration = () => {
    const currentLandmarks = landmarksRef.current;
    if (!currentLandmarks) {
      alert("얼굴을 인식할 수 없어 등록에 실패했습니다.");
      return;
    }

    const vector = extractFeatureVector(currentLandmarks);
    const thumbnail = captureThumbnail();

    const newUser = {
      id: Date.now(),
      name: userName,
      vector,
      thumbnail
    };

    setRegisteredUsers(prev => [...prev.slice(-4), newUser]);
    setCompletionMsg('✅ 등록 완료!');
    setTimeout(() => {
      setCompletionMsg('');
    }, 1000);
  };

  const captureThumbnail = () => {
    const video = videoRef.current;
    if (!video) return null;
    const canvas = document.createElement('canvas');
    canvas.width = 60;
    canvas.height = 45;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/jpeg');
  };

  const deleteUser = (id) => {
    setRegisteredUsers(prev => prev.filter(user => user.id !== id));
  };

  useEffect(() => {
    initDetector();
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      if (videoRef.current?.srcObject) videoRef.current.srcObject.getTracks().forEach(t => t.stop());
    };
  }, []);

  const getStatusText = () => {
    if (scanStatus === 'scanning') return countdown > 0 ? "스캔 준비 중..." : "스캔 중...";
    if (scanStatus === 'success') return "입장 허가!";
    if (scanStatus === 'failure') return "입장 거부!";
    return "대기 중";
  };

  const getBorderColor = () => {
    if (scanStatus === 'scanning') return '#38bdf8';
    if (scanStatus === 'success' || isUnlocked) return '#4ECDC4';
    if (scanStatus === 'failure') return '#ff6b6b';
    return '#e2e8f0';
  };

  return (
    <div className="detector-panel" style={{ width: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
      <div style={{ textAlign: 'center', marginBottom: '1.5rem' }}>
        <h2 style={{ fontSize: '1.8rem', color: '#1e293b' }}>🔐 VIP 라운지 — 보안 게이트</h2>
        {isUnlocked && <div style={{ color: '#4ECDC4', fontWeight: 700, marginTop: '0.5rem' }}>🔓 현재 VIP 입장 권한이 활성화되어 있습니다.</div>}
      </div>

      {error && <div style={{ padding: '3rem', textAlign: 'center', color: '#ff6b6b' }}>{error}</div>}

      {!error && (
        <>
          <div className={`video-card ${scanStatus === 'scanning' ? 'pulse-blue' : ''} ${scanStatus === 'failure' ? 'animate-shake' : ''}`} 
               style={{ 
                 padding: 0, overflow: 'hidden', maxWidth: '640px', width: '100%', position: 'relative', 
                 border: `3px solid ${getBorderColor()}`, borderRadius: '24px', transition: 'all 0.3s ease',
                 background: '#f8fafc', boxShadow: '0 10px 30px rgba(0,0,0,0.05)'
               }}>
            {!isLoaded && (
              <div style={{ padding: '4rem 2rem', textAlign: 'center' }}>
                <div className="spinner-icon" style={{ margin: '0 auto 1.5rem' }}></div>
                <p style={{ color: '#64748b' }}>🔄 얼굴 인식 보안 시스템 기동 중...</p>
              </div>
            )}
            <div className={`video-wrapper mirrored`} style={{ display: isLoaded ? 'block' : 'none', position: 'relative' }}>
              <video ref={videoRef} playsInline muted style={{ display: 'block', width: '100%' }} />
              <canvas ref={canvasRef} style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%' }} />
              
              {/* 게이트 애니메이션 */}
              <div className={`gate-door left ${scanStatus === 'scanning' ? '' : 'open'}`}></div>
              <div className={`gate-door right ${scanStatus === 'scanning' ? '' : 'open'}`}></div>

              {/* 카운트다운 오버레이 */}
              {countdown > 0 && (
                <div style={{
                  position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
                  background: 'rgba(0,0,0,0.4)', borderRadius: '12px', zIndex: 10
                }}>
                  <span style={{ fontSize: '8rem', fontWeight: 900, color: '#fff', textShadow: '0 0 30px rgba(0,0,0,0.5)' }}>
                    {countdown}
                  </span>
                </div>
              )}

              {/* 스캔 결과 오버레이 */}
              {scanStatus !== 'idle' && countdown === 0 && (
                <div style={{
                  position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                  background: scanStatus === 'success' ? 'rgba(78, 205, 196, 0.1)' : scanStatus === 'failure' ? 'rgba(255, 107, 107, 0.1)' : 'rgba(56, 189, 248, 0.1)',
                  borderRadius: '12px', zIndex: 11
                }}>
                  {scanStatus === 'success' ? (
                    <div className="result-card success">
                      <div style={{ fontSize: '3rem', marginBottom: '0.5rem' }}>✅</div>
                      <div style={{ fontSize: '1.5rem', fontWeight: 800 }}>입장 허가!</div>
                      <div style={{ fontSize: '1.1rem', marginTop: '0.5rem' }}>{identifiedUser?.name}님 환영합니다!</div>
                      <div style={{ fontSize: '0.9rem', opacity: 0.8, marginTop: '0.5rem' }}>유사도: {similarityScore}%</div>
                    </div>
                  ) : scanStatus === 'failure' ? (
                    <div className="result-card failure">
                      <div style={{ fontSize: '3rem', marginBottom: '0.5rem' }}>🚫</div>
                      <div style={{ fontSize: '1.5rem', fontWeight: 800 }}>입장 거부!</div>
                      <div style={{ fontSize: '1.1rem', marginTop: '0.5rem' }}>등록되지 않은 얼굴입니다.</div>
                      <div style={{ fontSize: '0.9rem', opacity: 0.8, marginTop: '0.5rem' }}>유사도: {similarityScore}%</div>
                    </div>
                  ) : (
                    <div className="scanning-line"></div>
                  )}
                </div>
              )}

              {/* 등록 완료 메시지 */}
              {completionMsg && (
                <div style={{
                  position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
                  background: 'rgba(78, 205, 196, 0.2)', borderRadius: '12px', zIndex: 20
                }}>
                  <div style={{ padding: '1.5rem 3rem', background: '#4ECDC4', color: '#0f172a', borderRadius: '50px', fontWeight: 800, fontSize: '1.5rem', boxShadow: '0 10px 30px rgba(0,0,0,0.3)' }}>
                    {completionMsg}
                  </div>
                </div>
              )}
            </div>
          </div>

          <div style={{ display: 'flex', gap: '1rem', marginTop: '1.5rem', width: '100%', maxWidth: '640px' }}>
            <div style={{ flex: 1, textAlign: 'center', background: '#fff', padding: '1.2rem', borderRadius: '20px', border: '1px solid #e2e8f0', boxShadow: '0 4px 6px rgba(0,0,0,0.02)' }}>
              <div style={{ fontSize: '0.75rem', color: '#94a3b8', marginBottom: '0.5rem', textTransform: 'uppercase', letterSpacing: '1px', fontWeight: 700 }}>보안 상태</div>
              <div style={{ fontWeight: 800, fontSize: '1.2rem', color: getBorderColor() }}>{getStatusText()}</div>
            </div>
            <div style={{ flex: 1, textAlign: 'center', background: '#fff', padding: '1.2rem', borderRadius: '20px', border: '1px solid #e2e8f0', boxShadow: '0 4px 6px rgba(0,0,0,0.02)' }}>
              <div style={{ fontSize: '0.75rem', color: '#94a3b8', marginBottom: '0.5rem', textTransform: 'uppercase', letterSpacing: '1px', fontWeight: 700 }}>생체 인식</div>
              <div style={{ fontWeight: 800, fontSize: '1.2rem', color: faceDetected ? '#4ECDC4' : '#64748b' }}>{faceDetected ? "감지됨" : "대기 중"}</div>
            </div>
          </div>

          <div style={{ marginTop: '1.5rem', display: 'flex', gap: '1rem' }}>
            <button 
              className="btn-game-start" 
              onClick={handleRegisterStart}
              disabled={!faceDetected || countdown > 0 || scanStatus !== 'idle'}
              style={{ padding: '0.8rem 1.5rem' }}
            >
              📸 얼굴 등록
            </button>
            <button 
              className="btn-game-start" 
              onClick={handleUnlockAttempt}
              disabled={!faceDetected || registeredUsers.length === 0 || countdown > 0 || scanStatus !== 'idle'}
              style={{ padding: '0.8rem 1.5rem', background: 'linear-gradient(135deg, #38bdf8 0%, #1d4ed8 100%)', color: '#fff' }}
            >
              🔓 입장 시도
            </button>
          </div>

          {/* 등록된 목록 */}
          <div style={{ marginTop: '2.5rem', width: '100%', maxWidth: '640px' }}>
            <h3 style={{ marginBottom: '1.2rem', textAlign: 'left', fontSize: '1rem', color: '#64748b', fontWeight: 700 }}>👥 등록된 VIP 리스트 ({registeredUsers.length}/5)</h3>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '1rem' }}>
              {registeredUsers.length === 0 && (
                <div style={{ gridColumn: '1 / -1', padding: '3rem', textAlign: 'center', background: '#f8fafc', borderRadius: '20px', border: '2px dashed #e2e8f0', color: '#94a3b8' }}>
                  등록된 VIP가 없습니다. 본인 등록을 먼저 진행해 주세요.
                </div>
              )}
              {registeredUsers.map(user => (
                <div key={user.id} style={{ 
                  display: 'flex', alignItems: 'center', gap: '1rem', padding: '1rem', 
                  background: '#fff', borderRadius: '16px', border: '1px solid #e2e8f0', boxShadow: '0 2px 4px rgba(0,0,0,0.02)'
                }}>
                  <img src={user.thumbnail} alt={user.name} style={{ width: '50px', height: '50px', borderRadius: '50%', objectFit: 'cover', border: '2px solid #f1f5f9' }} />
                  <span style={{ flex: 1, fontWeight: 700, fontSize: '1.1rem', color: '#334155' }}>{user.name}</span>
                  <button 
                    onClick={() => deleteUser(user.id)}
                    style={{ background: '#fff1f2', border: 'none', color: '#f43f5e', cursor: 'pointer', borderRadius: '50%', width: '32px', height: '32px', display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'all 0.2s' }}
                  >
                    ✕
                  </button>
                </div>
              ))}
            </div>
          </div>
        </>
      )}

      {/* 이름 입력 모달 */}
      {showNameModal && (
        <div style={{
          position: 'fixed', inset: 0, background: 'rgba(255,255,255,0.8)', backdropFilter: 'blur(10px)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000
        }}>
          <div className="modal-card" style={{ maxWidth: '400px', padding: '2.5rem', background: '#fff', borderRadius: '32px', boxShadow: '0 20px 50px rgba(0,0,0,0.1)', border: '1px solid #e2e8f0' }}>
            <h2 style={{ marginBottom: '0.5rem', fontSize: '1.8rem', color: '#1e293b' }}>VIP 등록</h2>
            <p style={{ color: '#64748b', marginBottom: '2rem', letterSpacing: 'normal', textTransform: 'none' }}>보안 게이트 통과를 위해 본인 성함을 입력해 주세요.</p>
            <form onSubmit={handleNameSubmit}>
              <input 
                autoFocus
                type="text" 
                value={userName}
                onChange={(e) => setUserName(e.target.value)}
                placeholder="성함 입력"
                style={{
                  width: '100%', padding: '1.2rem', background: '#f8fafc', color: '#1e293b',
                  border: '2px solid #e2e8f0', borderRadius: '16px', fontSize: '1.1rem',
                  marginBottom: '1.5rem', outline: 'none', fontWeight: 600
                }}
              />
              <div style={{ display: 'flex', gap: '1rem' }}>
                <button 
                  type="button"
                  onClick={() => setShowNameModal(false)}
                  style={{ flex: 1, background: '#f1f5f9', border: 'none', color: '#64748b', padding: '1rem', borderRadius: '16px', cursor: 'pointer', fontWeight: 700 }}
                >
                  취소
                </button>
                <button 
                  type="submit"
                  disabled={!userName.trim()}
                  className="btn-game-start"
                  style={{ flex: 2, padding: '1rem' }}
                >
                  등록하기
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      <style jsx>{`
        .detector-panel h2 {
          color: #1e293b;
          font-weight: 800;
        }
        .spinner-icon {
          width: 40px;
          height: 40px;
          border: 3px solid rgba(255, 255, 255, 0.1);
          border-top-color: #4ECDC4;
          border-radius: 50%;
          animation: spin 1s linear infinite;
        }
        @keyframes spin {
          to { transform: rotate(360deg); }
        }
        .mirrored video, .mirrored canvas {
          transform: scaleX(-1);
        }
        .pulse-blue {
          animation: pulse-blue-border 1.5s infinite;
        }
        @keyframes pulse-blue-border {
          0% { box-shadow: 0 0 0 0 rgba(56, 189, 248, 0.4); }
          70% { box-shadow: 0 0 0 20px rgba(56, 189, 248, 0); }
          100% { box-shadow: 0 0 0 0 rgba(56, 189, 248, 0); }
        }
        .result-card {
          padding: 2rem;
          border-radius: 20px;
          text-align: center;
          animation: pop-in 0.5s cubic-bezier(0.175, 0.885, 0.32, 1.275);
          min-width: 250px;
        }
        .result-card.success {
          background: rgba(78, 205, 196, 0.95);
          color: #0f172a;
          box-shadow: 0 20px 40px rgba(78, 205, 196, 0.3);
        }
        .result-card.failure {
          background: rgba(255, 107, 107, 0.95);
          color: #fff;
          box-shadow: 0 20px 40px rgba(255, 107, 107, 0.3);
        }
        @keyframes pop-in {
          0% { transform: scale(0.8); opacity: 0; }
          100% { transform: scale(1); opacity: 1; }
        }
        .scanning-line {
          width: 100%;
          height: 4px;
          background: linear-gradient(90deg, transparent, #38bdf8, transparent);
          position: absolute;
          top: 0;
          animation: scan-move 2s linear infinite;
          box-shadow: 0 0 15px #38bdf8;
        }
        @keyframes scan-move {
          0% { top: 0; }
          100% { top: 100%; }
        }
        .gate-door {
          position: absolute;
          top: 0;
          bottom: 0;
          width: 50%;
          background: rgba(255, 255, 255, 0.95);
          z-index: 5;
          transition: transform 1.2s cubic-bezier(0.7, 0, 0.3, 1);
          border: 1px solid #e2e8f0;
          backdrop-filter: blur(8px);
        }
        .gate-door.left {
          left: 0;
          border-right: 2px solid #4ECDC4;
        }
        .gate-door.right {
          right: 0;
          border-left: 2px solid #4ECDC4;
        }
        .gate-door.left.open { transform: translateX(-100%); }
        .gate-door.right.open { transform: translateX(100%); }
      `}</style>
    </div>
  );
}
