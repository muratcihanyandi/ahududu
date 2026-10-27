import React, { useState, useEffect } from 'react';
import { Sparkles, RefreshCw, X } from 'lucide-react';
import { api } from '../services/api';
import { playHaptic } from '../services/haptics';

export const UpdateBanner: React.FC = () => {
  const [hasUpdate, setHasUpdate] = useState(false);
  const [isDismissed, setIsDismissed] = useState(false);

  useEffect(() => {
    let currentBuildId: string | null = null;

    const checkVersion = async () => {
      try {
        const res = await api.getSystemVersion();
        const serverBuildId = res.build_id || res.version;
        if (!currentBuildId) {
          currentBuildId = serverBuildId;
        } else if (serverBuildId && serverBuildId !== currentBuildId) {
          setHasUpdate(true);
        }
      } catch (e) {
        // Silent catch
      }
    };

    checkVersion();
    const interval = setInterval(checkVersion, 15000); // Check every 15 seconds

    const handleVisibility = () => {
      if (document.visibilityState === 'visible') {
        checkVersion();
      }
    };
    document.addEventListener('visibilitychange', handleVisibility);

    return () => {
      clearInterval(interval);
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, []);

  const handleApplyUpdate = () => {
    playHaptic(30);
    // Force reload bypassing cache to load newest bundle from Raspberry Pi
    window.location.reload();
  };

  if (!hasUpdate || isDismissed) return null;

  return (
    <div className="fixed top-3 inset-x-3 z-50 max-w-md mx-auto bg-gradient-to-r from-berry-600 via-rose-600 to-pink-600 text-white rounded-2xl p-3.5 shadow-xl shadow-berry-900/20 border border-white/20 flex items-center justify-between animate-pulse">
      <div className="flex items-center gap-2.5 min-w-0">
        <div className="w-8 h-8 rounded-full bg-white/20 flex items-center justify-center shrink-0">
          <Sparkles className="w-4 h-4 text-amber-200" />
        </div>
        <div className="min-w-0">
          <p className="font-serif text-xs font-bold leading-tight truncate">
            Yeni bir özellik veya güncelleme hazır! ✨
          </p>
          <p className="text-[11px] text-pink-100 opacity-90 truncate">
            Tek tıkla yeni özellikler yüklensin (APK kurmaya gerek yok)
          </p>
        </div>
      </div>

      <div className="flex items-center gap-1.5 shrink-0 ml-2">
        <button
          onClick={handleApplyUpdate}
          className="px-3 py-1.5 rounded-xl bg-white text-berry-700 text-xs font-bold shadow-xs hover:bg-pink-50 transition-all active:scale-95 flex items-center gap-1"
        >
          <RefreshCw className="w-3 h-3 text-berry-600" />
          <span>Yenile</span>
        </button>
        <button
          onClick={() => setIsDismissed(true)}
          className="p-1 rounded-lg text-white/70 hover:text-white"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
};
