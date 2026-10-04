// WebSocket client for the Phase 0 latency spike sender (tools/spike-sender).
// Binary data is a byte stream of length-prefixed records (see RecordStream):
// the Vega WebSocket can split one sent message into several onmessage calls,
// so message boundaries are not relied on. kind 0 = init, 1 = fragment.

import {RecordStream} from './RecordStream';

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
  private badMessages = 0;
  private readonly records = new RecordStream();
  private chunks = 0;

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
      this.records.reset();
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
      const chunk = new Uint8Array(e.data as ArrayBuffer);
      if (this.chunks++ < 5) console.log(`[SpikeClient] chunk ${chunk.byteLength} bytes`);
      const before = this.records.resyncBytes;
      for (const r of this.records.push(chunk)) {
        const box = String.fromCharCode(r.payload[4], r.payload[5], r.payload[6], r.payload[7]);
        if (box !== (r.kind === 0 ? 'ftyp' : 'moof') && this.badMessages++ < 5) {
          console.log(`[SpikeClient] unexpected box '${box}' for kind ${r.kind}, ${r.payload.byteLength} bytes`);
        }
        if (r.kind === 0) {
          this.ev.onInit(r.payload);
        } else {
          const transit = this.clockOffset === undefined ? undefined : Date.now() + this.clockOffset - r.sentAt;
          this.ev.onFragment(r.payload, transit);
        }
      }
      if (this.records.resyncBytes !== before) {
        console.log(`[SpikeClient] skipped ${this.records.resyncBytes - before} bytes looking for a record marker`);
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
