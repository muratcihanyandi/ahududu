import { wsClient } from './websocket';

export type UpdateStatus = 'idle' | 'scheduled' | 'waiting' | 'reloading';

export interface UpdateState {
  status: UpdateStatus;
  secondsLeft: number;
  currentBuildId: string | null;
  serverBuildId: string | null;
  pending: boolean;
  postponed: boolean;
}

const BUILD_META_SELECTOR = 'meta[name="ahududu-build-id"]';
const POLL_INTERVAL_MS = 15000;
const RELOAD_DELAY_SECONDS = 4;
const FOCUS_RELEASE_DELAY_MS = 1200;
const CAPACITOR_FALLBACK_URL = 'https://ahududu.fakeyol.com';

const readDocumentBuildId = (): string | null => {
  const meta = document.querySelector(BUILD_META_SELECTOR);
  const value = meta?.getAttribute('content');
  return value && value.trim() ? value.trim() : null;
};

const resolveVersionUrl = (): string => {
  // Inside the Capacitor shell the app can be served from a local origin,
  // so the API base has to be resolved the same way services/api.ts does.
  if (
    window.location.hostname === 'localhost' &&
    window.location.port !== '33470' &&
    window.location.port !== '5173'
  ) {
    const saved = localStorage.getItem('ahududu_server_url') || CAPACITOR_FALLBACK_URL;
    return `${saved.replace(/\/$/, '')}/api/system/version`;
  }
  return '/api/system/version';
};

/**
 * Keeps the running bundle in sync with the server.
 *
 * A deployed build is detected through the WebSocket `app_update` push and a
 * slow HTTP poll as fallback. The app then reloads itself: immediately while it
 * is in the background, after a short countdown while it is visible, and only
 * once the user is no longer typing/drawing/recording so work is never lost.
 */
class UpdateManager {
  private currentBuildId: string | null = null;
  private serverBuildId: string | null = null;
  private status: UpdateStatus = 'idle';
  private secondsLeft = 0;
  private pending = false;
  private postponed = false;
  private busyCount = 0;
  private timer: number | null = null;
  private pollTimer: number | null = null;
  private focusTimer: number | null = null;
  private initialized = false;
  private listeners = new Set<(state: UpdateState) => void>();

  init(): void {
    if (this.initialized) return;
    this.initialized = true;
    this.currentBuildId = readDocumentBuildId();

    wsClient.on('app_update', (data: { build_id?: string } | null) => {
      const buildId = typeof data?.build_id === 'string' ? data.build_id : '';
      if (buildId) this.markPending(buildId);
    });

    document.addEventListener('visibilitychange', this.handleVisibility);
    document.addEventListener('focusout', this.handleFocusOut);
    window.addEventListener('focus', this.handleWindowFocus);

    this.pollTimer = window.setInterval(() => {
      void this.checkNow();
    }, POLL_INTERVAL_MS);

    void this.checkNow();
  }

  getState(): UpdateState {
    return {
      status: this.status,
      secondsLeft: this.secondsLeft,
      currentBuildId: this.currentBuildId,
      serverBuildId: this.serverBuildId,
      pending: this.pending,
      postponed: this.postponed,
    };
  }

  subscribe(listener: (state: UpdateState) => void): () => void {
    this.listeners.add(listener);
    listener(this.getState());
    return () => {
      this.listeners.delete(listener);
    };
  }

  /** Marks long-running user work (letter editor, voice recording) so reloads wait. */
  setBusy(busy: boolean): void {
    this.busyCount = Math.max(0, this.busyCount + (busy ? 1 : -1));
    if (!this.pending || this.postponed) return;
    if (this.busyCount > 0) {
      this.clearTimer();
      this.setStatus('waiting');
    } else {
      this.armReload();
    }
  }

