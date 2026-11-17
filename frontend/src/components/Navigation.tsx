import React from 'react';
import { Home, Feather, MessageCircleHeart, Sparkles, Flower2, Gamepad2 } from 'lucide-react';
import { playHaptic } from '../services/haptics';

export type TabType = 'home' | 'letters' | 'chat' | 'garden' | 'games' | 'memories';

interface NavigationProps {
  activeTab: TabType;
  onChangeTab: (tab: TabType) => void;
  unreadLettersCount?: number;
  hasNewSnaps?: boolean;
  /** Bahçede yeni bir şey var mı (hatıra, soru, kapsül) */
  hasGardenNews?: boolean;
  /** Sohbette okunmamış yeni mesaj sayısı */
  unreadChatCount?: number;
  /**
   * floating: sayfanın üstünde yüzen yuvarlak bar (diğer sekmeler).
   * attached: sohbet ekranında mesaj yazma alanının HEMEN ALTINA yapışan,
   *           akış içinde duran tam genişlik bar (WhatsApp gibi).
   */
  variant?: 'floating' | 'attached';
}

/**
 * Alt navigasyon — 6 tuş.
 *   1. Ana sayfa   2. Mektuplar   3. Sohbet   4. Bahçe   5. Oyunlar   6. Anılar
 * Sinema, Neredeyiz? ve bahçe alt bölümleri sayfa içinden açılır.
 */
const TABS: {
  id: TabType;
  label: string;
  icon: React.ElementType;
}[] = [
  { id: 'home', label: 'Ana', icon: Home },
  { id: 'letters', label: 'Mektup', icon: Feather },
  { id: 'chat', label: 'Sohbet', icon: MessageCircleHeart },
  { id: 'garden', label: 'Bahçe', icon: Flower2 },
  { id: 'games', label: 'Oyunlar', icon: Gamepad2 },
  { id: 'memories', label: 'Anılar', icon: Sparkles },
];

interface TabButtonProps {
  tab: (typeof TABS)[number];
  isActive: boolean;
  badge: number;
  dot: boolean;
  attached: boolean;
  onSelect: (tab: TabType) => void;
}

const TabButton: React.FC<TabButtonProps> = ({
  tab,
  isActive,
  badge,
  dot,
  attached,
  onSelect,
}) => {
  const Icon = tab.icon;

  if (attached) {
    return (
      <button
        onClick={() => onSelect(tab.id)}
        aria-label={tab.label}
        className={`relative flex flex-1 min-w-0 flex-col items-center justify-center py-1.5 rounded-2xl transition-all duration-200 ${
          isActive
            ? 'bg-gradient-to-r from-berry-500 to-rose-500 text-white shadow-md shadow-berry-500/25'
            : 'text-stone-500 active:text-berry-700'
        }`}
      >
        <Icon className={`w-[18px] h-[18px] ${isActive ? 'stroke-[2.2]' : 'stroke-[1.8]'}`} />
        <span className="text-[8.5px] font-semibold mt-0.5 tracking-tight whitespace-nowrap">
          {tab.label}
        </span>

        {badge > 0 && (
          <span className="absolute top-0 right-1 min-w-[15px] h-[15px] px-1 rounded-full bg-rose-600 text-white text-[8.5px] font-bold flex items-center justify-center shadow-xs ring-2 ring-white">
            {badge}
          </span>
        )}
        {dot && (
          <span className="absolute top-1 right-2 w-1.5 h-1.5 rounded-full bg-amber-500 ring-2 ring-white animate-pulse" />
        )}
      </button>
    );
  }

  return (
    <button
      onClick={() => onSelect(tab.id)}
      aria-label={tab.label}
      className={`relative flex flex-1 min-w-0 flex-col items-center justify-center py-1.5 px-1 rounded-xl transition-all duration-200 ${
        isActive
          ? 'bg-gradient-to-r from-berry-500 to-rose-500 text-white shadow-md shadow-berry-500/25 scale-105'
          : 'text-stone-500 hover:text-berry-700'
      }`}
    >
      <Icon className={`w-[18px] h-[18px] ${isActive ? 'stroke-[2.2]' : 'stroke-[1.8]'}`} />
      <span className="text-[8.5px] font-semibold mt-0.5 tracking-tight whitespace-nowrap">
        {tab.label}
      </span>

      {badge > 0 && (
        <span className="absolute -top-0.5 right-0.5 min-w-[15px] h-[15px] px-1 rounded-full bg-rose-600 text-white text-[8.5px] font-bold flex items-center justify-center shadow-xs">
          {badge}
        </span>
      )}

      {dot && (
        <span className="absolute top-1 right-2 w-1.5 h-1.5 rounded-full bg-amber-500 ring-2 ring-white animate-pulse" />
      )}
    </button>
  );
};

export const Navigation: React.FC<NavigationProps> = ({
  activeTab,
  onChangeTab,
  unreadLettersCount = 0,
  hasNewSnaps = false,
  hasGardenNews = false,
  unreadChatCount = 0,
  variant = 'floating',
}) => {
  const isAttached = variant === 'attached';

  const handleSelect = (tab: TabType) => {
    playHaptic(20);
    onChangeTab(tab);
  };

  const items = TABS.map((tab) => ({
    tab,
    isActive: activeTab === tab.id,
    badge:
      tab.id === 'letters'
        ? unreadLettersCount
        : tab.id === 'chat'
          ? unreadChatCount
          : 0,
    dot: (tab.id === 'memories' && hasNewSnaps) || (tab.id === 'garden' && hasGardenNews),
  }));

  if (isAttached) {
    return (
      <nav
        data-navigation-variant="attached"
        className="relative z-30 w-full shrink-0 border-t border-rose-100/80 bg-white/95 backdrop-blur-xl shadow-[0_-8px_24px_-12px_rgba(190,24,93,0.25)]"
        style={{ paddingBottom: 'calc(var(--safe-bottom, 0px) + 0.35rem)' }}
      >
        <div className="mx-auto flex w-full max-w-md items-stretch justify-around px-1.5 pt-1">
          {items.map(({ tab, isActive, badge, dot }) => (
            <TabButton
              key={tab.id}
              tab={tab}
              isActive={isActive}
              badge={badge}
              dot={dot}
              attached
              onSelect={handleSelect}
            />
          ))}
        </div>
      </nav>
    );
  }

  return (
    <nav
      data-navigation-variant="floating"
      className="fixed inset-x-3 z-40 max-w-md mx-auto"
      style={{ bottom: 'calc(0.75rem + var(--safe-bottom, 0px))' }}
    >
      <div className="bg-white/92 backdrop-blur-xl rounded-3xl p-1.5 shadow-xl shadow-berry-900/10 border border-rose-100 flex items-center justify-around gap-0.5">
        {items.map(({ tab, isActive, badge, dot }) => (
          <TabButton
            key={tab.id}
            tab={tab}
            isActive={isActive}
            badge={badge}
            dot={dot}
            attached={false}
            onSelect={handleSelect}
          />
        ))}
      </div>
    </nav>
  );
};
