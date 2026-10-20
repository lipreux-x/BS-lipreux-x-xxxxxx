import { AppState, type NativeEventSubscription } from 'react-native';
import type { WireMessage } from './api';

/*
 * WebSocket to /ws. The socket is only a fast path: after every (re)connect
 * the app resyncs over HTTP, so a message missed while offline or during a
 * Wi-Fi <-> 4G switch is still fetched (SPEC §5.1).
 *
 * A socket can die without a close event (iOS suspends the app, Android
 * dozes, the network changes): the server pings every 25 s, so a socket
 * silent for longer than SILENT_MS is replaced, checked on a timer and when
 * the app comes back to the foreground.
 */

const MIN_BACKOFF_MS = 1000;
const MAX_BACKOFF_MS = 30_000;
const SILENT_MS = 60_000; // two server pings missed
const WATCH_MS = 10_000;

export interface RealtimeHandlers {
  onMessage(message: WireMessage): void;
  /** An admin erased part of this group's history: reload it. */
  onPurge?(groupId: string): void;
  /** Socket (re)opened: resync anything missed while disconnected. */
  onConnected(): void;
  onStatus?(online: boolean): void;
}

export class RealtimeClient {
  private ws: WebSocket | null = null;
  private backoff = MIN_BACKOFF_MS;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private stopped = true;
  /** Bumped by every connect: one still waiting for its token gives up if another started since. */
  private attempt = 0;
  private lastFrameAt = 0;
  private watchdog: ReturnType<typeof setInterval> | null = null;
  private appState: NativeEventSubscription | null = null;

  constructor(
    private readonly baseUrl: string,
    private readonly getToken: () => Promise<string>,
    private readonly handlers: RealtimeHandlers,
  ) {}

  start(): void {
    if (!this.stopped) return;
    this.stopped = false;
    this.watchdog = setInterval(() => this.reconnectIfSilent(), WATCH_MS);
    this.appState = AppState.addEventListener('change', (state) => {
      if (state === 'active') this.reconnectIfSilent();
    });
    void this.connect();
  }

  stop(): void {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    if (this.watchdog) clearInterval(this.watchdog);
    this.watchdog = null;
    this.appState?.remove();
    this.appState = null;
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

  private reconnectIfSilent(): void {
    if (this.ws && Date.now() - this.lastFrameAt > SILENT_MS) this.reconnectNow();
  }

  private async connect(): Promise<void> {
    if (this.stopped || this.ws) return;
    const attempt = ++this.attempt;
    let token: string;
    try {
      token = await this.getToken(); // fresh each attempt: tokens are short-lived
    } catch {
      if (attempt === this.attempt) this.scheduleReconnect();
      return;
    }
    if (this.stopped || this.ws || attempt !== this.attempt) return;

    const ws = new WebSocket(`${this.baseUrl.replace(/^http/, 'ws')}/ws?token=${encodeURIComponent(token)}`);
    this.ws = ws;
    this.lastFrameAt = Date.now();
    ws.onmessage = (event) => {
      this.lastFrameAt = Date.now();
      let data: { type?: string; message?: WireMessage; groupId?: string };
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
      } else if (data.type === 'purge' && data.groupId) {
        this.handlers.onPurge?.(data.groupId);
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
