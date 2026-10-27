import React from 'react';
import { Heart, Battery, BatteryCharging, MapPin, Watch, Footprints, Activity, Smartphone } from 'lucide-react';
import { UserProfile, WatchBiometrics } from '../types';

interface LiveStatusWidgetProps {
  partnerProfile: UserProfile | null;
  partnerBiometrics: WatchBiometrics | null;
  myBattery?: { level: number; isCharging: boolean };
  distanceKm?: number;
  partnerName: string;
  startDate?: string;
}

export const LiveStatusWidget: React.FC<LiveStatusWidgetProps> = ({
  partnerProfile,
  partnerBiometrics,
  myBattery,
  distanceKm,
  partnerName,
  startDate = '2023-06-15',
}) => {
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
  const phoneBattery = partnerProfile?.battery_level ?? 100;
  const isPhoneCharging = partnerProfile?.is_charging ?? false;
  const watchBattery = partnerBiometrics?.battery ?? 88;
  const heartRate = partnerBiometrics?.heart_rate ?? 74;
  const steps = partnerBiometrics?.steps ?? 5210;

  return (
    <div className="w-full bg-white/85 backdrop-blur-md rounded-3xl p-5 border border-rose-100 shadow-sm shadow-rose-900/5 mb-4">
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
        {/* Partner Phone Status Card */}
        <div className="bg-gradient-to-br from-rose-50/80 to-pink-50/60 p-3.5 rounded-2xl border border-rose-100/90 flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between text-xs text-stone-500 mb-1.5">
              <div className="flex items-center gap-1 font-semibold text-berry-900">
                <Smartphone className="w-3.5 h-3.5 text-berry-600" />
                <span>{partnerName}'in Telefonu</span>
              </div>
            </div>

            {/* Real Phone Battery Display */}
            <div className="flex items-center gap-1.5 my-1">
              {isPhoneCharging ? (
                <BatteryCharging className="w-5 h-5 text-emerald-500 animate-pulse" />
              ) : (
                <Battery className={`w-5 h-5 ${phoneBattery <= 20 ? 'text-amber-500' : 'text-stone-700'}`} />
              )}
              <span className="font-serif text-xl font-bold text-berry-950">
                %{phoneBattery}
              </span>
              {isPhoneCharging && (
                <span className="text-[10px] bg-emerald-100 text-emerald-800 px-1.5 py-0.5 rounded-full font-semibold">
                  Şarjda ⚡
                </span>
              )}
            </div>
          </div>

          <div className="pt-2 border-t border-rose-200/50 text-[11px] text-stone-600">
            <div className="flex items-center gap-1 truncate">
              <MapPin className="w-3 h-3 text-berry-500 shrink-0" />
              <span className="truncate">{partnerProfile?.place_name || 'Evde 🏡'}</span>
            </div>
            <div className="text-stone-400 text-[10px] mt-0.5">
              {distanceKm !== undefined ? `Mesafe: ${distanceKm} km` : 'Yan Yana 💕'}
            </div>
          </div>
        </div>

        {/* Partner Galaxy Watch Status Card */}
        <div className="bg-gradient-to-br from-pink-50/80 to-rose-50/60 p-3.5 rounded-2xl border border-rose-100/90 flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between text-xs text-stone-500 mb-1.5">
              <div className="flex items-center gap-1 font-semibold text-berry-900">
                <Watch className="w-3.5 h-3.5 text-berry-600" />
                <span>Galaxy Watch</span>
              </div>
              <span className="text-[10px] text-stone-500 font-semibold">
                %{watchBattery}
              </span>
            </div>

            {/* Heart Rate */}
            <div className="flex items-center gap-1.5 my-1">
              <Activity className="w-5 h-5 text-rose-500 animate-pulse" />
              <span className="font-serif text-xl font-bold text-berry-950">
                {heartRate}
              </span>
              <span className="text-[10px] text-rose-400 font-semibold">BPM</span>
            </div>
          </div>

          <div className="pt-2 border-t border-rose-200/50 flex items-center justify-between text-[11px] text-stone-600">
            <div className="flex items-center gap-1">
              <Footprints className="w-3 h-3 text-stone-400" />
              <span>{steps.toLocaleString('tr-TR')} adım</span>
            </div>
            <span className="text-[10px] text-emerald-600 font-semibold">Sakin 🍃</span>
          </div>
        </div>
      </div>

      {/* Footer Info: My Battery & Partner Status */}
      <div className="mt-3 pt-2.5 flex items-center justify-between text-xs text-stone-600 px-1 border-t border-rose-100/60">
        <div className="flex items-center gap-1.5 truncate">
          <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse shrink-0" />
          <span className="font-medium text-berry-900 truncate">
            {partnerProfile?.status_text || 'Seni düşünüyor 🥰'}
          </span>
        </div>
        {myBattery && (
          <div className="flex items-center gap-1.5 text-xs bg-rose-50/80 px-2.5 py-1 rounded-full border border-rose-100 text-stone-700 font-medium shrink-0 ml-2">
            <Smartphone className="w-3.5 h-3.5 text-berry-600" />
            <span>Sen:</span>
            {myBattery.isCharging ? (
              <BatteryCharging className="w-4 h-4 text-emerald-500 animate-pulse" />
            ) : (
              <Battery className={`w-4 h-4 ${myBattery.level <= 20 ? 'text-amber-500' : 'text-stone-600'}`} />
            )}
            <span className="font-bold text-berry-950">%{myBattery.level}</span>
            {myBattery.isCharging && (
              <span className="text-[10px] text-emerald-600 font-semibold">⚡</span>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
