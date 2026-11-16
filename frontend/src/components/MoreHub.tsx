import React, { useState } from 'react';
import { Camera, BookOpen, PawPrint, Clapperboard, ChevronRight, MapPin } from 'lucide-react';
import { UserId } from '../types';
import { SnapAlbum } from './SnapAlbum';
import { DiaryBook } from './DiaryBook';
import { PetAlbum } from './PetAlbum';
import { playHaptic } from '../services/haptics';

interface MoreHubProps {
  currentUserId: UserId;
  onOpenCinema: () => void;
  onOpenRadar?: () => void;
}

type HubTab = 'snaps' | 'diary' | 'pets';

const SUB_TABS: { id: HubTab; label: string; icon: React.ElementType; accent: string }[] = [
  { id: 'snaps', label: 'Anlık', icon: Camera, accent: 'from-berry-500 to-rose-500' },
  { id: 'diary', label: 'Günlük', icon: BookOpen, accent: 'from-amber-500 to-rose-500' },
  { id: 'pets', label: 'Hayvanlar', icon: PawPrint, accent: 'from-emerald-500 to-teal-600' },
];

/**
 * "Anlar" sekmesi: Anlık Fotoğraf, Günlük ve Hayvan Albümü'nü tek yerde toplar.
 * Sinema Salonu ise buradan tek dokunuşla açılan, kendi tam ekran dünyası olan
 * ayrı bir "uygulama içi uygulama".
 */
export const MoreHub: React.FC<MoreHubProps> = ({ currentUserId, onOpenCinema, onOpenRadar }) => {
  const [tab, setTab] = useState<HubTab>('snaps');

  return (
    <div className="flex flex-col space-y-4">
      {/* Sinema Salonu daveti — büyük, animasyonlu kapı */}
      <button
        onClick={() => {
          playHaptic(30);
          onOpenCinema();
        }}
        className="group relative w-full overflow-hidden rounded-3xl p-4 text-left shadow-xl shadow-berry-900/25 active:scale-[0.98] transition-transform border border-amber-400/30"
        style={{ background: 'linear-gradient(120deg, #2a0713 0%, #5c0a20 45%, #7f1030 100%)' }}
      >
        {/* ışık süpürmesi */}
        <div
          className="absolute inset-0 opacity-40 animate-[lightsSweep_8s_ease-in-out_infinite] pointer-events-none"
          style={{
            background:
              'conic-gradient(from 205deg at 15% 0%, rgba(255,220,160,0.45), transparent 38%), conic-gradient(from -25deg at 85% 0%, rgba(255,120,170,0.4), transparent 38%)',
          }}
        />
        {/* sinema şeridi */}
        <div className="absolute top-0 inset-x-0 h-2 flex justify-around opacity-60">
          {Array.from({ length: 16 }).map((_, i) => (
            <span key={i} className="w-1.5 h-1.5 mt-0.5 rounded-[1px] bg-amber-200/70" />
          ))}
        </div>
        <div className="absolute bottom-0 inset-x-0 h-2 flex justify-around opacity-60">
          {Array.from({ length: 16 }).map((_, i) => (
            <span key={i} className="w-1.5 h-1.5 mb-0.5 rounded-[1px] bg-amber-200/70" />
          ))}
        </div>

        <div className="relative flex items-center gap-3 py-1">
          <div className="relative shrink-0">
            <div className="absolute -inset-2 rounded-full bg-amber-400/30 blur-xl animate-[marqueeGlow_3s_ease-in-out_infinite]" />
            <div className="relative w-14 h-14 rounded-2xl bg-gradient-to-br from-amber-300 to-rose-400 flex items-center justify-center text-2xl shadow-lg">
              🍿
            </div>
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-[9px] font-bold tracking-[0.28em] text-amber-300/80 uppercase">
              Büyük Güncelleme
            </p>
            <h3 className="font-serif text-base font-bold text-white leading-tight">
              Sinema Salonumuz 🎬
            </h3>
            <p className="text-[11px] text-white/70 mt-0.5 leading-snug">
              Her siteden video · telefon yatay · ikiniz birlikte, aynı saniyede
            </p>
          </div>
          <div className="shrink-0 flex flex-col items-center gap-1 text-amber-200">
            <Clapperboard className="w-5 h-5" />
            <ChevronRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
          </div>
        </div>

        <div className="relative flex items-center gap-1.5 mt-2 ml-[68px]">
          {['🎟️ Bilet al', '📱 Yatay mod', '💞 Karakterlerin'].map((t) => (
            <span
              key={t}
              className="text-[9px] font-semibold px-2 py-0.5 rounded-full bg-white/10 text-white/75"
            >
              {t}
            </span>
          ))}
        </div>
      </button>

      {/* Alt sekmeler */}
      <div className="flex items-center bg-rose-100/70 p-1 rounded-2xl">
        {SUB_TABS.map((t) => {
          const Icon = t.icon;
          const active = tab === t.id;
          return (
            <button
              key={t.id}
              onClick={() => {
                setTab(t.id);
                playHaptic(15);
              }}
              className={`flex-1 flex items-center justify-center gap-1.5 py-2 rounded-xl text-xs font-semibold transition-all ${
                active ? `bg-gradient-to-r ${t.accent} text-white shadow-xs` : 'text-stone-600'
              }`}
            >
              <Icon className="w-3.5 h-3.5" />
              {t.label}
            </button>
          );
        })}
      </div>

      {tab === 'snaps' && <SnapAlbum currentUserId={currentUserId} />}
      {tab === 'diary' && <DiaryBook currentUserId={currentUserId} />}
      {tab === 'pets' && <PetAlbum currentUserId={currentUserId} />}

      {/* Radar kısayolu */}
      {onOpenRadar && (
        <button
          onClick={() => {
            playHaptic(20);
            onOpenRadar();
          }}
          className="flex items-center justify-between gap-2 rounded-3xl bg-white/85 backdrop-blur-md border border-rose-100 shadow-sm px-4 py-3 active:scale-[0.99] transition-transform"
        >
          <span className="flex items-center gap-2 min-w-0">
            <MapPin className="w-5 h-5 text-berry-500 shrink-0" />
            <span className="min-w-0 text-left">
              <span className="block font-serif text-sm font-bold text-berry-950">
                Çift Radarı
              </span>
              <span className="block text-[10px] text-stone-500 truncate">
                Aradaki mesafe, konum ve pil durumu
              </span>
            </span>
          </span>
          <ChevronRight className="w-4 h-4 text-stone-400 shrink-0" />
        </button>
      )}
    </div>
  );
};

export default MoreHub;
