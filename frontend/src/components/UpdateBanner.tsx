import React, { useEffect, useState } from 'react';
import { Sparkles, RefreshCw, Loader2, X } from 'lucide-react';
import { updates, UpdateState } from '../services/updates';
import { playHaptic } from '../services/haptics';

export const UpdateBanner: React.FC = () => {
  const [state, setState] = useState<UpdateState>(() => updates.getState());

  useEffect(() => updates.subscribe(setState), []);

  const handleApplyUpdate = () => {
    playHaptic(30);
    updates.applyNow();
  };

  const handlePostpone = () => {
    playHaptic(15);
    updates.postpone();
  };

  // Nothing to announce, or the user asked to wait until the app is backgrounded.
  if (!state.pending) return null;
  if (state.postponed && state.status === 'idle') return null;

  const isReloading = state.status === 'reloading';
  const title = isReloading ? 'Yeni sürüm yükleniyor…' : 'Yeni sürüm hazır ✨';
  const subtitle = isReloading
    ? 'Yeni özellikler getiriliyor'
    : state.status === 'scheduled'
      ? `${state.secondsLeft} saniye içinde kendiliğinden yenilenecek`
      : 'İşin bitince kendiliğinden yenilenecek';

  return (
    <div
      role="status"
      aria-live="polite"
      style={{ top: 'calc(0.75rem + var(--safe-top, 0px))' }}
      className="fixed inset-x-3 z-50 max-w-md mx-auto bg-gradient-to-r from-berry-600 via-rose-600 to-pink-600 text-white rounded-2xl p-3.5 shadow-xl shadow-berry-900/20 border border-white/20 flex items-center justify-between"
    >
      <div className="flex items-center gap-2.5 min-w-0">
        <div className="w-8 h-8 rounded-full bg-white/20 flex items-center justify-center shrink-0">
          {isReloading ? (
            <Loader2 className="w-4 h-4 text-amber-200 animate-spin" />
          ) : (
            <Sparkles className="w-4 h-4 text-amber-200" />
          )}
        </div>
        <div className="min-w-0">
          <p className="font-serif text-xs font-bold leading-tight truncate">{title}</p>
          <p className="text-[11px] text-pink-100 opacity-90 truncate">{subtitle}</p>
        </div>
      </div>

      <div className="flex items-center gap-1.5 shrink-0 ml-2">
        <button
          onClick={handleApplyUpdate}
          disabled={isReloading}
          className="px-3 py-1.5 rounded-xl bg-white text-berry-700 text-xs font-bold shadow-xs hover:bg-pink-50 transition-all active:scale-95 flex items-center gap-1 disabled:opacity-70"
        >
          <RefreshCw className={`w-3 h-3 text-berry-600 ${isReloading ? 'animate-spin' : ''}`} />
          <span>Şimdi</span>
        </button>
        {!isReloading && (
          <button
            onClick={handlePostpone}
            aria-label="Daha sonra yenile"
            title="Daha sonra yenile"
            className="p-1 rounded-lg text-white/70 hover:text-white"
          >
            <X className="w-4 h-4" />
          </button>
        )}
      </div>
    </div>
  );
};
