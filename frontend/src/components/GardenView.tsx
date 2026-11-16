import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  Flower2, Lock, Unlock, Music, CalendarHeart, Sun, CloudRain, Moon, Cloud,
  Plus, X, Trash2, Sparkles, Send, Loader2, Heart, Clock, Play, AlertCircle,
} from 'lucide-react';
import { UserId, USERS, partnerOf, nameOf } from '../types';
import { api, mediaUrl } from '../services/api';
import { wsClient } from '../services/websocket';
import { playHaptic, soundEngine } from '../services/haptics';

interface GardenViewProps {
  currentUserId: UserId;
}

/** "demo" etiketi — My Bibi'den ilham alınan yeni ritüeller */
const DemoBadge: React.FC<{ title?: string }> = ({ title }) => (
  <span
    title={title || 'Bu özellik demo sürümündedir, geliştirmeye açık.'}
    className="shrink-0 text-[8px] font-bold px-1.5 py-0.5 rounded-full bg-gradient-to-r from-violet-500 to-fuchsia-500 text-white shadow-xs"
  >
    DEMO
  </span>
);

type MoodKey = 'sunny' | 'cloudy' | 'rainy' | 'storm' | 'night';

const MOOD_OPTIONS: { id: MoodKey; emoji: string; label: string; color: string }[] = [
  { id: 'sunny', emoji: '☀️', label: 'Güneşli', color: 'from-amber-300 to-yellow-400' },
  { id: 'cloudy', emoji: '⛅', label: 'Bulutlu', color: 'from-sky-200 to-slate-300' },
  { id: 'rainy', emoji: '🌧️', label: 'Yağmurlu', color: 'from-blue-300 to-indigo-400' },
  { id: 'storm', emoji: '⛈️', label: 'Fırtına', color: 'from-indigo-400 to-purple-500' },
  { id: 'night', emoji: '🌙', label: 'Gece', color: 'from-slate-600 to-indigo-800' },
];

