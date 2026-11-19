import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Plus, Film, X, Heart } from 'lucide-react';
import { GalleryItem, UserId } from '../types';
import { api, mediaUrl } from '../services/api';
import { wsClient } from '../services/websocket';
import { playHaptic } from '../services/haptics';
import { registerBackHandler } from '../services/backButton';

interface MemoryGalleryProps {
  currentUserId: UserId;
}

const ALBUMS = ['Tümü', 'Bizim Anılarımız', 'İlklerimiz', 'Tatillerimiz', 'Özel Günler'];

export const MemoryGallery: React.FC<MemoryGalleryProps> = ({ currentUserId }) => {
  const [items, setItems] = useState<GalleryItem[]>([]);
  const [selectedAlbum, setSelectedAlbum] = useState('Tümü');
  const [isUploading, setIsUploading] = useState(false);
  const [selectedItem, setSelectedItem] = useState<GalleryItem | null>(null);
  const [captionInput, setCaptionInput] = useState('');
  const [showUploadModal, setShowUploadModal] = useState(false);
  const [uploadedFile, setUploadedFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const loadGallery = useCallback(async () => {
    try {
      const albumFilter = selectedAlbum === 'Tümü' ? undefined : selectedAlbum;
      const data = await api.listGallery(albumFilter);
      setItems(Array.isArray(data) ? data : []);
    } catch (e) {
      console.error(e);
    }
  }, [selectedAlbum]);

  useEffect(() => {
    loadGallery();

    const unsub = wsClient.on('new_gallery_item', (data: any) => {
      const item = data?.item as GalleryItem | undefined;
      if (!item) return;
      if (selectedAlbum !== 'Tümü' && item.album !== selectedAlbum) return;
      setItems((prev) => [item, ...prev.filter((i) => i.id !== item.id)]);
    });

    return () => unsub();
  }, [selectedAlbum, loadGallery]);

  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
  }, [previewUrl]);

  const closeUploadModal = useCallback(() => {
    setShowUploadModal(false);
    setUploadedFile(null);
    setPreviewUrl(null);
    setCaptionInput('');
    if (fileInputRef.current) fileInputRef.current.value = '';
  }, []);

  useEffect(() => {
    return registerBackHandler(() => {
      if (selectedItem) {
        setSelectedItem(null);
        return true;
      }
      if (showUploadModal) {
        closeUploadModal();
        return true;
      }
      return false;
    });
  }, [selectedItem, showUploadModal, closeUploadModal]);

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    const file = files[0];
    e.target.value = '';
    setUploadedFile(file);
    setPreviewUrl(URL.createObjectURL(file));
    setShowUploadModal(true);
  };

  const handleSaveMemory = async () => {
    if (!uploadedFile || isUploading) return;
    setIsUploading(true);
    playHaptic(30);

    try {
      const uploadRes = await api.uploadMedia(uploadedFile, 'gallery');
      const isVideo = uploadedFile.type.startsWith('video');

      const newItem = await api.addGalleryItem({
        uploader: currentUserId,
        title: captionInput.trim() || 'Aşk Dolu Bir Anımız',
        caption: captionInput.trim(),
        media_type: isVideo ? 'video' : 'image',
        media_url: uploadRes.url,
        album: selectedAlbum === 'Tümü' ? 'Bizim Anılarımız' : selectedAlbum,
      });

      setItems((prev) => [newItem, ...prev.filter((i) => i.id !== newItem.id)]);
      closeUploadModal();
    } catch (err) {
      console.error(err);
      alert('Anı yüklenemedi.');
    } finally {
      setIsUploading(false);
    }
  };

  return (
    <div className="flex flex-col h-full space-y-4">
      {/* Top Controls: Albums filter & Add button */}
      <div className="flex items-center justify-between gap-2 overflow-x-auto pb-1">
        <div className="flex items-center gap-1.5">
          {ALBUMS.map((alb) => (
            <button
              key={alb}
              onClick={() => {
                setSelectedAlbum(alb);
                playHaptic(20);
              }}
              className={`px-3 py-1.5 rounded-full text-xs font-semibold whitespace-nowrap transition-all ${
                selectedAlbum === alb
                  ? 'bg-berry-500 text-white shadow-xs'
                  : 'bg-white/80 border border-rose-100 text-stone-600 hover:bg-rose-50'
              }`}
            >
              {alb}
            </button>
          ))}
        </div>

        <button
          onClick={() => fileInputRef.current?.click()}
          className="flex items-center gap-1 px-3.5 py-1.5 rounded-full bg-gradient-to-r from-berry-500 to-rose-500 text-white text-xs font-semibold shadow-xs shrink-0"
        >
          <Plus className="w-3.5 h-3.5" />
          Anı Ekle
        </button>
        <input
          type="file"
          ref={fileInputRef}
          onChange={handleFileSelect}
          accept="image/*,video/*"
          className="hidden"
        />
      </div>

      {/* Grid of photos/videos */}
      {items.length === 0 ? (
        <div className="flex flex-col items-center justify-center p-12 bg-white/60 rounded-3xl border border-rose-100 text-center opacity-60">
          <Heart className="w-12 h-12 text-berry-400 mb-2 animate-pulse" />
          <p className="font-serif text-sm font-semibold text-berry-900">
            Henüz fotoğraf eklenmemiş
          </p>
          <p className="text-xs text-stone-500 mt-1">
            Birlikte çekildiğiniz en tatlı kareleri buraya ekleyin ✨
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          {items.map((item) => (
            <div
              key={item.id}
              onClick={() => setSelectedItem(item)}
              className="group relative aspect-square rounded-2xl overflow-hidden bg-rose-100 border border-rose-200/50 shadow-xs cursor-pointer hover:shadow-md transition-all"
            >
              {item.media_type === 'video' ? (
                <div className="relative w-full h-full">
                  <video
                    src={mediaUrl(item.media_url)}
                    className="w-full h-full object-cover"
                  />
                  <div className="absolute inset-0 bg-black/25 flex items-center justify-center">
                    <Film className="w-8 h-8 text-white drop-shadow-md" />
                  </div>
                </div>
              ) : (
                <img
                  src={mediaUrl(item.media_url)}
                  alt={item.title || 'Anı'}
                  className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                />
              )}

              {/* Caption Overlay */}
              <div className="absolute inset-x-0 bottom-0 p-2 bg-gradient-to-t from-black/70 via-black/30 to-transparent text-white">
                <p className="text-xs font-semibold truncate drop-shadow-xs">
                  {item.title || item.caption || 'Bizim Anımız'}
                </p>
                <span className="text-[10px] text-white/80">
                  {new Date(item.taken_at || item.created_at).toLocaleDateString('tr-TR')}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Upload Modal */}
      {showUploadModal && previewUrl && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 safe-area-all">
          <div className="bg-white rounded-3xl p-5 max-w-sm w-full border border-rose-100 shadow-2xl">
            <h3 className="font-serif text-base font-bold text-berry-950 mb-3">
              Yeni Anı Paylaş 📸
            </h3>
            {uploadedFile?.type.startsWith('video') ? (
              <video
                src={previewUrl}
                controls
                playsInline
                className="w-full max-h-56 rounded-2xl mb-3 bg-black object-contain"
              />
            ) : (
              <img
                src={previewUrl}
                alt="Önizleme"
                className="w-full max-h-56 object-cover rounded-2xl mb-3"
              />
            )}
            <input
              type="text"
              placeholder="Bu anıya bir başlık / not yaz..."
              value={captionInput}
              onChange={(e) => setCaptionInput(e.target.value)}
              className="w-full px-3.5 py-2 rounded-xl border border-rose-200 text-sm mb-4 focus:ring-2 focus:ring-berry-400 focus:outline-none"
            />
            <div className="flex items-center justify-end gap-2">
              <button
                onClick={closeUploadModal}
                className="px-4 py-2 rounded-xl text-stone-600 text-xs font-medium hover:bg-stone-100"
              >
                Vazgeç
              </button>
              <button
                onClick={handleSaveMemory}
                disabled={isUploading}
                className="px-5 py-2 rounded-xl bg-berry-500 hover:bg-berry-600 text-white text-xs font-semibold shadow-xs"
              >
                {isUploading ? 'Yükleniyor...' : 'Galeriye Ekle'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Full-view Modal */}
      {selectedItem && (
        <div className="fixed inset-0 z-50 bg-black/90 backdrop-blur-md flex items-center justify-center p-3 safe-area-all">
          <button
            onClick={() => setSelectedItem(null)}
            className="absolute top-4 right-4 p-2 rounded-full bg-white/20 text-white hover:bg-white/30"
          >
            <X className="w-6 h-6" />
          </button>
          <div className="max-w-2xl w-full flex flex-col items-center">
            {selectedItem.media_type === 'video' ? (
              <video
                src={mediaUrl(selectedItem.media_url)}
                controls
                autoPlay
                className="max-h-[75vh] w-full rounded-2xl object-contain"
              />
            ) : (
              <img
                src={mediaUrl(selectedItem.media_url)}
                alt="Detay"
                className="max-h-[75vh] w-full rounded-2xl object-contain shadow-2xl"
              />
            )}
            <div className="mt-3 text-center text-white">
              <p className="font-serif text-lg font-bold">{selectedItem.title}</p>
              <p className="text-xs text-white/70 mt-1">{selectedItem.caption}</p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
