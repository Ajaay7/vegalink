// Reassembles length-prefixed records from arbitrarily split binary chunks.
// Record layout: ['V' 'L'][u32 BE n][n bytes: u8 kind, f64 BE sentAt, payload].

export type SpikeRecord = {kind: number; sentAt: number; payload: Uint8Array};

const MAGIC0 = 0x56; // 'V'
const MAGIC1 = 0x4c; // 'L'
const HEADER = 6; // magic + length
const MAX_RECORD = 16 * 1024 * 1024;

export class RecordStream {
  private buf = new Uint8Array(0);
  private len = 0;
  /** Bytes skipped while looking for the next record marker (should stay 0). */
  resyncBytes = 0;

  /** Appends a chunk and returns every complete record now available. */
  push(chunk: Uint8Array): SpikeRecord[] {
    this.append(chunk);
    const out: SpikeRecord[] = [];
    let off = 0;
    for (;;) {
      // Find the record marker; anything before it is garbage.
      while (off + 1 < this.len && !(this.buf[off] === MAGIC0 && this.buf[off + 1] === MAGIC1)) {
        off++;
        this.resyncBytes++;
      }
      if (this.len - off < HEADER) break;
      const n = ((this.buf[off + 2] << 24) | (this.buf[off + 3] << 16) | (this.buf[off + 4] << 8) | this.buf[off + 5]) >>> 0;
      if (n < 9 || n > MAX_RECORD) {
        // Not a real record header; skip the marker and keep scanning.
        off += 1;
        this.resyncBytes++;
        continue;
      }
      if (this.len - off < HEADER + n) break;
      const body = this.buf.subarray(off + HEADER, off + HEADER + n);
      const view = new DataView(body.buffer, body.byteOffset, body.byteLength);
      // slice() copies, so records stay valid after the internal buffer is reused.
      out.push({kind: body[0], sentAt: view.getFloat64(1, false), payload: body.slice(9)});
      off += HEADER + n;
    }
    this.consume(off);
    return out;
  }

  reset(): void {
    this.len = 0;
    this.resyncBytes = 0;
  }

  private append(chunk: Uint8Array): void {
    if (this.len + chunk.byteLength > this.buf.byteLength) {
      const next = new Uint8Array(Math.max(this.buf.byteLength * 2, this.len + chunk.byteLength, 64 * 1024));
      next.set(this.buf.subarray(0, this.len));
      this.buf = next;
    }
    this.buf.set(chunk, this.len);
    this.len += chunk.byteLength;
  }

  private consume(n: number): void {
    if (n === 0) return;
    this.buf.copyWithin(0, n, this.len);
    this.len -= n;
  }
}
