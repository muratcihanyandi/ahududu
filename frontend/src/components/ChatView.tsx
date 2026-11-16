import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Send,
  Paperclip,
  Heart,
  Play,
  Pause,
  Mic,
  Trash2,
  Loader2,
} from 'lucide-react';
import { ChatMessage, UserId, USERS, partnerOf } from '../types';
import { api, mediaUrl } from '../services/api';
import { wsClient } from '../services/websocket';
import { playHaptic, soundEngine } from '../services/haptics';
import { clearAllNotifications, notifyMessage } from '../services/notifications';

interface ChatViewProps {
  currentUserId: UserId;
  partnerName: string;
}

/** Ses kaydı için en kısa süre (saniye) — kazara dokunuşlar boşa gitmesin. */
const MIN_VOICE_SECONDS = 1;
/** Ses kaydının üst sınırı (saniye). */
const MAX_VOICE_SECONDS = 120;
/**
 * Bu süreden KISA dokunuş eski "dokun → kaydet → düzenle" moduna geçer.
 * Bu süreden uzun basış WhatsApp gibi "basılı tut → bırakınca gönder" olur.
 */
const TAP_TO_RECORD_MS = 450;
/** Kayıt sırasında sola bu kadar sürükleyince "bırakırsan iptal" durumuna geçilir. */
const CANCEL_DRAG_PX = 60;
/** Kayıt balonunun sola kayabileceği en fazla mesafe (px). */
const MAX_DRAG_PX = 132;

/** Saniyeyi "1:05" biçimine çevirir. */
const formatDuration = (totalSeconds: number): string => {
  const safe = Math.max(0, Math.floor(totalSeconds));
  const minutes = Math.floor(safe / 60);
  const seconds = safe % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
};

/** Tarayıcının desteklediği ses kayıt biçimini seçer. */
const pickAudioMimeType = (): string | undefined => {
  if (typeof MediaRecorder === 'undefined') return undefined;
  const candidates = [
    'audio/webm;codecs=opus',
    'audio/webm',
    'audio/mp4',
    'audio/ogg;codecs=opus',
  ];
  return candidates.find((type) => {
    try {
      return MediaRecorder.isTypeSupported(type);
    } catch {
      return false;
    }
  });
};

/** Mesaj ayırıcısında gösterilecek gün etiketi ("Bugün", "Dün", "12 Kasım"). */
const dayLabel = (date: Date): string => {
  const today = new Date();
  const startOfDay = (d: Date) =>
    new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const diffDays = Math.round((startOfDay(today) - startOfDay(date)) / 86400000);
  if (diffDays === 0) return 'Bugün';
  if (diffDays === 1) return 'Dün';
  return date.toLocaleDateString('tr-TR', { day: 'numeric', month: 'long' });
};

/** Baloncuklar arasına giren romantik gün ayırıcısı. */
const DayDivider: React.FC<{ date: Date }> = ({ date }) => (
  <div className="flex items-center justify-center py-1.5">
    <span className="rounded-full border border-rose-100 bg-white/85 px-3 py-1 text-[10px] font-semibold text-berry-700/80 shadow-[0_1px_2px_rgba(190,24,93,0.05)] backdrop-blur-xs">
      {dayLabel(date)}
    </span>
  </div>
);

/** Kayıt sırasında oynayan minik dalga. */
const RecordingWave: React.FC = () => (
  <span className="flex h-5 flex-1 items-end justify-center gap-[3px] overflow-hidden">
    {Array.from({ length: 26 }).map((_, i) => (
      <span
        key={i}
        className="chat-wave__bar w-[2px] rounded-full bg-gradient-to-t from-berry-400 to-rose-400"
        style={{
          height: `${9 + ((i * 5) % 11)}px`,
          animationDelay: `${(i % 9) * 70}ms`,
          animationDuration: `${760 + (i % 4) * 110}ms`,
        }}
      />
    ))}
  </span>
);