  async checkNow(): Promise<void> {
    try {
      const response = await fetch(`${resolveVersionUrl()}?t=${Date.now()}`, {
        cache: 'no-store',
      });
      if (!response.ok) return;
      const data: { build_id?: string; version?: string } = await response.json();
      const serverBuildId = String(data.build_id || data.version || '').trim();
      if (!serverBuildId) return;

      this.serverBuildId = serverBuildId;
      if (!this.currentBuildId) {
        // No build marker in the document (dev server): first answer is the baseline.
        this.currentBuildId = serverBuildId;
        this.notify();
        return;
      }
      if (serverBuildId !== this.currentBuildId) {
        this.markPending(serverBuildId);
      }
    } catch {
      // Offline or server restarting; the next poll retries.
    }
  }

  /** Manual "refresh now" action. */
  applyNow(): void {
    this.reloadNow();
  }

  /** User asked to wait: reload on the next backgrounding or next launch. */
  postpone(): void {
    if (!this.pending) return;
    this.postponed = true;
    this.clearTimer();
    this.setStatus('idle');
  }

  private markPending(serverBuildId: string): void {
    if (!serverBuildId || serverBuildId === this.currentBuildId) return;
    this.serverBuildId = serverBuildId;
    if (this.pending) {
      this.notify();
      return;
    }
    this.pending = true;
    this.postponed = false;
    this.armReload();
  }

  private armReload(): void {
    if (!this.pending || this.postponed) return;
    this.clearTimer();
    if (document.hidden) {
      this.reloadNow();
      return;
    }
    if (this.isUserBusy()) {
      this.setStatus('waiting');
      return;
    }
    this.secondsLeft = RELOAD_DELAY_SECONDS;
    this.setStatus('scheduled');
    this.timer = window.setInterval(() => this.tick(), 1000);
  }

  private tick(): void {
    if (this.isUserBusy()) {
      this.clearTimer();
      this.setStatus('waiting');
      return;
    }
    this.secondsLeft -= 1;
    if (this.secondsLeft <= 0) {
      this.reloadNow();
      return;
    }
    this.notify();
  }

  private isUserBusy(): boolean {
    if (this.busyCount > 0) return true;
    const active = document.activeElement as HTMLElement | null;
    if (!active) return false;
    const tag = active.tagName;
    return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || active.isContentEditable;
  }

  private reloadNow(): void {
    this.clearTimer();
    if (this.status !== 'reloading') {
      this.status = 'reloading';
      this.notify();
    }
    const buildId = this.serverBuildId || this.currentBuildId;
    try {
      const url = new URL(window.location.href);
      if (buildId) url.searchParams.set('_v', buildId);
      window.location.replace(url.toString());
    } catch {
      window.location.reload();
    }
  }

  private handleVisibility = (): void => {
    if (document.hidden) {
      // Reloading while hidden is invisible to the user.
      if (this.pending) this.reloadNow();
      return;
    }
    void this.checkNow();
    if (this.pending && !this.postponed) this.armReload();
  };

  private handleFocusOut = (): void => {
    if (!this.pending || this.postponed) return;
    if (this.focusTimer) window.clearTimeout(this.focusTimer);
    this.focusTimer = window.setTimeout(() => {
      this.focusTimer = null;
      if (this.pending && !this.postponed && this.status === 'waiting') this.armReload();
    }, FOCUS_RELEASE_DELAY_MS);
  };

  private handleWindowFocus = (): void => {
    void this.checkNow();
  };

  private setStatus(status: UpdateStatus): void {
    this.status = status;
    if (status !== 'scheduled') this.secondsLeft = 0;
    this.notify();
  }

  private clearTimer(): void {
    if (this.timer !== null) {
      window.clearInterval(this.timer);
      this.timer = null;
    }
  }

  private notify(): void {
    const state = this.getState();
    this.listeners.forEach((listener) => {
      try {
        listener(state);
      } catch (e) {
        console.error('[Ahududu Updates] listener error:', e);
      }
    });
  }
}

export const updates = new UpdateManager();
