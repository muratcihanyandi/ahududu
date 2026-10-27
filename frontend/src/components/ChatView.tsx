import React, { useState, useEffect, useRef } from 'react';
import { Send, Image, Mic, Film, Paperclip, Heart, Play, Pause } from 'lucide-react';
import { ChatMessage, UserId } from '../types';
import { api } from '../services/api';
import { wsClient } from '../services/websocket';
import { playHaptic, soundEngine } from '../services/haptics';

interface ChatViewProps {
  currentUserId: UserId;
  partnerName: string;
}

export const ChatView: React.FC<ChatViewProps> = ({ currentUserId, partnerName }) => {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [inputText, setInputText] = useState('');
  const [isUploading, setIsUploading] = useState(false);
  const [playingAudioId, setPlayingAudioId] = useState<number | null>(null);
  const audioPlayerRef = useRef<HTMLAudioElement | null>(null);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    loadMessages();

    // Subscribe to new incoming chat messages
    const unsub = wsClient.on('new_chat_message', (data: any) => {
      if (data.message) {
        setMessages((prev) => [...prev, data.message]);
        soundEngine.playLoveChime();
        scrollToBottom();
      }
    });

    return () => unsub();
  }, []);

  const loadMessages = async () => {
    try {
      const data = await api.getChatMessages(50);
      setMessages(data);
      scrollToBottom();
    } catch (e) {
      console.error(e);
    }
  };

  const scrollToBottom = () => {
    setTimeout(() => {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, 100);
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
      scrollToBottom();
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
      scrollToBottom();
    } catch (err) {
      console.error(err);
      alert('Dosya yüklenemedi.');
    } finally {
      setIsUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
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
      const audio = new Audio(url);
      audioPlayerRef.current = audio;
      audio.onended = () => setPlayingAudioId(null);
      audio.play().catch(console.warn);
      setPlayingAudioId(id);
    }
  };

  return (
    <div className="flex flex-col h-[calc(100vh-185px)] max-h-[750px] bg-white/70 backdrop-blur-md rounded-3xl border border-rose-100 shadow-sm overflow-hidden">
      {/* Header */}
      <div className="px-5 py-3.5 bg-rose-50/80 border-b border-rose-100 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-xl">{currentUserId === 'murat' ? '🌸' : '🐻'}</span>
          <div>
            <h3 className="font-serif text-sm font-bold text-berry-950">
              {partnerName} ile Sohbet
            </h3>
            <span className="text-[10px] text-emerald-600 font-medium flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
              Canlı Bağlantı
            </span>
          </div>
        </div>
      </div>

      {/* Messages Scroll Area */}
      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center opacity-60">
            <Heart className="w-10 h-10 text-berry-400 mb-2 animate-float" />
            <p className="font-serif text-sm text-stone-600">
              Henüz mesaj yok, sevgiline güzel bir şeyler yaz ❤️
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
                      src={msg.media_url}
                      alt="Görsel"
                      className="rounded-xl max-h-56 object-cover mt-1"
                    />
                  )}

                  {/* Video Attachment */}
                  {msg.message_type === 'video' && msg.media_url && (
                    <video
                      src={msg.media_url}
                      controls
                      className="rounded-xl max-h-56 w-full mt-1"
                    />
                  )}

                  {/* Voice / Walkie-Talkie Message */}
                  {(msg.message_type === 'voice' || msg.message_type === 'walkie_talkie') && msg.media_url && (
                    <div className="flex items-center gap-2 mt-1 py-1">
                      <button
                        onClick={() => togglePlayAudio(msg.id, msg.media_url!)}
                        className={`p-2 rounded-full ${
                          isMe ? 'bg-white/20 text-white' : 'bg-rose-100 text-berry-700'
                        }`}
                      >
                        {playingAudioId === msg.id ? (
                          <Pause className="w-4 h-4" />
                        ) : (
                          <Play className="w-4 h-4" />
                        )}
                      </button>
                      <span className="text-xs font-medium">
                        {msg.message_type === 'walkie_talkie' ? 'Telsiz Notu' : 'Sesli Mesaj'}
                        {msg.duration ? ` (${msg.duration}s)` : ''}
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

      {/* Input Bar */}
      <div className="p-3 bg-rose-50/50 border-t border-rose-100 flex items-center gap-2">
        <input
          type="file"
          ref={fileInputRef}
          onChange={handleFileUpload}
          accept="image/*,video/*,audio/*"
          className="hidden"
        />

        <button
          onClick={() => fileInputRef.current?.click()}
          disabled={isUploading}
          className="p-2.5 rounded-full bg-white hover:bg-rose-100 border border-rose-200/60 text-stone-600 transition-colors"
          title="Fotoğraf veya Video Ekle"
        >
          <Paperclip className="w-4 h-4" />
        </button>

        <input
          type="text"
          placeholder="Sevgiline bir mesaj yaz..."
          value={inputText}
          onChange={(e) => setInputText(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleSendMessage()}
          className="flex-1 bg-white px-4 py-2.5 rounded-full border border-rose-200/80 text-sm focus:outline-none focus:ring-2 focus:ring-berry-400"
        />

        <button
          onClick={handleSendMessage}
          disabled={!inputText.trim()}
          className="p-2.5 rounded-full bg-berry-500 hover:bg-berry-600 text-white disabled:opacity-40 transition-all shadow-xs"
        >
          <Send className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
};
