'use client';

import { useEffect, useRef, useState } from 'react';

const MODEL_PATH = "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task";
const WASM_PATH  = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/wasm";

const POSITION_MAP = {
  forehead: (lm) => ({ x: lm[10].x, y: lm[10].y - 0.02 }), // 머리 중앙 위쪽으로 살짝 이동
  eyes:     (lm) => ({ x: (lm[33].x + lm[263].x) / 2, y: (lm[33].y + lm[263].y) / 2 }),
  nose:     (lm) => ({ x: lm[4].x, y: lm[4].y }),
  mouth:    (lm) => ({ x: (lm[61].x + lm[291].x) / 2, y: (lm[13].y + lm[14].y) / 2 }),
};

const BUILT_IN_FILTERS = [
  { id: 'none', name: '❌ 없음', items: [] },
  { id: 'dog', name: '🐶 강아지', items: [
      { emoji: '🐶', position: 'forehead' },
      { emoji: '🐽', position: 'nose' }
    ] 
  },
  { id: 'cool', name: '😎 선글라스', items: [
      { emoji: '😎', position: 'eyes' }
    ] 
  },
  { id: 'crown', name: '👑 왕관', items: [
      { emoji: '👑', position: 'forehead' }
    ] 
  },
];

const POSITIONS = [
  { id: 'forehead', label: '이마' },
  { id: 'eyes',     label: '눈' },
  { id: 'nose',     label: '코' },
  { id: 'mouth',    label: '입' },
];

function getFaceAngle(lm) {
  // 거울 모드(canvas scaleX(-1))에서는 raw 좌표의 각도를 그대로 사용해야 화면상에서 일치합니다.
  const dx = lm[263].x - lm[33].x;
  const dy = lm[263].y - lm[33].y;
  return Math.atan2(dy, dx);
}

function getEyeDistance(lm, w) {
  return Math.sqrt(((lm[263].x - lm[33].x) * w) ** 2 + ((lm[263].y - lm[33].y) * w) ** 2);
}

