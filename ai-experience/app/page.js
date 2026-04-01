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

const TABS = [
  { id: 'rps', label: '🎮 가위바위보' },
  { id: 'move', label: '📦 물건 이동' },
  { id: 'pose', label: '✋ 핸드포즈' },
];

export default function Home() {
  const [activeTab, setActiveTab] = useState('rps');

  const activeLabel = TABS.find(tab => tab.id === activeTab)?.label;

  return (
    <main>
      <div className="card">
        <h1>🎮 AI 체험관</h1>
        <p>Realize Academy · 3주차</p>

        <div className="tabs-container">
          <div className="tabs-header">
            {TABS.map((tab) => (
              <button
                key={tab.id}
                className={`tab-btn ${activeTab === tab.id ? 'active' : ''}`}
                onClick={() => setActiveTab(tab.id)}
              >
                {tab.label}
              </button>
            ))}
          </div>

          <div className="tab-content">
            {activeTab === 'rps' && <RpsGame />}
            {activeTab === 'move' && <ObjectMover />}
            {activeTab !== 'rps' && activeTab !== 'move' && (
              <div key={activeTab} className="game-placeholder">
                여기에 <strong>{activeLabel}</strong>이 들어갈 예정입니다
              </div>
            )}
          </div>
        </div>
      </div>
    </main>
  );
}
