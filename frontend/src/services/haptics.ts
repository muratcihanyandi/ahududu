// Haptic and audio feedback engine for romantic interactions

export const playHaptic = (pattern: number | number[] = 100) => {
  if (typeof window !== 'undefined' && 'vibrate' in navigator) {
    try {
      navigator.vibrate(pattern);
    } catch (e) {
      console.warn('Vibration failed:', e);
    }
  }
};

export const HAPTIC_PATTERNS = {
  heartbeat: [120, 100, 180, 800, 120, 100, 180],
  attention: [250, 100, 250, 100, 400],
  hug: [400, 200, 400],
  kiss: [80, 80, 80, 80, 150],
  butterfly: [50, 50, 50, 50, 100],
  tap: 40,
};

// Cute web audio tone generator for notifications & walkie-talkie
class RomanticSoundEngine {
  private ctx: AudioContext | null = null;

  private getContext() {
    if (!this.ctx && typeof window !== 'undefined') {
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      if (AudioCtx) {
        this.ctx = new AudioCtx();
      }
    }
    if (this.ctx && this.ctx.state === 'suspended') {
      this.ctx.resume();
    }
    return this.ctx;
  }

  playLoveChime() {
    const ctx = this.getContext();
    if (!ctx) return;
    try {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      
      const now = ctx.currentTime;
      // Sweet 3-note ascending romantic chime (E5 -> G#5 -> B5)
      osc.frequency.setValueAtTime(659.25, now);
      osc.frequency.exponentialRampToValueAtTime(830.61, now + 0.12);
      osc.frequency.exponentialRampToValueAtTime(987.77, now + 0.25);

      gain.gain.setValueAtTime(0.2, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.6);

      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now);
      osc.stop(now + 0.6);
    } catch (e) {
      // Audio autoplay policy catch
    }
  }

  playWalkieBeep() {
    const ctx = this.getContext();
    if (!ctx) return;
    try {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'triangle';
      
      const now = ctx.currentTime;
      osc.frequency.setValueAtTime(880, now);
      osc.frequency.setValueAtTime(1760, now + 0.08);

      gain.gain.setValueAtTime(0.15, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.25);

      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now);
      osc.stop(now + 0.25);
    } catch (e) {}
  }
}

export const soundEngine = new RomanticSoundEngine();
