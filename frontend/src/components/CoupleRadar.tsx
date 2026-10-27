import React, { useState, useEffect } from 'react';
import { MapPin, Navigation2, Battery, RefreshCw, Vibrate, ExternalLink, Heart } from 'lucide-react';
import { CoupleStatus, UserId } from '../types';
import { api } from '../services/api';
import { wsClient } from '../services/websocket';
import { playHaptic, HAPTIC_PATTERNS } from '../services/haptics';

interface CoupleRadarProps {
  currentUserId: UserId;
  partnerName: string;
}

export const CoupleRadar: React.FC<CoupleRadarProps> = ({ currentUserId, partnerName }) => {
  const [status, setStatus] = useState<CoupleStatus | null>(null);
  const [isUpdating, setIsUpdating] = useState(false);

  useEffect(() => {
    loadStatus();

    const unsub = wsClient.on('partner_location_update', (data: any) => {
      setStatus((prev) => {
        if (!prev) return prev;
        const partnerKey = currentUserId === 'murat' ? 'sevgilim' : 'murat';
        return {
          ...prev,
          [partnerKey]: {
            ...prev[partnerKey],
            lat: data.latitude,
            lon: data.longitude,
            place: data.place_name,
            battery: data.battery,
          },
          distance_km: data.distance_km,
        };
      });
    });

    return () => unsub();
  }, [currentUserId]);

  const loadStatus = async () => {
    try {
      const data = await api.getCoupleStatus();
      setStatus(data);
    } catch (e) {
      console.error(e);
    }
  };

  const handleUpdateMyLocation = () => {
    if (!navigator.geolocation) {
      alert('Cihazınızda konum servisi desteklenmiyor.');
      return;
    }

    setIsUpdating(true);
    playHaptic(20);

    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        try {
          const res = await api.updateLocation({
            user_id: currentUserId,
            latitude: pos.coords.latitude,
            longitude: pos.coords.longitude,
            accuracy: pos.coords.accuracy,
            battery: 90,
            place_name: 'Canlı Konum Alındı 📍',
          });
          setIsUpdating(false);
          loadStatus();
        } catch (e) {
          setIsUpdating(false);
        }
      },
      (err) => {
        console.warn(err);
        setIsUpdating(false);
        alert('Konum izni verilemedi veya GPS sinyali zayıf.');
      },
      { enableHighAccuracy: true, timeout: 10000 }
    );
  };

  const myData = currentUserId === 'murat' ? status?.murat : status?.sevgilim;
  const partnerData = currentUserId === 'murat' ? status?.sevgilim : status?.murat;

  const openNavigation = () => {
    if (partnerData?.lat && partnerData?.lon) {
      window.open(
        `https://www.google.com/maps/dir/?api=1&destination=${partnerData.lat},${partnerData.lon}`,
        '_blank'
      );
    } else {
      alert('Sevgilinin henüz GPS koordinatı bulunmuyor.');
    }
  };

  return (
    <div className="flex flex-col h-full space-y-4">
      {/* Distance Hero Banner */}
      <div className="bg-gradient-to-r from-berry-600 via-rose-500 to-pink-500 rounded-3xl p-6 text-white text-center shadow-lg shadow-berry-500/20 relative overflow-hidden">
        <div className="absolute top-0 right-0 -mr-6 -mt-6 w-32 h-32 rounded-full bg-white/10 blur-xl pointer-events-none" />
        <div className="flex items-center justify-center gap-2 mb-1 opacity-90 text-xs font-semibold">
          <Heart className="w-4 h-4 fill-white" />
          <span>Kalplerimizin Mesafesi</span>
        </div>
        <div className="font-serif text-3xl font-extrabold tracking-tight mt-1">
          {status?.distance_km !== undefined ? `${status.distance_km} KM` : 'Aramızda Aşk Var 💕'}
        </div>
        <p className="text-xs text-pink-100 mt-1">
          {status?.distance_km && status.distance_km < 0.1
            ? 'Şu an yan yanasınız! 🥰'
            : 'Mesafe ne olursa olsun hep aklımdasın'}
        </p>
      </div>

      {/* Radar Map Graphic Card */}
      <div className="relative bg-white/80 backdrop-blur-md rounded-3xl p-6 border border-rose-100 shadow-sm flex flex-col items-center justify-center min-h-[260px] overflow-hidden">
        {/* Radar Rings */}
        <div className="absolute w-56 h-56 rounded-full border border-rose-200/50 animate-ping opacity-25 pointer-events-none" />
        <div className="absolute w-44 h-44 rounded-full border border-rose-200/80 pointer-events-none" />
        <div className="absolute w-28 h-28 rounded-full border border-rose-200/80 pointer-events-none" />

        {/* Center Heart Connection */}
        <div className="relative flex items-center justify-between w-full max-w-[260px] z-10">
          {/* Me */}
          <div className="flex flex-col items-center">
            <div className="w-14 h-14 rounded-full bg-berry-100 border-2 border-berry-500 flex items-center justify-center text-2xl shadow-md">
              {currentUserId === 'murat' ? '🐻' : '🌸'}
            </div>
            <span className="font-semibold text-xs text-berry-900 mt-1">Ben</span>
            <span className="text-[10px] text-stone-500">
              %{myData?.battery ?? 100} 🔋
            </span>
          </div>

          {/* Dotted love line */}
          <div className="flex-1 flex flex-col items-center mx-2">
            <div className="w-full border-t-2 border-dashed border-rose-300 relative">
              <Heart className="w-5 h-5 fill-berry-500 text-berry-600 absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 animate-pulse" />
            </div>
          </div>

          {/* Partner */}
          <div className="flex flex-col items-center">
            <div className="w-14 h-14 rounded-full bg-rose-100 border-2 border-rose-500 flex items-center justify-center text-2xl shadow-md">
              {currentUserId === 'murat' ? '🌸' : '🐻'}
            </div>
            <span className="font-semibold text-xs text-rose-950 mt-1">{partnerName}</span>
            <span className="text-[10px] text-stone-500">
              %{partnerData?.battery ?? 100} 🔋
            </span>
          </div>
        </div>

        {/* Status text */}
        <div className="mt-8 text-center text-xs text-stone-600 z-10">
          <p className="font-semibold text-berry-900">{partnerData?.place || 'Evde 🏡'}</p>
          <p className="text-[11px] text-stone-400 mt-0.5">
            Son görülme: {partnerData?.last_seen ? new Date(partnerData.last_seen).toLocaleTimeString('tr-TR') : 'Şimdi'}
          </p>
        </div>
      </div>

      {/* Action Buttons */}
      <div className="grid grid-cols-2 gap-3">
        <button
          onClick={handleUpdateMyLocation}
          disabled={isUpdating}
          className="flex items-center justify-center gap-2 py-3 px-4 rounded-2xl bg-white hover:bg-rose-50 border border-rose-200/80 text-berry-900 text-xs font-semibold shadow-xs transition-all active:scale-95"
        >
          <RefreshCw className={`w-4 h-4 text-berry-600 ${isUpdating ? 'animate-spin' : ''}`} />
          <span>{isUpdating ? 'Alınıyor...' : 'Konumumu Güncelle'}</span>
        </button>

        <button
          onClick={openNavigation}
          className="flex items-center justify-center gap-2 py-3 px-4 rounded-2xl bg-gradient-to-r from-berry-500 to-rose-500 text-white text-xs font-semibold shadow-xs hover:from-berry-600 hover:to-rose-600 transition-all active:scale-95"
        >
          <Navigation2 className="w-4 h-4" />
          <span>Yanına Yol Tarifi Al</span>
        </button>
      </div>
    </div>
  );
};
