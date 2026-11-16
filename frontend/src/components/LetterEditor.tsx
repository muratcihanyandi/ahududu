import React, { useState, useEffect } from 'react';
import { Feather, PenTool, Stamp, Send, X, Heart } from 'lucide-react';
import confetti from 'canvas-confetti';
import { SPenCanvas } from './SPenCanvas';
import { api } from '../services/api';
import { updates } from '../services/updates';
import { UserId } from '../types';
import { playHaptic, soundEngine, HAPTIC_PATTERNS } from '../services/haptics';

interface LetterEditorProps {
  currentUserId: UserId;
  onLetterSent: () => void;
  onClose: () => void;
}

type LetterTheme = 'vintage_parchment' | 'rose_blush' | 'starry_night' | 'lavender';

const LETTER_THEMES: { id: LetterTheme; color: string; title: string }[] = [
  { id: 'vintage_parchment', color: '#fef3c7', title: 'Parşömen' },
  { id: 'rose_blush', color: '#ffe4e6', title: 'Gül Pembesi' },
  { id: 'starry_night', color: '#1e1b4b', title: 'Gece Göğü' },
  { id: 'lavender', color: '#ede9fe', title: 'Lavanta' },
];

const DRAFT_KEY = 'ahududu_letter_draft';

interface LetterDraft {
  title: string;
  content: string;
  theme: LetterTheme;
  canvasDataUrl: string | null;
  canvasStrokesJson: string | null;
}

const loadLetterDraft = (): Partial<LetterDraft> => {
  try {
    const raw = localStorage.getItem(DRAFT_KEY);
    return raw ? (JSON.parse(raw) as Partial<LetterDraft>) : {};
  } catch {
    return {};
  }
};

const persistLetterDraft = (draft: LetterDraft) => {
  try {
    localStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
  } catch {
    // Canvas images can exceed the storage quota; keep the text no matter what.
    try {
      localStorage.setItem(DRAFT_KEY, JSON.stringify({ ...draft, canvasDataUrl: null }));
    } catch {
      // Storage unavailable: the editor is busy-marked, so no reload happens mid-write.
    }
  }
};

const clearLetterDraft = () => {
  try {
    localStorage.removeItem(DRAFT_KEY);
  } catch {
    // Ignore storage errors on cleanup.
  }
};

