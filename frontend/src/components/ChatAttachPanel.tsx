import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Images,
  Camera,
  MapPin,
  UserRound,
  FileText,
  ListChecks,
  CalendarDays,
  X,
  Check,
} from 'lucide-react';
import { GalleryItem, UserId } from '../types';
import { api, mediaUrl } from '../services/api';
import { playHaptic } from '../services/haptics';

/* ------------------------------------------------------------------ */
/* Sohbette paylaşılan "Kişi" kartı                                    */
/* ------------------------------------------------------------------ */

export interface ContactDraft {
  name: string;
  phone: string;
  note?: string;
}

/* ------------------------------------------------------------------ */
/* Dosya seçici tür süzgeçleri                                         */
/* ------------------------------------------------------------------ */

/** Galeri: yalnızca görsel. */
export const IMAGE_ACCEPT = 'image/*';
/**
 * Kamera: WebView/Chrome'da tek "Dosya Seç" penceresi açılıp orada
 * Kamera / Dosyalar seçilebilsin diye görsel + video kabul edilir.
 */
export const CAMERA_ACCEPT = 'image/*,video/*';

/** Galeri ızgarasında gösterilecek en fazla kare (açılış gecikmesin). */
const GRID_LIMIT = 8;

type SheetKind = 'galeri' | 'camera' | 'konum' | 'kisi' | 'belge' | 'anket' | 'etkinlik';

export type AttachAction =
  | 'galeri'
  | 'camera'
  | 'konum'
  | 'kisi'
  | 'belge'
  | 'anket'
  | 'etkinlik';

interface ChatAttachPanelProps {
  currentUserId: UserId;
  /** Panel açıldığında galeri karelerini tazelemek için sayaç. */
  refreshKey: number;
  /** Kapatma isteği (tutamak, geri tuşu, iş bitince). */
  onRequestClose: () => void;
  /** Galeri/Kamera/Belge: dosya seçicisini açar. */
  onPickFile: (action: 'galeri' | 'camera' | 'belge') => void;
  /** Paylaşılan konum — koordinat + insan dilinde yer adı. */
  onShareLocation: (place: {
    latitude: number;
    longitude: number;
    place_name: string;
  }) => Promise<void>;
  /** Kişi kartı gönder. */
  onShareContact: (contact: ContactDraft) => Promise<void>;
  /** Anket: soru + 2-6 seçenek. */
  onSharePoll: (question: string, options: string[]) => Promise<void>;
  /** Etkinlik: başlık + tarih/saat + (isteğe bağlı) ayrıntı. */
  onShareEvent: (event: {
    title: string;
    date: string;
    time: string;
    details: string;
  }) => Promise<void>;
  /** Panel içinden anlar / sinema gibi ana uygulama ekranları. */
  onOpenMemories: () => void;
  onOpenCinema: () => void;
  /** Kısa bilgi baloncuğu (hata/başarı). */
  showToast: (text: string) => void;
}

/* ------------------------------------------------------------------ */
/* Küçük yardımcılar                                                   */
/* ------------------------------------------------------------------ */

const pad2 = (n: number) => String(n).padStart(2, '0');

/** Bugünün YYYY-MM-DD biçimi (yerel saat). */
const todayIso = () => {
  const d = new Date();
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
};

/** Bir saat sonrası, HH:MM (yerel saat). */
const defaultTime = () => {
  const d = new Date(Date.now() + 60 * 60 * 1000);
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
};

