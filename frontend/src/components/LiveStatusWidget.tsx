import React, { useMemo } from 'react';
import { Heart, Battery, BatteryCharging, MapPin, Clock, Sparkles, Coffee } from 'lucide-react';
import { UserProfile } from '../types';

interface LiveStatusWidgetProps {
  partnerProfile: UserProfile | null;
  myBattery?: { level: number; isCharging: boolean };
  distanceKm?: number;
  partnerName: string;
  isPartnerOnline?: boolean;
  /** Birlikte olunan gün sayısı (ilişki başlangıcından) */
  daysTogether?: number;
  /** Partnerle son etkileşimden bu yana geçen dakika */
  mineBatteryLevel?: number;
}

const formatLastSeen = (value?: string): string => {
  if (!value) return 'Bilinmiyor';
  const seen = new Date(value).getTime();
  if (Number.isNaN(seen)) return 'Bilinmiyor';

  const minutes = Math.floor((Date.now() - seen) / 60000);
  if (minutes < 1) return 'şimdi';
  if (minutes < 60) return `${minutes} dk önce`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} saat önce`;
  return `${Math.floor(hours / 24)} gün önce`;
};

/** Küçük pil rozeti — ana ekranda yer kaplamasın diye minimal */
const BatteryPill: React.FC<{ level: number; charging: boolean; label?: string }> = ({
  level,
  charging,
  label,
}) => (
  <span
    className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold ${
      charging
        ? 'bg-emerald-50 text-emerald-700'
        : level <= 20
          ? 'bg-amber-50 text-amber-700'
          : 'bg-stone-100 text-stone-600'
    }`}
  >
    {charging ? (
      <BatteryCharging className="w-3 h-3" />
    ) : (
      <Battery className="w-3 h-3" />
    )}
    {label && <span className="opacity-70">{label}</span>}
    <span className="tabular-nums">%{level}</span>
  </span>
);

export const LiveStatusWidget: React.FC<LiveStatusWidgetProps> = ({
  partnerProfile,
  myBattery,
  distanceKm,
  partnerName,
  isPartnerOnline = false,
  daysTogether,
  mineBatteryLevel,
}) => {
  const phoneBattery = partnerProfile?.battery_level ?? 100;
  const isPhoneCharging = partnerProfile?.is_charging ?? false;
  const lastSeen = formatLastSeen(partnerProfile?.last_seen);
  const place = partnerProfile?.place_name?.trim();
  const statusText = partnerProfile?.status_text?.trim();
  const myLevel = mineBatteryLevel ?? myBattery?.level ?? 100;

  const statusIsCinema = statusText?.includes('Sinemada');

  const heroLine = useMemo(() => {
    if (statusIsCinema) return 'Sinemada 🍿';
    if (statusText) return statusText;
    if (isPartnerOnline) return 'Şu an burada, seninle 💞';
    return 'Seni düşünüyor olabilir 💭';
  }, [statusIsCinema, statusText, isPartnerOnline]);

  return (
    <div className="relative overflow-hidden rounded-3xl border border-rose-100/90 shadow-lg shadow-rose-900/5 bg-gradient-to-br from-white via-rose-50/50 to-pink-50/70">
      {/* Yumuşak dekor */}
      <div className="absolute -top-10 -right-8 w-32 h-32 rounded-full bg-rose-200/25 blur-2xl pointer-events-none" />
      <div className="absolute -bottom-12 -left-8 w-28 h-28 rounded-full bg-amber-200/25 blur-2xl pointer-events-none" />

      <div className="relative p-4">
        {/* Üst satır: partner + canlı durum rozeti */}
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <span className="relative flex h-9 w-9 items-center justify-center rounded-full bg-white shadow-xs text-lg shrink-0">
              {partnerProfile?.avatar || '💞'}
              <span
                className={`absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full border-2 border-white ${
                  isPartnerOnline ? 'bg-emerald-500' : 'bg-stone-300'
                }`}
              />
            </span>
            <div className="min-w-0">
              <p className="font-serif text-sm font-bold text-berry-950 leading-tight truncate">
                {partnerName}
              </p>
              <p className="text-[10px] text-stone-500">{lastSeen} görüldü</p>
            </div>
          </div>

          {/* Pil rozetleri — küçük ve sağ üstte */}
          <div className="flex items-center gap-1 shrink-0">
            <BatteryPill level={phoneBattery} charging={isPhoneCharging} label={partnerName.slice(0, 3)} />
            <BatteryPill level={myLevel} charging={myBattery?.isCharging ?? false} label="Sen" />
          </div>
        </div>

        {/* Durum cümlesi */}
        <div className="mt-3 flex items-center gap-2">
          <Heart
            className={`w-4 h-4 shrink-0 ${
              statusIsCinema ? 'text-amber-500' : 'text-rose-500 fill-rose-400 animate-pulse'
            }`}
          />
          <p className="font-serif text-[15px] font-semibold text-berry-950 leading-snug truncate">
            {heroLine}
          </p>
        </div>

        {/* Alt bilgi şeridi: mesafe / konum / gün sayısı */}
        <div className="mt-3 flex items-center gap-2 flex-wrap">
          {distanceKm != null && distanceKm > 0 && (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-berry-50 text-[10px] font-semibold text-berry-700">
              <MapPin className="w-3 h-3" />
              {distanceKm < 1
                ? `${Math.round(distanceKm * 1000)} m`
                : `${distanceKm.toFixed(1)} km`}
            </span>
          )}
          {place && (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-stone-100 text-[10px] font-medium text-stone-600 max-w-[140px]">
              <MapPin className="w-3 h-3 shrink-0" />
              <span className="truncate">{place}</span>
            </span>
          )}
          {daysTogether != null && daysTogether > 0 && (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-50 text-[10px] font-semibold text-amber-800">
              <Coffee className="w-3 h-3" />
              {daysTogether} gün birlikte
            </span>
          )}
          {!isPartnerOnline && (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-stone-100 text-[10px] font-medium text-stone-500">
              <Clock className="w-3 h-3" />
              çevrimdışı
            </span>
          )}
        </div>
      </div>
    </div>
  );
};
