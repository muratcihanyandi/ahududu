import React, { useEffect, useRef, useState } from 'react';
import { Heart, Vibrate } from 'lucide-react';
import confetti from 'canvas-confetti';
import { api } from '../services/api';
import { UserId } from '../types';
import { playHaptic, soundEngine, HAPTIC_PATTERNS } from '../services/haptics';

interface NudgeButtonProps {
  currentUserId: UserId;
  partnerName: string;
}

export const NudgeButton: React.FC<NudgeButtonProps> = ({
  currentUserId,
}) => {
  const [isPressing, setIsPressing] = useState(false);
  const [lastSentText, setLastSentText] = useState<string | null>(null);
  const toastTimerRef = useRef<number | null>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (toastTimerRef.current !== null) {
        window.clearTimeout(toastTimerRef.current);
        toastTimerRef.current = null;
      }
    };
  }, []);

  const flashSent = (msg: string, duration = 3500) => {
    if (!mountedRef.current) return;
    if (toastTimerRef.current !== null) window.clearTimeout(toastTimerRef.current);
    setLastSentText(msg);
    toastTimerRef.current = window.setTimeout(() => {
      toastTimerRef.current = null;
      if (mountedRef.current) setLastSentText(null);
    }, duration);
  };

  const handleNudge = async (nudgeType = 'attention', message = 'Beni sev!') => {
    if (isPressing) return;
    setIsPressing(true);
    playHaptic(HAPTIC_PATTERNS.attention);
    soundEngine.playLoveChime();

    // Heart explosion confetti
    confetti({
      particleCount: 35,
      spread: 70,
      origin: { y: 0.6 },
      colors: ['#be185d', '#f43f5e', '#fb7185', '#ffe4e6'],
      shapes: ['circle'],
    });

    try {
      await api.sendNudge({
        sender: currentUserId,
        nudge_type: nudgeType,
        message,
      });

      flashSent('Gönderildi 💓', 3500);
    } catch (e) {
      console.error(e);
    } finally {
      if (mountedRef.current) setIsPressing(false);
    }
  };

  const handleRemoteVibrate = async (pattern: string) => {
    if (isPressing) return;
    setIsPressing(true);
    playHaptic(HAPTIC_PATTERNS.heartbeat);
    try {
      await api.triggerRemoteHaptic({
        sender: currentUserId,
        pattern,
        target_device: 'all',
      });
      flashSent('Gönderildi 📳', 3000);
    } catch (e) {
      console.error(e);
    } finally {
      if (mountedRef.current) setIsPressing(false);
    }
  };

  return (
    <div className="flex flex-col items-center w-full my-3">
      {/* Main Giant Cute Button */}
      <div className="relative flex items-center justify-center">
        {/* Soft background glowing ring */}
        <div className="absolute -inset-2 rounded-full bg-gradient-to-r from-berry-400/20 via-pink-400/20 to-rose-400/20 blur-xl animate-pulse" />

        <button
          disabled={isPressing}
          onClick={() => handleNudge('attention', 'Beni sev! 🥰')}
          className={`relative group flex flex-col items-center justify-center w-40 h-40 sm:w-44 sm:h-44 rounded-full transition-all duration-300 disabled:opacity-80 ${
            isPressing
              ? 'scale-90 shadow-inner'
              : 'hover:scale-105 active:scale-95 shadow-xl shadow-berry-500/25'
          }`}
          style={{
            background: 'linear-gradient(135deg, #e11d48 0%, #be185d 50%, #9d174d 100%)',
          }}
        >
          <div className="flex flex-col items-center justify-center text-white px-2">
            <Heart className="w-12 h-12 mb-1 fill-white/90 drop-shadow-md group-hover:scale-110 transition-transform animate-heartbeat" />
            <span className="font-serif text-lg font-bold tracking-wide drop-shadow-xs">
              Beni Sev!
            </span>
          </div>
        </button>
      </div>

      {/* Confirmation feedback toast */}
      {lastSentText && (
        <div className="mt-3 px-4 py-1.5 rounded-full bg-berry-100/90 text-berry-800 text-xs font-semibold shadow-xs animate-pulse">
          {lastSentText}
        </div>
      )}

      {/* Quick Action Badges */}
      <div className="flex flex-wrap items-center justify-center gap-2 mt-4 px-2">
        <button
          disabled={isPressing}
          onClick={() => handleNudge('hug', 'Sana sımsıkı sarıldım! 🤗')}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-white hover:bg-rose-50 border border-rose-200/80 text-berry-800 text-xs font-semibold shadow-xs transition-all active:scale-95 disabled:opacity-60"
        >
          <span>🤗</span>
          <span>Sarıl Bana</span>
        </button>

        <button
          disabled={isPressing}
          onClick={() => handleNudge('kiss', 'Kocaman bir öpücük gönderiyorum! 💋')}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-white hover:bg-rose-50 border border-rose-200/80 text-berry-800 text-xs font-semibold shadow-xs transition-all active:scale-95 disabled:opacity-60"
        >
          <span>💋</span>
          <span>Öpücük Yolla</span>
        </button>

        <button
          disabled={isPressing}
          onClick={() => handleRemoteVibrate('heartbeat')}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-white hover:bg-rose-50 border border-rose-200/80 text-berry-800 text-xs font-semibold shadow-xs transition-all active:scale-95 disabled:opacity-60"
          title="Karşı tarafın telefonunu titretir"
        >
          <Vibrate className="w-3.5 h-3.5 text-rose-500" />
          <span>Telefonunu Titret</span>
        </button>
      </div>
    </div>
  );
};