export const ChatView: React.FC<ChatViewProps> = ({
  currentUserId,
  partnerName,
}) => {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [inputText, setInputText] = useState('');
  const [isUploading, setIsUploading] = useState(false);
  const [playingAudioId, setPlayingAudioId] = useState<number | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const audioPlayerRef = useRef<HTMLAudioElement | null>(null);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const atBottomRef = useRef(true);
  const toastTimerRef = useRef<number | null>(null);

  /** Kısa bir bilgi baloncuğu göster (teknik terimsiz, sıcak dil). */
  const showToast = useCallback((text: string) => {
    setToast(text);
    if (toastTimerRef.current !== null) window.clearTimeout(toastTimerRef.current);
    toastTimerRef.current = window.setTimeout(() => setToast(null), 2600);
  }, []);

  useEffect(
    () => () => {
      if (toastTimerRef.current !== null) window.clearTimeout(toastTimerRef.current);
    },
    []
  );

  /* ------------------------------------------------------------------ */
  /* Klavye: chat kökü parent'ın kısıtladığı alanı doldurur; klavye     */
  /* açılınca composer ekranın altında kalmasın diye görünür alanın     */
  /* dışında kalan kısmı root'a paddingBottom olarak veriyoruz.         */
  /* ------------------------------------------------------------------ */
  const [keyboardInset, setKeyboardInset] = useState(0);

  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    let frame = 0;

    const measure = () => {
      const el = containerRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const visibleBottom = vv.offsetTop + vv.height;
      const overlap = Math.round(rect.bottom - visibleBottom);
      // Küçük farklar (adres çubuğu vb.) klavye sayılmasın.
      setKeyboardInset(overlap > 80 ? overlap : 0);
    };

    const schedule = () => {
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(measure);
    };

    schedule();
    vv.addEventListener('resize', schedule);
    vv.addEventListener('scroll', schedule);
    window.addEventListener('orientationchange', schedule);

    let observer: ResizeObserver | null = null;
    if (typeof ResizeObserver !== 'undefined' && containerRef.current) {
      observer = new ResizeObserver(schedule);
      observer.observe(containerRef.current);
    }

    return () => {
      window.cancelAnimationFrame(frame);
      vv.removeEventListener('resize', schedule);
      vv.removeEventListener('scroll', schedule);
      window.removeEventListener('orientationchange', schedule);
      observer?.disconnect();
    };
  }, []);

  /**
   * Mesaj alanını EN ALTA kaydırır.
   *
   * Animasyonlu (`smooth`) kaydırma sohbet her açıldığında tüm konuşmayı
   * baştan sona kaydırıyordu. Bu yüzden anında kaydırıyoruz; ekran doğrudan
   * en alttaki son mesajla açılır.
   */
  const scrollToBottom = useCallback(
    (behavior: ScrollBehavior = 'instant') => {
      const scroller = scrollRef.current;
      if (scroller) {
        scroller.scrollTo({ top: scroller.scrollHeight, behavior });
        return;
      }
      messagesEndRef.current?.scrollIntoView({ block: 'end', behavior: 'instant' });
    },
    []
  );

  /** Kullanıcı en altta mı? (yukarıdaysa zıplamayalım) */
  const handleListScroll = useCallback(() => {
    const scroller = scrollRef.current;
    if (!scroller) return;
    atBottomRef.current =
      scroller.scrollHeight - scroller.clientHeight - scroller.scrollTop < 56;
  }, []);

  /** Klavye açılıp kapandığında son mesaj görünür kalsın. */
  useEffect(() => {
    const frame = window.requestAnimationFrame(() => scrollToBottom());
    return () => window.cancelAnimationFrame(frame);
  }, [keyboardInset, scrollToBottom]);

  /** Liste boyutu değişince (görsel yüklendi, klavye açıldı) dipte kal. */
  useEffect(() => {
    const scroller = scrollRef.current;
    if (!scroller || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => {
      if (atBottomRef.current) scrollToBottom();
    });
    observer.observe(scroller);
    return () => observer.disconnect();
  }, [scrollToBottom]);

  /** Sohbet açıldığında bekleyen bildirimler temizlenir. */
  useEffect(() => {
    void clearAllNotifications();
  }, []);

  /** Sohbet penceresinde mevcut mesajları yükle (en alta konumlanır). */
  const loadMessages = useCallback(async () => {
    try {
      const data = await api.getChatMessages(50);
      const list = Array.isArray(data) ? data : [];
      setMessages(list);
      // İki aşamalı: yerleşim oturduktan sonra da en alta in.
      window.requestAnimationFrame(() => scrollToBottom());
      window.setTimeout(() => scrollToBottom(), 120);
    } catch (e) {
      console.error(e);
    }
  }, [scrollToBottom]);

  useEffect(() => {
    loadMessages();

    // Subscribe to new incoming chat messages
    const unsub = wsClient.on('new_chat_message', (data: any) => {
      if (data.message) {
        // Aynı mesaj iki kez eklenmesin (kendi gönderdiğimizin yankısı ya da
        // yeniden bağlanma sonrası tekrar gelen olay).
        setMessages((prev) =>
          prev.some((m) => m.id === data.message.id) ? prev : [...prev, data.message]
        );
        soundEngine.playLoveChime();
        scrollToBottom('smooth');
        // Uygulama arka plandaysa sistem bildirimi goster.
        void maybeNotify(data.message);
      }
    });
    return () => unsub();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadMessages, scrollToBottom]);

  /** Mesaj listesi değiştiğinde (yeni mesaj, sesli mesaj, görsel) dipte kal. */
  useEffect(() => {
    if (!messages.length) return;
    const frame = window.requestAnimationFrame(() => scrollToBottom());
    const timer = window.setTimeout(() => scrollToBottom(), 160);
    return () => {
      window.cancelAnimationFrame(frame);
      window.clearTimeout(timer);
    };
  }, [messages.length, scrollToBottom]);

  /**
   * Yalnızca uygulama GÖRÜNÜR DEĞİLKEN bildirim göster; kullanıcı sohbete
   * bakıyorsa gereksiz bildirim çıkmasın.
   */
  const maybeNotify = async (msg: ChatMessage) => {
    try {
      if (typeof document !== 'undefined' && document.visibilityState === 'visible') return;
      if (msg.sender === currentUserId) return;
      const body =
        msg.message_type === 'text'
          ? msg.content || ''
          : msg.message_type === 'image'
            ? '📷 Fotoğraf gönderdi'
            : msg.message_type === 'video'
              ? '🎬 Video gönderdi'
              : '🎙️ Sesli mesaj gönderdi';
      await notifyMessage({
        title: partnerName,
        body: body.slice(0, 120),
        groupKey: 'chat-' + msg.sender,
      });
    } catch {
      /* yok say */
    }
  };

  const handleSendMessage = async () => {
    const textToSend = inputText.trim();
    if (!textToSend) return;
    setInputText('');
    playHaptic(25);

    try {
      const newMsg = await api.sendChatMessage({
        sender: currentUserId,
        message_type: 'text',
        content: textToSend,
      });
      setMessages((prev) => [...prev, newMsg]);
      scrollToBottom('smooth');
    } catch (e) {
      console.error(e);
      showToast('Mesaj gitmedi, bir daha dener misin? 💌');
    }
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    const file = files[0];
    setIsUploading(true);

    try {
      const uploadRes = await api.uploadMedia(file, 'chat');
      const isVideo = file.type.startsWith('video');
      const isAudio = file.type.startsWith('audio');
      const msgType = isVideo ? 'video' : isAudio ? 'voice' : 'image';

      const newMsg = await api.sendChatMessage({
        sender: currentUserId,
        message_type: msgType,
        media_url: uploadRes.url,
      });

      setMessages((prev) => [...prev, newMsg]);
      scrollToBottom('smooth');
    } catch (err) {
      console.error(err);
      showToast('Dosya yüklenemedi, tekrar dener misin?');
    } finally {
      setIsUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  /* ------------------------------------------------------------------ */
  /* Sesli mesaj (WhatsApp gibi: yazı yoksa mikrofon, yazı varsa Gönder) */
  /* ------------------------------------------------------------------ */

  const [isRecording, setIsRecording] = useState(false);
  const [recordSeconds, setRecordSeconds] = useState(0);
  /** Kısa dokunuşla açılan "düzenle ve gönder" modu. */
  const [tapMode, setTapMode] = useState(false);
  /** Mikrofon şu an parmak altında mı? */
  const [pressActive, setPressActive] = useState(false);
  /** Sola sürükleme mesafesi (negatif px). */
  const [dragX, setDragX] = useState(0);
  /** Bırakınca iptal olacak mı? */
  const [cancelArmed, setCancelArmed] = useState(false);

  const recorderRef = useRef<MediaRecorder | null>(null);
  const recordChunksRef = useRef<Blob[]>([]);
  const recordStreamRef = useRef<MediaStream | null>(null);
  const recordTimerRef = useRef<number | null>(null);
  const recordCancelledRef = useRef(false);
  const recordStartedAtRef = useRef(0);
  const cancelArmedRef = useRef(false);

  /** Mikrofon basış takibi (hold-to-send / tap-to-record ayrımı). */
  const pressRef = useRef<{
    pointerId: number;
    startX: number;
    startedAt: number;
  } | null>(null);
  /**
   * Parmak kayıt hazır olmadan kalkarsa niyeti burada tutuyoruz;
   * kayıt başlar başlamaz uygulanır (izin penceresi gecikmesi için).
   */
  const pendingReleaseRef = useRef<{
    action: 'tap' | 'hold' | 'cancel';
    elapsed: number;
  } | null>(null);

  const stopRecordTimer = () => {
    if (recordTimerRef.current !== null) {
      window.clearInterval(recordTimerRef.current);
      recordTimerRef.current = null;
    }
  };

  const releaseStream = () => {
    recordStreamRef.current?.getTracks().forEach((track) => {
      try {
        track.stop();
      } catch {
        /* yok say */
      }
    });
    recordStreamRef.current = null;
  };

  const resetRecordingUi = useCallback(() => {
    setIsRecording(false);
    setRecordSeconds(0);
    setTapMode(false);
    setPressActive(false);
    setDragX(0);
    setCancelArmed(false);
    cancelArmedRef.current = false;
    pressRef.current = null;
  }, []);

  const cancelRecording = useCallback(() => {
    recordCancelledRef.current = true;
    const recorder = recorderRef.current;
    if (recorder && recorder.state !== 'inactive') {
      try {
        recorder.stop();
      } catch {
        /* yok say */
      }
    }
    stopRecordTimer();
    releaseStream();
    recorderRef.current = null;
    recordChunksRef.current = [];
    resetRecordingUi();
  }, [resetRecordingUi]);

  // Sohbetten çıkılırken kayıt asla takılı kalmasın.
  useEffect(() => () => cancelRecording(), [cancelRecording]);

  // Sayfa arka plana giderse kayıt sessizce bitsin (mikrofon açık kalmasın).
  useEffect(() => {
    const onHidden = () => {
      if (document.visibilityState === 'hidden' && recorderRef.current) {
        cancelRecording();
      }
    };
    document.addEventListener('visibilitychange', onHidden);
    return () => document.removeEventListener('visibilitychange', onHidden);
  }, [cancelRecording]);

  const sendVoiceMessage = async (blob: Blob, seconds: number) => {
    if (blob.size < 400 || seconds < MIN_VOICE_SECONDS) return;
    setIsUploading(true);
    playHaptic(25);
    try {
      const ext = blob.type.includes('mp4') ? 'm4a' : 'webm';
      const file = new File([blob], `sesli-mesaj-${Date.now()}.${ext}`, {
        type: blob.type || 'audio/webm',
      });
      const upload = await api.uploadMedia(file, 'chat');
      const newMsg = await api.sendChatMessage({
        sender: currentUserId,
        message_type: 'voice',
        media_url: upload.url,
        duration: Math.max(1, Math.round(seconds)),
      });
      setMessages((prev) => [...prev, newMsg]);
      scrollToBottom('smooth');
    } catch (e) {
      console.error('Sesli mesaj gönderilemedi', e);
      showToast('Sesli mesaj gitmedi, bir daha dener misin?');
    } finally {
      setIsUploading(false);
    }
  };

  const startRecording = async () => {
    if (isRecording || isUploading) return;
    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
      showToast('Bu cihazda ses kaydı olmuyor.');
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
      const mimeType = pickAudioMimeType();
      const recorder = mimeType
        ? new MediaRecorder(stream, { mimeType })
        : new MediaRecorder(stream);

      recordStreamRef.current = stream;
      recordChunksRef.current = [];
      recordCancelledRef.current = false;
      recordStartedAtRef.current = Date.now();

      recorder.ondataavailable = (event) => {
        if (event.data && event.data.size > 0) recordChunksRef.current.push(event.data);
      };

      recorder.onstop = () => {
        const elapsed = (Date.now() - recordStartedAtRef.current) / 1000;
        const chunks = recordChunksRef.current.slice();
        const type = recorder.mimeType || mimeType || 'audio/webm';
        recordChunksRef.current = [];
        recorderRef.current = null;
        releaseStream();
        stopRecordTimer();
        resetRecordingUi();

        if (recordCancelledRef.current) {
          recordCancelledRef.current = false;
          return;
        }
        if (chunks.length) {
          void sendVoiceMessage(new Blob(chunks, { type }), elapsed);
        }
      };

      recorderRef.current = recorder;
      recorder.start();
      setIsRecording(true);
      setRecordSeconds(0);
      playHaptic(20);

      recordTimerRef.current = window.setInterval(() => {
        const elapsed = Math.floor((Date.now() - recordStartedAtRef.current) / 1000);
        setRecordSeconds(elapsed);
        // Üst sınır: otomatik olarak gönder.
        if (elapsed >= MAX_VOICE_SECONDS) {
          const active = recorderRef.current;
          if (active && active.state !== 'inactive') {
            try {
              active.stop();
            } catch {
              /* yok say */
            }
          }
        }
      }, 250);

      // Parmak kayıt hazır olmadan kalktıysa niyeti şimdi uygula.
      const pending = pendingReleaseRef.current;
      pendingReleaseRef.current = null;
      if (pending) {
        if (pending.action === 'cancel') {
          cancelRecording();
        } else if (pending.action === 'tap') {
          setTapMode(true);
        } else {
          releaseRecording(pending.elapsed);
        }
      }
    } catch (e) {
      console.error('Mikrofon açılamadı', e);
      pendingReleaseRef.current = null;
      releaseStream();
      stopRecordTimer();
      resetRecordingUi();
      showToast('Mikrofona ulaşamadık, izni kontrol eder misin?');
    }
  };

  /** Basılı tutup bırakınca: süre yeterliyse gönder. */
  const releaseRecording = (elapsedSec: number) => {
    const recorder = recorderRef.current;
    if (!recorder) return;
    if (elapsedSec < MIN_VOICE_SECONDS) {
      // Çok kısa: WhatsApp gibi sessizce sil.
      cancelRecording();
      playHaptic(15);
      showToast('Çok kısa oldu 💔');
      return;
    }
    if (recorder.state !== 'inactive') {
      try {
        recorder.stop();
      } catch {
        /* yok say */
      }
    }
  };

  /** Eski davranış (tap-to-record): süre + sil + gönder. */
  const finishRecording = () => {
    const recorder = recorderRef.current;
    if (!recorder) return;
    recordCancelledRef.current = false;
    const elapsed = (Date.now() - recordStartedAtRef.current) / 1000;
    if (elapsed < MIN_VOICE_SECONDS) {
      // Mikrofon açılması çağrıyı hafifçe geciktirmiş olabilir.
      window.setTimeout(() => {
        const still = recorderRef.current;
        if (still && still.state !== 'inactive') {
          try {
            still.stop();
          } catch {
            /* yok say */
          }
        }
      }, Math.max(0, (MIN_VOICE_SECONDS - elapsed) * 1000));
    } else if (recorder.state !== 'inactive') {
      try {
        recorder.stop();
      } catch {
        /* yok say */
      }
    }
  };

  /* ------------------------- Mikrofon jestleri ------------------------- */

  /**
   * Jest dinleyicileri pencerede tutulur.
   * Sebep: kayıt başlayınca mikrofon düğmesi yerini kayıt balonuna bırakır ve
   * düğüm DOM'dan kalkar; düğmeye bağlı pointer olayları o an kaybolur ama
   * parmak hâlâ ekrandadır. Bu yüzden basış/parmak kaldırma pencereden
   * dinlenir; jest her koşulda doğru biter (WhatsApp davranışı).
   */
  const gestureCleanupRef = useRef<(() => void) | null>(null);

  const detachGestureListeners = () => {
    gestureCleanupRef.current?.();
    gestureCleanupRef.current = null;
  };

  useEffect(
    () => () => {
      gestureCleanupRef.current?.();
      gestureCleanupRef.current = null;
    },
    []
  );

  /** Parmak kalktı: kısa dokunuş mu, basılı tutup gönderme mi, iptal mi? */
  const finishMicGesture = () => {
    const press = pressRef.current;
    if (!press) return;
    pressRef.current = null;
    const elapsed = (Date.now() - press.startedAt) / 1000;
    const armed = cancelArmedRef.current;
    const shortTap = elapsed * 1000 < TAP_TO_RECORD_MS;
    setPressActive(false);
    setDragX(0);

    if (!recorderRef.current) {
      // Kayıt henüz hazır değil: niyeti sakla, kayıt başlayınca uygula.
      pendingReleaseRef.current = {
        action: armed ? 'cancel' : shortTap ? 'tap' : 'hold',
        elapsed,
      };
      return;
    }

    if (armed) {
      cancelArmedRef.current = false;
      setCancelArmed(false);
      cancelRecording();
      playHaptic(15);
      showToast('Sesli mesaj silindi');
      return;
    }
    if (shortTap) {
      // Kısa dokunuş: kayıt devam eder, süre + sil + gönder arayüzü açılır.
      setTapMode(true);
      return;
    }
    // Basılı tut → bırak → otomatik gönder.
    setCancelArmed(false);
    cancelArmedRef.current = false;
    releaseRecording(elapsed);
  };

  /** Jest yarıda kesildi (arama, sistem kesmesi): kaydı temizle. */
  const abortMicGesture = () => {
    const hadPress = Boolean(pressRef.current);
    pressRef.current = null;
    pendingReleaseRef.current = null;
    setPressActive(false);
    setDragX(0);
    setCancelArmed(false);
    cancelArmedRef.current = false;
    if (hadPress && recorderRef.current) cancelRecording();
  };

  const handleMicPointerDown = (e: React.PointerEvent<HTMLButtonElement>) => {
    if (isRecording || isUploading) return;
    e.preventDefault();
    const pointerId = e.pointerId;

    detachGestureListeners();
    pressRef.current = {
      pointerId,
      startX: e.clientX,
      startedAt: Date.now(),
    };
    pendingReleaseRef.current = null;
    cancelArmedRef.current = false;
    setTapMode(false);
    setPressActive(true);
    setDragX(0);
    setCancelArmed(false);

    const onMove = (ev: PointerEvent) => {
      const press = pressRef.current;
      if (!press || press.pointerId !== pointerId) return;
      const dx = Math.max(-MAX_DRAG_PX, Math.min(0, ev.clientX - press.startX));
      setDragX(dx);
      const armed = dx <= -CANCEL_DRAG_PX;
      if (armed !== cancelArmedRef.current) {
        cancelArmedRef.current = armed;
        setCancelArmed(armed);
        if (armed) playHaptic(12);
      }
    };
    const onUp = (ev: PointerEvent) => {
      if (ev.pointerId !== pointerId) return;
      detachGestureListeners();
      finishMicGesture();
    };
    const onCancel = (ev: PointerEvent) => {
      if (ev.pointerId !== pointerId) return;
      detachGestureListeners();
      abortMicGesture();
    };
    const onContextMenu = (ev: Event) => ev.preventDefault();

    window.addEventListener('pointermove', onMove, true);
    window.addEventListener('pointerup', onUp, true);
    window.addEventListener('pointercancel', onCancel, true);
    window.addEventListener('contextmenu', onContextMenu, true);
    gestureCleanupRef.current = () => {
      window.removeEventListener('pointermove', onMove, true);
      window.removeEventListener('pointerup', onUp, true);
      window.removeEventListener('pointercancel', onCancel, true);
      window.removeEventListener('contextmenu', onContextMenu, true);
    };

    void startRecording();
  };

  /* ------------------------------ Oynatma ------------------------------ */

  const togglePlayAudio = (id: number, url: string) => {
    if (playingAudioId === id) {
      audioPlayerRef.current?.pause();
      setPlayingAudioId(null);
    } else {
      if (audioPlayerRef.current) {
        audioPlayerRef.current.pause();
      }
      const audio = new Audio(mediaUrl(url));
      audioPlayerRef.current = audio;
      audio.onended = () => setPlayingAudioId(null);
      audio.play().catch(console.warn);
      setPlayingAudioId(id);
    }
  };

  useEffect(
    () => () => {
      audioPlayerRef.current?.pause();
    },
    []
  );

  const hasText = inputText.trim().length > 0;
  const showTapControls = isRecording && tapMode;
  const dragProgress = Math.min(1, Math.abs(dragX) / CANCEL_DRAG_PX);

  return (
    /*
     * Tam ekran sohbet iskeleti (WhatsApp gibi):
     * - Yükseklik PARENT'tan gelir (flex-1 min-h-0); kendi height hesabı YOK.
     * - Başlık ve yazma alanı sabit, YALNIZCA mesaj listesi kayar.
     */
    <div
      ref={containerRef}
      data-chat-root="true"
      className="relative flex min-h-0 min-w-0 w-full flex-1 flex-col overflow-hidden bg-white transition-[padding-bottom] duration-150 ease-out"
      style={keyboardInset > 0 ? { paddingBottom: keyboardInset } : undefined}
    >
      {/* Başlık — SABİT, uygulama başlığının (Ahududu) hemen altına yapışık */}
      <div className="shrink-0 flex items-center gap-2.5 border-b border-rose-100/80 bg-white/95 px-4 py-2.5 backdrop-blur-md">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-rose-200/80 bg-gradient-to-br from-rose-100 via-pink-50 to-berry-100 text-lg shadow-[0_1px_3px_rgba(190,24,93,0.12)]">
          {USERS[partnerOf(currentUserId)].emoji}
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="truncate font-serif text-sm font-bold text-berry-950">
            {partnerName}
          </h3>
          <span className="flex items-center gap-1 text-[10px] font-medium text-berry-600/90">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 shadow-[0_0_0_2px_rgba(16,185,129,0.15)]" />
            Kalplerimiz bağlı
          </span>
        </div>
        <Heart
          className="h-4 w-4 shrink-0 text-rose-300"
          fill="currentColor"
          aria-hidden="true"
        />
      </div>

      {/* Mesaj listesi — YALNIZCA BURASI KAYAR.
          WhatsApp gibi: konuşma az olsa da EN ALTTAKİ mesaja yaslanır
          (inner wrapper + mt-auto). Taşınca üstteki mesajlar kaydırmayla erişilir. */}
      <div
        ref={scrollRef}
        onScroll={handleListScroll}
        className="chat-canvas flex flex-1 min-h-0 flex-col overflow-y-auto overscroll-contain px-3.5 py-3"
      >
        {messages.length === 0 ? (
          <div className="flex flex-1 flex-col items-center justify-center text-center opacity-70">
            <Heart className="mb-2 h-10 w-10 animate-float text-berry-400" />
            <p className="font-serif text-sm font-semibold text-berry-900">
              İlk mesajı sen yaz
            </p>
            <p className="mt-0.5 text-[11px] text-stone-500">
              Burada sadece ikimiz varız 💞
            </p>
          </div>
        ) : (
          <div className="mt-auto flex w-full flex-col">
            {messages.map((msg, index) => {
            const isMe = msg.sender === currentUserId;
            const created = new Date(msg.created_at);
            const prev = index > 0 ? new Date(messages[index - 1].created_at) : null;
            const showDay = !prev || prev.toDateString() !== created.toDateString();
            const isVoice =
              (msg.message_type === 'voice' || msg.message_type === 'walkie_talkie') &&
              Boolean(msg.media_url);

            return (
              <React.Fragment key={msg.id}>
                {showDay && <DayDivider date={created} />}

                <div
                  className={`mb-2 flex flex-col ${
                    isMe ? 'items-end' : 'items-start'
                  } animate-[popIn_0.18s_ease-out]`}
                >
                  <div
                    className={`max-w-[80%] rounded-2xl px-3.5 py-2 shadow-[0_1px_3px_rgba(190,24,93,0.08)] ${
                      isMe
                        ? 'rounded-br-md bg-gradient-to-br from-berry-500 to-rose-500 text-white'
                        : 'rounded-bl-md border border-rose-100/90 bg-white text-stone-800'
                    }`}
                  >
                    {/* Metin */}
                    {msg.content && (
                      <p className="select-text whitespace-pre-wrap text-[13.5px] leading-relaxed">
                        {msg.content}
                      </p>
                    )}

                    {/* Fotoğraf */}
                    {msg.message_type === 'image' && msg.media_url && (
                      <img
                        src={mediaUrl(msg.media_url)}
                        alt="Fotoğraf"
                        className="mt-1 max-h-56 rounded-xl object-cover"
                      />
                    )}

                    {/* Video */}
                    {msg.message_type === 'video' && msg.media_url && (
                      <video
                        src={mediaUrl(msg.media_url)}
                        controls
                        className="mt-1 max-h-56 w-full rounded-xl"
                      />
                    )}

                    {/* Sesli mesaj */}
                    {isVoice && msg.media_url && (
                      <div className="mt-1 flex items-center gap-2 py-0.5">
                        <button
                          onClick={() => togglePlayAudio(msg.id, msg.media_url!)}
                          className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full transition-transform active:scale-90 ${
                            isMe
                              ? 'bg-white/25 text-white'
                              : 'bg-rose-100 text-berry-700'
                          }`}
                          aria-label={
                            playingAudioId === msg.id ? 'Duraklat' : 'Dinle'
                          }
                        >
                          {playingAudioId === msg.id ? (
                            <Pause className="h-4 w-4" />
                          ) : (
                            <Play className="h-4 w-4" />
                          )}
                        </button>
                        <span className="flex h-4 items-end gap-[2px]">
                          {[6, 11, 8, 14, 9, 12, 7, 13, 8, 10].map((h, i) => (
                            <span
                              key={i}
                              className={`w-[2px] rounded-full ${
                                isMe ? 'bg-white/75' : 'bg-berry-400/70'
                              }`}
                              style={{ height: `${h}px` }}
                            />
                          ))}
                        </span>
                        <span className="shrink-0 text-[11px] font-semibold tabular-nums">
                          {msg.duration ? formatDuration(msg.duration) : 'Sesli mesaj'}
                        </span>
                      </div>
                    )}

                    {/* Saat */}
                    <span
                      className={`mt-0.5 block text-right text-[10px] tabular-nums ${
                        isMe ? 'text-white/75' : 'text-stone-400'
                      }`}
                    >
                      {created.toLocaleTimeString('tr-TR', {
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </span>
                  </div>
                </div>
              </React.Fragment>
            );
            })}
            <div ref={messagesEndRef} />
          </div>
        )}
      </div>

      {/* Yazma alanı — SABİT, alt navigasyona yapışık */}
      <div
        className={`relative shrink-0 border-t border-rose-100/80 bg-white/95 px-2.5 py-2 backdrop-blur-md transition-colors duration-150 ${
          cancelArmed ? 'bg-rose-50' : ''
        }`}
      >
        <input
          type="file"
          ref={fileInputRef}
          onChange={handleFileUpload}
          accept="image/*,video/*,audio/*"
          className="hidden"
        />

        {isRecording ? (
          <div className="relative flex items-center gap-2">
            {/* Sola sürüklerken ortaya çıkan çöp hedefi */}
            {pressActive && (
              <div
                className="pointer-events-none absolute left-0.5 top-1/2 z-10 flex h-10 w-10 items-center justify-center rounded-full bg-rose-500 text-white shadow-lg shadow-rose-500/30"
                style={{
                  opacity: dragProgress,
                  transform: `translateY(-50%) scale(${0.55 + dragProgress * 0.45})`,
                  transition: 'opacity 90ms linear, transform 90ms linear',
                }}
              >
                <Trash2 className="h-4 w-4" />
              </div>
            )}

            {showTapControls && (
              <button
                onClick={cancelRecording}
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-rose-200/70 bg-white text-rose-600 transition-colors hover:bg-rose-50 active:scale-95"
                title="Kaydı sil"
                aria-label="Kaydı iptal et"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            )}

            <div
              className={`flex min-w-0 flex-1 items-center gap-2.5 rounded-full border px-4 py-2.5 transition-colors duration-150 ${
                cancelArmed
                  ? 'border-rose-300 bg-rose-100/90'
                  : 'border-berry-200/80 bg-white shadow-[0_1px_3px_rgba(190,24,93,0.08)]'
              }`}
              style={{
                transform: `translateX(${dragX * 0.45}px)`,
                transition: pressActive
                  ? 'background-color 120ms ease-out'
                  : 'transform 160ms ease-out, background-color 120ms ease-out',
              }}
            >
              <span
                className={`h-2.5 w-2.5 shrink-0 rounded-full ${
                  cancelArmed ? 'bg-rose-600' : 'chat-rec-dot bg-rose-500'
                }`}
              />
              <span className="shrink-0 text-sm font-semibold tabular-nums text-berry-900">
                {formatDuration(recordSeconds)}
              </span>

              {cancelArmed ? (
                <span className="min-w-0 flex-1 truncate text-[11px] font-semibold text-rose-700">
                  Bırakırsan iptal olur
                </span>
              ) : (
                <RecordingWave />
              )}

              <span className="shrink-0 text-[9.5px] font-medium text-stone-500">
                {pressActive ? 'Bırak = gönder' : tapMode ? 'Hazır olunca gönder' : 'Kayıtta…'}
              </span>
            </div>

            {showTapControls && (
              <button
                onClick={finishRecording}
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-berry-500 text-white shadow-md shadow-berry-500/25 transition-transform active:scale-95"
                title="Sesli mesajı gönder"
                aria-label="Sesli mesajı gönder"
              >
                <Send className="h-4 w-4" />
              </button>
            )}
          </div>
        ) : (
          <div className="flex items-center gap-2">
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={isUploading}
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-rose-200/60 bg-white text-stone-500 transition-colors hover:bg-rose-50 disabled:opacity-50"
              title="Fotoğraf veya video ekle"
              aria-label="Fotoğraf veya video ekle"
            >
              <Paperclip className="h-4 w-4" />
            </button>

            <input
              type="text"
              placeholder="Mesaj yaz..."
              value={inputText}
              enterKeyHint="send"
              onChange={(e) => setInputText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  void handleSendMessage();
                }
              }}
              className="h-10 min-w-0 flex-1 rounded-full border border-rose-200/80 bg-white px-4 text-sm text-stone-800 placeholder:text-stone-400 focus:border-berry-300 focus:outline-none focus:ring-2 focus:ring-berry-300/40"
            />

            {/* WhatsApp davranışı: yazı yoksa MİKROFON, yazı varsa GÖNDER */}
            {hasText ? (
              <button
                onClick={handleSendMessage}
                disabled={isUploading}
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-berry-500 to-rose-500 text-white shadow-md shadow-berry-500/30 transition-transform active:scale-95 disabled:opacity-50"
                title="Gönder"
                aria-label="Gönder"
              >
                {isUploading ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Send className="h-4 w-4" />
                )}
              </button>
            ) : (
              <button
                type="button"
                onPointerDown={handleMicPointerDown}
                onContextMenu={(e) => e.preventDefault()}
                disabled={isUploading}
                className="flex h-10 w-10 shrink-0 select-none items-center justify-center rounded-full bg-gradient-to-br from-berry-500 to-rose-500 text-white shadow-md shadow-berry-500/30 transition-transform active:scale-95 disabled:opacity-50"
                style={{ touchAction: 'none', WebkitTouchCallout: 'none' }}
                title="Basılı tut, bırakınca gönder"
                aria-label="Sesli mesaj kaydet"
              >
                {isUploading ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Mic className="h-4 w-4" />
                )}
              </button>
            )}
          </div>
        )}
      </div>

      {/* Kısa bilgi baloncuğu */}
      {toast && (
        <div className="pointer-events-none absolute inset-x-4 bottom-20 z-20 flex justify-center">
          <div className="animate-[fadeIn_0.2s_ease-out] rounded-full bg-berry-900/95 px-4 py-2 text-center text-[11px] font-semibold text-white shadow-xl shadow-berry-900/25">
            {toast}
          </div>
        </div>
      )}
    </div>
  );
};

export default ChatView;
