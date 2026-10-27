import React, { useState } from 'react';
import { X, Watch, QrCode, CheckCircle2, Smartphone, ArrowRight, Sparkles } from 'lucide-react';
import { playHaptic } from '../services/haptics';

interface WatchInstallModalProps {
  onClose: () => void;
}

export const WatchInstallModal: React.FC<WatchInstallModalProps> = ({ onClose }) => {
  const [copied, setCopied] = useState(false);
  const watchUrl = typeof window !== 'undefined' ? `${window.location.origin}/watch` : 'https://ahududu.app/watch';

  const handleCopyLink = () => {
    navigator.clipboard.writeText(watchUrl);
    setCopied(true);
    playHaptic(25);
    setTimeout(() => setCopied(false), 2500);
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/65 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="relative w-full max-w-md bg-white rounded-3xl p-6 shadow-2xl border border-rose-100 overflow-hidden">
        
        {/* Close Button */}
        <button
          onClick={onClose}
          className="absolute top-4 right-4 p-2 rounded-full hover:bg-stone-100 text-stone-500"
        >
          <X className="w-5 h-5" />
        </button>

        <div className="flex items-center gap-2 mb-4">
          <div className="w-10 h-10 rounded-2xl bg-berry-100 flex items-center justify-center">
            <Watch className="w-5 h-5 text-berry-600" />
          </div>
          <div>
            <h3 className="font-serif text-base font-bold text-berry-950">
              Samsung Galaxy Watch'a Kurulum
            </h3>
            <p className="text-xs text-stone-500">Watch 7 & Watch Ultra için</p>
          </div>
        </div>

        {/* 2 Easy Options */}
        <div className="space-y-3.5 my-4">
          {/* Method 1: Instant Watch Tile (Zero Technical Knowledge) */}
          <div className="p-4 rounded-2xl bg-gradient-to-r from-rose-50 to-pink-50 border border-rose-200/80">
            <div className="flex items-center gap-2 mb-1.5">
              <span className="w-5 h-5 rounded-full bg-berry-600 text-white text-[11px] font-bold flex items-center justify-center">
                1
              </span>
              <h4 className="font-serif text-xs font-bold text-berry-900">
                En Kolay Yol: Saatin Ekranına 1 Dokunuşla Ekle
              </h4>
            </div>
            <p className="text-xs text-stone-600 leading-relaxed">
              Samsung Saatinizdeki <b>İnternet</b> uygulamasını açın ve bu adresi girin:
            </p>

            <div className="flex items-center gap-2 mt-2 bg-white px-3 py-2 rounded-xl border border-rose-200">
              <span className="text-xs font-mono font-semibold text-berry-700 truncate flex-1">
                {watchUrl}
              </span>
              <button
                onClick={handleCopyLink}
                className="text-xs font-semibold px-2.5 py-1 rounded-lg bg-berry-500 text-white shrink-0 hover:bg-berry-600"
              >
                {copied ? 'Kopyalandı ✓' : 'Kopyala'}
              </button>
            </div>
            <p className="text-[11px] text-stone-500 mt-2">
              Sayfa açılınca saatin menüsünden <b>"Kareye / Ana Ekrana Ekle"</b> diyerek her an bileğinizde tutabilirsiniz.
            </p>
          </div>

          {/* Method 2: Companion APK */}
          <div className="p-4 rounded-2xl bg-stone-50 border border-stone-200">
            <div className="flex items-center gap-2 mb-1.5">
              <span className="w-5 h-5 rounded-full bg-stone-700 text-white text-[11px] font-bold flex items-center justify-center">
                2
              </span>
              <h4 className="font-serif text-xs font-bold text-stone-800">
                Galaxy Wearable ile Otomatik Eşleşme
              </h4>
            </div>
            <p className="text-xs text-stone-600 leading-relaxed">
              Ahududu APK'sı telefonunuza kurulduğunda, Samsung Galaxy Wearable uygulaması aracılığıyla saatteki sensörleri (Nabız, Adım, Stres) otomatik olarak senkronize eder. Ekstra hiçbir ayar yapmanıza gerek yoktur.
            </p>
          </div>
        </div>

        <button
          onClick={onClose}
          className="w-full py-2.5 rounded-2xl bg-berry-500 hover:bg-berry-600 text-white font-semibold text-xs shadow-xs"
        >
          Tamam, Anladım 💕
        </button>
      </div>
    </div>
  );
};
