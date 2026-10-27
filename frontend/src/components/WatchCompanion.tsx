import React, { useState, useEffect } from 'react';
import { Watch, Heart, Activity, Footprints, Zap, Sparkles, Smile, Download } from 'lucide-react';
import confetti from 'canvas-confetti';
import { WatchBiometrics, UserId } from '../types';
import { api } from '../services/api';
import { wsClient } from '../services/websocket';
import { playHaptic, soundEngine, HAPTIC_PATTERNS } from '../services/haptics';

interface WatchCompanionProps {
  currentUserId: UserId;
  partnerName: string;
  onOpenInstallModal: () => void;
}

export const WatchCompanion: React.FC<WatchCompanionProps> = ({
  currentUserId,
  partnerName,
  onOpenInstallModal,
}) => {
  const [partnerBiometrics, setPartnerBiometrics] = useState<WatchBiometrics>({
    user_id: currentUserId === 'murat' ? 'sevgilim' : 'murat',
    heart_rate: 74,
    steps: 6420,
    stress_level: 18,
    battery: 88,
    watch_model: currentUserId === 'murat' ? 'Galaxy Watch 7' : 'Galaxy Watch Ultra',
  });

  const [activeAnimation, setActiveAnimation] = useState<string | null>(null);

  useEffect(() => {
    const partnerId = currentUserId === 'murat' ? 'sevgilim' : 'murat';
    api.getWatchBiometrics(partnerId).then(setPartnerBiometrics).catch(console.warn);

    const unsubBio = wsClient.on('partner_watch_biometrics', (data: any) => {
      setPartnerBiometrics((prev) => ({
        ...prev,
        heart_rate: data.heart_rate,
        steps: data.steps,
        stress_level: data.stress_level,
        battery: data.battery,
        watch_model: data.watch_model,
      }));
    });

    const unsubAnim = wsClient.on('watch_animation', (data: any) => {
      setActiveAnimation(data.animation);
      playHaptic(HAPTIC_PATTERNS.attention);
      soundEngine.playLoveChime();
      setTimeout(() => setActiveAnimation(null), 3500);
    });

    return () => {
      unsubBio();
      unsubAnim();
    };
  }, [currentUserId]);

  const sendWatchPulse = (anim: string) => {
    setActiveAnimation(anim);
    playHaptic(HAPTIC_PATTERNS.heartbeat);
    soundEngine.playLoveChime();

    wsClient.send({
      type: 'watch_pulse',
      animation: anim,
    });

    setTimeout(() => setActiveAnimation(null), 3000);
  };

  return (
    <div className="flex flex-col items-center space-y-4">
      {/* Top Bar with "Saate Kur" Button */}
      <div className="w-full flex items-center justify-between px-2">
        <div className="flex items-center gap-2">
          <Watch className="w-5 h-5 text-berry-600" />
          <span className="font-serif text-sm font-bold text-berry-950">
            {partnerBiometrics.watch_model}
          </span>
        </div>

        <button
          onClick={onOpenInstallModal}
          className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-full bg-gradient-to-r from-berry-600 to-rose-600 hover:from-berry-700 hover:to-rose-700 text-white text-xs font-semibold shadow-xs transition-all active:scale-95"
        >
          <Download className="w-3.5 h-3.5" />
          <span>Saate Kur ⌚</span>
        </button>
      </div>

      {/* Samsung Galaxy Watch Circular Display Frame */}
      <div className="relative w-64 h-64 sm:w-72 sm:h-72 rounded-full p-2 bg-gradient-to-b from-stone-800 to-stone-950 shadow-2xl border-4 border-stone-700/80 flex items-center justify-center">
        {/* Screen inner circle */}
        <div className="relative w-full h-full rounded-full bg-black overflow-hidden flex flex-col items-center justify-center p-4 text-white text-center select-none">
          
          {/* Active romantic animation overlay on watch face */}
          {activeAnimation ? (
            <div className="absolute inset-0 z-20 bg-berry-900/90 flex flex-col items-center justify-center animate-fade-in p-4">
              {activeAnimation === 'heartbeat' && (
                <>
                  <Heart className="w-16 h-16 fill-rose-500 text-rose-400 animate-heartbeat mb-2 drop-shadow-lg" />
                  <span className="font-serif text-sm font-bold text-pink-100">
                    {partnerName}'in Kalbi Senin İçin Atıyor!
                  </span>
                </>
              )}
              {activeAnimation === 'hug' && (
                <>
                  <span className="text-5xl animate-bounce mb-2">🤗</span>
                  <span className="font-serif text-sm font-bold text-pink-100">
                    Sımsıkı Sarılma Geldi!
                  </span>
                </>
              )}
              {activeAnimation === 'kiss' && (
                <>
                  <span className="text-5xl animate-pulse mb-2">💋</span>
                  <span className="font-serif text-sm font-bold text-pink-100">
                    Kocaman Bir Öpücük!
                  </span>
                </>
              )}
            </div>
          ) : null}

          {/* Watch Face Content */}
          <div className="flex flex-col items-center z-10">
            {/* Partner Avatar & Name */}
            <span className="text-xs font-medium text-pink-300 opacity-90">
              {partnerName}'in Saati
            </span>

            {/* Live Heart Rate Pulse */}
            <div className="flex items-center gap-1.5 my-2">
              <Heart className="w-6 h-6 fill-rose-500 text-rose-500 animate-heartbeat" />
              <span className="font-serif text-3xl font-extrabold tracking-tight text-white">
                {partnerBiometrics.heart_rate}
              </span>
              <span className="text-[10px] text-rose-300 font-semibold uppercase">
                BPM
              </span>
            </div>

            {/* Steps & Stress meter */}
            <div className="grid grid-cols-2 gap-4 mt-1 w-full max-w-[190px] pt-2 border-t border-white/15">
              <div className="flex flex-col items-center">
                <div className="flex items-center gap-1 text-[11px] text-stone-300 font-medium">
                  <Footprints className="w-3.5 h-3.5 text-pink-400" />
                  <span>Adım</span>
                </div>
                <span className="font-semibold text-xs text-white mt-0.5">
                  {partnerBiometrics.steps.toLocaleString('tr-TR')}
                </span>
              </div>

              <div className="flex flex-col items-center">
                <div className="flex items-center gap-1 text-[11px] text-stone-300 font-medium">
                  <Activity className="w-3.5 h-3.5 text-emerald-400" />
                  <span>Stres</span>
                </div>
                <span className="font-semibold text-xs text-emerald-300 mt-0.5">
                  {partnerBiometrics.stress_level < 30 ? 'Sakin 🍃' : 'Normal ✨'}
                </span>
              </div>
            </div>

            {/* Watch Battery */}
            <span className="text-[10px] text-stone-400 mt-2">
              Pil: %{partnerBiometrics.battery} ⚡
            </span>
          </div>
        </div>
      </div>

      {/* Watch Haptic & Animation Dispatch Buttons */}
      <div className="w-full bg-white/80 backdrop-blur-md rounded-3xl p-4 border border-rose-100 shadow-sm">
        <h4 className="font-serif text-xs font-bold text-berry-900 mb-2.5 text-center">
          {partnerName}'in Kolundaki Saate Özel His Gönder ✨
        </h4>
        <div className="grid grid-cols-3 gap-2">
          <button
            onClick={() => sendWatchPulse('heartbeat')}
            className="flex flex-col items-center justify-center p-3 rounded-2xl bg-rose-50 hover:bg-rose-100/80 border border-rose-200/60 text-berry-800 transition-all active:scale-95"
          >
            <Heart className="w-5 h-5 text-rose-500 fill-rose-300 mb-1 animate-pulse" />
            <span className="text-[11px] font-semibold">Kalp Atışı</span>
          </button>

          <button
            onClick={() => sendWatchPulse('hug')}
            className="flex flex-col items-center justify-center p-3 rounded-2xl bg-rose-50 hover:bg-rose-100/80 border border-rose-200/60 text-berry-800 transition-all active:scale-95"
          >
            <span className="text-xl mb-0.5">🤗</span>
            <span className="text-[11px] font-semibold">Sarılma</span>
          </button>

          <button
            onClick={() => sendWatchPulse('kiss')}
            className="flex flex-col items-center justify-center p-3 rounded-2xl bg-rose-50 hover:bg-rose-100/80 border border-rose-200/60 text-berry-800 transition-all active:scale-95"
          >
            <span className="text-xl mb-0.5">💋</span>
            <span className="text-[11px] font-semibold">Öpücük</span>
          </button>
        </div>
      </div>
    </div>
  );
};
