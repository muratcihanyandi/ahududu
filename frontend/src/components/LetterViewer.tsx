import React, { useState } from 'react';
import { X, Stamp, Heart, Calendar, User, Eye } from 'lucide-react';
import confetti from 'canvas-confetti';
import { LoveLetter } from '../types';
import { api } from '../services/api';
import { playHaptic, soundEngine, HAPTIC_PATTERNS } from '../services/haptics';

interface LetterViewerProps {
  letter: LoveLetter;
  onClose: () => void;
  onLetterOpened: (letter: LoveLetter) => void;
}

export const LetterViewer: React.FC<LetterViewerProps> = ({
  letter,
  onClose,
  onLetterOpened,
}) => {
  const [isOpening, setIsOpening] = useState(false);
  const [opened, setOpened] = useState(letter.is_opened);

  const handleBreakSeal = async () => {
    if (opened) return;
    setIsOpening(true);
    playHaptic(HAPTIC_PATTERNS.attention);
    soundEngine.playLoveChime();

    // Wax seal breaking confetti
    confetti({
      particleCount: 50,
      spread: 70,
      origin: { y: 0.5 },
      colors: ['#be185d', '#d97706', '#f43f5e', '#fed7aa'],
    });

    try {
      const updated = await api.openLetter(letter.id);
      setTimeout(() => {
        setOpened(true);
        setIsOpening(false);
        onLetterOpened(updated);
      }, 700);
    } catch (e) {
      console.error(e);
      setOpened(true);
      setIsOpening(false);
    }
  };

  const themeStyles = {
    vintage_parchment: 'bg-amber-50/85 border-amber-200 text-stone-900',
    rose_blush: 'bg-rose-50/90 border-rose-200 text-rose-950',
    starry_night: 'bg-slate-900 border-indigo-800 text-purple-100',
    lavender: 'bg-purple-50/90 border-purple-200 text-purple-950',
  };

  const currentTheme = themeStyles[letter.stationery_theme] || themeStyles.vintage_parchment;
  const isFromMurat = letter.sender === 'murat';

  return (
    <div className="fixed inset-0 z-50 bg-black/65 backdrop-blur-sm flex items-center justify-center p-3 sm:p-5">
      <div className="relative w-full max-w-lg max-h-[90vh] flex flex-col bg-white rounded-3xl shadow-2xl overflow-hidden border border-rose-200/50">
        
        {/* Close Button */}
        <button
          onClick={onClose}
          className="absolute top-4 right-4 z-20 p-2 rounded-full bg-white/80 hover:bg-white text-stone-600 shadow-sm transition-all"
        >
          <X className="w-5 h-5" />
        </button>

        {!opened ? (
          /* Sealed Envelope View */
          <div className="p-8 flex flex-col items-center justify-center text-center min-h-[420px] bg-gradient-to-b from-rose-50 via-pink-50 to-amber-50/50">
            <div className="mb-4 text-xs font-semibold tracking-wider uppercase text-berry-600 flex items-center gap-1.5">
              <Heart className="w-4 h-4 fill-berry-400" />
              Sana Özel Mühürlü Bir Mektup Geldi
            </div>

            <h3 className="font-serif text-2xl font-bold text-berry-900 mb-6 max-w-xs">
              "{letter.title}"
            </h3>

            {/* 3D Wax Seal Button */}
            <div className="relative my-4">
              <button
                onClick={handleBreakSeal}
                disabled={isOpening}
                className={`relative group w-32 h-32 rounded-full flex flex-col items-center justify-center shadow-2xl transition-all ${
                  isOpening
                    ? 'scale-115 rotate-12 opacity-80'
                    : 'hover:scale-105 active:scale-95 animate-pulseGlow'
                }`}
                style={{
                  background: 'radial-gradient(circle, #be185d 0%, #831843 70%, #500724 100%)',
                  boxShadow: '0 15px 35px -5px rgba(190, 24, 93, 0.5), inset 0 2px 4px rgba(255, 255, 255, 0.4), inset 0 -3px 6px rgba(0, 0, 0, 0.5)'
                }}
              >
                <div className="w-24 h-24 rounded-full border-2 border-dashed border-amber-300/60 flex flex-col items-center justify-center">
                  <Stamp className="w-8 h-8 text-amber-300 mb-1" />
                  <span className="font-serif text-[11px] font-bold text-amber-200 tracking-wider">
                    AHUDUDU
                  </span>
                </div>
              </button>
            </div>

            <p className="mt-6 text-sm text-stone-500 font-medium">
              Mührü kırmak ve mektubu okumak için dokun ✨
            </p>
          </div>
        ) : (
          /* Opened Letter View */
          <div className="flex flex-col h-full overflow-hidden">
            {/* Header info */}
            <div className="px-6 py-4 bg-rose-50/70 border-b border-rose-100 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="text-xl">{isFromMurat ? '🐻' : '🌸'}</span>
                <div>
                  <h3 className="font-serif text-base font-bold text-berry-950">
                    {letter.title}
                  </h3>
                  <div className="flex items-center gap-3 text-xs text-stone-500">
                    <span className="flex items-center gap-1">
                      <User className="w-3 h-3" />
                      {isFromMurat ? 'Murat' : 'Sevgilim'}
                    </span>
                    <span className="flex items-center gap-1">
                      <Calendar className="w-3 h-3" />
                      {new Date(letter.created_at).toLocaleDateString('tr-TR', {
                        day: 'numeric',
                        month: 'long',
                        hour: '2-digit',
                        minute: '2-digit'
                      })}
                    </span>
                  </div>
                </div>
              </div>
            </div>

            {/* Letter Paper Body */}
            <div className="flex-1 overflow-y-auto p-6">
              <div className={`p-6 rounded-2xl border shadow-inner ${currentTheme}`}>
                {letter.content_text && (
                  <p className="font-handwriting text-2xl leading-relaxed whitespace-pre-wrap">
                    {letter.content_text}
                  </p>
                )}

                {/* S-Pen / Canvas Drawing if attached */}
                {letter.canvas_image_url && (
                  <div className="mt-6 pt-5 border-t border-current/20">
                    <p className="font-serif text-xs font-semibold mb-2 opacity-70">
                      El Yazısı & Kalp Çizimi:
                    </p>
                    <img
                      src={letter.canvas_image_url}
                      alt="Sevgilimin Çizimi"
                      className="w-full max-h-[400px] object-contain rounded-xl bg-white/40 border border-current/20"
                    />
                  </div>
                )}
              </div>
            </div>

            {/* Footer */}
            <div className="px-6 py-3 bg-rose-50/50 border-t border-rose-100 flex items-center justify-between text-xs text-stone-500">
              <span className="flex items-center gap-1 text-berry-600">
                <Heart className="w-3.5 h-3.5 fill-berry-400" />
                Ahududu Mektup Arşivimizde sonsuza dek saklanıyor
              </span>
              <button
                onClick={onClose}
                className="px-4 py-1.5 rounded-xl bg-berry-500 text-white font-medium hover:bg-berry-600"
              >
                Kapat
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