export const LetterEditor: React.FC<LetterEditorProps> = ({
  currentUserId,
  onLetterSent,
  onClose,
}) => {
  const [initialDraft] = useState(loadLetterDraft);
  const [title, setTitle] = useState(initialDraft.title ?? '');
  const [content, setContent] = useState(initialDraft.content ?? '');
  const [theme, setTheme] = useState<LetterTheme>(initialDraft.theme ?? 'vintage_parchment');
  const [activeTab, setActiveTab] = useState<'write' | 'draw'>('write');
  const [canvasDataUrl, setCanvasDataUrl] = useState<string | null>(initialDraft.canvasDataUrl ?? null);
  const [canvasStrokesJson, setCanvasStrokesJson] = useState<string | null>(initialDraft.canvasStrokesJson ?? null);
  const [isSending, setIsSending] = useState(false);
  const [showRestoredNotice, setShowRestoredNotice] = useState(
    Boolean(initialDraft.title || initialDraft.content || initialDraft.canvasDataUrl || initialDraft.canvasStrokesJson)
  );

  const hasDraftContent = Boolean(title || content || canvasDataUrl || canvasStrokesJson);

  // Never reload the app while an unsent letter is being written.
  useEffect(() => {
    updates.setBusy(true);
    return () => updates.setBusy(false);
  }, []);

  // Keep the draft on the device so even a forced reload cannot lose it.
  useEffect(() => {
    if (!hasDraftContent) {
      clearLetterDraft();
      return;
    }
    persistLetterDraft({ title, content, theme, canvasDataUrl, canvasStrokesJson });
  }, [title, content, theme, canvasDataUrl, canvasStrokesJson, hasDraftContent]);

  const handleCanvasSave = (dataUrl: string, strokesJson: string) => {
    setCanvasDataUrl(dataUrl);
    setCanvasStrokesJson(strokesJson);
    setActiveTab('write');
  };

  const handleDiscardDraft = () => {
    playHaptic(20);
    clearLetterDraft();
    setTitle('');
    setContent('');
    setCanvasDataUrl(null);
    setCanvasStrokesJson(null);
    setTheme('vintage_parchment');
    setShowRestoredNotice(false);
  };

  const handleSendLetter = async () => {
    if (!title && !content && !canvasDataUrl) {
      alert('Mektup boş olamaz.');
      return;
    }

    setIsSending(true);
    playHaptic(HAPTIC_PATTERNS.attention);
    soundEngine.playLoveChime();

    // Wax seal confetti burst
    confetti({
      particleCount: 45,
      spread: 60,
      origin: { y: 0.7 },
      colors: ['#be185d', '#e11d48', '#d97706', '#fbcfe8'],
    });

    try {
      await api.createLetter({
        sender: currentUserId,
        title: title.trim() || 'Kalbimden Sana Mektup 💌',
        content_text: content,
        canvas_data: canvasStrokesJson || undefined,
        canvas_image_url: canvasDataUrl || undefined,
        stationery_theme: theme,
      });

      clearLetterDraft();

      setTimeout(() => {
        setIsSending(false);
        onLetterSent();
      }, 1200);
    } catch (e) {
      console.error(e);
      setIsSending(false);
      alert('Mektup gönderilemedi, lütfen tekrar dene.');
    }
  };

  const themeStyles = {
    vintage_parchment: 'bg-amber-50/70 border-amber-200 text-stone-800',
    rose_blush: 'bg-rose-50/80 border-rose-200 text-rose-950',
    starry_night: 'bg-slate-900 border-indigo-800 text-purple-100',
    lavender: 'bg-purple-50/80 border-purple-200 text-purple-950',
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-3 sm:p-5 safe-area-all">
      <div className="relative w-full max-w-xl max-h-[92vh] flex flex-col bg-white rounded-3xl shadow-2xl overflow-hidden border border-rose-200/50">
        
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 bg-gradient-to-r from-rose-50 to-pink-50 border-b border-rose-100">
          <div className="flex items-center gap-2">
            <Feather className="w-5 h-5 text-berry-600" />
            <h2 className="font-serif text-lg font-semibold text-berry-900">
              Yeni Mektup
            </h2>
          </div>
          <button
            onClick={onClose}
            aria-label="Editörü kapat"
            className="p-1.5 rounded-full hover:bg-rose-100 text-stone-500 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Restored draft notice */}
        {showRestoredNotice && (
          <div className="flex items-center justify-between gap-2 px-5 py-2 bg-amber-50 border-b border-amber-200/70 text-[11px] text-amber-900">
            <span className="font-medium">
              Yazdığın taslak geri yüklendi, kaldığın yerden devam edebilirsin.
            </span>
            <button
              onClick={handleDiscardDraft}
              className="shrink-0 px-2 py-1 rounded-lg bg-white border border-amber-300 font-semibold text-amber-900 hover:bg-amber-100 transition-colors"
            >
              Taslağı sil
            </button>
          </div>
        )}

        {/* Tab switch & stationery theme picker */}
        <div className="flex flex-wrap items-center justify-between gap-2 px-5 py-2.5 bg-rose-50/40 border-b border-rose-100/60">
          <div className="flex items-center bg-white p-1 rounded-xl shadow-xs border border-rose-200/60">
            <button
              onClick={() => {
                setActiveTab('write');
                playHaptic(20);
              }}
              className={`flex items-center gap-1.5 px-3 py-1 rounded-lg text-xs font-semibold transition-all ${
                activeTab === 'write'
                  ? 'bg-berry-500 text-white shadow-xs'
                  : 'text-stone-600 hover:text-berry-700'
              }`}
            >
              <Feather className="w-3.5 h-3.5" />
              Yazı
            </button>
            <button
              onClick={() => {
                setActiveTab('draw');
                playHaptic(20);
              }}
              className={`flex items-center gap-1.5 px-3 py-1 rounded-lg text-xs font-semibold transition-all ${
                activeTab === 'draw'
                  ? 'bg-berry-500 text-white shadow-xs'
                  : 'text-stone-600 hover:text-berry-700'
              }`}
            >
              <PenTool className="w-3.5 h-3.5" />
              S-Pen / Çizim
            </button>
          </div>

          {/* Theme circles */}
          <div className="flex items-center gap-1.5">
            <span className="text-[11px] font-medium text-stone-500 mr-1">Kağıt:</span>
            {LETTER_THEMES.map((t) => (
              <button
                key={t.id}
                onClick={() => {
                  setTheme(t.id);
                  playHaptic(20);
                }}
                className={`w-5 h-5 rounded-full border transition-all ${
                  theme === t.id ? 'ring-2 ring-berry-500 scale-115' : 'opacity-80'
                }`}
                style={{ backgroundColor: t.color }}
                title={t.title}
              />
            ))}
          </div>
        </div>

        {/* Editor Body */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-5">
          {activeTab === 'write' ? (
            <div className={`p-5 rounded-2xl border min-h-[380px] shadow-inner transition-colors ${themeStyles[theme]}`}>
              <input
                type="text"
                placeholder="Mektubun başlığı"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                className="w-full bg-transparent font-serif text-xl font-bold mb-4 border-b border-current/20 pb-2 focus:outline-none placeholder:opacity-50"
              />

              <textarea
                placeholder="Aklındakileri, kalbindekileri buraya dök canım..."
                value={content}
                onChange={(e) => setContent(e.target.value)}
                rows={9}
                className="w-full bg-transparent font-handwriting text-2xl leading-relaxed resize-none focus:outline-none placeholder:opacity-50"
              />

              {/* Show attached drawing thumbnail if any */}
              {canvasDataUrl && (
                <div className="mt-4 pt-3 border-t border-current/20">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs font-semibold opacity-75">Ekli Çizim / El Yazısı:</span>
                    <button
                      onClick={() => setCanvasDataUrl(null)}
                      className="text-xs text-rose-500 hover:underline"
                    >
                      Çizimi Kaldır
                    </button>
                  </div>
                  <img
                    src={canvasDataUrl}
                    alt="Çizim"
                    className="max-h-40 rounded-xl border border-current/20 object-contain bg-white/40"
                  />
                </div>
              )}
            </div>
          ) : (
            <div className="h-[430px]">
              <SPenCanvas onSave={handleCanvasSave} />
            </div>
          )}
        </div>

        {/* Footer / Send with Wax Seal */}
        <div className="p-4 bg-gradient-to-r from-rose-50 to-pink-50 border-t border-rose-100 flex items-center justify-between">
          <div className="flex items-center gap-1.5 text-xs text-berry-700">
            <Heart className="w-4 h-4 fill-berry-400 text-berry-500 animate-pulse" />
            <span>Mektup balmumu mühürle kapatılacak</span>
          </div>

          <button
            onClick={handleSendLetter}
            disabled={isSending}
            className={`flex items-center gap-2 px-6 py-2.5 rounded-2xl font-serif text-sm font-semibold tracking-wide text-white shadow-lg transition-all ${
              isSending
                ? 'bg-amber-600 scale-95 opacity-80'
                : 'bg-gradient-to-r from-berry-600 to-rose-600 hover:from-berry-700 hover:to-rose-700 active:scale-95 shadow-berry-500/25'
            }`}
          >
            <Stamp className="w-4 h-4 text-amber-300" />
            {isSending ? 'Mühürleniyor...' : 'Mektubu Mühürle & Gönder'}
          </button>
        </div>
      </div>
    </div>
  );
};
