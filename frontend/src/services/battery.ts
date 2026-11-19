import { Device } from '@capacitor/device';

export interface BatteryStatus {
  level: number; // 0 - 100
  isCharging: boolean;
}

export const getRealBatteryStatus = async (): Promise<BatteryStatus> => {
  // 1. Try native Capacitor Device plugin
  try {
    const info = await Device.getBatteryInfo();
    if (info && typeof info.batteryLevel === 'number' && !isNaN(info.batteryLevel) && info.batteryLevel >= 0) {
      const level = info.batteryLevel > 1.0
        ? Math.round(info.batteryLevel)
        : Math.round(info.batteryLevel * 100);
      return {
        level: Math.min(100, Math.max(0, level)),
        isCharging: Boolean(info.isCharging),
      };
    }
  } catch (e) {
    // Fall back to Web Battery API
  }

  // 2. Try standard Web Battery API (supported in Android Chrome/WebView)
  try {
    if (typeof navigator !== 'undefined' && 'getBattery' in navigator) {
      const b = await (navigator as any).getBattery();
      if (b && typeof b.level === 'number' && !isNaN(b.level)) {
        return {
          level: Math.min(100, Math.max(0, Math.round(b.level * 100))),
          isCharging: Boolean(b.charging),
        };
      }
    }
  } catch (e) {}

  return { level: 100, isCharging: false };
};

/**
 * Register a listener for real-time battery changes (level & charging plugged/unplugged)
 */
export const subscribeToBatteryChanges = (
  callback: (status: BatteryStatus) => void
): (() => void) => {
  let isCleanedUp = false;
  let batteryRef: any = null;
  let listenerRef: (() => void) | null = null;

  // 1. Try Web Battery API event listeners
  try {
    if (typeof navigator !== 'undefined' && 'getBattery' in navigator) {
      (navigator as any).getBattery().then((battery: any) => {
        if (isCleanedUp || !battery) return;

        const handleUpdate = () => {
          if (isCleanedUp) return;
          callback({
            level: Math.min(100, Math.max(0, Math.round(battery.level * 100))),
            isCharging: Boolean(battery.charging),
          });
        };

        batteryRef = battery;
        listenerRef = handleUpdate;
        battery.addEventListener('levelchange', handleUpdate);
        battery.addEventListener('chargingchange', handleUpdate);

        // Immediate callback with current status
        handleUpdate();
      }).catch(() => {});
    }
  } catch (e) {}

  return () => {
    isCleanedUp = true;
    if (batteryRef && listenerRef) {
      try {
        batteryRef.removeEventListener('levelchange', listenerRef);
        batteryRef.removeEventListener('chargingchange', listenerRef);
      } catch {
        /* yok say */
      }
      batteryRef = null;
      listenerRef = null;
    }
  };
};
