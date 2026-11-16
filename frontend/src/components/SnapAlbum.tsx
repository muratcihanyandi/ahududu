import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  Camera, X, Send, Trash2, Eye, Sparkles, Clock, Play, Pause,
  ChevronLeft, ChevronRight, Heart, RefreshCw,
} from 'lucide-react';
import { SnapStory, SnapFeed, UserId, USERS, partnerOf, nameOf } from '../types';
import { api, mediaUrl } from '../services/api';
import { wsClient } from '../services/websocket';
import { playHaptic, soundEngine, HAPTIC_PATTERNS } from '../services/haptics';

interface SnapAlbumProps {
  currentUserId: UserId;
}

// Duygu durumları — küçük, tatlı etiketler
const MOODS: { id: string; label: string; emoji: string }[] = [
  { id: 'mutlu', label: 'Mutlu', emoji: '😊' },
  { id: 'özledim', label: 'Özledim', emoji: '🥺' },
  { id: 'aşık', label: 'Aşık', emoji: '🥰' },
  { id: 'uykum', label: 'Uykum var', emoji: '😴' },
  { id: 'heyecanlı', label: 'Heyecanlı', emoji: '🤩' },
  { id: 'kızgın', label: 'Kızgın', emoji: '😤' },
  { id: 'üzgün', label: 'Üzgün', emoji: '😢' },
];

// Fotoğraf filtreleri — CSS renk düzenlemeleri
const FILTERS: { id: string; label: string; css: string }[] = [
  { id: 'none', label: 'Normal', css: '' },
  { id: 'rose', label: 'Gül', css: 'saturate(1.25) contrast(1.05) hue-rotate(-8deg)' },
  { id: 'vivid', label: 'Canlı', css: 'saturate(1.6) contrast(1.15)' },
  { id: 'soft', label: 'Yumuşak', css: 'saturate(0.85) brightness(1.08) contrast(0.95)' },
  { id: 'noir', label: 'Siyah Beyaz', css: 'grayscale(1) contrast(1.1)' },
  { id: 'sunset', label: 'Gün Batımı', css: 'sepia(0.25) saturate(1.4) hue-rotate(-15deg)' },
  { id: 'dream', label: 'Rüya', css: 'saturate(1.2) brightness(1.05) blur(0.3px)' },
];

const filterCss = (id?: string) => FILTERS.find((f) => f.id === id)?.css || '';
const moodOf = (id?: string) => MOODS.find((m) => m.id === id);

const timeAgo = (iso: string): string => {
  const diffMin = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (diffMin < 1) return 'az önce';
  if (diffMin < 60) return `${diffMin} dk`;
  const hours = Math.floor(diffMin / 60);
  if (hours < 24) return `${hours} sa`;
  return `${Math.floor(hours / 24)} gün`;
};

const remainingHours = (iso: string): number => {
  const ms = new Date(iso).getTime() - Date.now();
  return Math.max(0, Math.ceil(ms / 3600000));
};

