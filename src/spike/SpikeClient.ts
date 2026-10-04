// WebSocket client for the Phase 0 latency spike sender (tools/spike-sender).
// Wire format: [u8 kind][f64 BE sender ms][payload]; kind 0 = init, 1 = fragment.

export type SpikeHello = {codec: string; size: string; fps: number; encoder: string; source: string};

export type SpikeClientEvents = {
  onHello: (h: SpikeHello) => void;
  onInit: (data: Uint8Array) => void;
  onFragment: (data: Uint8Array, transitMs: number | undefined) => void;
  onState: (state: 'connecting' | 'open' | 'closed', detail?: string) => void;
  onRtt: (rttMs: number) => void;
};

export class SpikeClient {
  private ws?: WebSocket;
  private pingTimer?: ReturnType<typeof setInterval>;
  /** Estimated serverClock - localClock, from the lowest-RTT ping seen. */
  private clockOffset?: number;
  private bestRtt = Infinity;

  constructor(private readonly ev: SpikeClientEvents) {}

  connect(url: string): void {
    this.close();
    this.ev.onState('connecting');
    const ws = new WebSocket(url);
    (ws as unknown as {binaryType: string}).binaryType = 'arraybuffer';
    this.ws = ws;

    ws.onopen = () => {
      this.ev.onState('open');
      this.bestRtt = Infinity;
      this.clockOffset = undefined;
      this.pingTimer = setInterval(() => ws.send(JSON.stringify({t: 'ping', c: Date.now()})), 1000);
    };
    ws.onclose = (e) => {
      this.stopPing();
      this.ev.onState('closed', e.reason || `code ${e.code}`);
    };
    ws.onerror = (e) => {
      this.ev.onState('closed', (e as unknown as {message?: string}).message ?? 'error');
    };
    ws.onmessage = (e) => {
      if (typeof e.data === 'string') {
        this.handleText(e.data);
        return;
      }
      const buf = e.data as ArrayBuffer;
      const view = new DataView(buf);
      const kind = view.getUint8(0);
      const sentAt = view.getFloat64(1, false);
      const payload = new Uint8Array(buf, 9);
      if (kind === 0) {
        this.ev.onInit(payload);
      } else {
        const transit = this.clockOffset === undefined ? undefined : Date.now() + this.clockOffset - sentAt;
        this.ev.onFragment(payload, transit);
      }
    };
  }

  private handleText(text: string): void {
    let msg: {t: string; c?: number; s?: number} & Partial<SpikeHello>;
    try {
      msg = JSON.parse(text);
    } catch {
      return;
    }
    if (msg.t === 'hello') {
      this.ev.onHello(msg as unknown as SpikeHello);
    } else if (msg.t === 'pong' && msg.c !== undefined && msg.s !== undefined) {
      const now = Date.now();
      const rtt = now - msg.c;
      this.ev.onRtt(rtt);
      if (rtt <= this.bestRtt) {
        this.bestRtt = rtt;
        this.clockOffset = msg.s - (msg.c + now) / 2;
      }
    }
  }

  private stopPing(): void {
    if (this.pingTimer) clearInterval(this.pingTimer);
    this.pingTimer = undefined;
  }

  close(): void {
    this.stopPing();
    if (this.ws) {
      this.ws.onclose = null;
      this.ws.close();
      this.ws = undefined;
    }
  }
}

/** Builds the MSE MIME string for the codec announced by the sender. */
export function mimeForCodec(codec: string): string {
  return codec === 'hevc'
    ? 'video/mp4; codecs="hvc1.1.6.L120.B0"'
    : 'video/mp4; codecs="avc1.640028"';
}
