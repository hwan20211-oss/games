'use client';

import { useState } from 'react';
import dynamic from 'next/dynamic';

// Use dynamic import for RpsGame because it accesses browser APIs (webcam, tfjs)
const RpsGame = dynamic(() => import('@/components/RpsGame'), { 
  ssr: false,
  loading: () => <div className="game-placeholder">AI 가위바위보를 불러오는 중...</div>
});

const ObjectMover = dynamic(() => import('@/components/ObjectMover'), { 
  ssr: false,
  loading: () => <div className="game-placeholder">객체 인식 모델을 불러오는 중...</div>
});

const HandPose = dynamic(() => import('@/components/HandPose'), {
  ssr: false,
  loading: () => <div className="game-placeholder">핸드포즈 모델을 불러오는 중...</div>
});

const SecurityGate = dynamic(() => import('@/components/SecurityGate'), {
  ssr: false,
  loading: () => <div className="game-placeholder">보안 게이트 모델을 불러오는 중...</div>
});

const ARFilter = dynamic(() => import('@/components/ARFilter'), {
  ssr: false,
  loading: () => <div className="game-placeholder">AR 필터 모델을 불러오는 중...</div>
});

const TABS = [
  { id: 'rps', label: '🎮 가위바위보' },
  { id: 'move', label: '📦 물건 이동' },
  { id: 'pose', label: '✋ 핸드포즈' },
  { id: 'security', label: '🔐 보안 게이트' },
  { id: 'filter', label: '🎭 AR 필터' },
];

export default function Home() {
  const [activeTab, setActiveTab] = useState('rps');
  const [isVipUnlocked, setIsVipUnlocked] = useState(false);

  const TABS = [
    { id: 'rps', label: '🎮 가위바위보', week: '2주차' },
    { id: 'move', label: '📦 물건 이동', week: '3주차' },
    { id: 'pose', label: '✋ 핸드포즈', week: '3주차' },
    { id: 'security', label: isVipUnlocked ? '🔓 보안 게이트' : '🔐 보안 게이트', week: '4주차' },
    { id: 'filter', label: isVipUnlocked ? '🎭 AR 필터' : '🔒 AR 필터', week: '4주차' },
  ];

  const handleUnlockSuccess = () => {
    setIsVipUnlocked(true);
    // 성공 시 사용자 편의를 위해 AR 필터 탭으로 자동 이동하고 싶을 수도 있지만, 일단은 상태만 변경
  };

  const goToSecurity = () => {
    setActiveTab('security');
  };

  return (
    <main>
      <div className="card">
        <header>
          <h1>🎮 AI 체험관</h1>
          <p className="subtitle">Realize Academy · 나만의 AI 체험 세계</p>
        </header>

        <div className="tabs-container">
          <nav className="tabs-header">
            {TABS.map((tab) => (
              <button
                key={tab.id}
                className={`tab-btn ${activeTab === tab.id ? 'active' : ''}`}
                onClick={() => setActiveTab(tab.id)}
              >
                {tab.label}
              </button>
            ))}
          </nav>

          <div className="tab-content">
            {activeTab === 'rps' && <RpsGame />}
            {activeTab === 'move' && <ObjectMover />}
            {activeTab === 'pose' && <HandPose />}
            {activeTab === 'security' && (
              <SecurityGate onUnlockSuccess={handleUnlockSuccess} isUnlocked={isVipUnlocked} />
            )}
            {activeTab === 'filter' && (
              <ARFilter isUnlocked={isVipUnlocked} onGoToSecurity={goToSecurity} />
            )}
          </div>
        </div>

        <footer style={{ marginTop: '3rem', paddingTop: '2rem', borderTop: '1px solid rgba(0,0,0,0.05)', color: '#94a3b8', fontSize: '0.9rem' }}>
          Made with ❤️ by <strong style={{ color: '#64748b' }}>[남궁환]</strong> · 2026 AI Experience Center
        </footer>
      </div>
    </main>
  );
}
