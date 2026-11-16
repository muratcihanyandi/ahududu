import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  Calendar, ChevronLeft, ChevronRight, Ticket, Clock, MapPin, Film,
  Plus, X, Trash2, Pencil, Popcorn, Sparkles, Star, Users, Play,
  Loader2, Wand2, Link2, CheckCircle2,
} from 'lucide-react';
import { Showtime, UserId, USERS, partnerOf, nameOf } from '../types';
import { api, mediaUrl } from '../services/api';
import { wsClient } from '../services/websocket';
import { playHaptic, soundEngine } from '../services/haptics';
import { registerBackHandler } from '../services/backButton';

interface CinemaCalendarProps {
  currentUserId: UserId;
  /** Seansı salonda aç (takvimden izlemeye geçiş) */
  onWatch: (showtime: Showtime) => void;
}

const MONTHS_TR = [
  'Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran',
  'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık',
];
const DAYS_TR = ['Pzt', 'Sal', 'Çar', 'Per', 'Cum', 'Cmt', 'Paz'];

/** YYYY-MM biçiminde ay anahtarı */
const monthKey = (year: number, month: number) =>
  `${year}-${String(month + 1).padStart(2, '0')}`;

const todayIso = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

const formatDateTR = (iso: string): string => {
  const [y, m, d] = iso.split('-').map(Number);
  return `${d} ${MONTHS_TR[(m || 1) - 1]} ${y}`;
};

const shortDate = (iso: string): string => {
  const [, m, d] = iso.split('-').map(Number);
  return `${d} ${MONTHS_TR[(m || 1) - 1].slice(0, 3)}`;
};

/** Türkçe'ye uygun kısa süre metni */
const showtimeLabel = (s: Showtime): string => {
  // Geçmiş bir günün seansı için "başladı" demek yanıltıcı olur.
  const today = todayIso();
  if (s.show_date < today) return `${s.show_time} · geçti`;
  if (s.show_date > today) return `${s.show_time}`;
  if (!s.starts_in_minutes) return `${s.show_time}`;
  if (s.starts_in_minutes < 0) return `${s.show_time} · başladı`;
  if (s.starts_in_minutes < 60) return `${s.show_time} · ${s.starts_in_minutes} dk sonra`;
  const h = Math.floor(s.starts_in_minutes / 60);
  return `${s.show_time} · ${h} sa sonra`;
};

