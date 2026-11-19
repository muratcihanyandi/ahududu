import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
  BookOpen, Plus, X, Lock, Unlock, Trash2, Feather, Calendar,
  Flame, Heart, ChevronLeft, ChevronRight, Send, Star, CloudSun, Pencil,
} from 'lucide-react';
import { DiaryEntry, DiaryStats, UserId, USERS, partnerOf, nameOf, emojiOf } from '../types';
import { api, mediaUrl } from '../services/api';
import { wsClient } from '../services/websocket';
import { playHaptic, soundEngine } from '../services/haptics';
import { registerBackHandler } from '../services/backButton';

interface DiaryBookProps {
  currentUserId: UserId;
}

const MOODS: { id: string; label: string; emoji: string; color: string }[] = [
  { id: 'mutlu', label: 'Mutlu', emoji: '😊', color: 'from-amber-300 to-rose-300' },
  { id: 'aşık', label: 'Aşık', emoji: '🥰', color: 'from-rose-300 to-pink-400' },
  { id: 'sakin', label: 'Sakin', emoji: '🌿', color: 'from-emerald-200 to-teal-300' },
  { id: 'heyecanlı', label: 'Heyecanlı', emoji: '🤩', color: 'from-fuchsia-300 to-purple-300' },
  { id: 'yorgun', label: 'Yorgun', emoji: '😴', color: 'from-slate-200 to-indigo-200' },
  { id: 'üzgün', label: 'Üzgün', emoji: '😢', color: 'from-sky-200 to-blue-300' },
  { id: 'kızgın', label: 'Kızgın', emoji: '😤', color: 'from-orange-300 to-red-300' },
];

const WEATHERS: { id: string; label: string; emoji: string }[] = [
  { id: 'none', label: 'Yok', emoji: '✖️' },
  { id: 'güneşli', label: 'Güneşli', emoji: '☀️' },
  { id: 'bulutlu', label: 'Bulutlu', emoji: '⛅' },
  { id: 'yağmurlu', label: 'Yağmurlu', emoji: '🌧️' },
  { id: 'karlı', label: 'Karlı', emoji: '❄️' },
  { id: 'fırtına', label: 'Fırtına', emoji: '⛈️' },
];

const moodOf = (id?: string) => MOODS.find((m) => m.id === id);
const weatherOf = (id?: string) => WEATHERS.find((w) => w.id === id);

