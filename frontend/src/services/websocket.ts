import { UserId } from '../types';
import { playHaptic, soundEngine, HAPTIC_PATTERNS } from './haptics';

type MessageHandler = (data: any) => void;

class WebSocketClient {
  private ws: WebSocket | null = null;
  private currentUserId: UserId | null = null;
  private handlers: Map<string, Set<MessageHandler>> = new Map();
  private reconnectTimer: any = null;
  private isExplicitlyClosed = false;

  connect(userId: UserId) {
    if (this.ws && this.currentUserId === userId && this.ws.readyState === WebSocket.OPEN) {
      return;
    }
    this.currentUserId = userId;
    this.isExplicitlyClosed = false;

    // Determine WS URL
    let wsHost = window.location.host;
    let wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';

    // If running in Capacitor Android Native App (where host is localhost)
    if (window.location.hostname === 'localhost' && window.location.port !== '33470' && window.location.port !== '5173') {
      const serverUrl = localStorage.getItem('ahududu_server_url') || 'https://ahududu.fakeyol.com';
      const cleanHost = serverUrl.replace(/^https?:\/\//, '').replace(/\/$/, '');
      const isHttps = serverUrl.startsWith('https');
      wsProtocol = isHttps ? 'wss:' : 'ws:';
      wsHost = cleanHost;
    }

    const wsUrl = `${wsProtocol}//${wsHost}/ws/${userId}`;

    try {
      this.ws = new WebSocket(wsUrl);

      this.ws.onopen = () => {
        console.log(`[Ahududu WS] Connected as ${userId}`);
        this.emit('connection_status', { connected: true });
        if (this.reconnectTimer) {
          clearTimeout(this.reconnectTimer);
          this.reconnectTimer = null;
        }
      };

      this.ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          this.handleIncoming(data);
        } catch (e) {
          console.error('[Ahududu WS] JSON Parse error:', e);
        }
      };

      this.ws.onclose = () => {
        console.warn(`[Ahududu WS] Closed for ${userId}`);
        this.emit('connection_status', { connected: false });
        if (!this.isExplicitlyClosed) {
          this.scheduleReconnect();
        }
      };

      this.ws.onerror = (err) => {
        console.warn('[Ahududu WS] Error:', err);
      };
    } catch (e) {
      console.error('[Ahududu WS] Connection error:', e);
      this.scheduleReconnect();
    }
  }

  private scheduleReconnect() {
    if (this.reconnectTimer) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (this.currentUserId && !this.isExplicitlyClosed) {
        console.log('[Ahududu WS] Reconnecting...');
        this.connect(this.currentUserId);
      }
    }, 3000);
  }

  private handleIncoming(data: any) {
    const type = data.type;

    // Automatic haptic and sound triggers for nudges & remote vibrations
    if (type === 'nudge') {
      playHaptic(HAPTIC_PATTERNS.attention);
      soundEngine.playLoveChime();
    } else if (type === 'remote_vibrate') {
      const pattern = data.vibration_pattern || HAPTIC_PATTERNS.heartbeat;
      playHaptic(pattern);
    } else if (type === 'walkie_talkie_play') {
      soundEngine.playWalkieBeep();
    } else if (type === 'new_letter') {
      playHaptic(HAPTIC_PATTERNS.hug);
      soundEngine.playLoveChime();
    }

    // Trigger registered event listeners
    this.emit(type, data);
    this.emit('*', data);
  }

  send(data: any) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(data));
    } else {
      console.warn('[Ahududu WS] Cannot send, socket not open');
    }
  }

  on(event: string, handler: MessageHandler) {
    if (!this.handlers.has(event)) {
      this.handlers.set(event, new Set());
    }
    this.handlers.get(event)!.add(handler);
    return () => this.off(event, handler);
  }

  off(event: string, handler: MessageHandler) {
    const set = this.handlers.get(event);
    if (set) {
      set.delete(handler);
    }
  }

  private emit(event: string, data: any) {
    const set = this.handlers.get(event);
    if (set) {
      set.forEach((h) => {
        try {
          h(data);
        } catch (e) {
          console.error(`Error in WS event handler for ${event}:`, e);
        }
      });
    }
  }

  disconnect() {
    this.isExplicitlyClosed = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }
}

export const wsClient = new WebSocketClient();
