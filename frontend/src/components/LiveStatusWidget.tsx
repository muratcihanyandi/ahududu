import React from 'react';
import { Heart, Battery, BatteryCharging, MapPin, Watch, Footprints, Activity, Smile } from 'lucide-react';
import { UserProfile, WatchBiometrics } from '../types';

interface LiveStatusWidgetProps {
  partnerProfile: UserProfile | null;
  partnerBiometrics: WatchBiometrics | null;
  distanceKm?: number;
  startDate?: string; // Romantic milestone
}

export const LiveStatusWidget: React.FC<LiveStatusWidgetProps> = ({
  partnerProfile,
  partnerBiometrics,
  distanceKm,
  startDate = '2023-06-15',
}) => {
  // Calculate days together
  const calculateDays = () => {
    try {
      const start = new Date(startDate).getTime();
      const now = new Date().getTime();
      const diff = Math.floor((now - start) / (1000 * 60 * 60 * 24));
      return diff > 0 ? diff : 1;
    } catch (e) {
      return 1;
    }
  };

  const daysTogether = calculateDays();
  const battery = partnerProfile?.battery_level ?? 92;
  const isCharging = partnerProfile?.is_charging ?? false;
  const heartRate = partnerBiometrics?.heart_rate ?? 76;
  const steps = partnerBiometrics?.steps ?? 5210;

  return (
    <div className="w-full bg-white/80 backdrop-blur-md rounded-3xl p-5 border border-rose-100 shadow-sm shadow-rose-900/5 mb-4">
      {/* Top Banner: Days Together Counter */}
      <div className="flex items-center justify-between pb-3.5 mb-3.5 border-b border-rose-100/60">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-full bg-rose-100 flex items-center justify-center">
            <Heart className="w-4 h-4 fill-berry-500 text-berry-600" />
          </div>
          <div>
            <span className="text-xs font-semibold text-berry-900">
              Birlikte Geçen Günlerimiz
            </span>
            <p className="text-[11px] text-stone-500">Aşkla geçen her an</p>
          </div>
        </div>
        <div className="flex items-baseline gap-1 bg-gradient-to-r from-berry-50 to-pink-50 px-3 py-1 rounded-full border border-rose-200/50">
          <span className="font-serif text-lg font-bold text-berry-700">
            {daysTogether}
          </span>
          <span className="text-xs font-semibold text-berry-600">. Günümüz</span>
        </div>
      </div>

      {/* Main Status Grid */}
      <div className="grid grid-cols-2 gap-3">
        {/* Distance & Location Card */}
        <div className="bg-gradient-to-br from-rose-50/70 to-pink-50/50 p-3.5 rounded-2xl border border-rose-100/80">
          <div className="flex items-center gap-1.5 text-xs text-stone-500 mb-1">
            <MapPin className="w-3.5 h-3.5 text-berry-500" />
            <span>Mesafe & Konum</span>
          </div>
          <div className="font-serif text-lg font-bold text-berry-950">
            {distanceKm !== undefined ? `${distanceKm} km` : 'Yan Yana 💕'}
          </div>
          <p className="text-xs text-stone-600 truncate mt-0.5">
            {partnerProfile?.place_name || 'Evde 🏡'}
          </p>
        </div>

        {/* Watch Biometrics: Heart Rate & Steps */}
        <div className="bg-gradient-to-br from-pink-50/70 to-rose-50/50 p-3.5 rounded-2xl border border-rose-100/80">
          <div className="flex items-center justify-between text-xs text-stone-500 mb-1">
            <div className="flex items-center gap-1">
              <Watch className="w-3.5 h-3.5 text-berry-500" />
              <span>Galaxy Watch</span>
            </div>
            {/* Battery Indicator */}
            <div className="flex items-center gap-1 text-[11px] font-semibold text-stone-600">
              {isCharging ? (
                <BatteryCharging className="w-3.5 h-3.5 text-emerald-500" />
              ) : (
                <Battery className="w-3.5 h-3.5 text-stone-500" />
              )}
              <span>%{battery}</span>
            </div>
          </div>
          <div className="flex items-center gap-2 mt-1">
            <div className="flex items-center gap-1 text-berry-700 font-semibold text-sm">
              <Activity className="w-4 h-4 text-rose-500 animate-pulse" />
              <span>{heartRate} BPM</span>
            </div>
          </div>
          <div className="flex items-center gap-1 text-[11px] text-stone-500 mt-1">
            <Footprints className="w-3 h-3 text-stone-400" />
            <span>{steps.toLocaleString('tr-TR')} Adım</span>
          </div>
        </div>
      </div>

      {/* Partner Status Message */}
      <div className="mt-3 pt-2.5 flex items-center justify-between text-xs text-stone-600 px-1">
        <div className="flex items-center gap-1.5">
          <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
          <span className="font-medium">
            {partnerProfile?.status_text || 'Seni düşünüyor 🥰'}
          </span>
        </div>
        <span className="text-[11px] text-stone-400">
          Samsung Galaxy
        </span>
      </div>
    </div>
  );
};
