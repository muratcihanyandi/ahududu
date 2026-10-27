import React, { useState, useRef, useEffect } from 'react';
import { Mic, Radio, Volume2, Square, Sparkles } from 'lucide-react';
import { api } from '../services/api';
import { wsClient } from '../services/websocket';
import { UserId } from '../types';
import { playHaptic, soundEngine, HAPTIC_PATTERNS } from '../services/haptics';

interface WalkieTalkieProps {
  currentUserId: UserId;
  partnerName: string;
}

export const WalkieTalkie: React.FC<WalkieTalkieProps> = ({
  currentUserId,
  partnerName,
}) => {
  const [isRecording, setIsRecording] = useState(false);
  const [isPlayingIncoming, setIsPlayingIncoming] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string>('Telsiz Modu Aktif');
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const recordStartTimeRef = useRef<number>(0);

  // Listen for incoming walkie-talkie audio packets
  useEffect(() => {
    const unsub = wsClient.on('walkie_talkie_play', (data: any) => {
      if (data.audio_base64) {
        playIncomingAudio(data.audio_base64);
      } else if (data.audio_url) {
        const audio = new Audio(data.audio_url);
        audio.play().catch(console.warn);
      }
    });

    return () => unsub();
  }, []);

  const playIncomingAudio = (base64Data: string) => {
    setIsPlayingIncoming(true);
    setStatusMessage(`${partnerName} telsizden konuşuyor... 📻`);
    soundEngine.playWalkieBeep();
    playHaptic(HAPTIC_PATTERNS.attention);

    try {
      const audio = new Audio(`data:audio/webm;base64,${base64Data}`);
      audio.onended = () => {
        setIsPlayingIncoming(false);
        setStatusMessage('Telsiz Beklemede 🎙️');
      };
      audio.play().catch((err) => {
        console.warn('Autoplay error:', err);
        setIsPlayingIncoming(false);
      });
    } catch (e) {
      setIsPlayingIncoming(false);
    }
  };

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      audioChunksRef.current = [];
      recordStartTimeRef.current = Date.now();

      const mediaRecorder = new MediaRecorder(stream);
      mediaRecorderRef.current = mediaRecorder;

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };

      mediaRecorder.onstop = async () => {
        const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
        const durationSec = Math.round((Date.now() - recordStartTimeRef.current) / 1000) || 1;

        // Convert to base64 for instant WebSocket broadcast
        const reader = new FileReader();
        reader.readAsDataURL(audioBlob);
        reader.onloadend = async () => {
          const base64Data = (reader.result as string).split(',')[1];
          wsClient.send({
            type: 'walkie_talkie_audio',
            audio_base64: base64Data,
          });

          // Also upload and persist into chat history
          try {
            const audioFile = new File([audioBlob], `walkie_${Date.now()}.webm`, { type: 'audio/webm' });
            const uploadRes = await api.uploadMedia(audioFile, 'voice');
            await api.sendChatMessage({
              sender: currentUserId,
              message_type: 'walkie_talkie',
              content: '📻 Telsiz Sesli Mesajı',
              media_url: uploadRes.url,
              duration: durationSec,
            });
          } catch (err) {
            console.error('Failed to save walkie audio to chat:', err);
          }
        };

        // Stop all tracks
        stream.getTracks().forEach((t) => t.stop());
      };

      mediaRecorder.start();
      setIsRecording(true);
      setStatusMessage('Konuşuluyor... Bırakınca gönderilir 🎙️');
      playHaptic(30);
      soundEngine.playWalkieBeep();
    } catch (err) {
      console.error('Microphone error:', err);
      alert('Mikrofon izni alınamadı.');
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
      setStatusMessage('Mesaj gönderildi ✨');
      playHaptic(40);
      setTimeout(() => setStatusMessage('Telsiz Beklemede 🎙️'), 2000);
    }
  };

  return (
    <div className="w-full bg-gradient-to-r from-rose-50 to-pink-50 rounded-3xl p-4 border border-rose-200/60 shadow-xs mb-4">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Radio className="w-4 h-4 text-berry-600 animate-pulse" />
          <span className="font-serif text-sm font-bold text-berry-900">
            Canlı Telsiz (Bas-Konuş)
          </span>
        </div>
        <span className="text-[11px] font-medium text-stone-500">
          {isPlayingIncoming ? (
            <span className="text-berry-600 flex items-center gap-1 font-semibold">
              <Volume2 className="w-3.5 h-3.5 animate-bounce" />
              Ses Çalıyor...
            </span>
          ) : (
            statusMessage
          )}
        </span>
      </div>

      {/* Big Push-to-Talk Button */}
      <div className="flex items-center justify-center">
        <button
          onPointerDown={startRecording}
          onPointerUp={stopRecording}
          onPointerLeave={stopRecording}
          className={`flex items-center justify-center gap-3 w-full max-w-xs py-3.5 px-6 rounded-2xl font-serif text-sm font-semibold tracking-wide text-white transition-all shadow-md select-none touch-none ${
            isRecording
              ? 'bg-rose-600 scale-95 ring-4 ring-rose-300'
              : 'bg-gradient-to-r from-berry-500 to-rose-500 hover:from-berry-600 hover:to-rose-600 active:scale-95'
          }`}
        >
          <Mic className={`w-5 h-5 ${isRecording ? 'animate-bounce' : ''}`} />
          <span>{isRecording ? 'Dinleniyor... Bırak Gönder' : 'Basılı Tut & Konuş (Telsiz)'}</span>
        </button>
      </div>
    </div>
  );
};