export const GardenView: React.FC<GardenViewProps> = ({ currentUserId }) => {
  const partnerId = partnerOf(currentUserId);

  const [question, setQuestion] = useState<any>(null);
  const [answer, setAnswer] = useState('');
  const [isAnswering, setIsAnswering] = useState(false);
  const [capsules, setCapsules] = useState<any[]>([]);
  const [songs, setSongs] = useState<any[]>([]);
  const [onThisDay, setOnThisDay] = useState<any>(null);
  const [mood, setMood] = useState<any>(null);
  const [summary, setSummary] = useState<any>(null);
  const [openCapsule, setOpenCapsule] = useState<any | null>(null);
  const [capsuleComposer, setCapsuleComposer] = useState(false);
  const [songComposer, setSongComposer] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  const showToast = useCallback((text: string) => {
    setToast(text);
    window.setTimeout(() => setToast(null), 2800);
  }, []);

  const loadAll = useCallback(async () => {
    try {
      const [q, c, s, o, m, sum] = await Promise.all([
        api.getDailyQuestion(currentUserId),
        api.listCapsules(currentUserId),
        api.listSongs(),
        api.getOnThisDay(),
        api.getMood(currentUserId),
        api.getGardenSummary(currentUserId),
      ]);
      setQuestion(q);
      setCapsules(Array.isArray(c) ? c : []);
      setSongs(Array.isArray(s) ? s : []);
      setOnThisDay(o);
      setMood(m);
      setSummary(sum);
    } catch (e) {
      console.error('Bahçe yüklenemedi', e);
    }
  }, [currentUserId]);

  useEffect(() => {
    loadAll();
    const unsubQ = wsClient.on('garden_question_answered', (d: any) => {
      if (d?.by === partnerId) {
        playHaptic(60);
        soundEngine.playLoveChime();
        if (d.revealed) {
          showToast(`${nameOf(partnerId)} cevap verdi — ikinizin cevabı açıldı! 🌸`);
        } else {
          showToast(`${nameOf(partnerId)} bugünün sorusunu cevapladı 💌`);
        }
        loadAll();
      }
    });
    const unsubCapsule = wsClient.on('garden_capsule_sealed', (d: any) => {
      playHaptic(40);
      showToast(`${nameOf(partnerId)} bir zaman kapsülü mühürledi 🔒`);
      loadAll();
    });
    const unsubSong = wsClient.on('garden_song_added', (d: any) => {
      soundEngine.playLoveChime();
      showToast(`${nameOf(partnerId)} "${d.title}" şarkısını ekledi 🎵`);
      loadAll();
    });
    const unsubMood = wsClient.on('garden_mood_updated', (d: any) => {
      showToast(`${nameOf(partnerId)} bugünkü havası ${d.emoji}`);
      loadAll();
    });
    return () => {
      unsubQ();
      unsubCapsule();
      unsubSong();
      unsubMood();
    };
  }, [partnerId, loadAll, showToast]);

  const handleAnswer = async () => {
    if (!answer.trim()) return;
    setIsAnswering(true);
    playHaptic(30);
    try {
      const res = await api.answerDailyQuestion(currentUserId, answer.trim());
      setAnswer('');
      await loadAll();
      soundEngine.playLoveChime();
      showToast(res.revealed ? 'İkinizin cevabı da hazır! 🌸' : 'Cevabın kaydedildi 💌');
    } catch (e) {
      showToast('Cevap kaydedilemedi');
    } finally {
      setIsAnswering(false);
    }
  };

  const handleMood = async (m: MoodKey) => {
    playHaptic(20);
    try {
      await api.setMood(currentUserId, m);
      await loadAll();
    } catch (e) {
      showToast('Hava kaydedilemedi');
    }
  };

  const partnerMoodEmoji = useMemo(() => {
    const key = mood?.partner_today as MoodKey | undefined;
    return key ? MOOD_OPTIONS.find((m) => m.id === key)?.emoji : null;
  }, [mood]);

  const readyCapsules = capsules.filter((c) => c.can_open);
  const waitingCapsules = capsules.filter((c) => !c.can_open);

  return (
    <div className="flex flex-col space-y-4">
      {/* ---- Bahçe başlığı ---- */}
      <div className="relative overflow-hidden rounded-3xl p-4 bg-gradient-to-br from-emerald-600 via-teal-500 to-cyan-600 text-white shadow-lg shadow-teal-900/25">
        <div className="absolute -right-4 -bottom-8 text-[110px] opacity-15 leading-none">🌸</div>
        <div className="absolute -left-8 -top-10 w-32 h-32 rounded-full bg-white/15 blur-2xl" />

        <div className="relative flex items-start justify-between">
          <div>
            <div className="flex items-center gap-2">
              <Flower2 className="w-5 h-5 text-emerald-200" />
              <h2 className="font-serif text-lg font-bold">Anı Bahçemiz</h2>
              <DemoBadge title="My Bibi ilhamıyla eklenen yeni ritüeller — demo sürüm" />
            </div>
            <p className="text-[11px] text-white/80 mt-0.5">
              Her gün bir soru, bir hatıra, bir şarkı… yavaş yavaş büyüyen bahçe
            </p>
          </div>
        </div>

        {/* Hızlı özet */}
        <div className="relative grid grid-cols-3 gap-2 mt-3">
          <div className="rounded-2xl bg-white/15 backdrop-blur-xs p-2 text-center">
            <p className="font-serif text-base font-bold leading-none">{summary?.ready_capsules ?? 0}</p>
            <p className="text-[9px] text-white/75 mt-1">açılmayı bekleyen kapsül</p>
          </div>
          <div className="rounded-2xl bg-white/15 backdrop-blur-xs p-2 text-center">
            <p className="font-serif text-base font-bold leading-none">{summary?.song_count ?? 0}</p>
            <p className="text-[9px] text-white/75 mt-1">şarkımız</p>
          </div>
          <div className="rounded-2xl bg-white/15 backdrop-blur-xs p-2 text-center">
            <p className="font-serif text-base font-bold leading-none">{summary?.on_this_day_count ?? 0}</p>
            <p className="text-[9px] text-white/75 mt-1">yıl önce bugün</p>
          </div>
        </div>
      </div>

      {/* ---- Günlük Soru ---- */}
      <div className="rounded-3xl bg-white/90 backdrop-blur-md border border-rose-100 shadow-sm p-4">
        <div className="flex items-center justify-between mb-2">
          <h3 className="font-serif text-sm font-bold text-berry-950 flex items-center gap-1.5">
            <Sparkles className="w-4 h-4 text-amber-500" />
            Günün Sorusu
          </h3>
          <DemoBadge />
        </div>

        {question ? (
          <>
            <p className="font-serif text-[15px] font-semibold text-berry-900 leading-snug">
              {question.prompt}
            </p>

            {/* Cevap durumu */}
            <div className="flex items-center gap-2 mt-2.5">
              <span
                className={`text-[9px] font-bold px-2 py-0.5 rounded-full ${
                  question.answered_mine ? 'bg-emerald-100 text-emerald-700' : 'bg-stone-100 text-stone-500'
                }`}
              >
                Sen {question.answered_mine ? '✓' : '…'}
              </span>
              <span
                className={`text-[9px] font-bold px-2 py-0.5 rounded-full ${
                  question.answered_partner ? 'bg-emerald-100 text-emerald-700' : 'bg-stone-100 text-stone-500'
                }`}
              >
                {nameOf(partnerId)} {question.answered_partner ? '✓' : '…'}
              </span>
            </div>

            {question.both_answered ? (
              <div className="mt-3 space-y-2">
                <AnswerBubble
                  who={nameOf(currentUserId)}
                  emoji={USERS[currentUserId].emoji}
                  text={question.my_answer}
                  mine
                />
                <AnswerBubble
                  who={nameOf(partnerId)}
                  emoji={USERS[partnerId].emoji}
                  text={question.partner_answer}
                />
              </div>
            ) : question.answered_mine ? (
              <div className="mt-3 rounded-2xl bg-rose-50/70 border border-rose-100 p-3 flex items-start gap-2">
                <Lock className="w-4 h-4 text-berry-400 shrink-0 mt-0.5" />
                <div>
                  <p className="text-[11px] font-semibold text-berry-800">Cevabın kaydedildi</p>
                  <p className="text-[10px] text-stone-500 mt-0.5">
                    {nameOf(partnerId)} de cevaplayınca ikinizin cevabı aynı anda açılacak 🌸
                  </p>
                </div>
              </div>
            ) : (
              <div className="mt-3 flex items-end gap-2">
                <textarea
                  value={answer}
                  onChange={(e) => setAnswer(e.target.value)}
                  rows={2}
                  placeholder="Aklından geçen ilk şeyi yaz…"
                  className="flex-1 px-3 py-2 rounded-xl border border-rose-200 text-xs resize-none focus:outline-none focus:ring-2 focus:ring-rose-400"
                />
                <button
                  onClick={handleAnswer}
                  disabled={!answer.trim() || isAnswering}
                  className="p-2.5 rounded-xl bg-gradient-to-r from-berry-500 to-rose-500 text-white disabled:opacity-40 active:scale-95"
                >
                  {isAnswering ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                </button>
              </div>
            )}
          </>
        ) : (
          <p className="text-xs text-stone-500 animate-pulse">Soru hazırlanıyor…</p>
        )}
      </div>

      {/* ---- Duygu Havası ---- */}
      <div className="rounded-3xl bg-white/90 backdrop-blur-md border border-rose-100 shadow-sm p-4">
        <div className="flex items-center justify-between mb-2">
          <h3 className="font-serif text-sm font-bold text-berry-950 flex items-center gap-1.5">
            <Sun className="w-4 h-4 text-amber-500" />
            Bugünkü Havam
          </h3>
          <DemoBadge />
        </div>
        <p className="text-[10px] text-stone-500 mb-2">
          Bugün içindeki hava nasıl? {partnerMoodEmoji ? `${nameOf(partnerId)}: ${partnerMoodEmoji}` : ''}
        </p>
        <div className="flex items-center gap-1.5">
          {MOOD_OPTIONS.map((m) => (
            <button
              key={m.id}
              onClick={() => handleMood(m.id)}
              className={`flex-1 flex flex-col items-center gap-0.5 py-2 rounded-xl text-[9px] font-semibold transition-all active:scale-95 ${
                mood?.today === m.id
                  ? 'bg-gradient-to-br ' + m.color + ' text-white shadow-md scale-105'
                  : 'bg-rose-50 text-stone-600 border border-rose-100'
              }`}
            >
              <span className="text-base">{m.emoji}</span>
              {m.label}
            </button>
          ))}
        </div>

        {/* Isı haritası */}
        {mood?.history?.length > 0 && (
          <div className="flex flex-wrap gap-1 mt-3">
            {mood.history.slice(-21).map((h: any) => (
              <span
                key={h.date}
                title={h.date}
                className="w-4 h-4 rounded-[3px] bg-rose-100 flex items-center justify-center text-[8px]"
              >
                {h.emoji}
              </span>
            ))}
          </div>
        )}
      </div>

      {/* ---- Zaman Kapsülleri ---- */}
      <div className="rounded-3xl bg-white/90 backdrop-blur-md border border-amber-200/70 shadow-sm p-4">
        <div className="flex items-center justify-between mb-2">
          <h3 className="font-serif text-sm font-bold text-berry-950 flex items-center gap-1.5">
            <CalendarHeart className="w-4 h-4 text-rose-500" />
            Zaman Kapsülleri
          </h3>
          <div className="flex items-center gap-1.5">
            <DemoBadge />
            <button
              onClick={() => {
                setCapsuleComposer(true);
                playHaptic(20);
              }}
              className="p-1.5 rounded-full bg-berry-500 text-white active:scale-90"
              aria-label="Kapsül ekle"
            >
              <Plus className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        {capsules.length === 0 ? (
          <p className="text-[11px] text-stone-500 py-2">
            Bir mesaj yaz, ileri bir tarihte açılsın. Ne sen ne de o, o gün gelmeden okuyamaz 🔒
          </p>
        ) : (
          <div className="space-y-2">
            {readyCapsules.map((c) => (
              <button
                key={c.id}
                onClick={() => {
                  setOpenCapsule(c);
                  playHaptic(30);
                }}
                className="w-full flex items-center gap-2.5 p-2.5 rounded-2xl bg-gradient-to-r from-amber-50 to-rose-50 border border-amber-300 text-left active:scale-[0.99]"
              >
                <Unlock className="w-4 h-4 text-amber-600 shrink-0" />
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-bold text-berry-950 truncate">{c.title}</p>
                  <p className="text-[10px] text-amber-700">Açıldı! Dokun ve oku 💌</p>
                </div>
              </button>
            ))}
            {waitingCapsules.map((c) => (
              <div
                key={c.id}
                className="flex items-center gap-2.5 p-2.5 rounded-2xl bg-stone-50 border border-stone-200"
              >
                <Lock className="w-4 h-4 text-stone-400 shrink-0" />
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-bold text-stone-700 truncate">{c.title}</p>
                  <p className="text-[10px] text-stone-500">
                    {new Date(c.open_date).toLocaleDateString('tr-TR')} tarihinde açılacak
                  </p>
                </div>
                {c.is_mine && (
                  <button
                    onClick={async () => {
                      if (!window.confirm('Kapsülü silmek istiyor musun?')) return;
                      await api.deleteCapsule(c.id, currentUserId);
                      loadAll();
                    }}
                    className="p-1.5 text-stone-400 hover:text-rose-500"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ---- Bizim Şarkılarımız ---- */}
      <div className="rounded-3xl bg-white/90 backdrop-blur-md border border-fuchsia-200/70 shadow-sm p-4">
        <div className="flex items-center justify-between mb-2">
          <h3 className="font-serif text-sm font-bold text-berry-950 flex items-center gap-1.5">
            <Music className="w-4 h-4 text-fuchsia-500" />
            Bizim Şarkılarımız
          </h3>
          <div className="flex items-center gap-1.5">
            <DemoBadge />
            <button
              onClick={() => {
                setSongComposer(true);
                playHaptic(20);
              }}
              className="p-1.5 rounded-full bg-fuchsia-500 text-white active:scale-90"
              aria-label="Şarkı ekle"
            >
              <Plus className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        {songs.length === 0 ? (
          <p className="text-[11px] text-stone-500 py-2">
            İkinizin hikâyesinden bir şarkı ekleyin — o şarkıyı neden seçtiğinizi de yazın 🎵
          </p>
        ) : (
          <div className="space-y-2">
            {songs.map((s) => (
              <div
                key={s.id}
                className="flex items-center gap-2.5 p-2.5 rounded-2xl bg-fuchsia-50/60 border border-fuchsia-100"
              >
                <span className="w-8 h-8 rounded-lg bg-gradient-to-br from-fuchsia-400 to-purple-500 flex items-center justify-center shrink-0">
                  <Music className="w-4 h-4 text-white" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-bold text-berry-950 truncate">{s.title}</p>
                  <p className="text-[10px] text-stone-500 truncate">
                    {s.artist ? `${s.artist} · ` : ''}
                    {USERS[s.added_by as UserId]?.emoji} {nameOf(s.added_by)}
                  </p>
                  {s.note && <p className="text-[10px] text-fuchsia-700 italic truncate">“{s.note}”</p>}
                </div>
                <a
                  href={s.url}
                  target="_blank"
                  rel="noreferrer"
                  className="p-1.5 rounded-full bg-white text-fuchsia-600 shadow-xs shrink-0"
                  aria-label="Şarkıyı aç"
                >
                  <Play className="w-3.5 h-3.5" />
                </a>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ---- Bugün Yıllar Önce ---- */}
      <div className="rounded-3xl bg-white/90 backdrop-blur-md border border-sky-200/70 shadow-sm p-4">
        <div className="flex items-center justify-between mb-2">
          <h3 className="font-serif text-sm font-bold text-berry-950 flex items-center gap-1.5">
            <Clock className="w-4 h-4 text-sky-500" />
            Yıllar Önce Bugün
          </h3>
          <DemoBadge />
        </div>

        {!onThisDay || onThisDay.count === 0 ? (
          <p className="text-[11px] text-stone-500 py-2">
            Bugünün geçmişte bir anısı yok. Günlüklere bugünü yazarsan gelecek yıl burada hatırlanacak 🌙
          </p>
        ) : (
          <div className="space-y-2">
            {onThisDay.items.map((item: any, i: number) => (
              <div
                key={`${item.type}-${i}`}
                className="flex items-start gap-2.5 p-2.5 rounded-2xl bg-sky-50/60 border border-sky-100"
              >
                <span className="text-base shrink-0">
                  {item.type === 'diary' ? '📖' : item.type === 'letter' ? '💌' : '📸'}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-[10px] font-bold text-sky-700">{item.year} yılında</p>
                  <p className="text-xs font-bold text-berry-950 truncate">{item.title}</p>
                  {item.content && (
                    <p className="text-[10px] text-stone-500 line-clamp-2">{item.content}</p>
                  )}
                </div>
                {item.url && (
                  <img
                    src={mediaUrl(item.url)}
                    alt=""
                    className="w-10 h-10 rounded-lg object-cover shrink-0"
                  />
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {toast && (
        <div className="fixed left-1/2 -translate-x-1/2 top-20 z-[70] max-w-[90%] px-4 py-2 rounded-2xl bg-berry-900/95 text-white text-xs font-semibold shadow-xl text-center animate-[fadeIn_0.25s_ease-out]">
          {toast}
        </div>
      )}

      {openCapsule && (
        <CapsuleReader capsule={openCapsule} onClose={() => setOpenCapsule(null)} />
      )}

      {capsuleComposer && (
        <CapsuleComposer
          currentUserId={currentUserId}
          onClose={() => setCapsuleComposer(false)}
          onSaved={() => {
            setCapsuleComposer(false);
            loadAll();
            showToast('Kapsül mühürlendi 🔒');
          }}
        />
      )}

      {songComposer && (
        <SongComposer
          currentUserId={currentUserId}
          onClose={() => setSongComposer(false)}
          onSaved={() => {
            setSongComposer(false);
            loadAll();
            showToast('Şarkınız eklendi 🎵');
          }}
        />
      )}
    </div>
  );
};

/* ------------------------------------------------------------------ */

const AnswerBubble: React.FC<{
  who: string;
  emoji: string;
  text: string;
  mine?: boolean;
}> = ({ who, emoji, text, mine }) => (
  <div
    className={`rounded-2xl px-3 py-2 ${
      mine
        ? 'bg-gradient-to-r from-berry-500 to-rose-500 text-white ml-4'
        : 'bg-rose-50 border border-rose-100 text-stone-800 mr-4'
    }`}
  >
    <p className={`text-[9px] font-bold mb-0.5 ${mine ? 'text-white/80' : 'text-rose-600'}`}>
      {emoji} {who}
    </p>
    <p className="text-xs leading-relaxed">{text}</p>
  </div>
);

const CapsuleReader: React.FC<{ capsule: any; onClose: () => void }> = ({ capsule, onClose }) => (
  <div className="fixed inset-0 z-[60] bg-black/70 backdrop-blur-md flex items-center justify-center p-4 safe-area-all">
    <div className="w-full max-w-md max-h-[90vh] overflow-y-auto rounded-3xl shadow-2xl bg-[#fffdf7] border border-amber-200 animate-[pageFlipIn_0.4s_ease-out]">
      <div className="sticky top-0 flex items-center justify-between px-5 py-3 bg-gradient-to-r from-amber-500 to-rose-500 text-white">
        <div className="flex items-center gap-2">
          <Unlock className="w-4 h-4" />
          <span className="font-serif text-sm font-bold">Kapsül Açıldı</span>
        </div>
        <button onClick={onClose} className="p-1.5 rounded-full hover:bg-white/20">
          <X className="w-5 h-5" />
        </button>
      </div>
      <div className="p-5">
        <h3 className="font-serif text-xl font-bold text-berry-900 mb-1">{capsule.title}</h3>
        <p className="text-[10px] text-stone-400 mb-3">
          {USERS[capsule.sender as UserId]?.emoji} {nameOf(capsule.sender)} ·
          {' '}{new Date(capsule.open_date).toLocaleDateString('tr-TR')}
        </p>
        <p className="font-handwriting text-xl leading-relaxed text-stone-700 whitespace-pre-wrap">
          {capsule.content}
        </p>
        <p className="text-center font-handwriting text-lg text-rose-400 mt-5">~ zamanda saklı ~</p>
      </div>
    </div>
  </div>
);

const CapsuleComposer: React.FC<{
  currentUserId: UserId;
  onClose: () => void;
  onSaved: () => void;
}> = ({ currentUserId, onClose, onSaved }) => {
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [openDate, setOpenDate] = useState(() => {
    const d = new Date();
    d.setFullYear(d.getFullYear() + 1);
    return d.toISOString().slice(0, 10);
  });
  const [isSaving, setIsSaving] = useState(false);

  const handleSave = async () => {
    if (!title.trim() || !content.trim()) return;
    setIsSaving(true);
    playHaptic(30);
    try {
      await api.createCapsule({
        sender: currentUserId,
        title: title.trim(),
        content: content.trim(),
        open_date: `${openDate}T00:00:00`,
      });
      soundEngine.playLoveChime();
      onSaved();
    } catch (e) {
      console.error(e);
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[60] bg-black/65 backdrop-blur-md flex items-end sm:items-center justify-center safe-area-all">
      <div className="w-full sm:max-w-md max-h-[94vh] overflow-y-auto bg-[#fffdf7] rounded-t-3xl sm:rounded-3xl shadow-2xl">
        <div className="sticky top-0 flex items-center justify-between px-5 py-3.5 bg-gradient-to-r from-amber-500 to-rose-500 text-white">
          <div className="flex items-center gap-2">
            <Lock className="w-5 h-5" />
            <h3 className="font-serif text-base font-bold">Zaman Kapsülü Mühürle</h3>
            <DemoBadge />
          </div>
          <button onClick={onClose} className="p-1.5 rounded-full hover:bg-white/20">
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="p-4 space-y-3">
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Kapsülün başlığı (örn: Doğum günün için)"
            className="w-full px-3 py-2.5 rounded-xl border border-amber-200 text-sm font-bold focus:outline-none focus:ring-2 focus:ring-amber-400"
          />
          <textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            rows={6}
            placeholder="O gün okunacak mesajın…"
            className="w-full px-3 py-2 rounded-xl border border-amber-200 font-handwriting text-lg resize-none focus:outline-none focus:ring-2 focus:ring-amber-400"
          />
          <div>
            <label className="text-[11px] font-semibold text-stone-600">Ne zaman açılsın?</label>
            <input
              type="date"
              value={openDate}
              min={new Date().toISOString().slice(0, 10)}
              onChange={(e) => setOpenDate(e.target.value)}
              className="w-full px-3 py-2 mt-1 rounded-xl border border-amber-200 text-xs focus:outline-none focus:ring-2 focus:ring-amber-400"
            />
          </div>
          <p className="text-[10px] text-amber-800 bg-amber-50 border border-amber-200 rounded-xl p-2 flex items-start gap-1.5">
            <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
            O tarih gelene kadar ne sen ne de o okuyabilir.
          </p>
          <button
            onClick={handleSave}
            disabled={isSaving || !title.trim() || !content.trim()}
            className="w-full flex items-center justify-center gap-2 py-3 rounded-2xl bg-gradient-to-r from-amber-500 to-rose-500 text-white font-serif text-sm font-bold shadow-lg active:scale-[0.98] disabled:opacity-50"
          >
            {isSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Lock className="w-4 h-4" />}
            {isSaving ? 'Mühürleniyor…' : 'Mühürle'}
          </button>
        </div>
      </div>
    </div>
  );
};

const SongComposer: React.FC<{
  currentUserId: UserId;
  onClose: () => void;
  onSaved: () => void;
}> = ({ currentUserId, onClose, onSaved }) => {
  const [title, setTitle] = useState('');
  const [artist, setArtist] = useState('');
  const [url, setUrl] = useState('');
  const [note, setNote] = useState('');
  const [isSaving, setIsSaving] = useState(false);

  const handleSave = async () => {
    if (!title.trim() || !url.trim()) return;
    setIsSaving(true);
    playHaptic(30);
    try {
      await api.addSong({
        added_by: currentUserId,
        title: title.trim(),
        artist: artist.trim() || undefined,
        url: url.trim(),
        note: note.trim() || undefined,
      });
      soundEngine.playLoveChime();
      onSaved();
    } catch (e) {
      console.error(e);
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[60] bg-black/65 backdrop-blur-md flex items-end sm:items-center justify-center safe-area-all">
      <div className="w-full sm:max-w-md max-h-[94vh] overflow-y-auto bg-white rounded-t-3xl sm:rounded-3xl shadow-2xl">
        <div className="sticky top-0 flex items-center justify-between px-5 py-3.5 bg-gradient-to-r from-fuchsia-500 to-purple-500 text-white">
          <div className="flex items-center gap-2">
            <Music className="w-5 h-5" />
            <h3 className="font-serif text-base font-bold">Şarkı Ekle</h3>
            <DemoBadge />
          </div>
          <button onClick={onClose} className="p-1.5 rounded-full hover:bg-white/20">
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="p-4 space-y-3">
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Şarkı adı"
            className="w-full px-3 py-2.5 rounded-xl border border-fuchsia-200 text-sm font-bold focus:outline-none focus:ring-2 focus:ring-fuchsia-400"
          />
          <input
            type="text"
            value={artist}
            onChange={(e) => setArtist(e.target.value)}
            placeholder="Sanatçı (isteğe bağlı)"
            className="w-full px-3 py-2 rounded-xl border border-fuchsia-200 text-xs focus:outline-none focus:ring-2 focus:ring-fuchsia-400"
          />
          <input
            type="url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="Şarkı bağlantısı"
            className="w-full px-3 py-2 rounded-xl border border-fuchsia-200 text-xs focus:outline-none focus:ring-2 focus:ring-fuchsia-400"
          />
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={2}
            placeholder="Bu şarkının sizin için anlamı ne?"
            className="w-full px-3 py-2 rounded-xl border border-fuchsia-200 text-xs resize-none focus:outline-none focus:ring-2 focus:ring-fuchsia-400"
          />
          <button
            onClick={handleSave}
            disabled={isSaving || !title.trim() || !url.trim()}
            className="w-full flex items-center justify-center gap-2 py-3 rounded-2xl bg-gradient-to-r from-fuchsia-500 to-purple-500 text-white font-serif text-sm font-bold shadow-lg active:scale-[0.98] disabled:opacity-50"
          >
            {isSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Heart className="w-4 h-4" />}
            {isSaving ? 'Ekleniyor…' : 'Şarkımızı Ekle'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default GardenView;
