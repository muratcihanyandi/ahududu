import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Send, Paperclip, Heart, Play, Pause, Mic, Trash2, Square } from 'lucide-react';
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

export const ChatView: React.FC<ChatViewProps> = ({ currentUserId, partnerName }) => {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [inputText, setInputText] = useState('');
  const [isUploading, setIsUploading] = useState(false);
  const [playingAudioId, setPlayingAudioId] = useState<number | null>(null);
  const audioPlayerRef = useRef<HTMLAudioElement | null>(null);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  /**
   * Android klavyesi açılınca 100dvh küçülmez: klavye WebView'in üstüne biner
   * ve yazma alanı ekranın altında kalır. visualViewport klavye açıldığında
   * gerçek görünür yüksekliği verir, kutuyu ona göre kısaltıyoruz.
   */
  const [keyboardHeight, setKeyboardHeight] = useState(0);

  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;

    const sync = () => {
      // Klavye kapalıyken vv.height ~ window.innerHeight olur.
      const hidden = Math.max(0, window.innerHeight - vv.height);
      setKeyboardHeight(hidden > 100 ? Math.round(hidden) : 0);
    };

    sync();
    vv.addEventListener('resize', sync);
    vv.addEventListener('scroll', sync);
    return () => {
      vv.removeEventListener('resize', sync);
      vv.removeEventListener('scroll', sync);
    };
  }, []);

  /**
   * Mesaj alanını EN ALTA kaydırır.
   *
   * Önemli: animasyonlu (`smooth`) kaydırma sohbet her açıldığında tüm
   * konuşmayı baştan sona "kaydırıp geçiyordu". Artık anında (instant)
   * kaydırıyoruz; ekran doğrudan en alttaki son mesajla açılır.
   */
  const scrollToBottom = useCallback((behavior: ScrollBehavior = 'instant') => {
    const scroller = scrollRef.current;
    if (scroller) {
      scroller.scrollTo({ top: scroller.scrollHeight, behavior });
      return;
    }
    // Yedek: kapsayıcı henüz hazır değilse son çapa öğesine atla.
    messagesEndRef.current?.scrollIntoView({ block: 'end', behavior: 'instant' });
  }, []);

  /** Ekran boyutu / klavye değiştiğinde de en altta kal. */
  useEffect(() => {
    const frame = window.requestAnimationFrame(() => scrollToBottom());
    return () => window.cancelAnimationFrame(frame);
  }, [keyboardHeight, scrollToBottom]);

  /**
   * Sohbet kutusunun boyutu ölçüldüğünde (ilk yerleşim, klavye, döndürme)
   * her seferinde EN ALTA in. Görseller geç yüklendiğinde de konum bozulmaz.
   */
  useEffect(() => {
    const scroller = scrollRef.current;
    if (!scroller || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => scrollToBottom());
    observer.observe(scroller);
    return () => observer.disconnect();
  }, [scrollToBottom]);

  // Klavye açılınca son mesaj görünür kalsın.
  useEffect(() => {
    if (keyboardHeight > 0) scrollToBottom();
  }, [keyboardHeight, scrollToBottom]);

  /**
   * Sohbet penceresinde mevcut mesajları yükle (en alta konumlanır).
   */
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

  /**
   * Mesaj listesi değiştiğinde (yeni mesaj, sesli mesaj, görsel) her zaman
   * en alta in. Ekran sadece kaydırma alanını oynatır; başlık ve yazma alanı sabit.
   */
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
          ? (msg.content || '')
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
    if (!inputText.trim()) return;
    const textToSend = inputText.trim();
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
      const msgType = isVideo ? 'video' : (isAudio ? 'voice' : 'image');

      const newMsg = await api.sendChatMessage({
        sender: currentUserId,
        message_type: msgType,
        media_url: uploadRes.url,
      });

      setMessages((prev) => [...prev, newMsg]);
      scrollToBottom('smooth');
    } catch (err) {
      console.error(err);
      alert('Dosya yüklenemedi.');
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
  const recorderRef = useRef<MediaRecorder | null>(null);
  const recordChunksRef = useRef<Blob[]>([]);
  const recordStreamRef = useRef<MediaStream | null>(null);
  const recordTimerRef = useRef<number | null>(null);
  const recordCancelledRef = useRef(false);
  const recordStartedAtRef = useRef(0);

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
    setIsRecording(false);
    setRecordSeconds(0);
  }, []);

  // Sohbetten çıkılırken kayıt asla takılı kalmasın.
  useEffect(() => () => cancelRecording(), [cancelRecording]);

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
      alert('Sesli mesaj gönderilemedi, tekrar dener misin?');
    } finally {
      setIsUploading(false);
    }
  };

  const startRecording = async () => {
    if (isRecording || isUploading) return;
    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
      alert('Bu cihazda ses kaydı desteklenmiyor.');
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
      const recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);

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
        setIsRecording(false);
        setRecordSeconds(0);

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
    } catch (e) {
      console.error('Mikrofon açılamadı', e);
      releaseStream();
      stopRecordTimer();
      setIsRecording(false);
      alert('Mikrofona erişilemedi. Telefon ayarlarından mikrofon iznini kontrol eder misin?');
    }
  };

  /** Kaydı bitirir: süre yeterliyse gönderir, değilse iptal eder. */
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

  const hasText = inputText.trim().length > 0;

  return (
    /*
     * Sabit sohbet iskeleti:
     * - Başlık ve mesaj yazma alanı asla oynamaz.
     * - Yalnızca ortadaki mesaj listesi kayar.
     * Yükseklik `dvh` ile hesaplanır: mobil tarayıcı çubuğu açılıp kapansa da
     * klavye açıldığında da yazma alanı görünür kalır.
     */
    <div
      ref={containerRef}
      className="flex flex-col bg-white/70 backdrop-blur-md rounded-3xl border border-rose-100 shadow-sm overflow-hidden"
      style={{
        height: keyboardHeight > 0
          ? `calc(100dvh - 210px - ${keyboardHeight}px)`
          : 'calc(100dvh - 210px)',
        minHeight: '240px',
        transition: 'height 120ms ease-out',
      }}
    >
      {/* Header — SABİT */}
      <div className="shrink-0 px-5 py-3.5 bg-rose-50/80 border-b border-rose-100 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-xl">{USERS[partnerOf(currentUserId)].emoji}</span>
          <div>
            <h3 className="font-serif text-sm font-bold text-berry-950">
              {partnerName}
            </h3>
            <span className="text-[10px] text-emerald-600 font-medium flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
              Canlı Bağlantı
            </span>
          </div>
        </div>
      </div>

      {/* Messages Scroll Area — SADECE BURASI KAYAR */}
      <div ref={scrollRef} className="flex-1 min-h-0 overflow-y-auto overscroll-contain p-4 space-y-3">
        {messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center opacity-60">
            <Heart className="w-10 h-10 text-berry-400 mb-2 animate-float" />
            <p className="font-serif text-sm text-stone-600">
              Henüz mesaj yok.
            </p>
          </div>
        ) : (
          messages.map((msg) => {
            const isMe = msg.sender === currentUserId;
            return (
              <div
                key={msg.id}
                className={`flex flex-col ${isMe ? 'items-end' : 'items-start'}`}
              >
                <div
                  className={`max-w-[78%] rounded-2xl px-4 py-2.5 shadow-xs transition-all ${
                    isMe
                      ? 'bg-gradient-to-r from-berry-500 to-rose-500 text-white rounded-br-xs'
                      : 'bg-white border border-rose-100 text-stone-800 rounded-bl-xs'
                  }`}
                >
                  {/* Text Message */}
                  {msg.content && (
                    <p className="text-sm leading-relaxed whitespace-pre-wrap select-text">
                      {msg.content}
                    </p>
                  )}

                  {/* Image Attachment */}
                  {msg.message_type === 'image' && msg.media_url && (
                    <img
                      src={mediaUrl(msg.media_url)}
                      alt="Görsel"
                      className="rounded-xl max-h-56 object-cover mt-1"
                    />
                  )}

                  {/* Video Attachment */}
                  {msg.message_type === 'video' && msg.media_url && (
                    <video
                      src={mediaUrl(msg.media_url)}
                      controls
                      className="rounded-xl max-h-56 w-full mt-1"
                    />
                  )}

                  {/* Voice message (eski telsiz kayıtları da sesli mesaj olarak görünür) */}
                  {(msg.message_type === 'voice' || msg.message_type === 'walkie_talkie') && msg.media_url && (
                    <div className="flex items-center gap-2 mt-1 py-1">
                      <button
                        onClick={() => togglePlayAudio(msg.id, msg.media_url!)}
                        className={`p-2 rounded-full ${
                          isMe ? 'bg-white/20 text-white' : 'bg-rose-100 text-berry-700'
                        }`}
                        aria-label={playingAudioId === msg.id ? 'Duraklat' : 'Dinle'}
                      >
                        {playingAudioId === msg.id ? (
                          <Pause className="w-4 h-4" />
                        ) : (
                          <Play className="w-4 h-4" />
                        )}
                      </button>
                      <span className="flex items-center gap-1.5">
                        <span className="flex items-end gap-[2px] h-4">
                          {[6, 11, 8, 14, 9, 12, 7, 13, 8, 10].map((h, i) => (
                            <span
                              key={i}
                              className={`w-[2px] rounded-full ${
                                isMe ? 'bg-white/70' : 'bg-berry-400/70'
                              }`}
                              style={{ height: `${h}px` }}
                            />
                          ))}
                        </span>
                        <span className="text-[11px] font-semibold tabular-nums">
                          {msg.duration ? formatDuration(msg.duration) : 'Sesli mesaj'}
                        </span>
                      </span>
                    </div>
                  )}

                  {/* Timestamp */}
                  <span
                    className={`block text-[10px] mt-1 text-right ${
                      isMe ? 'text-white/75' : 'text-stone-400'
                    }`}
                  >
                    {new Date(msg.created_at).toLocaleTimeString('tr-TR', {
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </span>
                </div>
              </div>
            );
          })
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Input Bar — SABİT */}
      <div className="shrink-0 p-3 bg-rose-50/50 border-t border-rose-100 flex items-center gap-2">
        <input
          type="file"
          ref={fileInputRef}
          onChange={handleFileUpload}
          accept="image/*,video/*,audio/*"
          className="hidden"
        />

        {isRecording ? (
          <>
            {/* Kayıt sürüyor: süre + iptal + gönder */}
            <button
              onClick={cancelRecording}
              className="p-2.5 rounded-full bg-white hover:bg-rose-100 border border-rose-200/60 text-rose-600 transition-colors"
              title="Kaydı iptal et"
              aria-label="Kaydı iptal et"
            >
              <Trash2 className="w-4 h-4" />
            </button>

            <div className="flex-1 flex items-center gap-2.5 px-4 py-2.5 rounded-full bg-white border border-berry-200">
              <span className="w-2.5 h-2.5 rounded-full bg-rose-500 animate-pulse shrink-0" />
              <span className="text-sm font-semibold text-berry-900 tabular-nums">
                {formatDuration(recordSeconds)}
              </span>
              <span className="flex items-end gap-[2px] h-4 flex-1 overflow-hidden">
                {Array.from({ length: 24 }).map((_, i) => (
                  <span
                    key={i}
                    className="w-[2px] rounded-full bg-berry-300"
                    style={{
                      height: `${6 + ((i * 7 + recordSeconds * 3) % 12)}px`,
                      transition: 'height 120ms ease-out',
                    }}
                  />
                ))}
              </span>
              <span className="text-[10px] font-medium text-stone-500 shrink-0">
                Kayıtta…
              </span>
            </div>

            <button
              onClick={finishRecording}
              className="p-2.5 rounded-full bg-berry-500 hover:bg-berry-600 text-white transition-all shadow-xs shrink-0"
              title="Sesli mesajı gönder"
              aria-label="Sesli mesajı gönder"
            >
              <Send className="w-4 h-4" />
            </button>
          </>
        ) : (
          <>
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={isUploading}
              className="p-2.5 rounded-full bg-white hover:bg-rose-100 border border-rose-200/60 text-stone-600 transition-colors shrink-0"
              title="Fotoğraf veya Video Ekle"
            >
              <Paperclip className="w-4 h-4" />
            </button>

            <input
              type="text"
              placeholder="Mesaj yaz..."
              value={inputText}
              onChange={(e) => setInputText(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSendMessage()}
              className="flex-1 min-w-0 bg-white px-4 py-2.5 rounded-full border border-rose-200/80 text-sm focus:outline-none focus:ring-2 focus:ring-berry-400"
            />

            {/* WhatsApp davranışı: yazı yoksa MİKROFON, yazı varsa GÖNDER */}
            {hasText ? (
              <button
                onClick={handleSendMessage}
                className="p-2.5 rounded-full bg-berry-500 hover:bg-berry-600 text-white transition-all shadow-xs shrink-0 active:scale-95"
                title="Gönder"
                aria-label="Gönder"
              >
                <Send className="w-4 h-4" />
              </button>
            ) : (
              <button
                onClick={startRecording}
                disabled={isUploading}
                className="p-2.5 rounded-full bg-berry-500 hover:bg-berry-600 text-white transition-all shadow-xs shrink-0 active:scale-95 disabled:opacity-50"
                title="Sesli mesaj kaydet (bas ve bırak)"
                aria-label="Sesli mesaj kaydet"
              >
                {isUploading ? <Square className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
              </button>
            )}
          </>
        )}
      </div>
    </div>
  );
};

export default ChatView;
