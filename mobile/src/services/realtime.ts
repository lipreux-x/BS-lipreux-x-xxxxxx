import type { WireMessage } from './api';

/*
 * WebSocket to /ws. The socket is only a fast path: after every (re)connect
 * the app resyncs over HTTP, so a message missed while offline or during a
 * Wi-Fi <-> 4G switch is still fetched (SPEC §5.1).
 */

const MIN_BACKOFF_MS = 1000;
const MAX_BACKOFF_MS = 30_000;

export interface RealtimeHandlers {
  onMessage(message: WireMessage): void;
  /** Socket (re)opened: resync anything missed while disconnected. */
  onConnected(): void;
  onStatus?(online: boolean): void;
}

export class RealtimeClient {
  private ws: WebSocket | null = null;
  private backoff = MIN_BACKOFF_MS;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private stopped = true;

  constructor(
    private readonly baseUrl: string,
    private readonly getToken: () => Promise<string>,
    private readonly handlers: RealtimeHandlers,
  ) {}

  start(): void {
    if (!this.stopped) return;
    this.stopped = false;
    void this.connect();
  }

  stop(): void {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    const ws = this.ws;
    this.ws = null;
    ws?.close();
  }

  /** Call on a network change: drop the (possibly dead) socket and reconnect now. */
  reconnectNow(): void {
    if (this.stopped) return;
    this.backoff = MIN_BACKOFF_MS;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    const ws = this.ws;
    this.ws = null;
    ws?.close();
    void this.connect();
  }

  private async connect(): Promise<void> {
    if (this.stopped || this.ws) return;
    let token: string;
    try {
      token = await this.getToken(); // fresh each attempt: tokens are short-lived
    } catch {
      return this.scheduleReconnect();
    }
    if (this.stopped) return;

    const ws = new WebSocket(`${this.baseUrl.replace(/^http/, 'ws')}/ws?token=${encodeURIComponent(token)}`);
    this.ws = ws;
    ws.onmessage = (event) => {
      let data: { type?: string; message?: WireMessage };
      try {
        data = JSON.parse(String(event.data));
      } catch {
        return;
      }
      if (data.type === 'ready') {
        this.backoff = MIN_BACKOFF_MS;
        this.handlers.onStatus?.(true);
        this.handlers.onConnected();
      } else if (data.type === 'message' && data.message) {
        this.handlers.onMessage(data.message);
      }
    };
    ws.onclose = () => {
      if (this.ws !== ws) return; // replaced by reconnectNow()
      this.ws = null;
      this.handlers.onStatus?.(false);
      this.scheduleReconnect();
    };
    ws.onerror = () => ws.close();
  }

  private scheduleReconnect(): void {
    if (this.stopped || this.timer) return;
    const delay = this.backoff;
    this.backoff = Math.min(this.backoff * 2, MAX_BACKOFF_MS);
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.connect();
    }, delay);
  }
}