export const SnapAlbum: React.FC<SnapAlbumProps> = ({ currentUserId }) => {
  const partnerId = partnerOf(currentUserId);
  const [snaps, setSnaps] = useState<SnapStory[]>([]);
  const [feed, setFeed] = useState<SnapFeed | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [showComposer, setShowComposer] = useState(false);
  const [viewerList, setViewerList] = useState<SnapStory[] | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [reactionBurst, setReactionBurst] = useState<{ key: number; emoji: string } | null>(null);

  const showToast = useCallback((text: string) => {
    setToast(text);
    window.setTimeout(() => setToast(null), 2600);
  }, []);

  const loadAll = useCallback(async () => {
    setIsLoading(true);
    try {
      const [list, f] = await Promise.all([
        api.listSnaps(),
        api.getSnapFeed(currentUserId),
      ]);
      setSnaps(Array.isArray(list) ? list : []);
      setFeed(f);
    } catch (e) {
      console.error('Snap yükleme hatası', e);
    } finally {
      setIsLoading(false);
    }
  }, [currentUserId]);

  useEffect(() => {
    loadAll();

    const unsubNew = wsClient.on('new_snap', (data: any) => {
      if (data?.snap) {
        setSnaps((prev) => [data.snap, ...prev.filter((s) => s.id !== data.snap.id)]);
        if (data.snap.sender === partnerId) {
          soundEngine.playLoveChime();
          playHaptic(HAPTIC_PATTERNS.butterfly);
          showToast(`${nameOf(partnerId)} yeni bir an paylaştı! 📸`);
        }
        api.getSnapFeed(currentUserId).then(setFeed).catch(() => {});
      }
    });

    const unsubSeen = wsClient.on('snap_seen', () => {
      api.getSnapFeed(currentUserId).then(setFeed).catch(() => {});
    });

    const unsubReaction = wsClient.on('snap_reaction', (data: any) => {
      if (data?.reaction) {
        setReactionBurst({ key: Date.now(), emoji: data.reaction });
        playHaptic(HAPTIC_PATTERNS.butterfly);
        showToast(`${nameOf(partnerId)} anına ${data.reaction} bıraktı!`);
      }
    });

    const unsubDeleted = wsClient.on('snap_deleted', (data: any) => {
      setSnaps((prev) => prev.filter((s) => s.id !== data?.snap_id));
    });

    // 24 saatlik anları temiz tut: dakikada bir yeniden çek
    const timer = window.setInterval(() => {
      api.listSnaps().then((l) => setSnaps(Array.isArray(l) ? l : [])).catch(() => {});
    }, 60000);

    return () => {
      unsubNew();
      unsubSeen();
      unsubReaction();
      unsubDeleted();
      window.clearInterval(timer);
    };
  }, [currentUserId, partnerId, showToast]);

  const mySnaps = snaps.filter((s) => s.sender === currentUserId);
  const partnerSnaps = snaps.filter((s) => s.sender === partnerId);
  const partnerUnseen = partnerSnaps.filter((s) => !s.is_seen).length;

  const openViewer = (list: SnapStory[]) => {
    if (!list.length) return;
    playHaptic(20);
    // Önce görülmemişler, sonra yeniden eskiye
    const ordered = [...list].sort((a, b) => {
      if (a.is_seen !== b.is_seen) return a.is_seen ? 1 : -1;
      return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
    });
    setViewerList(ordered);
  };

  const handleDelete = async (snap: SnapStory) => {
    if (!window.confirm('Bu anı silmek istediğine emin misin?')) return;
    try {
      await api.deleteSnap(snap.id, currentUserId);
      setSnaps((prev) => prev.filter((s) => s.id !== snap.id));
      playHaptic(30);
    } catch (e) {
      console.error(e);
    }
  };

  return (
    <div className="flex flex-col space-y-4">
      {/* Canlı özet kartı */}
      <div className="relative overflow-hidden rounded-3xl p-4 bg-gradient-to-br from-berry-600 via-rose-500 to-amber-400 shadow-lg shadow-berry-500/20 text-white">
        <div className="absolute -top-10 -right-8 w-32 h-32 rounded-full bg-white/15 blur-xl" />
        <div className="absolute -bottom-12 -left-6 w-28 h-28 rounded-full bg-white/10 blur-lg" />

        <div className="relative flex items-center justify-between">
          <div>
            <h2 className="font-serif text-lg font-bold leading-tight">Anlık Fotoğraflar 📸</h2>
            <p className="text-[11px] text-white/85 mt-0.5">
              Anlar 24 saat sonra kendiliğinden kaybolur
            </p>
          </div>
          <button
            onClick={() => {
              setShowComposer(true);
              playHaptic(25);
            }}
            className="flex items-center gap-1.5 px-3.5 py-2 rounded-2xl bg-white/95 text-berry-700 text-xs font-bold shadow-md active:scale-95 transition-all"
          >
            <Camera className="w-4 h-4" />
            An Paylaş
          </button>
        </div>

        <div className="relative grid grid-cols-2 gap-2 mt-3">
          <div className="rounded-2xl bg-white/15 backdrop-blur-xs p-2.5">
            <div className="flex items-center gap-1.5 text-[10px] text-white/80">
              <Clock className="w-3 h-3" />
              Senin aktif anın
            </div>
            <div className="flex items-center gap-1.5 mt-1">
              <span className="font-serif text-base font-bold">
                {feed?.me.count ?? mySnaps.length} an
              </span>
              {(feed?.me.unseen_by_partner ?? 0) > 0 && (
                <span className="text-[9px] bg-white/25 px-1.5 py-0.5 rounded-full font-semibold">
                  {feed?.me.unseen_by_partner} görülmedi
                </span>
              )}
            </div>
          </div>

          <div className="rounded-2xl bg-white/15 backdrop-blur-xs p-2.5">
            <div className="flex items-center gap-1.5 text-[10px] text-white/80">
              <Sparkles className="w-3 h-3" />
              {nameOf(partnerId)} · yeni
            </div>
            <div className="flex items-center gap-1.5 mt-1">
              <span className="font-serif text-base font-bold">
                {partnerUnseen > 0 ? `${partnerUnseen} yeni` : 'Hepsi görüldü'}
              </span>
              {partnerUnseen > 0 && <span className="text-sm animate-pulse">✨</span>}
            </div>
          </div>
        </div>
      </div>

      {/* Halkalar: kimin anları */}
      <div className="flex items-center gap-3 overflow-x-auto pb-1">
        <SnapRing
          label="Sen"
          avatar={USERS[currentUserId].emoji}
          count={mySnaps.length}
          hasNew={mySnaps.some((s) => !s.is_seen)}
          isMine
          onClick={() => openViewer(mySnaps)}
        />
        <SnapRing
          label={nameOf(partnerId)}
          avatar={USERS[partnerId].emoji}
          count={partnerSnaps.length}
          hasNew={partnerUnseen > 0}
          onClick={() => openViewer(partnerSnaps)}
        />
      </div>

      {/* Küçük ızgara akışı */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <h3 className="font-serif text-sm font-bold text-berry-950">Son Anlarımız</h3>
          <button
            onClick={loadAll}
            className="flex items-center gap-1 text-[11px] text-berry-600 font-semibold"
          >
            <RefreshCw className={`w-3 h-3 ${isLoading ? 'animate-spin' : ''}`} />
            Yenile
          </button>
        </div>

        {isLoading ? (
          <div className="p-8 text-center text-xs text-stone-500 animate-pulse">Anlar yükleniyor…</div>
        ) : snaps.length === 0 ? (
          <div className="flex flex-col items-center justify-center p-10 bg-white/70 rounded-3xl border border-rose-100 text-center">
            <Camera className="w-10 h-10 text-berry-300 mb-2 animate-float" />
            <p className="font-serif text-sm font-semibold text-berry-900">Henüz anın yok 📸</p>
            <p className="text-xs text-stone-500 mt-1 max-w-[240px]">
              Şu an ne yapıyorsun? Bir fotoğraf çek, sevgilin anında görsün ✨
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-3 gap-2">
            {snaps.map((snap) => {
              const isMine = snap.sender === currentUserId;
              return (
                <div
                  key={snap.id}
                  onClick={() => openViewer(snaps.filter((s) => s.sender === snap.sender))}
                  className={`group relative aspect-[3/4] rounded-2xl overflow-hidden border shadow-xs cursor-pointer transition-all active:scale-95 ${
                    snap.is_seen ? 'border-rose-100 opacity-80' : 'border-amber-300 ring-2 ring-amber-300/60'
                  }`}
                >
                  {snap.media_type === 'video' ? (
                    <video
                      src={mediaUrl(snap.media_url)}
                      muted
                      playsInline
                      preload="metadata"
                      className="w-full h-full object-cover"
                      style={{ filter: filterCss(snap.filter_name) }}
                      onMouseEnter={(e) => (e.target as HTMLVideoElement).play().catch(() => {})}
                      onMouseLeave={(e) => {
                        const v = e.target as HTMLVideoElement;
                        v.pause();
                        v.currentTime = 0;
                      }}
                    />
                  ) : (
                    <img
                      src={mediaUrl(snap.media_url)}
                      alt="An"
                      loading="lazy"
                      className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                      style={{ filter: filterCss(snap.filter_name) }}
                    />
                  )}

                  <div className="absolute inset-x-0 top-0 p-1.5 bg-gradient-to-b from-black/60 to-transparent flex items-center justify-between">
                    <span className="text-[13px] drop-shadow">{USERS[snap.sender].emoji}</span>
                    {!snap.is_seen && !isMine && (
                      <span className="text-[8px] font-bold bg-amber-400 text-amber-950 px-1.5 py-0.5 rounded-full">
                        YENİ
                      </span>
                    )}
                    {isMine && snap.is_seen && (
                      <span className="text-[8px] font-bold bg-white/85 text-berry-800 px-1.5 py-0.5 rounded-full">
                        GÖRÜLDÜ
                      </span>
                    )}
                  </div>

                  <div className="absolute inset-x-0 bottom-0 p-1.5 bg-gradient-to-t from-black/75 to-transparent">
                    <div className="flex items-center gap-1 text-[9px] text-white/90">
                      {moodOf(snap.mood) && <span>{moodOf(snap.mood)!.emoji}</span>}
                      <span className="truncate">{moodOf(snap.mood)?.label || timeAgo(snap.created_at)}</span>
                    </div>
                  </div>

                  {isMine && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleDelete(snap);
                      }}
                      className="absolute top-1.5 right-1.5 p-1 rounded-full bg-black/50 text-white opacity-0 group-hover:opacity-100 transition-opacity"
                      title="Anı sil"
                    >
                      <Trash2 className="w-3 h-3" />
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {toast && (
        <div className="fixed left-1/2 -translate-x-1/2 top-20 z-[70] px-4 py-2 rounded-2xl bg-berry-900/90 text-white text-xs font-semibold shadow-xl animate-[fadeIn_0.25s_ease-out]">
          {toast}
        </div>
      )}

      {reactionBurst && (
        <div key={reactionBurst.key} className="pointer-events-none fixed inset-0 z-[80] overflow-hidden">
          {Array.from({ length: 14 }).map((_, i) => (
            <span
              key={i}
              className="absolute text-3xl animate-[floatUp_2.2s_ease-out_forwards]"
              style={{
                left: `${8 + Math.random() * 84}%`,
                bottom: '8%',
                animationDelay: `${i * 90}ms`,
              }}
            >
              {reactionBurst.emoji}
            </span>
          ))}
        </div>
      )}

      {showComposer && (
        <SnapComposer
          currentUserId={currentUserId}
          onClose={() => setShowComposer(false)}
          onCreated={(snap) => {
            setSnaps((prev) => [snap, ...prev]);
            setShowComposer(false);
            showToast('Anın paylaşıldı! Sevgilin birazdan görecek 💌');
            api.getSnapFeed(currentUserId).then(setFeed).catch(() => {});
          }}
        />
      )}

      {viewerList && (
        <SnapViewer
          snaps={viewerList}
          currentUserId={currentUserId}
          onClose={() => {
            setViewerList(null);
            api.getSnapFeed(currentUserId).then(setFeed).catch(() => {});
          }}
          onSeen={(id) =>
            setSnaps((prev) => prev.map((s) => (s.id === id ? { ...s, is_seen: true } : s)))
          }
        />
      )}
    </div>
  );
};

/* ------------------------------------------------------------------ */
/* Halka (ring)                                                        */
/* ------------------------------------------------------------------ */

const SnapRing: React.FC<{
  label: string;
  avatar: string;
  count: number;
  hasNew: boolean;
  isMine?: boolean;
  onClick: () => void;
}> = ({ label, avatar, count, hasNew, isMine, onClick }) => (
  <button
    onClick={onClick}
    aria-label={`${label} anları`}
    className="flex flex-col items-center gap-1.5 shrink-0 active:scale-95 transition-transform"
  >
    <div
      className={`relative w-16 h-16 rounded-full p-[3px] ${
        hasNew
          ? 'bg-gradient-to-tr from-amber-400 via-rose-500 to-berry-600 animate-[spinSlow_6s_linear_infinite]'
          : count > 0
            ? 'bg-rose-300'
            : 'bg-rose-100'
      }`}
    >
      <div className="w-full h-full rounded-full bg-white flex items-center justify-center text-2xl">
        {avatar}
      </div>
      {count > 0 && (
        <span className="absolute -bottom-0.5 -right-0.5 min-w-[18px] h-[18px] px-1 rounded-full bg-berry-600 text-white text-[9px] font-bold flex items-center justify-center border-2 border-white">
          {count}
        </span>
      )}
      {isMine && (
        <span className="absolute -top-1 -right-1 w-5 h-5 rounded-full bg-amber-400 text-white text-xs font-bold flex items-center justify-center border-2 border-white">
          +
        </span>
      )}
    </div>
    <span className="text-[10px] font-semibold text-berry-900">{label}</span>
  </button>
);

/* ------------------------------------------------------------------ */
/* Paylaşım ekranı                                                     */
/* ------------------------------------------------------------------ */

const SnapComposer: React.FC<{
  currentUserId: UserId;
  onClose: () => void;
  onCreated: (snap: SnapStory) => void;
}> = ({ currentUserId, onClose, onCreated }) => {
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [caption, setCaption] = useState('');
  const [mood, setMood] = useState('mutlu');
  const [filter, setFilter] = useState('none');
  const [isUploading, setIsUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const cameraInputRef = useRef<HTMLInputElement | null>(null);
  const galleryInputRef = useRef<HTMLInputElement | null>(null);
  const isVideo = Boolean(file && file.type.startsWith('video'));

  useEffect(() => {
    return () => {
      if (preview) URL.revokeObjectURL(preview);
    };
  }, [preview]);

  const handleSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    if (preview) URL.revokeObjectURL(preview);
    setFile(f);
    setPreview(URL.createObjectURL(f));
    playHaptic(20);
    e.target.value = '';
  };

  const handleShare = async () => {
    if (!file) {
      setError('Önce bir fotoğraf ya da video seç canım 📷');
      return;
    }
    setIsUploading(true);
    setError(null);
    playHaptic(HAPTIC_PATTERNS.attention);

    try {
      const upload = await api.uploadMedia(file, 'snaps');
      const created = await api.createSnap({
        sender: currentUserId,
        media_url: upload.url,
        media_type: isVideo ? 'video' : 'image',
        caption: caption.trim() || undefined,
        mood,
        filter_name: filter,
        duration: 5,
      });
      soundEngine.playLoveChime();
      onCreated(created);
    } catch (err) {
      console.error(err);
      setError('Anı paylaşamadık, tekrar dener misin?');
    } finally {
      setIsUploading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[60] bg-black/70 backdrop-blur-md flex items-center justify-center p-3 safe-area-all">
      <div className="w-full max-w-md max-h-[94vh] overflow-y-auto bg-white rounded-3xl shadow-2xl border border-rose-100">
        <div className="sticky top-0 z-10 flex items-center justify-between px-5 py-3.5 bg-gradient-to-r from-berry-500 to-rose-500 text-white">
          <div className="flex items-center gap-2">
            <Camera className="w-5 h-5" />
            <h3 className="font-serif text-base font-bold">Anını Paylaş</h3>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-full hover:bg-white/20">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-4 space-y-4">
          {/* Önizleme / seçim alanı */}
          <div className="relative aspect-[3/4] max-h-[42vh] rounded-2xl overflow-hidden bg-gradient-to-br from-rose-50 to-amber-50 border-2 border-dashed border-rose-200 flex items-center justify-center">
            {preview ? (
              isVideo ? (
                <video
                  src={preview}
                  className="w-full h-full object-cover"
                  style={{ filter: filterCss(filter) }}
                  autoPlay
                  muted
                  loop
                  playsInline
                />
              ) : (
                <img
                  src={preview}
                  alt="Önizleme"
                  className="w-full h-full object-cover"
                  style={{ filter: filterCss(filter) }}
                />
              )
            ) : (
              <div className="text-center px-6">
                <div className="text-4xl mb-2 animate-float">📷</div>
                <p className="font-serif text-sm font-semibold text-berry-900">
                  Şu anki anını yakala
                </p>
                <p className="text-[11px] text-stone-500 mt-1">
                  Kamera ile çek ya da galerinden seç
                </p>
              </div>
            )}

            <input
              ref={cameraInputRef}
              type="file"
              accept="image/*,video/*"
              capture="environment"
              onChange={handleSelect}
              className="hidden"
            />
            <input
              ref={galleryInputRef}
              type="file"
              accept="image/*,video/*"
              onChange={handleSelect}
              className="hidden"
            />

            {preview && (
              <button
                onClick={() => {
                  if (preview) URL.revokeObjectURL(preview);
                  setPreview(null);
                  setFile(null);
                }}
                className="absolute top-2 right-2 p-1.5 rounded-full bg-black/50 text-white"
              >
                <X className="w-4 h-4" />
              </button>
            )}
          </div>

          <div className="grid grid-cols-2 gap-2">
            <button
              onClick={() => cameraInputRef.current?.click()}
              className="flex items-center justify-center gap-2 py-2.5 rounded-2xl bg-gradient-to-r from-berry-500 to-rose-500 text-white text-xs font-bold shadow-xs active:scale-95"
            >
              <Camera className="w-4 h-4" />
              Fotoğraf Çek
            </button>
            <button
              onClick={() => galleryInputRef.current?.click()}
              className="flex items-center justify-center gap-2 py-2.5 rounded-2xl bg-rose-50 border border-rose-200 text-berry-800 text-xs font-bold active:scale-95"
            >
              <Play className="w-4 h-4" />
              Galeriden Seç
            </button>
          </div>

          {/* Filtreler */}
          {preview && !isVideo && (
            <div>
              <p className="text-[11px] font-semibold text-stone-600 mb-1.5">Filtre</p>
              <div className="flex gap-2 overflow-x-auto pb-1">
                {FILTERS.map((f) => (
                  <button
                    key={f.id}
                    onClick={() => {
                      setFilter(f.id);
                      playHaptic(15);
                    }}
                    className={`shrink-0 w-16 rounded-xl overflow-hidden border-2 transition-all ${
                      filter === f.id ? 'border-berry-500 scale-105' : 'border-transparent opacity-80'
                    }`}
                  >
                    <div className="h-12 bg-rose-200 overflow-hidden">
                      {preview && (
                        <img
                          src={preview}
                          alt={f.label}
                          className="w-full h-full object-cover"
                          style={{ filter: f.css }}
                        />
                      )}
                    </div>
                    <span className="block text-[9px] font-semibold text-stone-600 py-0.5">{f.label}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Duygu durumu */}
          <div>
            <p className="text-[11px] font-semibold text-stone-600 mb-1.5">Şu an nasılsın?</p>
            <div className="flex flex-wrap gap-1.5">
              {MOODS.map((m) => (
                <button
                  key={m.id}
                  onClick={() => {
                    setMood(m.id);
                    playHaptic(12);
                  }}
                  className={`flex items-center gap-1 px-2.5 py-1.5 rounded-full text-[11px] font-semibold transition-all ${
                    mood === m.id
                      ? 'bg-berry-500 text-white shadow-xs'
                      : 'bg-rose-50 border border-rose-200 text-stone-600'
                  }`}
                >
                  <span>{m.emoji}</span>
                  {m.label}
                </button>
              ))}
            </div>
          </div>

          <input
            type="text"
            value={caption}
            onChange={(e) => setCaption(e.target.value)}
            placeholder="Kısa bir not ekle… (isteğe bağlı)"
            maxLength={200}
            className="w-full px-3.5 py-2.5 rounded-xl border border-rose-200 text-sm focus:outline-none focus:ring-2 focus:ring-berry-400"
          />

          {error && <p className="text-xs text-rose-600 font-medium">{error}</p>}

          <button
            onClick={handleShare}
            disabled={isUploading}
            className="w-full flex items-center justify-center gap-2 py-3 rounded-2xl bg-gradient-to-r from-berry-600 to-rose-600 text-white font-serif text-sm font-bold shadow-lg active:scale-[0.98] disabled:opacity-60"
          >
            <Send className="w-4 h-4" />
            {isUploading ? 'Paylaşılıyor…' : 'Anımı Paylaş'}
          </button>
          <p className="text-center text-[10px] text-stone-400">
            24 saat sonra bu an kendiliğinden kaybolacak
          </p>
        </div>
      </div>
    </div>
  );
};

/* ------------------------------------------------------------------ */
/* Tam ekran görüntüleyici                                             */
/* ------------------------------------------------------------------ */

const SnapViewer: React.FC<{
  snaps: SnapStory[];
  currentUserId: UserId;
  onClose: () => void;
  onSeen: (id: number) => void;
}> = ({ snaps, currentUserId, onClose, onSeen }) => {
  const [index, setIndex] = useState(0);
  const [progress, setProgress] = useState(0);
  const [paused, setPaused] = useState(false);
  const [reacted, setReacted] = useState<Record<number, string>>({});
  const current = snaps[index];
  const isMine = current?.sender === currentUserId;
  const DURATION = 6000;

  // Görüldü işaretle
  useEffect(() => {
    if (!current || isMine) return;
    if (!current.is_seen) {
      api.markSnapSeen(current.id).then(() => onSeen(current.id)).catch(() => {});
    }
  }, [current?.id, isMine]);

  // İlerleme çubuğu
  useEffect(() => {
    setProgress(0);
    if (paused) return;
    const started = Date.now();
    const timer = window.setInterval(() => {
      const pct = Math.min(100, ((Date.now() - started) / DURATION) * 100);
      setProgress(pct);
      if (pct >= 100) {
        window.clearInterval(timer);
        if (index < snaps.length - 1) setIndex((i) => i + 1);
        else onClose();
      }
    }, 50);
    return () => window.clearInterval(timer);
  }, [index, paused]);

  const goNext = () => {
    if (index < snaps.length - 1) setIndex((i) => i + 1);
    else onClose();
  };
  const goPrev = () => setIndex((i) => Math.max(0, i - 1));

  const handleReact = async (emoji: string) => {
    if (!current) return;
    setReacted((prev) => ({ ...prev, [current.id]: emoji }));
    playHaptic(HAPTIC_PATTERNS.butterfly);
    try {
      await api.reactToSnap(current.id, currentUserId, emoji);
    } catch (e) {
      console.error(e);
    }
  };

  if (!current) return null;

  return (
    <div className="fixed inset-0 z-[70] bg-black flex flex-col safe-area-all">
      {/* İlerleme çubukları */}
      <div className="flex gap-1 px-2 pt-2">
        {snaps.map((s, i) => (
          <div key={s.id} className="flex-1 h-[3px] rounded-full bg-white/25 overflow-hidden">
            <div
              className="h-full bg-white rounded-full transition-none"
              style={{ width: i < index ? '100%' : i === index ? `${progress}%` : '0%' }}
            />
          </div>
        ))}
      </div>

      {/* Üst bar */}
      <div className="flex items-center justify-between px-3 py-2.5">
        <div className="flex items-center gap-2">
          <div className="w-9 h-9 rounded-full bg-white/15 flex items-center justify-center text-lg">
            {USERS[current.sender].emoji}
          </div>
          <div>
            <p className="text-white text-sm font-bold leading-tight">{nameOf(current.sender)}</p>
            <p className="text-white/60 text-[10px]">
              {timeAgo(current.created_at)} önce · {remainingHours(current.expires_at)} sa kaldı
            </p>
          </div>
        </div>
        <button onClick={onClose} className="p-2 rounded-full bg-white/10 text-white">
          <X className="w-5 h-5" />
        </button>
      </div>

      {/* Medya */}
      <div
        className="relative flex-1 min-h-0 flex items-center justify-center"
        onPointerDown={() => setPaused(true)}
        onPointerUp={() => setPaused(false)}
        onPointerLeave={() => setPaused(false)}
      >
        <button
          onClick={goPrev}
          disabled={index === 0}
          className="absolute left-1 z-10 p-2 rounded-full bg-white/10 text-white disabled:opacity-20"
        >
          <ChevronLeft className="w-6 h-6" />
        </button>

        {current.media_type === 'video' ? (
          <video
            key={current.id}
            src={mediaUrl(current.media_url)}
            autoPlay
            loop
            playsInline
            muted={false}
            className="max-h-full max-w-full object-contain"
            style={{ filter: filterCss(current.filter_name) }}
          />
        ) : (
          <img
            key={current.id}
            src={mediaUrl(current.media_url)}
            alt="An"
            className="max-h-full max-w-full object-contain animate-[snapIn_0.35s_ease-out]"
            style={{ filter: filterCss(current.filter_name) }}
          />
        )}

        <button
          onClick={goNext}
          className="absolute right-1 z-10 p-2 rounded-full bg-white/10 text-white"
        >
          <ChevronRight className="w-6 h-6" />
        </button>

        {paused && (
          <div className="absolute top-3 left-1/2 -translate-x-1/2 px-3 py-1 rounded-full bg-black/50 text-white text-[10px] flex items-center gap-1">
            <Pause className="w-3 h-3" /> Duraklatıldı
          </div>
        )}
      </div>

      {/* Alt bar: not + tepkiler */}
      <div className="px-4 pb-4 pt-2 space-y-2.5">
        {(current.caption || moodOf(current.mood)) && (
          <div className="text-center">
            {moodOf(current.mood) && (
              <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-white/15 text-white text-[11px] font-semibold mb-1.5">
                {moodOf(current.mood)!.emoji} {moodOf(current.mood)!.label}
              </span>
            )}
            {current.caption && <p className="text-white text-sm">{current.caption}</p>}
          </div>
        )}

        {isMine ? (
          <div className="flex items-center justify-center gap-2 text-white/70 text-xs">
            {current.is_seen ? (
              <>
                <Eye className="w-4 h-4" />
                {nameOf(partnerOf(currentUserId))} gördü ✓
              </>
            ) : (
              <>
                <Clock className="w-4 h-4" />
                Henüz görülmedi…
              </>
            )}
          </div>
        ) : (
          <div className="flex items-center justify-center gap-2">
            {['❤️', '😍', '😂', '🥺', '🔥', '💋'].map((emoji) => (
              <button
                key={emoji}
                onClick={() => handleReact(emoji)}
                className={`w-11 h-11 rounded-full flex items-center justify-center text-xl transition-all active:scale-90 ${
                  reacted[current.id] === emoji
                    ? 'bg-berry-500 scale-110 shadow-lg'
                    : 'bg-white/15 hover:bg-white/25'
                }`}
              >
                {emoji}
              </button>
            ))}
          </div>
        )}

        <div className="flex items-center justify-center gap-1 text-[10px] text-white/40">
          <Heart className="w-3 h-3" />
          {index + 1} / {snaps.length}
        </div>
      </div>
    </div>
  );
};

export default SnapAlbum;
