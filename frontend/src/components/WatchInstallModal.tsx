import React, { useState, useEffect } from 'react';
import {
  X, Watch, Sparkles, CheckCircle2, Smartphone,
  Bluetooth, Share2, Heart, ExternalLink, Loader2
} from 'lucide-react';
import confetti from 'canvas-confetti';
import { playHaptic, soundEngine } from '../services/haptics';
import { galaxyWatchService, WatchStatusResponse } from '../services/galaxyWatch';

interface WatchInstallModalProps {
  onClose: () => void;
}

export const WatchInstallModal: React.FC<WatchInstallModalProps> = ({ onClose }) => {
  const [watchStatus, setWatchStatus] = useState<WatchStatusResponse | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [feedbackMessage, setFeedbackMessage] = useState<string | null>(null);
  const [isSuccess, setIsSuccess] = useState(false);

  const watchUrl = typeof window !== 'undefined'
    ? `${window.location.origin}/watch`
    : 'http://192.168.2.170:33470/watch';

  useEffect(() => {
    // Check if Samsung Galaxy Watch is connected via Bluetooth
    galaxyWatchService.getStatus().then((status) => {
      setWatchStatus(status);
    });
  }, []);

  const handle1TapLaunch = async () => {
    setIsLoading(true);
    setFeedbackMessage(null);
    playHaptic(30);

    try {
      const res = await galaxyWatchService.launchOnWatch(watchUrl);
      setIsLoading(false);
      setFeedbackMessage(res.message);
      setIsSuccess(res.success);

      if (res.success) {
        soundEngine.playLoveChime();
        confetti({
          particleCount: 40,
          spread: 60,
          origin: { y: 0.6 },
          colors: ['#be185d', '#f43f5e', '#fb7185', '#fbcfe8'],
        });
      }
    } catch (e: any) {
      setIsLoading(false);
      setFeedbackMessage('Saate sinyal iletilemedi. Lütfen Bluetooth bağlantısını kontrol edin.');
      setIsSuccess(false);
    }
  };

  const handleOpenGalaxyWearable = async () => {
    playHaptic(20);
    const opened = await galaxyWatchService.openWearableApp();
    if (!opened) {
      alert('Samsung Galaxy Wearable uygulaması bulunamadı.');
    }
  };

  const handleShareToWatch = async () => {
    playHaptic(20);
    try {
      if (navigator.share) {
        await navigator.share({
          title: 'Ahududu Saat ❤️',
          text: 'Samsung Galaxy Watch üzerinde aç',
          url: watchUrl,
        });
      } else {
        navigator.clipboard.writeText(watchUrl);
        alert('Bağlantı kopyalandı!');
      }
    } catch (e) {}
  };

  const connectedWatchName = watchStatus?.watches?.[0]?.name || 'Samsung Galaxy Watch';

  return (
    <div className="fixed inset-0 z-50 bg-black/65 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="relative w-full max-w-sm bg-gradient-to-b from-white via-rose-50/30 to-pink-50/50 rounded-3xl p-6 shadow-2xl border border-rose-100 overflow-hidden">
        
        {/* Close Button */}
        <button
          onClick={onClose}
          className="absolute top-4 right-4 p-2 rounded-full hover:bg-stone-100 text-stone-500 transition-colors"
        >
          <X className="w-5 h-5" />
        </button>

        {/* Header */}
        <div className="flex items-center gap-3 mb-5">
          <div className="w-12 h-12 rounded-2xl bg-gradient-to-tr from-berry-500 to-rose-400 text-white flex items-center justify-center shadow-md shadow-berry-900/10">
            <Watch className="w-6 h-6 animate-pulse" />
          </div>
          <div>
            <h3 className="font-serif text-lg font-bold text-berry-950">
              Saate Kolay Kurulum
            </h3>
            <div className="flex items-center gap-1.5 mt-0.5">
              <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
              <span className="text-xs font-semibold text-emerald-700">
                {watchStatus?.connected ? `${connectedWatchName} Bağlı` : 'Galaxy Watch Bağlantısı Aktif'}
              </span>
            </div>
          </div>
        </div>

        {/* Romantic Explanation */}
        <div className="p-3.5 rounded-2xl bg-white/80 border border-rose-100/80 shadow-xs mb-4">
          <p className="text-xs text-stone-600 leading-relaxed">
            Telefonun zaten Bluetooth ile saatine bağlı 💕 Yazı yazmaya veya ayar yapmaya hiç gerek yok, aşağıdaki butona dokunman yeterli!
          </p>
        </div>

        {/* 1-Tap Magic Button */}
        <div className="space-y-3">
          <button
            onClick={handle1TapLaunch}
            disabled={isLoading}
            className="w-full py-4 px-4 rounded-2xl bg-gradient-to-r from-berry-600 via-rose-600 to-pink-600 hover:from-berry-700 hover:to-pink-700 active:scale-[0.98] text-white font-semibold text-sm shadow-lg shadow-berry-600/20 flex items-center justify-center gap-2.5 transition-all disabled:opacity-75"
          >
            {isLoading ? (
              <>
                <Loader2 className="w-5 h-5 animate-spin" />
                <span>Saate Bağlanılıyor...</span>
              </>
            ) : (
              <>
                <Sparkles className="w-5 h-5 text-amber-200 animate-bounce" />
                <span>Tek Dokunuşla Saatte Aç ⌚✨</span>
              </>
            )}
          </button>

          {/* Feedback message banner */}
          {feedbackMessage && (
            <div
              className={`p-3 rounded-2xl border text-xs flex items-center gap-2 ${
                isSuccess
                  ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
                  : 'bg-amber-50 border-amber-200 text-amber-800'
              }`}
            >
              {isSuccess ? (
                <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
              ) : (
                <Bluetooth className="w-4 h-4 text-amber-600 shrink-0" />
              )}
              <span className="font-medium leading-snug">{feedbackMessage}</span>
            </div>
          )}

          {/* Alternative 1: Open Samsung Galaxy Wearable app on phone */}
          <button
            onClick={handleOpenGalaxyWearable}
            className="w-full py-2.5 px-3 rounded-xl bg-white hover:bg-stone-50 border border-stone-200 text-stone-700 text-xs font-semibold flex items-center justify-between transition-colors"
          >
            <div className="flex items-center gap-2">
              <Smartphone className="w-4 h-4 text-berry-600" />
              <span>Samsung Wearable ile Kare (Tile) Ekle</span>
            </div>
            <ExternalLink className="w-3.5 h-3.5 text-stone-400" />
          </button>

          {/* Alternative 2: Samsung Quick Share to Watch */}
          <button
            onClick={handleShareToWatch}
            className="w-full py-2.5 px-3 rounded-xl bg-white hover:bg-stone-50 border border-stone-200 text-stone-700 text-xs font-semibold flex items-center justify-between transition-colors"
          >
            <div className="flex items-center gap-2">
              <Share2 className="w-4 h-4 text-rose-500" />
              <span>Quick Share ile Saate Gönder</span>
            </div>
            <ExternalLink className="w-3.5 h-3.5 text-stone-400" />
          </button>
        </div>

        {/* Automatic Health Sync Note */}
        <div className="mt-4 pt-3 border-t border-rose-100 flex items-start gap-2 text-[11px] text-stone-500">
          <Heart className="w-3.5 h-3.5 text-berry-500 shrink-0 mt-0.5" />
          <p>
            Telefonun ve saatin sürekli bağlı olduğu için nabız, stres ve adım bilgilerin sevgiline otomatik olarak aktarılır.
          </p>
        </div>

        <button
          onClick={onClose}
          className="mt-4 w-full py-2.5 rounded-xl bg-stone-100 hover:bg-stone-200 text-stone-700 font-semibold text-xs transition-colors"
        >
          Kapat
        </button>
      </div>
    </div>
  );
};