export const CinemaCalendar: React.FC<CinemaCalendarProps> = ({ currentUserId, onWatch }) => {
  const partnerId = partnerOf(currentUserId);
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth());
  const [showtimes, setShowtimes] = useState<Showtime[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [selectedDate, setSelectedDate] = useState<string | null>(todayIso());
  const [composerOpen, setComposerOpen] = useState(false);
  const [editing, setEditing] = useState<Showtime | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [detail, setDetail] = useState<Showtime | null>(null);
  const [isQuickStarting, setIsQuickStarting] = useState(false);

  const showToast = useCallback((text: string) => {
    setToast(text);
    window.setTimeout(() => setToast(null), 2800);
  }, []);

  const currentMonth = monthKey(year, month);

  const load = useCallback(async () => {
    setIsLoading(true);
    try {
      const data = await api.listShowtimes(currentMonth, currentUserId);
      setShowtimes(data);
    } catch (e) {
      console.error('Takvim yüklenemedi', e);
    } finally {
      setIsLoading(false);
    }
  }, [currentMonth, currentUserId]);

  useEffect(() => {
    load();
  }, [load]);

  // Android geri tuşu: açık pencere varsa onu kapat.
  useEffect(() => {
    const unregister = registerBackHandler(() => {
      if (composerOpen) {
        setComposerOpen(false);
        setEditing(null);
        return true;
      }
      if (detail) {
        setDetail(null);
        return true;
      }
      return false;
    });
    return unregister;
  }, [composerOpen, detail]);

  // Canlı güncellemeler
  useEffect(() => {
    const reload = () => load();
    const unsubAdded = wsClient.on('cinema_showtime_added', (d: any) => {
      if (d?.showtime) {
        soundEngine.playLoveChime();
        showToast(`Takvime yeni film eklendi: ${d.showtime.title} 🎬`);
        load();
      }
    });
    const unsubUpdated = wsClient.on('cinema_showtime_updated', reload);
    const unsubDeleted = wsClient.on('cinema_showtime_deleted', reload);
    const unsubImport = wsClient.on('cinema_calendar_updated', (d: any) => {
      showToast(`Takvim güncellendi · ${d?.count ?? 0} seans eklendi`);
      load();
    });
    const unsubTicket = wsClient.on('cinema_ticket_booked', (d: any) => {
      if (d?.booked_by && d.booked_by !== currentUserId) {
        playHaptic(60);
        soundEngine.playLoveChime();
        showToast(`${nameOf(d.booked_by)} ${d.showtime?.title ?? 'filme'} bilet aldı! 🎟️`);
        load();
      }
    });
    const unsubTicketCancel = wsClient.on('cinema_ticket_cancelled', reload);

    return () => {
      unsubAdded();
      unsubUpdated();
      unsubDeleted();
      unsubImport();
      unsubTicket();
      unsubTicketCancel();
    };
  }, [load, currentUserId, showToast]);

  // Takvim ızgarası: pazartesi başlangıçlı
  const cells = useMemo(() => {
    const first = new Date(year, month, 1);
    const startOffset = (first.getDay() + 6) % 7; // Pazartesi = 0
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const result: (string | null)[] = [];
    for (let i = 0; i < startOffset; i += 1) result.push(null);
    for (let d = 1; d <= daysInMonth; d += 1) result.push(monthKey(year, month) + '-' + String(d).padStart(2, '0'));
    return result;
  }, [year, month]);

  const byDate = useMemo(() => {
    const map = new Map<string, Showtime[]>();
    showtimes.forEach((s) => {
      const list = map.get(s.show_date) || [];
      list.push(s);
      map.set(s.show_date, list);
    });
    // Saate göre sırala
    map.forEach((list) => list.sort((a, b) => a.show_time.localeCompare(b.show_time)));
    return map;
  }, [showtimes]);

  const selectedShows = selectedDate ? byDate.get(selectedDate) || [] : [];
  const tonightShow = byDate.get(todayIso())?.[0] ?? null;
  const nextShow = useMemo(
    () => showtimes.filter((s) => s.show_date >= todayIso()).sort((a, b) =>
      (a.show_date + a.show_time).localeCompare(b.show_date + b.show_time))[0] ?? null,
    [showtimes]
  );
  const totalTickets = showtimes.filter((s) => s.my_ticket).length;

  const changeMonth = (delta: number) => {
    playHaptic(15);
    const next = new Date(year, month + delta, 1);
    setYear(next.getFullYear());
    setMonth(next.getMonth());
    setSelectedDate(null);
  };

  const goToday = () => {
    const d = new Date();
    setYear(d.getFullYear());
    setMonth(d.getMonth());
    setSelectedDate(todayIso());
    playHaptic(15);
  };

  /** Boş takvimde tek dokunuşla örnek bir ay kurar. */
  const handleQuickStart = async () => {
    setIsQuickStarting(true);
    playHaptic(40);
    try {
      const mk = (offset: number) => {
        // Geçmiş bir güne düşmesin: bugünün tarihi baz alınır.
        const now = new Date();
        const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + offset);
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      };
      // Bu hafta içinde yaklaşan dört akşam (1, 3, 5, 7 gün sonra)
      await api.importCalendar({
        month: currentMonth,
        replace_existing: false,
        created_by: currentUserId,
        showtimes: [
          {
            title: 'Aşk Tesadüfleri Sever',
            video_url: 'https://www.youtube.com/watch?v=YoHD9XEInc0',
            show_date: mk(1),
            show_time: '21:00',
            description: 'İlk birlikte izleyeceğimiz film 🍿',
          },
          {
            title: 'La La Land',
            video_url: 'https://www.youtube.com/watch?v=0pdqf4P9MB8',
            show_date: mk(3),
            show_time: '21:00',
          },
          {
            title: 'Notting Hill',
            video_url: 'https://www.youtube.com/watch?v=4_Rn7ubdJfY',
            show_date: mk(5),
            show_time: '21:30',
          },
          {
            title: 'Bizim Filmimiz',
            video_url: 'https://www.youtube.com/watch?v=YoHD9XEInc0',
            show_date: mk(7),
            show_time: '20:30',
            description: 'Bu akşam canımız ne isterse 🍿',
          },
        ],
      });
      soundEngine.playLoveChime();
      showToast('Bu ayın perdesi kuruldu! 🎬');
      await load();
      setSelectedDate(mk(1));
    } catch (e) {
      console.error(e);
      showToast('Takvim kurulamadı, tekrar dener misin?');
    } finally {
      setIsQuickStarting(false);
    }
  };

  const handleBook = async (show: Showtime) => {playHaptic(30);
    try {
      const isCancelling = show.my_ticket;
      const updated = isCancelling
        ? await api.cancelTicket(show.id, currentUserId)
        : await api.bookTicket(show.id, currentUserId);

      setShowtimes((prev) => prev.map((s) => (s.id === updated.id ? updated : s)));
      setDetail(updated);
      if (!isCancelling) {
        soundEngine.playLoveChime();
        showToast(updated.partner_ticket
          ? 'Biletin hazır! İkiniz için de yer ayrıldı 🎟️🍿'
          : 'Biletin hazır! Sevgiline de haber verdik 💌');
      } else {
        showToast('Biletin iptal edildi');
      }
    } catch (e: any) {
      showToast(e?.message || 'Bilet işlemi başarısız');
    }
  };

  const handleWatch = async (show: Showtime) => {
    if (!show.my_ticket) {
      showToast('Önce bilet almalısın 🎟️');
      return;
    }
    playHaptic(40);
    try {
      await api.openShowtime(show.id, currentUserId);
      // Detay penceresini kapat ki salon tam ekran açılabilsin. (Açık kalırsa
      // salonun üstünde kalır ve kullanıcı perdeyi göremez.)
      setDetail(null);
      onWatch(show);
    } catch (e: any) {
      showToast(e?.message || 'Salon açılamadı');
    }
  };

  const handleDelete = async (show: Showtime) => {
    if (!window.confirm(`"${show.title}" seansını takvimden kaldırmak istiyor musun?`)) return;
    try {
      await api.deleteShowtime(show.id);
      setShowtimes((prev) => prev.filter((s) => s.id !== show.id));
      setDetail(null);
      playHaptic(30);
      showToast('Seans kaldırıldı');
    } catch (e) {
      console.error(e);
    }
  };

  return (
    <div className="flex flex-col space-y-4" style={{ colorScheme: 'dark' }}>
      {/* ---- Takvim başlığı (koyu perde) ---- */}
      <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-[#2a0713] via-[#3d0b1c] to-[#1a0510] text-white shadow-xl shadow-berry-900/30 border border-amber-400/25">
        {/* perde ışığı */}
        <div
          className="absolute inset-0 opacity-40 pointer-events-none animate-[lightsSweep_9s_ease-in-out_infinite]"
          style={{
            background:
              'conic-gradient(from 205deg at 18% 0%, rgba(255,225,170,0.5), transparent 38%), conic-gradient(from -25deg at 82% 0%, rgba(255,120,170,0.42), transparent 38%)',
          }}
        />
        <div className="relative px-4 pt-4 pb-3">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="text-[9px] font-bold tracking-[0.28em] text-amber-300/85 uppercase">
                Sinema Takvimi
              </p>
              <h2 className="font-serif text-lg font-bold tracking-wide mt-0.5">
                {MONTHS_TR[month]} {year} 🎬
              </h2>
              <p className="text-[11px] text-white/65 mt-0.5">
                {showtimes.length} seans · {totalTickets} biletin var
              </p>
            </div>
            <button
              onClick={() => {
                setEditing(null);
                setComposerOpen(true);
                playHaptic(25);
              }}
              className="shrink-0 flex items-center gap-1.5 px-3 py-2 rounded-2xl bg-amber-400 text-[#2a0713] text-xs font-bold shadow-md active:scale-95"
            >
              <Plus className="w-3.5 h-3.5" />
              Film Ekle
            </button>
          </div>

          {/* Mini özet kartları */}
          <div className="grid grid-cols-2 gap-2 mt-3">
            <div className="rounded-2xl bg-white/10 backdrop-blur-xs px-3 py-2 border border-white/10">
              <div className="flex items-center gap-1.5 text-[9px] text-amber-200/90 font-semibold uppercase tracking-wide">
                <Popcorn className="w-3 h-3" />
                Bu akşam
              </div>
              <p className="font-serif text-xs font-bold mt-0.5 truncate">
                {tonightShow ? `${tonightShow.show_time} · ${tonightShow.title}` : 'Seans yok'}
              </p>
            </div>
            <div className="rounded-2xl bg-white/10 backdrop-blur-xs px-3 py-2 border border-white/10">
              <div className="flex items-center gap-1.5 text-[9px] text-rose-200/90 font-semibold uppercase tracking-wide">
                <Ticket className="w-3 h-3" />
                Sıradaki
              </div>
              <p className="font-serif text-xs font-bold mt-0.5 truncate">
                {nextShow ? `${shortDate(nextShow.show_date)} · ${nextShow.title}` : 'Takvim boş'}
              </p>
            </div>
          </div>
        </div>

        {/* Sinema şeridi */}
        <div className="relative h-3 flex justify-around items-center bg-black/50">
          {Array.from({ length: 22 }).map((_, i) => (
            <span key={i} className="w-1.5 h-1.5 rounded-[1px] bg-amber-200/55" />
          ))}
        </div>
      </div>

      {/* ---- Takvim (koyu) ---- */}
      <div className="rounded-3xl bg-[#17040d] border border-amber-400/20 shadow-lg shadow-black/40 p-3.5">
        <div className="flex items-center justify-between mb-2.5">
          <button
            onClick={() => changeMonth(-1)}
            className="p-1.5 rounded-xl bg-white/5 hover:bg-white/10 text-amber-100/80 active:scale-90"
            aria-label="Önceki ay"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>
          <div className="flex items-center gap-2">
            <Calendar className="w-4 h-4 text-amber-300" />
            <span className="font-serif text-sm font-bold text-amber-50">
              {MONTHS_TR[month]} {year}
            </span>
            <button
              onClick={goToday}
              className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-amber-400 text-[#2a0713]"
            >
              Bugün
            </button>
          </div>
          <button
            onClick={() => changeMonth(1)}
            className="p-1.5 rounded-xl bg-white/5 hover:bg-white/10 text-amber-100/80 active:scale-90"
            aria-label="Sonraki ay"
          >
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>

        {/* Gün başlıkları */}
        <div className="grid grid-cols-7 gap-1 mb-1">
          {DAYS_TR.map((d) => (
            <div key={d} className="text-center text-[9px] font-bold text-amber-200/45 py-1">
              {d}
            </div>
          ))}
        </div>

        {/* Günler */}
        <div className="grid grid-cols-7 gap-1">
          {cells.map((iso, index) => {
            if (!iso) return <div key={`empty-${index}`} />;
            const dayShows = byDate.get(iso) || [];
            const isToday = iso === todayIso();
            const isSelected = iso === selectedDate;
            const isPast = iso < todayIso();
            const hasTicket = dayShows.some((s) => s.my_ticket);
            const dayNumber = Number(iso.slice(-2));

            return (
              <button
                key={iso}
                onClick={() => {
                  setSelectedDate(iso);
                  playHaptic(12);
                }}
                className={`relative aspect-square rounded-xl flex flex-col items-center justify-center transition-all active:scale-90 ${
                  isSelected
                    ? 'bg-gradient-to-br from-amber-300 to-rose-400 text-[#2a0713] shadow-md shadow-amber-500/25'
                    : isToday
                      ? 'bg-amber-400/15 text-amber-100 ring-1 ring-amber-400/60'
                      : dayShows.length
                        ? 'bg-rose-500/15 text-rose-50 hover:bg-rose-500/25'
                        : isPast
                          ? 'text-stone-600 hover:bg-white/5'
                          : 'text-amber-50/85 hover:bg-white/10'
                }`}
              >
                <span className="text-[11px] font-bold leading-none">{dayNumber}</span>
                {dayShows.length > 0 && (
                  <span className="flex items-center gap-0.5 mt-0.5">
                    {dayShows.slice(0, 3).map((s) => (
                      <span
                        key={s.id}
                        className={`w-1 h-1 rounded-full ${
                          isSelected ? 'bg-[#2a0713]/80' : hasTicket ? 'bg-emerald-400' : 'bg-amber-300'
                        }`}
                      />
                    ))}
                  </span>
                )}
                {hasTicket && !isSelected && (
                  <Ticket className="absolute top-0.5 right-0.5 w-2 h-2 text-emerald-400" />
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* ---- Seçili günün seansları ---- */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <h3 className="font-serif text-sm font-bold text-amber-100 flex items-center gap-1.5">
            <Film className="w-4 h-4 text-amber-300" />
            {selectedDate ? formatDateTR(selectedDate) : 'Bir gün seç'}
          </h3>
          {selectedDate && (
            <span className="text-[10px] text-amber-200/50">
              {selectedShows.length} seans
            </span>
          )}
        </div>

        {isLoading ? (
          <div className="p-8 text-center text-xs text-amber-100/60 animate-pulse">Perde hazırlanıyor…</div>
        ) : selectedShows.length === 0 ? (
          <div className="rounded-3xl border-2 border-dashed border-amber-400/25 bg-black/20 p-6 text-center">
            <Popcorn className="w-9 h-9 text-amber-300/60 mx-auto mb-2 animate-float" />
            <p className="font-serif text-sm font-semibold text-amber-50">
              {selectedDate ? 'Bu gün seans yok' : 'Takvimden bir gün seç'}
            </p>
            <p className="text-[11px] text-amber-100/55 mt-1 max-w-[250px] mx-auto">
              "Film Ekle" ile bu aya film koyabilirsin. İstersen tek dokunuşla örnek bir
              program da hazırlayabiliriz 🎬
            </p>
            {showtimes.length === 0 && (
              <button
                onClick={handleQuickStart}
                disabled={isQuickStarting}
                className="mt-3 inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-gradient-to-r from-amber-300 to-rose-400 text-[#2a0713] text-[11px] font-bold shadow-md active:scale-95 disabled:opacity-60"
              >
                {isQuickStarting ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Wand2 className="w-3.5 h-3.5" />
                )}
                {isQuickStarting ? 'Hazırlanıyor…' : 'Bu ay için örnek program kur'}
              </button>
            )}
          </div>
        ) : (
          <div className="space-y-2.5">
            {selectedShows.map((show) => (
              <ShowtimeCard
                key={show.id}
                show={show}
                currentUserId={currentUserId}
                partnerId={partnerId}
                onOpen={() => setDetail(show)}
                onBook={() => handleBook(show)}
                onWatch={() => handleWatch(show)}
              />
            ))}
          </div>
        )}
      </div>

      {toast && (
        <div className="fixed left-1/2 -translate-x-1/2 top-20 z-[70] max-w-[90%] px-4 py-2 rounded-2xl bg-black/90 border border-amber-400/30 text-white text-xs font-semibold shadow-xl text-center animate-[fadeIn_0.25s_ease-out]">
          {toast}
        </div>
      )}

      {/* Detay penceresi */}
      {detail && (
        <ShowtimeDetail
          show={detail}
          currentUserId={currentUserId}
          onClose={() => setDetail(null)}
          onBook={() => handleBook(detail)}
          onWatch={() => handleWatch(detail)}
          onEdit={() => {
            setEditing(detail);
            setDetail(null);
            setComposerOpen(true);
          }}
          onDelete={() => handleDelete(detail)}
        />
      )}

      {/* Film ekleme / düzenleme */}
      {composerOpen && (
        <ShowtimeComposer
          currentUserId={currentUserId}
          editing={editing}
          initialDate={selectedDate || todayIso()}
          onClose={() => {
            setComposerOpen(false);
            setEditing(null);
          }}
          onSaved={() => {
            setComposerOpen(false);
            setEditing(null);
            load();
            showToast(editing ? 'Seans güncellendi ✨' : 'Seans takvime eklendi 🎬');
          }}
        />
      )}
    </div>
  );
};

/* ------------------------------------------------------------------ */
/* Seans kartı                                                         */
/* ------------------------------------------------------------------ */

const ShowtimeCard: React.FC<{
  show: Showtime;
  currentUserId: UserId;
  partnerId: UserId;
  onOpen: () => void;
  onBook: () => void;
  onWatch: () => void;
}> = ({ show, currentUserId, partnerId, onOpen, onBook, onWatch }) => {
  const poster = mediaUrl(show.poster_url);
  const bothTickets = show.booked_by.includes(currentUserId) && show.booked_by.includes(partnerId);

  return (
    <div
      onClick={onOpen}
      className="group relative flex gap-3 rounded-3xl overflow-hidden bg-[#1c0611] border border-amber-400/20 shadow-md shadow-black/30 hover:border-amber-400/40 transition-all cursor-pointer active:scale-[0.99]"
    >
      {/* Afiş */}
      <div className="relative w-24 shrink-0 bg-gradient-to-br from-[#3b0a1c] to-black overflow-hidden">
        {poster ? (
          <img
            src={poster}
            alt={show.title}
            className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
            onError={(e) => {
              (e.target as HTMLImageElement).style.display = 'none';
            }}
          />
        ) : (
          <div className="w-full h-full min-h-[112px] flex items-center justify-center">
            <Film className="w-8 h-8 text-amber-500/40" />
          </div>
        )}
        <span className="absolute top-1.5 left-1.5 text-[8px] font-bold px-1.5 py-0.5 rounded-full bg-black/65 text-amber-200">
          {show.hall}
        </span>
      </div>

      {/* Bilgiler */}
      <div className="flex-1 min-w-0 py-2.5 pr-2.5 flex flex-col justify-between">
        <div>
          <div className="flex items-start justify-between gap-2">
            <h4 className="font-serif text-sm font-bold text-amber-50 leading-tight line-clamp-1">
              {show.title}
            </h4>
            {bothTickets && (
              <span className="shrink-0 text-[8px] font-bold px-1.5 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-400/30">
                İKİNİZ 🎟️
              </span>
            )}
          </div>
          <div className="flex items-center gap-2 mt-1 text-[10px] text-amber-100/55">
            <span className="flex items-center gap-0.5">
              <Clock className="w-2.5 h-2.5" />
              {showtimeLabel(show)}
            </span>
            <span className="flex items-center gap-0.5">
              <Users className="w-2.5 h-2.5" />
              {show.booked_count}/{show.seats}
            </span>
          </div>
          {show.description && (
            <p className="text-[10px] text-amber-100/45 mt-1 line-clamp-1">{show.description}</p>
          )}
        </div>

        <div className="flex items-center gap-1.5 mt-2">
          <button
            onClick={(e) => {
              e.stopPropagation();
              onBook();
            }}
            className={`flex items-center justify-center gap-1 px-2.5 py-1.5 rounded-xl text-[10px] font-bold active:scale-95 transition-all border ${
              show.my_ticket
                ? 'bg-emerald-500/15 text-emerald-300 border-emerald-400/30'
                : 'bg-amber-400/15 text-amber-200 border-amber-400/30'
            }`}
          >
            {show.my_ticket ? <CheckCircle2 className="w-3 h-3" /> : <Ticket className="w-3 h-3" />}
            {show.my_ticket ? 'Biletim var' : 'Bilet Al'}
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation();
              onWatch();
            }}
            className="flex-1 flex items-center justify-center gap-1 px-2.5 py-1.5 rounded-xl bg-gradient-to-r from-amber-400 to-rose-400 text-[#2a0713] text-[10px] font-bold active:scale-95"
          >
            <Play className="w-3 h-3" />
            Salona Gir
          </button>
        </div>
      </div>
    </div>
  );
};

/* ------------------------------------------------------------------ */
/* Seans detayı                                                        */
/* ------------------------------------------------------------------ */

const ShowtimeDetail: React.FC<{
  show: Showtime;
  currentUserId: UserId;
  onClose: () => void;
  onBook: () => void;
  onWatch: () => void;
  onEdit: () => void;
  onDelete: () => void;
}> = ({ show, currentUserId, onClose, onBook, onWatch, onEdit, onDelete }) => {
  const partnerId = partnerOf(currentUserId);
  const poster = mediaUrl(show.poster_url);

  return (
    <div className="fixed inset-0 z-[60] bg-black/80 backdrop-blur-md overflow-y-auto safe-area-all" style={{ colorScheme: 'dark' }}>
      <div className="min-h-full flex items-start justify-center p-3">
        <div className="w-full max-w-md bg-[#1c0611] rounded-3xl shadow-2xl shadow-black/60 overflow-hidden border border-amber-400/20 animate-[popIn_0.28s_ease-out]">
          <div className="relative h-56 bg-gradient-to-br from-[#3b0a1c] to-black">
            {poster && (
              <img
                src={poster}
                alt={show.title}
                className="w-full h-full object-cover opacity-90"
                onError={(e) => {
                  (e.target as HTMLImageElement).style.display = 'none';
                }}
              />
            )}
            <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-transparent to-black/40" />
            <button
              onClick={onClose}
              className="absolute top-3 right-3 p-2 rounded-full bg-black/60 border border-white/10 text-white"
            >
              <X className="w-5 h-5" />
            </button>
            <div className="absolute top-3 left-3 flex gap-1.5">
              <button
                onClick={onEdit}
                className="p-2 rounded-full bg-black/60 border border-white/10 text-amber-100"
              >
                <Pencil className="w-4 h-4" />
              </button>
              <button
                onClick={onDelete}
                className="p-2 rounded-full bg-black/60 border border-white/10 text-rose-300"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
            <div className="absolute bottom-3 left-4 right-4">
              <span className="text-[9px] font-bold tracking-[0.2em] text-amber-300 uppercase">
                {show.hall} · {show.genre}
              </span>
              <h2 className="font-serif text-xl font-bold text-white drop-shadow">{show.title}</h2>
              <p className="text-[11px] text-white/75 mt-0.5">
                {formatDateTR(show.show_date)} · {show_time_1(show)} · {show.seats} kişilik
              </p>
            </div>
          </div>

          <div className="p-4 space-y-3">
            {show.description && (
              <p className="text-xs text-amber-100/70 leading-relaxed">{show.description}</p>
            )}

            {/* Bilet durumu */}
            <div className="rounded-2xl border border-amber-400/25 bg-amber-400/10 p-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1.5 text-[11px] font-bold text-amber-200">
                  <Ticket className="w-3.5 h-3.5" />
                  Biletler
                </div>
              </div>
              <div className="flex items-center gap-2 mt-2">
                {[USERS[currentUserId], USERS[partnerId]].map((u, i) => {
                  const id = i === 0 ? currentUserId : partnerId;
                  const has = show.booked_by.split(',').includes(id);
                  return (
                    <div
                      key={id}
                      className={`flex items-center gap-1 px-2 py-1 rounded-full text-[10px] font-bold ${
                        has
                          ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-400/30'
                          : 'bg-white/5 text-stone-500 border border-white/10'
                      }`}
                    >
                      <span>{u.emoji}</span>
                      {u.name}
                      {has ? ' 🎟️' : ' —'}
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="flex gap-2">
              <button
                onClick={onBook}
                className={`flex-1 py-2.5 rounded-2xl text-xs font-bold active:scale-95 transition-all ${
                  show.my_ticket
                    ? 'bg-white/5 text-amber-100/70 border border-white/10'
                    : 'bg-amber-400 text-[#2a0713] shadow-md shadow-amber-500/20'
                }`}
              >
                {show.my_ticket ? 'Bileti İptal Et' : 'Bilet Al 🎟️'}
              </button>
              <button
                onClick={onWatch}
                className="flex-1 py-2.5 rounded-2xl bg-gradient-to-r from-amber-400 to-rose-400 text-[#2a0713] text-xs font-bold shadow-md active:scale-95"
              >
                Salona Gir 🍿
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

/* Küçük yardımcı: uzun etiket */
function show_time_1(show: Showtime): string {
  return showtimeLabel(show);
}

/* ------------------------------------------------------------------ */
/* Film ekle / düzenle                                                 */
/* ------------------------------------------------------------------ */

const ShowtimeComposer: React.FC<{
  currentUserId: UserId;
  editing: Showtime | null;
  initialDate: string;
  onClose: () => void;
  onSaved: () => void;
}> = ({ currentUserId, editing, initialDate, onClose, onSaved }) => {
  const isNew = !editing;
  const [title, setTitle] = useState(editing?.title ?? '');
  const [videoUrl, setVideoUrl] = useState(editing?.video_url ?? '');
  const [showDate, setShowDate] = useState(editing?.show_date ?? initialDate);
  const [showTime, setShowTime] = useState(editing?.show_time ?? '21:00');
  const [description, setDescription] = useState(editing?.description ?? '');
  const [hall, setHall] = useState(editing?.hall ?? 'Salon 1');
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSave = async () => {
    if (!title.trim() || !videoUrl.trim()) {
      setError('Film adı ve video bağlantısı gerekli 🎬');
      return;
    }
    setIsSaving(true);
    setError(null);
    playHaptic(30);

    try {
      if (editing) {
        await api.updateShowtime(editing.id, {
          title: title.trim(),
          video_url: videoUrl.trim(),
          show_date: showDate,
          show_time: showTime,
          description: description.trim() || undefined,
          hall,
          updated_by: currentUserId,
        });
      } else {
        await api.createShowtime({
          title: title.trim(),
          video_url: videoUrl.trim(),
          show_date: showDate,
          show_time: showTime,
          description: description.trim() || undefined,
          hall,
          created_by: currentUserId,
        });
      }
      soundEngine.playLoveChime();
      onSaved();
    } catch (e) {
      console.error(e);
      setError('Kaydedemedik, tekrar dener misin?');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[60] bg-black/80 backdrop-blur-md flex items-end sm:items-center justify-center safe-area-all"
      style={{ colorScheme: 'dark' }}
    >
      <div className="w-full sm:max-w-md max-h-[94vh] overflow-y-auto bg-[#1c0611] rounded-t-3xl sm:rounded-3xl shadow-2xl shadow-black/60 border-t sm:border border-amber-400/20">
        <div className="sticky top-0 z-10 flex items-center justify-between px-5 py-3.5 bg-gradient-to-r from-[#3d0b1c] to-[#2a0713] text-white border-b border-amber-400/20">
          <div className="flex items-center gap-2">
            <Film className="w-5 h-5 text-amber-300" />
            <h3 className="font-serif text-base font-bold">
              {isNew ? 'Takvime Film Ekle' : 'Seansı Düzenle'}
            </h3>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-full hover:bg-white/10">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-4 space-y-3.5">
          <div>
            <label className="text-[11px] font-semibold text-amber-100/70">Film adı</label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Örn: Aşk Tesadüfleri Sever"
              className="w-full px-3 py-2.5 mt-1 rounded-xl bg-black/40 border border-amber-400/25 text-sm font-bold text-amber-50 placeholder:text-amber-100/30 focus:outline-none focus:ring-2 focus:ring-amber-400"
            />
          </div>

          <div>
            <label className="text-[11px] font-semibold text-amber-100/70 flex items-center gap-1">
              <Link2 className="w-3 h-3" /> Video bağlantısı
            </label>
            <textarea
              value={videoUrl}
              onChange={(e) => setVideoUrl(e.target.value)}
              rows={2}
              placeholder="Film bağlantısı"
              className="w-full px-3 py-2 mt-1 rounded-xl bg-black/40 border border-amber-400/25 text-xs text-amber-50 placeholder:text-amber-100/30 resize-none focus:outline-none focus:ring-2 focus:ring-amber-400"
            />
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-[11px] font-semibold text-amber-100/70">Tarih</label>
              <input
                type="date"
                value={showDate}
                onChange={(e) => setShowDate(e.target.value)}
                className="w-full px-3 py-2 mt-1 rounded-xl bg-black/40 border border-amber-400/25 text-xs text-amber-50 focus:outline-none focus:ring-2 focus:ring-amber-400"
              />
            </div>
            <div>
              <label className="text-[11px] font-semibold text-amber-100/70">Seans saati</label>
              <input
                type="time"
                value={showTime}
                onChange={(e) => setShowTime(e.target.value)}
                className="w-full px-3 py-2 mt-1 rounded-xl bg-black/40 border border-amber-400/25 text-xs text-amber-50 focus:outline-none focus:ring-2 focus:ring-amber-400"
              />
            </div>
          </div>

          <div>
            <label className="text-[11px] font-semibold text-amber-100/70">Salon</label>
            <div className="flex gap-1.5 mt-1">
              {['Salon 1', 'Salon 2', 'Vip Salon'].map((h) => (
                <button
                  key={h}
                  onClick={() => setHall(h)}
                  className={`flex-1 py-2 rounded-xl text-[11px] font-bold transition-all ${
                    hall === h
                      ? 'bg-gradient-to-r from-amber-400 to-rose-400 text-[#2a0713] shadow-xs'
                      : 'bg-white/5 border border-white/10 text-amber-100/60'
                  }`}
                >
                  {h}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="text-[11px] font-semibold text-amber-100/70">Kısa not (isteğe bağlı)</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
              placeholder="Bu filmi neden birlikte izliyoruz? 💕"
              className="w-full px-3 py-2 mt-1 rounded-xl bg-black/40 border border-amber-400/25 text-xs text-amber-50 placeholder:text-amber-100/30 resize-none focus:outline-none focus:ring-2 focus:ring-amber-400"
            />
          </div>

          {error && <p className="text-xs text-rose-300 font-medium">{error}</p>}

          <button
            onClick={handleSave}
            disabled={isSaving}
            className="w-full flex items-center justify-center gap-2 py-3 rounded-2xl bg-gradient-to-r from-amber-400 to-rose-400 text-[#2a0713] font-serif text-sm font-bold shadow-lg active:scale-[0.98] disabled:opacity-60"
          >
            {isSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
            {isSaving ? 'Kaydediliyor…' : isNew ? 'Takvime Ekle' : 'Değişiklikleri Kaydet'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default CinemaCalendar;