const cleanPhone = (value: string) => value.replace(/[^\d+*#]/g, '');

/** Telefon izni verilmemiş / konum bulunamadı mesajı. */
const geolocationErrorText = (err: unknown): string => {
  const code = (err as { code?: number })?.code;
  if (code === 1) return 'Konum izni kapalı. Ayarlardan izin verip tekrar dener misin?';
  if (code === 2) return 'Konum alınamadı (sinyal yok). Birazdan tekrar dene.';
  if (code === 3) return 'Konum almak uzun sürdü. Tekrar dener misin?';
  return 'Konumunu bulamadık, tekrar dener misin?';
};

/** Konum için okunur etiket: cihaz adı varsa o, yoksa "Konumum (lat, lon)". */
const buildPlaceName = (position: GeolocationPosition): string => {
  const coords = position.coords as unknown as {
    city?: string;
    district?: string;
    street?: string;
  };
  const parts = [coords.city, coords.district, coords.street]
    .filter((part): part is string => Boolean(part && String(part).trim()))
    .map((part) => String(part).trim());
  if (parts.length) return parts.join(', ');
  return `Konumum (${position.coords.latitude.toFixed(4)}, ${position.coords.longitude.toFixed(4)})`;
};

/* ------------------------------------------------------------------ */
/* Altlık panel (bottom sheet)                                         */
/* ------------------------------------------------------------------ */

/**
 * Panelin içeriği çökerse yalnızca içerik kaybolur; tutamak ve kaçış yolu kalır.
 * Sınıf bileşeni: yalnızca yaşam döngüsü kullanılır.
 */
class ErrorBoundary extends React.Component<
  { children: React.ReactNode; fallback?: React.ReactNode; onError?: (e: unknown) => void },
  { failed: boolean }
> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: unknown) {
    this.props.onError?.(error);
  }

  render() {
    if (this.state.failed) return this.props.fallback ?? null;
    return this.props.children;
  }
}

const SHEET_TITLES: Record<SheetKind, string> = {
  galeri: 'Galeri',
  camera: 'Kamera',
  konum: 'Konum',
  kisi: 'Kişi',
  belge: 'Belge',
  anket: 'Anket',
  etkinlik: 'Etkinlik',
};

const SHEET_ACCENTS: Record<SheetKind, string> = {
  galeri: 'from-rose-400 to-berry-500',
  camera: 'from-amber-400 to-orange-500',
  konum: 'from-emerald-400 to-teal-500',
  kisi: 'from-sky-400 to-blue-500',
  belge: 'from-violet-400 to-purple-500',
  anket: 'from-pink-400 to-rose-500',
  etkinlik: 'from-orange-400 to-rose-500',
};

/**
 * Sohbetteki ataç → alttan açılan panel.
 *
 * Üstte 7 kutu (Galeri · Kamera · Konum · Kişi · Belge · Anket · Etkinlik),
 * hemen ALTINDA gerçek galeri kareleri (ortak fotoğraf galerisindeki son
 * fotoğraflar). Galeri/kamera/belge işlemleri dosya seçiciyi açar; konum, kişi,
 * anket ve etkinlik kendi küçük formunu bu panelin içinde gösterir.
 *
 * Panel her zaman bir kapatma yolu sunar: tutamak, formdaki ✕ ya da Android
 * geri tuşu — hiçbir durumda ekranda kilitli kalmaz.
 */
