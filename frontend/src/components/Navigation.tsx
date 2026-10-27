import React from 'react';
import { Home, Feather, MessageCircleHeart, Image as ImageIcon, Navigation as RadarIcon, Watch } from 'lucide-react';
import { playHaptic } from '../services/haptics';

export type TabType = 'home' | 'letters' | 'chat' | 'memories' | 'radar' | 'watch';

interface NavigationProps {
  activeTab: TabType;
  onChangeTab: (tab: TabType) => void;
  unreadLettersCount?: number;
}

export const Navigation: React.FC<NavigationProps> = ({
  activeTab,
  onChangeTab,
  unreadLettersCount = 0,
}) => {
  const tabs = [
    { id: 'home', label: 'Biz', icon: Home },
    { id: 'letters', label: 'Mektuplar', icon: Feather, badge: unreadLettersCount },
    { id: 'chat', label: 'Sohbet', icon: MessageCircleHeart },
    { id: 'memories', label: 'Anılar & Not', icon: ImageIcon },
    { id: 'radar', label: 'Radar', icon: RadarIcon },
    { id: 'watch', label: 'Saat', icon: Watch },
  ];

  return (
    <nav className="fixed bottom-3 inset-x-3 z-40 max-w-md mx-auto">
      <div className="bg-white/90 backdrop-blur-xl rounded-3xl p-1.5 shadow-xl shadow-berry-900/10 border border-rose-100 flex items-center justify-around">
        {tabs.map((tab) => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.id;

          return (
            <button
              key={tab.id}
              onClick={() => {
                playHaptic(20);
                onChangeTab(tab.id as TabType);
              }}
              className={`relative flex flex-col items-center justify-center py-2 px-3 rounded-2xl transition-all duration-200 ${
                isActive
                  ? 'bg-gradient-to-r from-berry-500 to-rose-500 text-white shadow-md shadow-berry-500/25 scale-105'
                  : 'text-stone-500 hover:text-berry-700'
              }`}
            >
              <Icon className={`w-5 h-5 ${isActive ? 'stroke-[2.2]' : 'stroke-[1.8]'}`} />
              <span className="text-[10px] font-semibold mt-0.5 tracking-tight">
                {tab.label}
              </span>

              {/* Unread badge for letters */}
              {tab.badge && tab.badge > 0 ? (
                <span className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-rose-600 text-white text-[9px] font-bold flex items-center justify-center shadow-xs">
                  {tab.badge}
                </span>
              ) : null}
            </button>
          );
        })}
      </div>
    </nav>
  );
};