function renderFilters(ctx, lm, w, h, activeFilter, activeCustoms, customFilters, customImages) {
  // 좌표 반전은 CSS(scaleX(-1))가 처리하므로 raw 좌표를 그대로 사용합니다.
  const eyeDist = getEyeDistance(lm, w);
  const angle = getFaceAngle(lm);

  if (activeFilter && activeFilter.id !== 'none') {
    for (const item of activeFilter.items) {
      const pos = POSITION_MAP[item.position](lm);
      let size = eyeDist * 0.8;
      if (item.position === 'forehead') size = eyeDist * 1.2;
      if (item.position === 'eyes') size = eyeDist * 2.2; // 선글라스 크기 소폭 축소
      if (item.position === 'nose') size = eyeDist * 0.9;
      
      ctx.save();
      ctx.translate(pos.x * w, pos.y * h);
      ctx.rotate(angle);
      ctx.font = `${size}px serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(item.emoji, 0, 0);
      ctx.restore();
    }
  }

  for (const cId of activeCustoms) {
    const cf = customFilters.find(f => f.id === cId);
    if (!cf) continue;
    const img = customImages[cId];
    if (!img || !img.complete) continue;
    const pos = POSITION_MAP[cf.position](lm);
    const drawW = eyeDist * 2.0; // 커스텀 필터도 기본적으로 작지 않게 조정
    const drawH = drawW * (img.naturalHeight / img.naturalWidth);
    ctx.save();
    ctx.translate(pos.x * w, pos.y * h);
    ctx.rotate(angle);
    ctx.drawImage(img, -drawW / 2, -drawH / 2, drawW, drawH);
    ctx.restore();
  }
}

export default function ARFilter({ isUnlocked, onGoToSecurity }) {
  const videoRef         = useRef(null);
  const canvasRef        = useRef(null);
  const detectorRef      = useRef(null);
  const rafRef           = useRef();
  const customImagesRef  = useRef({});
  const fileInputRef     = useRef(null);

  const [isLoaded, setIsLoaded]           = useState(false);
  const [error, setError]                 = useState(null);
  const [activeFilter, setActiveFilter]   = useState(BUILT_IN_FILTERS[0]);
  const [customFilters, setCustomFilters] = useState([]);
  const [activeCustoms, setActiveCustoms] = useState([]);
  
  // 사진 촬영 및 갤러리 상태
  const [photos, setPhotos]               = useState([]);
  const [isCapturing, setIsCapturing]     = useState(false);
  const [countdown, setCountdown]         = useState(0);
  const [selectedPhoto, setSelectedPhoto] = useState(null);

  // 커스텀 필터 추가 모달용 상태
  const [showPosModal, setShowPosModal]   = useState(false);
  const [pendingImageUrl, setPendingImageUrl] = useState(null);
  const [pendingImageName, setPendingImageName] = useState("");

  const activeFilterRef  = useRef(activeFilter);
  const activeCustomsRef = useRef(activeCustoms);
  const customFiltersRef = useRef(customFilters);
  
  useEffect(() => { activeFilterRef.current = activeFilter; }, [activeFilter]);
  useEffect(() => { activeCustomsRef.current = activeCustoms; }, [activeCustoms]);
  useEffect(() => { customFiltersRef.current = customFilters; }, [customFilters]);

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
    const video = videoRef.current, canvas = canvasRef.current;
    if (!detectorRef.current || !video || video.readyState < 2 || !video.videoWidth) {
      rafRef.current = requestAnimationFrame(predictLoop);
      return;
    }
    try {
      const result = detectorRef.current.detectForVideo(video, performance.now());

      if (!canvas) { rafRef.current = requestAnimationFrame(predictLoop); return; }
      const w = video.videoWidth, h = video.videoHeight;
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w; canvas.height = h;
      }
      const ctx = canvas.getContext('2d');
      ctx.clearRect(0, 0, w, h);

      if (result.faceLandmarks && result.faceLandmarks.length > 0) {
        renderFilters(ctx, result.faceLandmarks[0], w, h,
          activeFilterRef.current, activeCustomsRef.current,
          customFiltersRef.current, customImagesRef.current);
      }
    } catch (e) {}
    rafRef.current = requestAnimationFrame(predictLoop);
  };

  const handleFileUpload = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    if (customFilters.length >= 3) {
      alert("최대 3개의 커스텀 필터만 등록 가능합니다.");
      return;
    }

    const reader = new FileReader();
    reader.onload = (ev) => {
      setPendingImageUrl(ev.target.result);
      setPendingImageName(file.name);
      setShowPosModal(true);
    };
    reader.readAsDataURL(file);
  };

  const addCustomFilter = (positionId) => {
    const id = Date.now().toString();
    const img = new Image();
    img.src = pendingImageUrl;
    img.onload = () => {
      customImagesRef.current[id] = img;
      const newFilter = { id, name: pendingImageName, position: positionId, thumbnail: pendingImageUrl };
      setCustomFilters(prev => [...prev, newFilter]);
      setActiveCustoms(prev => [...prev, id]);
      setShowPosModal(false);
      setPendingImageUrl(null);
      if (fileInputRef.current) fileInputRef.current.value = "";
    };
  };

  const deleteCustomFilter = (id) => {
    setCustomFilters(prev => prev.filter(f => f.id !== id));
    setActiveCustoms(prev => prev.filter(cId => cId !== id));
    delete customImagesRef.current[id];
  };

  const toggleCustomActive = (id) => {
    // 기본 1개 + 커스텀 1개 제한을 위해 이전 선택 해제 후 새로운 아이디 추가
    setActiveCustoms(prev => prev.includes(id) ? [] : [id]);
  };

  const playShutterSound = () => {
    try {
      const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      const gainNode = audioCtx.createGain();
      
      // Noise buffer generation for a crisp 'shutter' click
      const bufferSize = audioCtx.sampleRate * 0.1;
      const buffer = audioCtx.createBuffer(1, bufferSize, audioCtx.sampleRate);
      const data = buffer.getChannelData(0);
      for(let i=0; i<bufferSize; i++) data[i] = Math.random() * 2 - 1;
      
      const noiseSource = audioCtx.createBufferSource();
      noiseSource.buffer = buffer;
      
      noiseSource.connect(gainNode);
      gainNode.connect(audioCtx.destination);
      
      gainNode.gain.setValueAtTime(0.5, audioCtx.currentTime);
      gainNode.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.1);
      
      noiseSource.start();
    } catch (e) {
      console.error("Audio error:", e);
    }
  };

  const handleCapture = () => {
    if (isCapturing) return;
    setIsCapturing(true);
    let count = 3;
    setCountdown(count);
    
    const timer = setInterval(() => {
      count -= 1;
      setCountdown(count);
      if (count <= 0) {
        clearInterval(timer);
        performCapture();
      }
    }, 1000);
  };

  const performCapture = () => {
    const video = videoRef.current;
    if (!video || !detectorRef.current) return;
    
    // Offscreen 합성을 위한 캔버스
    const offCanvas = document.createElement('canvas');
    offCanvas.width = video.videoWidth;
    offCanvas.height = video.videoHeight;
    const offCtx = offCanvas.getContext('2d');
    
    // 1. 영상 그리기 (거울 모드이므로 반전해서 그리기)
    offCtx.save();
    offCtx.scale(-1, 1);
    offCtx.translate(-offCanvas.width, 0);
    offCtx.drawImage(video, 0, 0);
    offCtx.restore();
    
    // 2. 필터 입히기 (거울 모드 캔버스에 그리는 것과 동일한 로직)
    const result = detectorRef.current.detectForVideo(video, performance.now());
    if (result.faceLandmarks && result.faceLandmarks.length > 0) {
      // 오프스크린 캔버스도 거울 모드로 설정 (renderFilters가 raw 좌표를 쓰기 때문)
      offCtx.save();
      offCtx.scale(-1, 1);
      offCtx.translate(-offCanvas.width, 0);
      renderFilters(offCtx, result.faceLandmarks[0], offCanvas.width, offCanvas.height,
        activeFilterRef.current, activeCustomsRef.current,
        customFiltersRef.current, customImagesRef.current);
      offCtx.restore();
    }
    
    playShutterSound();
    const dataUrl = offCanvas.toDataURL('image/png');
    setPhotos(prev => [{ id: Date.now(), url: dataUrl }, ...prev].slice(0, 10));
    
    setIsCapturing(false);
    setCountdown(0);
  };

  const deletePhoto = (id) => {
    setPhotos(prev => prev.filter(p => p.id !== id));
  };

  const downloadPhoto = (url) => {
    const link = document.createElement('a');
    link.href = url;
    link.download = `ar-filter-${Date.now()}.png`;
    link.click();
  };

  useEffect(() => {
    initDetector();
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      if (videoRef.current?.srcObject) videoRef.current.srcObject.getTracks().forEach(t => t.stop());
    };
  }, []);

  return (
    <div className="detector-panel" style={{ width: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
      <div style={{ textAlign: 'center', marginBottom: '1rem' }}>
        <h2>🎭 AR 필터</h2>
      </div>

      {error && <div style={{ padding: '3rem', textAlign: 'center', color: '#ff6b6b' }}>{error}</div>}

      {!error && (
        <>
          <div className="video-card" style={{ 
            padding: 0, overflow: 'hidden', maxWidth: '640px', width: '100%', position: 'relative', 
            border: '8px solid #fff', borderRadius: '32px', boxShadow: '0 20px 40px rgba(0,0,0,0.05)',
            background: '#f8fafc'
          }}>
            {!isLoaded && (
              <div style={{ padding: '4rem 2rem', textAlign: 'center' }}>
                <div className="spinner-icon" style={{ margin: '0 auto 1.5rem' }}></div>
                <p style={{ color: '#64748b' }}>🔄 AR 렌더링 시스템 기동 중...</p>
              </div>
            )}
            <div className="video-wrapper mirrored" style={{ display: isLoaded ? 'block' : 'none', position: 'relative' }}>
              <video ref={videoRef} playsInline muted style={{ display: 'block', width: '100%' }} />
              <canvas ref={canvasRef} style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%' }} />
              
              {/* 카운트다운 오버레이 */}
              {countdown > 0 && (
                <div style={{
                  position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
                  background: 'rgba(255,255,255,0.4)', backdropFilter: 'blur(10px)', zIndex: 10
                }}>
                  <span style={{ fontSize: '8rem', fontWeight: 900, color: '#1e293b' }}>{countdown}</span>
                </div>
              )}
            </div>

            {/* VIP 잠금 오버레이 */}
            {!isUnlocked && (
              <div style={{
                position: 'absolute', inset: 0, background: 'rgba(255, 255, 255, 0.7)', backdropFilter: 'blur(12px)',
                display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', zIndex: 100,
                textAlign: 'center', padding: '2rem'
              }}>
                <div style={{ fontSize: '4rem', marginBottom: '1.5rem' }}>🔒</div>
                <h3 style={{ fontSize: '1.8rem', color: '#1e293b', marginBottom: '0.5rem', fontWeight: 800 }}>VIP 전용 콘텐츠</h3>
                <p style={{ color: '#64748b', marginBottom: '2rem', textTransform: 'none', letterSpacing: 'normal', fontWeight: 500 }}>
                  이 기능을 사용하려면 보안 게이트에서<br/>생체 인증을 먼저 완료해 주세요.
                </p>
                <button 
                  onClick={onGoToSecurity}
                  className="btn-game-start"
                  style={{ maxWidth: '250px' }}
                >
                  🚀 보안 게이트로 이동
                </button>
              </div>
            )}
          </div>

          {/* 필터 선택 UI */}
          <div style={{ marginTop: '1.5rem', width: '100%', maxWidth: '640px' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1.2rem' }}>
              {/* 기본 필터 */}
              <div style={{ display: 'flex', justifyContent: 'center', gap: '0.8rem', flexWrap: 'wrap' }}>
                {BUILT_IN_FILTERS.map(filter => (
                  <button
                    key={filter.id}
                    onClick={() => setActiveFilter(filter)}
                    style={{
                      padding: '0.6rem 1.2rem',
                      borderRadius: '50px',
                      border: '2px solid',
                      borderColor: activeFilter.id === filter.id ? '#4ECDC4' : 'rgba(255,255,255,0.1)',
                      background: activeFilter.id === filter.id ? 'rgba(78, 205, 196, 0.15)' : 'rgba(255,255,255,0.05)',
                      color: activeFilter.id === filter.id ? '#4ECDC4' : '#94a3b8',
                      fontWeight: 700,
                      cursor: 'pointer',
                      transition: 'all 0.2s ease',
                      boxShadow: activeFilter.id === filter.id ? '0 0 15px rgba(78, 205, 196, 0.3)' : 'none'
                    }}
                  >
                    {filter.name}
                  </button>
                ))}
              </div>

              {/* 촬영 버튼 */}
              <div style={{ display: 'flex', justifyContent: 'center', position: 'relative' }}>
                <button 
                  className={`btn-game-start ${isCapturing ? 'pulse-blue' : ''}`}
                  onClick={handleCapture}
                  disabled={!isLoaded || isCapturing}
                  style={{
                    padding: '1rem 3rem',
                    fontSize: '1.2rem',
                    background: isCapturing ? '#38bdf8' : 'linear-gradient(135deg, #4ECDC4 0%, #2ab5ad 100%)',
                    boxShadow: '0 10px 20px rgba(78, 205, 196, 0.2)'
                  }}
                >
                  {isCapturing ? (countdown > 0 ? `⌛ ${countdown}...` : "📸 찰칵!") : "📸 사진 찍기"}
                </button>
              </div>

              {/* 커스텀 필터 */}
              <div style={{ background: '#fff', padding: '1.5rem', borderRadius: '24px', border: '1px solid #e2e8f0', boxShadow: '0 4px 6px rgba(0,0,0,0.02)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.2rem' }}>
                  <h3 style={{ fontSize: '0.9rem', color: '#64748b', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '1px' }}>🖼️ 커스텀 아이템</h3>
                  <button 
                    onClick={() => fileInputRef.current?.click()}
                    disabled={customFilters.length >= 3 || !isUnlocked}
                    style={{ background: 'transparent', border: 'none', color: '#4ECDC4', cursor: 'pointer', fontSize: '0.9rem', fontWeight: 800 }}
                  >
                    + 필터 추가
                  </button>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '1rem' }}>
                  {customFilters.map(filter => (
                    <button
                      key={filter.id}
                      onClick={() => toggleCustomActive(filter.id)}
                      disabled={!isUnlocked}
                      style={{
                        padding: '0.8rem',
                        background: activeCustoms.includes(filter.id) ? '#f0fdfa' : '#f8fafc',
                        border: '2px solid',
                        borderColor: activeCustoms.includes(filter.id) ? '#4ECDC4' : '#e2e8f0',
                        borderRadius: '16px',
                        cursor: 'pointer',
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: 'center',
                        gap: '0.5rem',
                        transition: 'all 0.2s'
                      }}
                    >
                      <img src={filter.thumbnail} alt="" style={{ width: '40px', height: '40px', objectFit: 'contain', opacity: activeCustoms.includes(filter.id) ? 1 : 0.5 }} />
                      <span style={{ fontSize: '0.7rem', color: activeCustoms.includes(filter.id) ? '#0f766e' : '#94a3b8', fontWeight: 700 }}>{filter.name.slice(0, 5)}</span>
                    </button>
                  ))}
                  {customFilters.length < 3 && (
                    <div 
                      onClick={() => isUnlocked && fileInputRef.current?.click()}
                      style={{ border: '2px dashed #e2e8f0', borderRadius: '16px', display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '80px', cursor: isUnlocked ? 'pointer' : 'not-allowed', background: '#f8fafc' }}
                    >
                      <span style={{ fontSize: '1.5rem', color: '#cbd5e1' }}>+</span>
                    </div>
                  )}
                </div>
              </div>
            </div>
            <input ref={fileInputRef} type="file" accept="image/*" hidden onChange={handleFileUpload} />
          </div>

          {/* 사진 갤러리 */}
          {photos.length > 0 && (
            <div style={{ marginTop: '3rem', width: '100%', maxWidth: '640px' }}>
              <h3 style={{ marginBottom: '1.2rem', color: '#64748b', fontSize: '1rem', fontWeight: 700, textTransform: 'uppercase' }}>🎞️ 캡처 갤러리</h3>
              <div style={{ 
                display: 'flex', gap: '1.2rem', overflowX: 'auto', paddingBottom: '1.5rem',
                scrollbarWidth: 'thin', scrollbarColor: '#e2e8f0 transparent'
              }}>
                {photos.map(photo => (
                  <div key={photo.id} style={{ flexShrink: 0, position: 'relative', width: '180px' }}>
                    <div style={{ position: 'relative', overflow: 'hidden', borderRadius: '20px', boxShadow: '0 4px 12px rgba(0,0,0,0.05)', border: '4px solid #fff' }}>
                      <img 
                        src={photo.url} 
                        onClick={() => setSelectedPhoto(photo)}
                        style={{ width: '100%', aspectRatio: '16/9', objectFit: 'cover', cursor: 'pointer', display: 'block' }} 
                      />
                      <div style={{ position: 'absolute', bottom: '0.5rem', right: '0.5rem', display: 'flex', gap: '0.3rem' }}>
                        <button 
                          onClick={() => downloadPhoto(photo.url)}
                          style={{ width: '30px', height: '30px', borderRadius: '50%', background: 'rgba(255,255,255,0.9)', border: 'none', boxShadow: '0 2px 5px rgba(0,0,0,0.1)', cursor: 'pointer', fontSize: '0.9rem' }}
                        >
                          💾
                        </button>
                        <button 
                          onClick={() => deletePhoto(photo.id)}
                          style={{ width: '30px', height: '30px', borderRadius: '50%', background: 'rgba(255,255,255,0.9)', border: 'none', boxShadow: '0 2px 5px rgba(0,0,0,0.1)', cursor: 'pointer', fontSize: '0.9rem', color: '#f43f5e' }}
                        >
                          ✕
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}

      {/* 사진 크게 보기 모달 */}
      {selectedPhoto && (
        <div style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.9)', backdropFilter: 'blur(10px)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 2000, padding: '2rem'
        }} onClick={() => setSelectedPhoto(null)}>
          <div style={{ maxWidth: '90%', maxHeight: '90%', position: 'relative' }} onClick={e => e.stopPropagation()}>
            <img src={selectedPhoto.url} style={{ width: '100%', borderRadius: '20px', boxShadow: '0 30px 60px rgba(0,0,0,0.5)' }} />
            <div style={{ marginTop: '1.5rem', display: 'flex', justifyContent: 'center', gap: '1rem' }}>
              <button 
                onClick={() => downloadPhoto(selectedPhoto.url)}
                className="btn-game-start"
                style={{ height: 'auto', padding: '0.8rem 2rem' }}
              >
                💾 저장하기
              </button>
              <button 
                onClick={() => setSelectedPhoto(null)}
                style={{ padding: '0.8rem 2rem', background: 'rgba(255,255,255,0.1)', border: 'none', color: '#fff', borderRadius: '12px', cursor: 'pointer', fontWeight: 600 }}
              >
                닫기
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 위치 선택 모달 */}
      {showPosModal && (
        <div style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.8)', backdropFilter: 'blur(8px)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000
        }}>
          <div className="card" style={{ maxWidth: '400px', padding: '2.5rem' }}>
            <h2 style={{ marginBottom: '1rem', fontSize: '1.8rem' }}>필터 위치 선택</h2>
            <p style={{ color: '#94a3b8', marginBottom: '1.5rem', textTransform: 'none', letterSpacing: 'normal' }}>
              이미지가 표시될 얼굴 부위를 선택해 주세요.
            </p>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.8rem', marginBottom: '1.5rem' }}>
              {POSITIONS.map(pos => (
                <button
                  key={pos.id}
                  onClick={() => addCustomFilter(pos.id)}
                  style={{
                    padding: '1rem',
                    borderRadius: '12px',
                    border: '1px solid rgba(255,255,255,0.1)',
                    background: 'rgba(255,255,255,0.05)',
                    color: '#fff',
                    fontWeight: 600,
                    cursor: 'pointer',
                    transition: 'all 0.2s ease'
                  }}
                  onMouseEnter={(e) => e.currentTarget.style.background = 'rgba(255,255,255,0.1)'}
                  onMouseLeave={(e) => e.currentTarget.style.background = 'rgba(255,255,255,0.05)'}
                >
                  {pos.label}
                </button>
              ))}
            </div>
            <button 
              onClick={() => setShowPosModal(false)}
              style={{ width: '100%', padding: '1rem', borderRadius: '12px', border: 'none', background: 'rgba(255,255,255,0.1)', color: '#fff', cursor: 'pointer' }}
            >
              취소
            </button>
          </div>
        </div>
      )}

      <style jsx>{`
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
      `}</style>
    </div>
  );
}