export const ChatAttachPanel: React.FC<ChatAttachPanelProps> = ({
  currentUserId,
  refreshKey,
  onRequestClose,
  onPickFile,
  onShareLocation,
  onShareContact,
  onSharePoll,
  onShareEvent,
  onOpenMemories,
  onOpenCinema,
  showToast,
}) => {
  const [sheet, setSheetRaw] = useState<SheetKind | null>(null);
  /**
   * Seçili formun ANLIK değeri. Aynı karede iki dokunuş (kutuya bas → form
   * zaten açıksa kapat) eski durum fonksiyonuyla yanlış yöne gidebildiği için
   * gerçek değeri ref'te tutuyoruz.
   */
  const sheetSyncRef = useRef<SheetKind | null>(null);
  const setSheet = (value: SheetKind | null) => {
    sheetSyncRef.current = value;
    setSheetRaw(value);
  };
  const [photos, setPhotos] = useState<GalleryItem[]>([]);
  const [photosLoading, setPhotosLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  /** "Tekrar dene"ye basınca içerik yeniden kurulur (anahtar). */
  const [retryKey, setRetryKey] = useState(0);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  /* ---------------------------- Galeri ---------------------------- */

  const loadPhotos = useCallback(async () => {
    try {
      const data = await api.listGallery();
      if (!mountedRef.current) return;
      const images = (Array.isArray(data) ? data : [])
        .filter((item) => item && item.media_type !== 'video' && item.media_url)
        .slice(0, GRID_LIMIT);
      setPhotos(images);
    } catch (e) {
      console.warn('[Ahududu] Galeri kareleri yüklenemedi', e);
      if (mountedRef.current) setPhotos([]);
    } finally {
      if (mountedRef.current) setPhotosLoading(false);
    }
  }, []);

  /** Panel her açıldığında (refreshKey artar) ve onarımda kareleri tazele. */
  useEffect(() => {
    void loadPhotos();
  }, [loadPhotos, refreshKey, retryKey]);

  /* --------------------------- Form durumları --------------------------- */

  // Kişi
  const [contactName, setContactName] = useState('');
  const [contactPhone, setContactPhone] = useState('');
  const [contactNote, setContactNote] = useState('');

  // Anket
  const [pollQuestion, setPollQuestion] = useState('');
  const [pollOptions, setPollOptions] = useState<string[]>(['', '']);

  // Etkinlik
  const [eventTitle, setEventTitle] = useState('');
  const [eventDate, setEventDate] = useState(todayIso());
  const [eventTime, setEventTime] = useState(defaultTime());
  const [eventDetails, setEventDetails] = useState('');

  const selectBox = (action: AttachAction) => {
    playHaptic(18);
    if (action === 'galeri' || action === 'camera' || action === 'belge') {
      onPickFile(action);
      return;
    }
    setSheet(sheetSyncRef.current === action ? null : action);
  };

  /** Async işi "meşgul" durumuyla çalıştırır; panel yok olsa bile çökmez. */
  const run = async (work: () => Promise<void>) => {
    if (busy) return;
    setBusy(true);
    try {
      // work() içinde gönderilen satırlar (konum/kişi/anket/etkinlik) listeye
      // eklenir ama altlık panel sohbeti kapattığı için sonraki adım zorlaşır:
      // gönderim başarılıysa panel otomatik kapanır.
      await work();
      onRequestClose();
    } catch (e) {
      console.error('[Ahududu] Paylaşım hatası', e);
      showToast(
        e instanceof Error && /izni|Konum|bulamadık|uzun sürdü/.test(e.message)
          ? e.message
          : 'Gönderemedik, bir daha dener misin? 💌'
      );
    } finally {
      // Panel kapanmış olabilir; kapanmış bileşende state yazmayalım.
      if (mountedRef.current) setBusy(false);
    }
  };

  const handleLocation = () =>
    run(async () => {
      if (typeof navigator === 'undefined' || !navigator.geolocation) {
        showToast('Bu cihazda konum paylaşımı olmuyor.');
        return;
      }
      const position = await new Promise<GeolocationPosition>((resolve, reject) => {
        try {
          navigator.geolocation.getCurrentPosition(resolve, reject, {
            enableHighAccuracy: true,
            timeout: 15000,
            maximumAge: 30000,
          });
        } catch (e) {
          reject(e);
        }
      }).catch((err: GeolocationPositionError) => {
        throw new Error(geolocationErrorText(err));
      });

      await onShareLocation({
        latitude: position.coords.latitude,
        longitude: position.coords.longitude,
        place_name: buildPlaceName(position),
      });
      playHaptic(25);
      showToast('Konumun gönderildi 📍');
    });

  const handleContact = () =>
    run(async () => {
      const name = contactName.trim();
      if (!name) {
        showToast('Kişinin adını yazmayı unutma 🙂');
        return;
      }
      await onShareContact({
        name,
        phone: cleanPhone(contactPhone.trim()),
        note: contactNote.trim(),
      });
      playHaptic(25);
      showToast('Kişi gönderildi 👤');
      if (mountedRef.current) {
        setContactName('');
        setContactPhone('');
        setContactNote('');
      }
    });

  const handlePoll = () =>
    run(async () => {
      const question = pollQuestion.trim();
      const options = pollOptions.map((o) => o.trim()).filter(Boolean);
      if (!question) {
        showToast('Önce anket sorusunu yaz 🙂');
        return;
      }
      if (options.length < 2) {
        showToast('En az iki seçenek gerekiyor.');
        return;
      }
      await onSharePoll(question, options.slice(0, 6));
      playHaptic(25);
      showToast('Anket gönderildi 📊');
      if (mountedRef.current) {
        setPollQuestion('');
        setPollOptions(['', '']);
      }
    });

  const handleEvent = () =>
    run(async () => {
      const title = eventTitle.trim();
      if (!title) {
        showToast('Etkinliğe bir ad ver 🙂');
        return;
      }
      if (!eventDate) {
        showToast('Tarih seçmeyi unutma.');
        return;
      }
      await onShareEvent({
        title,
        date: eventDate,
        time: eventTime || '21:00',
        details: eventDetails.trim(),
      });
      playHaptic(25);
      showToast('Etkinlik gönderildi 📅');
      if (mountedRef.current) {
        setEventTitle('');
        setEventDetails('');
      }
    });

  /* ------------------------------ Görünüm ------------------------------ */

  const inputClass =
    'w-full rounded-xl border border-rose-200 bg-white px-3 py-2 text-xs text-stone-800 placeholder:text-stone-400 focus:border-berry-300 focus:outline-none focus:ring-2 focus:ring-berry-300/30';

  return (
    <div
      data-chat-attach-panel="true"
      className="relative z-20 shrink-0 rounded-t-[22px] border-t border-rose-100 bg-white/97 backdrop-blur-xl shadow-[0_-10px_28px_-14px_rgba(190,24,93,0.28)]"
    >
      {/*
       * Kapatma her an, panel kayarken bile tek dokunuş uzaklıkta olmalı:
       * bu düğme kayarak hareket eden kabuğun (translateY) DIŞINDA durur,
       * böylece animasyon sürerken de dokunuşu alır.
       */}
      <button
        type="button"
        onClick={onRequestClose}
        aria-label="Paneli tamamen kapat"
        className="absolute right-2 top-2 z-10 flex h-8 w-8 items-center justify-center rounded-full bg-stone-100/95 text-stone-500 shadow-sm active:scale-95"
      >
        <X className="h-4 w-4" />
      </button>

      {/* Üstteki tutamak: aşağı sürüklemek gibi dokunmak da paneli kapatır. */}
      <button
        type="button"
        onClick={onRequestClose}
        aria-label="Paneli kapat"
        className="flex w-full flex-col items-center pb-1 pt-1.5"
      >
        <span className="h-1.5 w-11 rounded-full bg-stone-300" />
      </button>

      {/* Tek bir kutu/form çökerse paneli tümden kapatmak yerine sade bir
          onarım çubuğu gösterilir; panel kullanılabilir kalır. */}
      <ErrorBoundary
        key={`attach-body-${retryKey}`}
        onError={(error) => console.warn('[Ahududu] Ataç paneli içeriği hatası', error)}
        fallback={
          <div className="px-4 pb-4 pt-2 text-center">
            <p className="text-[11.5px] font-semibold text-stone-600">
              Bu bölüm açılırken bir sorun oldu.
            </p>
            <div className="mt-2 flex items-center justify-center gap-2">
              <button
                type="button"
                onClick={() => {
                  setSheet(null);
                  setRetryKey((key) => key + 1);
                }}
                className="rounded-full bg-berry-500 px-3 py-1.5 text-[11px] font-bold text-white active:scale-95"
              >
                Tekrar dene
              </button>
              <button
                type="button"
                onClick={onRequestClose}
                className="rounded-full border border-rose-200 bg-white px-3 py-1.5 text-[11px] font-semibold text-stone-600 active:scale-95"
              >
                Kapat
              </button>
            </div>
          </div>
        }
      >
        <div className="max-h-[46vh] overflow-y-auto overscroll-contain px-3 pb-2.5">
          {/* ---- 7 kutu + Anılar kısayolu ---- */}
          <div className="grid grid-cols-4 gap-x-1.5 gap-y-2.5">
            <AttachBox
              label="Galeri"
              color="text-sky-500"
              ring="border-sky-200/80"
              icon={<Images className="h-5 w-5" />}
              onClick={() => selectBox('galeri')}
            />
            <AttachBox
              label="Kamera"
              color="text-rose-500"
              ring="border-rose-200/80"
              icon={<Camera className="h-5 w-5" />}
              onClick={() => selectBox('camera')}
            />
            <AttachBox
              label="Konum"
              color="text-emerald-500"
              ring="border-emerald-200/80"
              icon={<MapPin className="h-5 w-5" />}
              onClick={() => selectBox('konum')}
              active={sheet === 'konum'}
              busy={busy && sheet === 'konum'}
            />
            <AttachBox
              label="Kişi"
              color="text-blue-500"
              ring="border-blue-200/80"
              icon={<UserRound className="h-5 w-5" />}
              onClick={() => selectBox('kisi')}
              active={sheet === 'kisi'}
            />
            <AttachBox
              label="Belge"
              color="text-violet-500"
              ring="border-violet-200/80"
              icon={<FileText className="h-5 w-5" />}
              onClick={() => selectBox('belge')}
            />
            <AttachBox
              label="Anket"
              color="text-amber-500"
              ring="border-amber-200/80"
              icon={<ListChecks className="h-5 w-5" />}
              onClick={() => selectBox('anket')}
              active={sheet === 'anket'}
            />
            <AttachBox
              label="Etkinlik"
              color="text-pink-500"
              ring="border-pink-200/80"
              icon={<CalendarDays className="h-5 w-5" />}
              onClick={() => selectBox('etkinlik')}
              active={sheet === 'etkinlik'}
            />
            <button
              type="button"
              onClick={() => {
                playHaptic(15);
                onOpenMemories();
              }}
              aria-label="Anılar"
              className="flex flex-col items-center justify-center gap-0.5 rounded-2xl border border-stone-200/80 bg-stone-50/70 px-1 py-2 text-stone-500 transition-transform active:scale-95"
            >
              <span className="text-[10px] font-bold leading-tight">Anılar</span>
              <span className="text-[9px] leading-tight text-stone-400">galerimiz</span>
            </button>
          </div>

          {/* ---- Seçilen kutuya ait küçük form ---- */}
          {sheet && (
            <div className="mt-2.5 animate-[fadeIn_0.18s_ease-out] rounded-2xl border border-rose-100 bg-rose-50/50 p-3">
              <div className="mb-2 flex items-center justify-between">
                <span className="flex items-center gap-1.5">
                  <span
                    className={`inline-flex h-6 w-6 items-center justify-center rounded-full bg-gradient-to-br text-white ${SHEET_ACCENTS[sheet]}`}
                  >
                    {sheet === 'konum' ? (
                      <MapPin className="h-3.5 w-3.5" />
                    ) : sheet === 'kisi' ? (
                      <UserRound className="h-3.5 w-3.5" />
                    ) : sheet === 'anket' ? (
                      <ListChecks className="h-3.5 w-3.5" />
                    ) : (
                      <CalendarDays className="h-3.5 w-3.5" />
                    )}
                  </span>
                  <span className="font-serif text-xs font-bold text-berry-950">
                    {SHEET_TITLES[sheet]}
                  </span>
                </span>
                <button
                  type="button"
                  onClick={() => setSheet(null)}
                  className="rounded-full p-1 text-stone-400 hover:bg-white"
                  aria-label="Formu kapat"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              {sheet === 'konum' && (
                <div className="space-y-2">
                  <p className="text-[11px] leading-relaxed text-stone-600">
                    Şu anki konumun haritada açılabilir bir kart olarak gönderilsin mi?
                  </p>
                  <div className="flex gap-2">
                    <SheetButton busy={busy} onClick={() => void handleLocation()}>
                      Konumumu gönder
                    </SheetButton>
                    <SheetGhost onClick={() => setSheet(null)}>Vazgeç</SheetGhost>
                  </div>
                </div>
              )}

              {sheet === 'kisi' && (
                <form
                  className="space-y-2"
                  onSubmit={(e) => {
                    e.preventDefault();
                    void handleContact();
                  }}
                >
                  <input
                    type="text"
                    value={contactName}
                    onChange={(e) => setContactName(e.target.value)}
                    placeholder="Ad Soyad"
                    autoComplete="off"
                    className={inputClass}
                  />
                  <input
                    type="tel"
                    value={contactPhone}
                    onChange={(e) => setContactPhone(e.target.value)}
                    placeholder="Telefon numarası"
                    inputMode="tel"
                    autoComplete="off"
                    className={inputClass}
                  />
                  <input
                    type="text"
                    value={contactNote}
                    onChange={(e) => setContactNote(e.target.value)}
                    placeholder="Not (isteğe bağlı)"
                    autoComplete="off"
                    className={inputClass}
                  />
                  <div className="flex gap-2">
                    <SheetButton busy={busy} onClick={() => void handleContact()}>
                      Kişiyi gönder
                    </SheetButton>
                    <SheetGhost onClick={() => setSheet(null)}>Vazgeç</SheetGhost>
                  </div>
                </form>
              )}

              {sheet === 'anket' && (
                <form
                  className="space-y-2"
                  onSubmit={(e) => {
                    e.preventDefault();
                    void handlePoll();
                  }}
                >
                  <input
                    type="text"
                    value={pollQuestion}
                    onChange={(e) => setPollQuestion(e.target.value)}
                    placeholder="Anket sorusu (örn: Bu akşam ne yiyelim?)"
                    autoComplete="off"
                    className={inputClass}
                  />
                  {pollOptions.map((option, index) => (
                    <input
                      key={index}
                      type="text"
                      value={option}
                      onChange={(e) =>
                        setPollOptions((prev) =>
                          prev.map((value, i) => (i === index ? e.target.value : value))
                        )
                      }
                      placeholder={`${index + 1}. seçenek`}
                      autoComplete="off"
                      className={inputClass}
                    />
                  ))}
                  <div className="flex items-center gap-2">
                    {pollOptions.length < 6 && (
                      <button
                        type="button"
                        onClick={() => setPollOptions((prev) => [...prev, ''])}
                        className="rounded-full border border-rose-200 bg-white px-2.5 py-1 text-[10px] font-semibold text-berry-700 active:scale-95"
                      >
                        + Seçenek ekle
                      </button>
                    )}
                    {pollOptions.length > 2 && (
                      <button
                        type="button"
                        onClick={() => setPollOptions((prev) => prev.slice(0, -1))}
                        className="rounded-full border border-rose-200 bg-white px-2.5 py-1 text-[10px] font-semibold text-stone-500 active:scale-95"
                      >
                        – Son seçeneği sil
                      </button>
                    )}
                  </div>
                  <div className="flex gap-2">
                    <SheetButton busy={busy} onClick={() => void handlePoll()}>
                      Anketi gönder
                    </SheetButton>
                    <SheetGhost onClick={() => setSheet(null)}>Vazgeç</SheetGhost>
                  </div>
                </form>
              )}

              {sheet === 'etkinlik' && (
                <form
                  className="space-y-2"
                  onSubmit={(e) => {
                    e.preventDefault();
                    void handleEvent();
                  }}
                >
                  <input
                    type="text"
                    value={eventTitle}
                    onChange={(e) => setEventTitle(e.target.value)}
                    placeholder="Etkinlik adı (örn: Bisiklet turu)"
                    autoComplete="off"
                    className={inputClass}
                  />
                  <div className="grid grid-cols-2 gap-2">
                    <input
                      type="date"
                      value={eventDate}
                      onChange={(e) => setEventDate(e.target.value)}
                      className={inputClass}
                    />
                    <input
                      type="time"
                      value={eventTime}
                      onChange={(e) => setEventTime(e.target.value)}
                      className={inputClass}
                    />
                  </div>
                  <input
                    type="text"
                    value={eventDetails}
                    onChange={(e) => setEventDetails(e.target.value)}
                    placeholder="Nerede / not (isteğe bağlı)"
                    autoComplete="off"
                    className={inputClass}
                  />
                  <div className="flex gap-2">
                    <SheetButton busy={busy} onClick={() => void handleEvent()}>
                      Etkinliği gönder
                    </SheetButton>
                    <SheetGhost onClick={onOpenCinema}>Sinema</SheetGhost>
                  </div>
                </form>
              )}
            </div>
          )}

          {/* ---- Galerideki fotoğraflar: kutuların HEMEN ALTINDA ---- */}
          <div className="mt-3">
            <div className="mb-1.5 flex items-center justify-between">
              <span className="text-[10px] font-bold tracking-wide text-stone-500">
                Galeriden gönder
              </span>
              <button
                type="button"
                onClick={() => {
                  playHaptic(12);
                  onOpenMemories();
                }}
                className="text-[10px] font-semibold text-berry-600"
              >
                Tümü ›
              </button>
            </div>

            {photosLoading ? (
              <div className="grid grid-cols-4 gap-1.5">
                {Array.from({ length: 4 }).map((_, i) => (
                  <div
                    key={i}
                    className="aspect-square animate-pulse rounded-xl bg-rose-100/70"
                  />
                ))}
              </div>
            ) : photos.length === 0 ? (
              <button
                type="button"
                onClick={() => onPickFile('galeri')}
                className="flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-rose-200 bg-rose-50/60 py-3 text-[11px] font-semibold text-berry-600"
              >
                <Images className="h-4 w-4" />
                Galerimizde henüz kare yok — bir tane seç
              </button>
            ) : (
              <div className="grid grid-cols-4 gap-1.5">
                {photos.map((photo) => (
                  <div
                    key={photo.id}
                    className="relative aspect-square overflow-hidden rounded-xl bg-rose-100"
                  >
                    <img
                      src={mediaUrl(photo.thumbnail_url || photo.media_url)}
                      alt={photo.title || 'Anımız'}
                      loading="lazy"
                      decoding="async"
                      className="h-full w-full object-cover"
                      onError={(e) => {
                        // Yüklenemeyen bir kare tüm ızgarayı bozmasın.
                        (e.currentTarget as HTMLImageElement).style.visibility = 'hidden';
                      }}
                    />
                  </div>
                ))}
              </div>
            )}
          </div>

          <p className="mt-2 text-center text-[9.5px] text-stone-400">
            Kapatmak için yukarıdaki tutamağa dokun ya da geri tuşuna bas
          </p>
        </div>
      </ErrorBoundary>
    </div>
  );
};

/* ------------------------------------------------------------------ */
/* Parçalar                                                            */
/* ------------------------------------------------------------------ */

const AttachBox: React.FC<{
  label: string;
  icon: React.ReactNode;
  color: string;
  ring: string;
  onClick: () => void;
  active?: boolean;
  busy?: boolean;
}> = ({ label, icon, color, ring, onClick, active = false, busy = false }) => (
  <button
    type="button"
    onClick={onClick}
    aria-pressed={active}
    aria-label={label}
    className="flex flex-col items-center gap-1 rounded-2xl px-0.5 py-0.5 transition-transform active:scale-95"
  >
    <span
      className={`flex h-[52px] w-[52px] items-center justify-center rounded-full border bg-white shadow-[0_2px_8px_-2px_rgba(190,24,93,0.18)] ${ring} ${color} ${
        active ? 'ring-2 ring-berry-300' : ''
      } ${busy ? 'animate-pulse' : ''}`}
    >
      {icon}
    </span>
    <span className="text-[10.5px] font-medium leading-none text-stone-600">{label}</span>
  </button>
);

const SheetButton: React.FC<{
  busy?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}> = ({ busy, onClick, children }) => (
  <button
    type="button"
    onClick={onClick}
    disabled={busy}
    className="flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-gradient-to-r from-berry-500 to-rose-500 py-2 text-[11px] font-bold text-white shadow-sm shadow-berry-500/25 active:scale-[0.98] disabled:opacity-60"
  >
    {busy ? (
      <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white/40 border-t-white" />
    ) : (
      <Check className="h-3.5 w-3.5" />
    )}
    {children}
  </button>
);

const SheetGhost: React.FC<{ onClick: () => void; children: React.ReactNode }> = ({
  onClick,
  children,
}) => (
  <button
    type="button"
    onClick={onClick}
    className="shrink-0 rounded-xl border border-rose-200 bg-white px-3 py-2 text-[11px] font-semibold text-stone-600 active:scale-[0.98]"
  >
    {children}
  </button>
);

export default ChatAttachPanel;