const todayIso = () => {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

const formatDate = (iso: string): string => {
  try {
    return new Date(`${iso}T12:00:00`).toLocaleDateString('tr-TR', {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    });
  } catch {
    return iso;
  }
};

const dayName = (iso: string): string => {
  try {
    return new Date(`${iso}T12:00:00`).toLocaleDateString('tr-TR', { weekday: 'long' });
  } catch {
    return '';
  }
};

export const DiaryBook: React.FC<DiaryBookProps> = ({ currentUserId }) => {
  const partnerId = partnerOf(currentUserId);
  const [entries, setEntries] = useState<DiaryEntry[]>([]);
  const [stats, setStats] = useState<DiaryStats | null>(null);
  const [filter, setFilter] = useState<'all' | 'me' | 'partner'>('all');
  const [selected, setSelected] = useState<DiaryEntry | null>(null);
  const [composerOpen, setComposerOpen] = useState(false);
  const [editing, setEditing] = useState<DiaryEntry | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [toast, setToast] = useState<string | null>(null);
  const toastTimerRef = useRef<number | null>(null);

  const showToast = useCallback((text: string) => {
    if (toastTimerRef.current !== null) {
      window.clearTimeout(toastTimerRef.current);
    }
    setToast(text);
    toastTimerRef.current = window.setTimeout(() => {
      toastTimerRef.current = null;
      setToast(null);
    }, 2600);
  }, []);

  useEffect(() => {
    return () => {
      if (toastTimerRef.current !== null) {
        window.clearTimeout(toastTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    return registerBackHandler(() => {
      if (composerOpen) {
        setComposerOpen(false);
        setEditing(null);
        return true;
      }
      if (selected) {
        setSelected(null);
        return true;
      }
      return false;
    });
  }, [composerOpen, selected]);

  const load = useCallback(async () => {
    setIsLoading(true);
    try {
      const [list, s] = await Promise.all([
        api.listDiary(currentUserId),
        api.getDiaryStats(),
      ]);
      setEntries(Array.isArray(list) ? list : []);
      setStats(s);
    } catch (e) {
      console.error('Günlük yükleme hatası', e);
    } finally {
      setIsLoading(false);
    }
  }, [currentUserId]);

  useEffect(() => {
    load();

    const unsubNew = wsClient.on('new_diary_entry', (data: any) => {
      const rawEntry: DiaryEntry | undefined = data?.entry;
      if (rawEntry) {
        const isMasked = Boolean(rawEntry.is_locked && rawEntry.author !== currentUserId);
        const entry: DiaryEntry = isMasked
          ? { ...rawEntry, content: '', photo_url: undefined }
          : rawEntry;
        setEntries((prev) => [entry, ...prev.filter((e) => e.id !== entry.id)]);
        if (entry.author !== currentUserId) {
          soundEngine.playLoveChime();
          playHaptic(50);
          showToast(`${nameOf(partnerId)} günlüğe yeni bir sayfa ekledi 📖`);
        }
        api.getDiaryStats().then(setStats).catch(() => {});
      }
    });

    const unsubUpdate = wsClient.on('diary_entry_updated', () => load());
    const unsubDelete = wsClient.on('diary_entry_deleted', (data: any) => {
      setEntries((prev) => prev.filter((e) => e.id !== data?.entry_id));
      api.getDiaryStats().then(setStats).catch(() => {});
    });

    return () => {
      unsubNew();
      unsubUpdate();
      unsubDelete();
    };
  }, [currentUserId, partnerId, load, showToast]);

  const visible = useMemo(() => {
    return entries.filter((e) => {
      if (filter === 'me') return e.author === currentUserId;
      if (filter === 'partner') return e.author === partnerId;
      return true;
    });
  }, [entries, filter, currentUserId, partnerId]);

  const grouped = useMemo(() => {
    const map = new Map<string, DiaryEntry[]>();
    visible.forEach((e) => {
      const list = map.get(e.entry_date) || [];
      list.push(e);
      map.set(e.entry_date, list);
    });
    return Array.from(map.entries()).sort((a, b) => (a[0] < b[0] ? 1 : -1));
  }, [visible]);

  const handleDelete = async (entry: DiaryEntry, e?: React.MouseEvent) => {
    e?.stopPropagation();
    if (!window.confirm('Bu günlük sayfasını silmek istediğine emin misin?')) return;
    try {
      await api.deleteDiaryEntry(entry.id, currentUserId);
      setEntries((prev) => prev.filter((x) => x.id !== entry.id));
      if (selected?.id === entry.id) setSelected(null);
      playHaptic(35);
    } catch (err) {
      console.error(err);
      showToast('Sayfa silinemedi 🔒');
    }
  };

  return (
    <div className="flex flex-col space-y-4">
      {/* Defter kapağı */}
      <div className="relative overflow-hidden rounded-3xl p-4 bg-gradient-to-br from-amber-600 via-rose-600 to-berry-700 text-white shadow-lg shadow-berry-900/25">
        <div className="absolute -right-6 -top-8 text-[110px] opacity-15 leading-none">📖</div>
        <div className="absolute -left-8 -bottom-10 w-32 h-32 rounded-full bg-white/10 blur-2xl" />

        <div className="relative flex items-start justify-between">
          <div>
            <h2 className="font-serif text-lg font-bold leading-tight">Bizim Günlüğümüz 📖</h2>
            <p className="text-[11px] text-white/80 mt-0.5">
              Her gün bir sayfa, bir ömür bir defter
            </p>
          </div>
          <button
            onClick={() => {
              setEditing(null);
              setComposerOpen(true);
              playHaptic(25);
            }}
            className="flex items-center gap-1.5 px-3.5 py-2 rounded-2xl bg-white/95 text-berry-700 text-xs font-bold shadow-md active:scale-95 transition-all"
          >
            <Feather className="w-4 h-4" />
            Sayfa Yaz
          </button>
        </div>

        <div className="relative grid grid-cols-3 gap-2 mt-3">
          <div className="rounded-2xl bg-white/15 backdrop-blur-xs p-2.5 text-center">
            <div className="font-serif text-lg font-bold leading-none">{stats?.total ?? 0}</div>
            <div className="text-[9px] text-white/75 mt-1">sayfa</div>
          </div>
          <div className="rounded-2xl bg-white/15 backdrop-blur-xs p-2.5 text-center">
            <div className="font-serif text-lg font-bold leading-none flex items-center justify-center gap-1">
              {stats?.streak ?? 0}
              {(stats?.streak ?? 0) > 0 && <Flame className="w-3.5 h-3.5 text-amber-300" />}
            </div>
            <div className="text-[9px] text-white/75 mt-1">gün serisi</div>
          </div>
          <div className="rounded-2xl bg-white/15 backdrop-blur-xs p-2.5 text-center">
            <div className="font-serif text-lg font-bold leading-none">{stats?.total_days ?? 0}</div>
            <div className="text-[9px] text-white/75 mt-1">ayrı gün</div>
          </div>
        </div>
      </div>

      {/* Filtre */}
      <div className="flex items-center gap-1.5">
        {([
          { id: 'all', label: 'Hepsi' },
          { id: 'me', label: 'Benim' },
          { id: 'partner', label: nameOf(partnerId) },
        ] as const).map((f) => (
          <button
            key={f.id}
            onClick={() => {
              setFilter(f.id);
              playHaptic(15);
            }}
            className={`px-3.5 py-1.5 rounded-full text-xs font-semibold transition-all ${
              filter === f.id
                ? 'bg-berry-500 text-white shadow-xs'
                : 'bg-white/80 border border-rose-100 text-stone-600'
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {/* Günlük sayfaları */}
      {isLoading ? (
        <div className="p-10 text-center text-xs text-stone-500 animate-pulse">Defter açılıyor…</div>
      ) : grouped.length === 0 ? (
        <div className="flex flex-col items-center justify-center p-10 bg-white/70 rounded-3xl border border-rose-100 text-center">
          <BookOpen className="w-10 h-10 text-berry-300 mb-2 animate-float" />
          <p className="font-serif text-sm font-semibold text-berry-900">Defter henüz boş</p>
          <p className="text-xs text-stone-500 mt-1 max-w-[250px]">
            Bugünü yaz, ileride okuduğunuzda ne kadar güzel günler geçirdiğinizi hatırlayın 🌙
          </p>
        </div>
      ) : (
        <div className="space-y-5">
          {grouped.map(([date, dayEntries]) => (
            <div key={date}>
              <div className="flex items-center gap-2 mb-2">
                <Calendar className="w-3.5 h-3.5 text-berry-500" />
                <span className="text-[11px] font-bold text-berry-900">{formatDate(date)}</span>
                <span className="text-[10px] text-stone-400 capitalize">{dayName(date)}</span>
                <div className="flex-1 h-px bg-rose-100" />
              </div>

              <div className="space-y-2">
                {dayEntries.map((entry) => {
                  const isMine = entry.author === currentUserId;
                  const canEdit = isMine || entry.author === 'ortak';
                  const mood = moodOf(entry.mood);
                  return (
                    <div
                      key={entry.id}
                      onClick={() => {
                        if (entry.is_locked && !isMine) {
                          showToast('Bu sayfa kilitli 🔒');
                          return;
                        }
                        playHaptic(18);
                        setSelected(entry);
                      }}
                      className={`group relative diary-paper rounded-2xl border p-3.5 shadow-xs cursor-pointer transition-all hover:shadow-md active:scale-[0.99] ${
                        isMine ? 'border-rose-200' : 'border-amber-200/80'
                      }`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-1.5 mb-1">
                            <span className="text-sm">{entry.author === 'ortak' ? '💞' : emojiOf(entry.author)}</span>
                            <span className="text-[10px] font-bold text-berry-700">
                              {entry.author === 'ortak' ? 'Biz' : nameOf(entry.author)}
                            </span>
                            {mood && (
                              <span className={`text-[9px] px-1.5 py-0.5 rounded-full bg-gradient-to-r ${mood.color} text-stone-800 font-semibold`}>
                                {mood.emoji} {mood.label}
                              </span>
                            )}
                            {entry.weather && entry.weather !== 'none' && (
                              <span className="text-[10px]">{weatherOf(entry.weather)?.emoji}</span>
                            )}
                            {entry.is_locked && <Lock className="w-3 h-3 text-stone-400" />}
                          </div>

                          <h4 className="font-serif text-sm font-bold text-berry-950 truncate">
                            {entry.title}
                          </h4>
                          {entry.content && !entry.is_locked && (
                            <p className="text-[11px] text-stone-600 mt-0.5 line-clamp-2 leading-relaxed">
                              {entry.content}
                            </p>
                          )}
                          {entry.content && entry.is_locked && (
                            <p className="text-[11px] text-stone-400 mt-0.5 italic">
                              Bu sayfa sadece yazanına açık 🔒
                            </p>
                          )}
                        </div>

                        {entry.photo_url && !entry.is_locked && (
                          <img
                            src={mediaUrl(entry.photo_url)}
                            alt="Günlük fotoğrafı"
                            className="w-14 h-14 rounded-xl object-cover border border-white shadow-xs shrink-0"
                          />
                        )}
                      </div>

                      {entry.mood_score ? (
                        <div className="flex items-center gap-0.5 mt-1.5">
                          {Array.from({ length: 5 }).map((_, i) => (
                            <Star
                              key={i}
                              className={`w-2.5 h-2.5 ${
                                i < (entry.mood_score || 0)
                                  ? 'text-amber-400 fill-amber-400'
                                  : 'text-stone-200'
                              }`}
                            />
                          ))}
                        </div>
                      ) : null}

                      {canEdit && (
                        <div className="absolute top-2 right-2 flex gap-1 opacity-100 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity">
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              setEditing(entry);
                              setComposerOpen(true);
                            }}
                            className="p-1.5 rounded-lg bg-white/90 border border-rose-100 text-stone-500"
                            aria-label="Düzenle"
                          >
                            <Pencil className="w-3 h-3" />
                          </button>
                          <button
                            onClick={(e) => handleDelete(entry, e)}
                            className="p-1.5 rounded-lg bg-white/90 border border-rose-100 text-rose-500"
                            aria-label="Sil"
                          >
                            <Trash2 className="w-3 h-3" />
                          </button>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}

      {toast && (
        <div className="fixed left-1/2 -translate-x-1/2 top-20 z-[70] px-4 py-2 rounded-2xl bg-berry-900/90 text-white text-xs font-semibold shadow-xl">
          {toast}
        </div>
      )}

      {selected && (
        <DiaryPageView
          entry={selected}
          currentUserId={currentUserId}
          onClose={() => setSelected(null)}
          onEdit={() => {
            setEditing(selected);
            setSelected(null);
            setComposerOpen(true);
          }}
          onDelete={() => void handleDelete(selected)}
        />
      )}

      {composerOpen && (
        <DiaryComposer
          currentUserId={currentUserId}
          editing={editing}
          onClose={() => {
            setComposerOpen(false);
            setEditing(null);
          }}
          onSaved={(entry, isNew) => {
            setEntries((prev) =>
              isNew ? [entry, ...prev.filter((e) => e.id !== entry.id)] : prev.map((e) => (e.id === entry.id ? entry : e))
            );
            api.getDiaryStats().then(setStats).catch(() => {});
            setComposerOpen(false);
            setEditing(null);
            showToast(isNew ? 'Sayfan deftere eklendi 📖' : 'Sayfa güncellendi ✨');
          }}
        />
      )}
    </div>
  );
};

/* ------------------------------------------------------------------ */
/* Sayfa görüntüleme (kitap çevirme animasyonu)                        */
/* ------------------------------------------------------------------ */

const DiaryPageView: React.FC<{
  entry: DiaryEntry;
  currentUserId: UserId;
  onClose: () => void;
  onEdit: () => void;
  onDelete: () => void;
}> = ({ entry, currentUserId, onClose, onEdit, onDelete }) => {
  const mood = moodOf(entry.mood);
  const canEdit = entry.author === currentUserId || entry.author === 'ortak';

  return (
    <div className="fixed inset-0 z-[60] bg-stone-900/80 backdrop-blur-md flex items-center justify-center p-3 safe-area-all">
      <div
        className="relative w-full max-w-md max-h-[90vh] overflow-y-auto rounded-3xl shadow-2xl animate-[pageFlipIn_0.45s_ease-out] diary-paper border border-amber-200"
      >
        {/* Defter sırtı */}
        <div className="absolute left-0 top-0 bottom-0 w-1.5 bg-gradient-to-b from-amber-300 via-amber-400 to-amber-300 rounded-l-3xl" />

        <div className="sticky top-0 flex items-center justify-between px-5 py-3 bg-white/70 backdrop-blur-sm border-b border-amber-200/60">
          <div className="flex items-center gap-2">
            <BookOpen className="w-4 h-4 text-berry-600" />
            <span className="text-[11px] font-bold text-berry-900">{formatDate(entry.entry_date)}</span>
          </div>
          <div className="flex items-center gap-1">
            {canEdit && (
              <>
                <button onClick={onEdit} className="p-1.5 rounded-full hover:bg-amber-100 text-stone-500" aria-label="Düzenle">
                  <Pencil className="w-4 h-4" />
                </button>
                <button onClick={onDelete} className="p-1.5 rounded-full hover:bg-rose-50 text-rose-500" aria-label="Sil">
                  <Trash2 className="w-4 h-4" />
                </button>
              </>
            )}
            <button onClick={onClose} className="p-1.5 rounded-full hover:bg-amber-100 text-stone-500">
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        <div className="px-6 py-5 diary-margin">
          <div className="flex items-center gap-2 mb-3">
            <span className="text-xl">{entry.author === 'ortak' ? '💞' : emojiOf(entry.author)}</span>
            <div>
              <p className="text-xs font-bold text-berry-800">
                {entry.author === 'ortak' ? 'Biz' : nameOf(entry.author)}
              </p>
              <p className="text-[10px] text-stone-400 capitalize">{dayName(entry.entry_date)}</p>
            </div>
            {mood && (
              <span className={`ml-auto text-[10px] px-2 py-1 rounded-full bg-gradient-to-r ${mood.color} text-stone-800 font-semibold`}>
                {mood.emoji} {mood.label}
              </span>
            )}
          </div>

          <h2 className="font-handwriting text-3xl text-berry-900 leading-tight mb-3">
            {entry.title}
          </h2>

          {entry.content && (
            <p className="font-handwriting text-xl leading-relaxed text-stone-700 whitespace-pre-wrap">
              {entry.content}
            </p>
          )}

          {entry.photo_url && (
            <img
              src={mediaUrl(entry.photo_url)}
              alt="Günlük anısı"
              className="mt-4 w-full rounded-2xl border-4 border-white shadow-md object-cover rotate-[-1deg]"
            />
          )}

          <div className="flex items-center justify-between mt-5 pt-3 border-t border-amber-200/70">
            <div className="flex items-center gap-0.5">
              {Array.from({ length: 5 }).map((_, i) => (
                <Star
                  key={i}
                  className={`w-3.5 h-3.5 ${
                    i < (entry.mood_score || 0) ? 'text-amber-400 fill-amber-400' : 'text-stone-200'
                  }`}
                />
              ))}
            </div>
            <div className="flex items-center gap-2 text-[10px] text-stone-400">
              {entry.weather && entry.weather !== 'none' && (
                <span className="flex items-center gap-0.5">
                  <CloudSun className="w-3 h-3" />
                  {weatherOf(entry.weather)?.label}
                </span>
              )}
              {entry.is_locked ? <Lock className="w-3 h-3" /> : <Unlock className="w-3 h-3" />}
            </div>
          </div>

          <p className="text-center font-handwriting text-lg text-rose-400 mt-5">
            ~ bizim defterimizden ~
          </p>
        </div>
      </div>
    </div>
  );
};

/* ------------------------------------------------------------------ */
/* Yeni sayfa / düzenleme                                              */
/* ------------------------------------------------------------------ */

const DiaryComposer: React.FC<{
  currentUserId: UserId;
  editing: DiaryEntry | null;
  onClose: () => void;
  onSaved: (entry: DiaryEntry, isNew: boolean) => void;
}> = ({ currentUserId, editing, onClose, onSaved }) => {
  const isNew = !editing;
  const [title, setTitle] = useState(editing?.title ?? '');
  const [content, setContent] = useState(editing?.content ?? '');
  const [mood, setMood] = useState<string>(editing?.mood ?? 'mutlu');
  const [moodScore, setMoodScore] = useState(editing?.mood_score ?? 5);
  const [weather, setWeather] = useState(editing?.weather ?? 'none');
  const [entryDate, setEntryDate] = useState(editing?.entry_date ?? todayIso());
  const [isLocked, setIsLocked] = useState(editing?.is_locked ?? false);
  const [author, setAuthor] = useState<'me' | 'ortak'>(
    editing?.author === 'ortak' ? 'ortak' : 'me'
  );
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [photoPreview, setPhotoPreview] = useState<string | null>(() =>
    editing?.photo_url ? mediaUrl(editing.photo_url) : null
  );
  const [photoRemoved, setPhotoRemoved] = useState(false);
  const blobUrlRef = useRef<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    return () => {
      if (blobUrlRef.current) {
        URL.revokeObjectURL(blobUrlRef.current);
        blobUrlRef.current = null;
      }
    };
  }, []);

  const handlePhoto = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    if (blobUrlRef.current) URL.revokeObjectURL(blobUrlRef.current);
    const nextBlob = URL.createObjectURL(f);
    blobUrlRef.current = nextBlob;
    setPhotoFile(f);
    setPhotoPreview(nextBlob);
    setPhotoRemoved(false);
    e.target.value = '';
  };

  const shiftDate = (days: number) => {
    const d = new Date(`${entryDate}T12:00:00`);
    d.setDate(d.getDate() + days);
    const pad = (n: number) => String(n).padStart(2, '0');
    setEntryDate(`${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`);
    playHaptic(12);
  };

  const isOrtakEntry = author === 'ortak' || editing?.author === 'ortak';

  const handleSave = async () => {
    if (!title.trim()) {
      setError('Sayfana bir başlık ver 🌸');
      return;
    }
    setIsSaving(true);
    setError(null);
    playHaptic(30);

    try {
      let photoUrl: string | undefined = editing?.photo_url || undefined;
      if (photoRemoved && !photoFile) {
        photoUrl = '';
      }
      if (photoFile) {
        const upload = await api.uploadMedia(photoFile, 'diary');
        photoUrl = upload.url;
      }

      const payload = {
        title: title.trim(),
        content: content.trim(),
        mood,
        mood_score: moodScore,
        weather,
        entry_date: entryDate,
        photo_url: photoUrl,
        is_locked: isOrtakEntry ? false : isLocked,
      };

      const saved = editing
        ? await api.updateDiaryEntry(editing.id, payload as Partial<DiaryEntry>, currentUserId)
        : await api.createDiaryEntry({
            author: author === 'ortak' ? 'ortak' : currentUserId,
            ...payload,
          });

      soundEngine.playLoveChime();
      onSaved(saved, isNew);
    } catch (err) {
      console.error(err);
      setError('Sayfa kaydedilemedi, tekrar dener misin?');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[60] bg-black/65 backdrop-blur-md flex items-end sm:items-center justify-center safe-area-all">
      <div className="w-full sm:max-w-md max-h-[94vh] overflow-y-auto bg-[#fffdf7] rounded-t-3xl sm:rounded-3xl shadow-2xl border border-amber-200 animate-[pageFlipIn_0.35s_ease-out]">
        <div className="sticky top-0 z-10 flex items-center justify-between px-5 py-3.5 bg-gradient-to-r from-amber-500 to-rose-500 text-white">
          <div className="flex items-center gap-2">
            <Feather className="w-5 h-5" />
            <h3 className="font-serif text-base font-bold">
              {isNew ? 'Yeni Sayfa' : 'Sayfayı Düzenle'}
            </h3>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-full hover:bg-white/20">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-4 space-y-3.5">
          {/* Tarih */}
          <div className="flex items-center justify-between bg-white rounded-2xl border border-amber-200 px-3 py-2">
            <button onClick={() => shiftDate(-1)} className="p-1 rounded-lg hover:bg-amber-50 text-stone-500">
              <ChevronLeft className="w-4 h-4" />
            </button>
            <div className="text-center">
              <p className="text-xs font-bold text-berry-900">{formatDate(entryDate)}</p>
              <p className="text-[10px] text-stone-400 capitalize">{dayName(entryDate)}</p>
            </div>
            <button onClick={() => shiftDate(1)} className="p-1 rounded-lg hover:bg-amber-50 text-stone-500">
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>

          {/* Yazar seçimi (yeni sayfada) */}
          {isNew && (
            <div className="flex gap-2">
              <button
                onClick={() => setAuthor('me')}
                className={`flex-1 flex items-center justify-center gap-1.5 py-2 rounded-xl text-xs font-bold transition-all ${
                  author === 'me'
                    ? 'bg-berry-500 text-white shadow-xs'
                    : 'bg-white border border-amber-200 text-stone-600'
                }`}
              >
                {USERS[currentUserId].emoji} Ben yazdım
              </button>
              <button
                onClick={() => {
                  setAuthor('ortak');
                  setIsLocked(false);
                }}
                className={`flex-1 flex items-center justify-center gap-1.5 py-2 rounded-xl text-xs font-bold transition-all ${
                  author === 'ortak'
                    ? 'bg-berry-500 text-white shadow-xs'
                    : 'bg-white border border-amber-200 text-stone-600'
                }`}
              >
                💞 Birlikte yazdık
              </button>
            </div>
          )}

          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Bu güne bir başlık…"
            className="w-full bg-transparent font-handwriting text-2xl text-berry-900 border-b border-amber-200 pb-2 focus:outline-none placeholder:opacity-40"
          />

          <textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            rows={7}
            placeholder="Bugün neler oldu? Kalbinden geçenleri yaz…"
            className="w-full bg-transparent font-handwriting text-xl leading-relaxed text-stone-700 resize-none focus:outline-none placeholder:opacity-40"
          />

          {/* Ruh hali */}
          <div>
            <p className="text-[11px] font-semibold text-stone-600 mb-1.5">Ruh halin</p>
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
                      : 'bg-white border border-amber-200 text-stone-600'
                  }`}
                >
                  {m.emoji} {m.label}
                </button>
              ))}
            </div>
          </div>

          {/* Puan */}
          <div className="flex items-center gap-1.5">
            <p className="text-[11px] font-semibold text-stone-600 mr-1">Günün puanı</p>
            {Array.from({ length: 5 }).map((_, i) => (
              <button key={i} onClick={() => setMoodScore(i + 1)} className="p-0.5">
                <Star
                  className={`w-5 h-5 transition-transform active:scale-90 ${
                    i < moodScore ? 'text-amber-400 fill-amber-400' : 'text-stone-200'
                  }`}
                />
              </button>
            ))}
          </div>

          {/* Hava */}
          <div>
            <p className="text-[11px] font-semibold text-stone-600 mb-1.5">Hava nasıldı?</p>
            <div className="flex flex-wrap gap-1.5">
              {WEATHERS.map((w) => (
                <button
                  key={w.id}
                  onClick={() => setWeather(w.id)}
                  className={`px-2.5 py-1.5 rounded-full text-[11px] font-semibold transition-all ${
                    weather === w.id
                      ? 'bg-berry-500 text-white shadow-xs'
                      : 'bg-white border border-amber-200 text-stone-600'
                  }`}
                >
                  {w.emoji} {w.label}
                </button>
              ))}
            </div>
          </div>

          {/* Fotoğraf */}
          <div className="flex items-center gap-2">
            <label className="flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-xl bg-white border border-amber-200 text-xs font-bold text-berry-800 cursor-pointer active:scale-95 transition-transform">
              📷 Fotoğraf ekle
              <input type="file" accept="image/*" onChange={handlePhoto} className="hidden" />
            </label>
            {photoPreview && (
              <div className="relative">
                <img src={mediaUrl(photoPreview)} alt="Önizleme" className="w-12 h-12 rounded-xl object-cover border border-white shadow-xs" />
                <button
                  onClick={() => {
                    if (blobUrlRef.current) {
                      URL.revokeObjectURL(blobUrlRef.current);
                      blobUrlRef.current = null;
                    }
                    setPhotoFile(null);
                    setPhotoPreview(null);
                    setPhotoRemoved(true);
                  }}
                  className="absolute -top-1.5 -right-1.5 p-0.5 rounded-full bg-rose-500 text-white"
                >
                  <X className="w-3 h-3" />
                </button>
              </div>
            )}
          </div>

          {/* Kilit */}
          {isOrtakEntry ? (
            <div className="w-full flex items-center gap-2 px-3.5 py-2.5 rounded-xl border border-amber-200 bg-amber-50/50 text-xs font-semibold text-stone-600">
              <Unlock className="w-4 h-4 text-berry-500" />
              <span>Ortak sayfa — her zaman ikinize açık</span>
            </div>
          ) : (
            <button
              onClick={() => setIsLocked((v) => !v)}
              className={`w-full flex items-center justify-between px-3.5 py-2.5 rounded-xl border text-xs font-semibold transition-all ${
                isLocked
                  ? 'bg-stone-800 text-white border-stone-800'
                  : 'bg-white text-stone-600 border-amber-200'
              }`}
            >
              <span className="flex items-center gap-2">
                {isLocked ? <Lock className="w-4 h-4" /> : <Unlock className="w-4 h-4" />}
                {isLocked ? 'Kilitli — sadece yazan görebilir' : 'Ortak defterde herkese açık'}
              </span>
              <span className="text-[10px] opacity-70">değiştir</span>
            </button>
          )}

          {error && <p className="text-xs text-rose-600 font-medium">{error}</p>}

          <button
            onClick={handleSave}
            disabled={isSaving}
            className="w-full flex items-center justify-center gap-2 py-3 rounded-2xl bg-gradient-to-r from-amber-500 to-rose-500 text-white font-serif text-sm font-bold shadow-lg active:scale-[0.98] disabled:opacity-60"
          >
            <Send className="w-4 h-4" />
            {isSaving ? 'Kaydediliyor…' : isNew ? 'Deftere Yaz' : 'Değişiklikleri Kaydet'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default DiaryBook;
