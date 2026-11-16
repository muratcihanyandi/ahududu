import React from 'react';
import { Home, Feather, MessageCircleHeart, Sparkles, Flower2 } from 'lucide-react';
import { playHaptic } from '../services/haptics';

export type TabType = 'home' | 'letters' | 'chat' | 'garden' | 'memories';

interface NavigationProps {
  activeTab: TabType;
  onChangeTab: (tab: TabType) => void;
  unreadLettersCount?: number;
  hasNewSnaps?: boolean;
  /** Bahçede yeni bir şey var mı (hatıra, soru, kapsül) */
  hasGardenNews?: boolean;
  /** Sohbette okunmamış yeni mesaj sayısı */
  unreadChatCount?: number;
}

/**
 * Alt navigasyon — HER ZAMAN 5 tuş.
 *   1. Ana sayfa   2. Mektuplar   3. Sohbet   4. Bahçe   5. Anılar
 * Sinema, Radar ve bahçe alt bölümleri sayfa içinden açılır.
 */
const TABS: {
  id: TabType;
  label: string;
  icon: React.ElementType;
}[] = [
  { id: 'home', label: 'Ana sayfa', icon: Home },
  { id: 'letters', label: 'Mektuplar', icon: Feather },
  { id: 'chat', label: 'Sohbet', icon: MessageCircleHeart },
  { id: 'garden', label: 'Bahçe', icon: Flower2 },
  { id: 'memories', label: 'Anılar', icon: Sparkles },
];

export const Navigation: React.FC<NavigationProps> = ({
  activeTab,
  onChangeTab,
  unreadLettersCount = 0,
  hasNewSnaps = false,
  hasGardenNews = false,
  unreadChatCount = 0,
}) => {
  return (
    <nav
      className="fixed inset-x-3 z-40 max-w-md mx-auto"
      style={{ bottom: 'calc(0.75rem + var(--safe-bottom, 0px))' }}
    >
      <div className="bg-white/92 backdrop-blur-xl rounded-3xl p-1.5 shadow-xl shadow-berry-900/10 border border-rose-100 flex items-center justify-around">
        {TABS.map((tab) => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.id;
          const badge =
            tab.id === 'letters'
              ? unreadLettersCount
              : tab.id === 'chat'
                ? unreadChatCount
                : 0;
          const dot =
            (tab.id === 'memories' && hasNewSnaps) ||
            (tab.id === 'garden' && hasGardenNews);

          return (
            <button
              key={tab.id}
              onClick={() => {
                playHaptic(20);
                onChangeTab(tab.id);
              }}
              aria-label={tab.label}
              className={`relative flex flex-col items-center justify-center py-2 px-2.5 rounded-2xl transition-all duration-200 ${
                isActive
                  ? 'bg-gradient-to-r from-berry-500 to-rose-500 text-white shadow-md shadow-berry-500/25 scale-105'
                  : 'text-stone-500 hover:text-berry-700'
              }`}
            >
              <Icon className={`w-5 h-5 ${isActive ? 'stroke-[2.2]' : 'stroke-[1.8]'}`} />
              <span className="text-[9.5px] font-semibold mt-0.5 tracking-tight whitespace-nowrap">
                {tab.label}
              </span>

              {badge > 0 && (
                <span className="absolute -top-1 -right-1 min-w-[16px] h-4 px-1 rounded-full bg-rose-600 text-white text-[9px] font-bold flex items-center justify-center shadow-xs">
                  {badge}
                </span>
              )}

              {dot && (
                <span className="absolute top-1 right-1.5 w-2 h-2 rounded-full bg-amber-500 ring-2 ring-white animate-pulse" />
              )}
            </button>
          );
        })}
      </div>
    </nav>
  );
};
