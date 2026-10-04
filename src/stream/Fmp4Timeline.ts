// Rewrites fMP4 fragment decode times so consecutive fragments are always
// contiguous. MSE treats a gap larger than 2x the previous frame duration as a
// discontinuity and then drops every frame until the next keyframe, which
// freezes a game stream (frames arrive irregularly, keyframes are rare).
// Re-timing frames back-to-back also means each frame is presented as soon as
// it arrives instead of at its original capture time.

type Box = {type: string; start: number; size: number; header: number};

function readBoxes(b: Uint8Array, start: number, end: number): Box[] {
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const out: Box[] = [];
  let off = start;
  while (off + 8 <= end) {
    let size = v.getUint32(off);
    let header = 8;
    const type = String.fromCharCode(b[off + 4], b[off + 5], b[off + 6], b[off + 7]);
    if (size === 1) {
      size = Number(v.getBigUint64(off + 8));
      header = 16;
    } else if (size === 0) {
      size = end - off;
    }
    if (size < header || off + size > end) break;
    out.push({type, start: off, size, header});
    off += size;
  }
  return out;
}

export class Fmp4Timeline {
  /** Next decode time to assign, in track timescale units. */
  private nextDts = 0;
  /** Fallback per-sample duration when a fragment carries none. */
  constructor(private readonly fallbackDuration = 0) {}

  reset(): void {
    this.nextDts = 0;
  }

  /**
   * Rewrites tfdt in every traf of the fragment (in place) to continue the
   * timeline, and advances it by the fragment's total sample duration.
   * Returns false if the fragment could not be parsed (left untouched).
   */
  retime(frag: Uint8Array): boolean {
    const v = new DataView(frag.buffer, frag.byteOffset, frag.byteLength);
    const moof = readBoxes(frag, 0, frag.byteLength).find((x) => x.type === 'moof');
    if (!moof) return false;
    let advanced = 0;
    let ok = false;
    for (const traf of readBoxes(frag, moof.start + moof.header, moof.start + moof.size)) {
      if (traf.type !== 'traf') continue;
      const kids = readBoxes(frag, traf.start + traf.header, traf.start + traf.size);
      const tfhd = kids.find((x) => x.type === 'tfhd');
      const tfdt = kids.find((x) => x.type === 'tfdt');
      if (!tfhd || !tfdt) continue;

      // tfhd: fullbox flags, track_ID, then optional fields in flag order.
      const tfhdFlags = v.getUint32(tfhd.start + tfhd.header) & 0xffffff;
      let p = tfhd.start + tfhd.header + 8;
      if (tfhdFlags & 0x01) p += 8; // base_data_offset
      if (tfhdFlags & 0x02) p += 4; // sample_description_index
      const defaultDuration = tfhdFlags & 0x08 ? v.getUint32(p) : this.fallbackDuration;

      let total = 0;
      for (const trun of kids.filter((x) => x.type === 'trun')) {
        const flags = v.getUint32(trun.start + trun.header) & 0xffffff;
        const count = v.getUint32(trun.start + trun.header + 4);
        let q = trun.start + trun.header + 8;
        if (flags & 0x001) q += 4; // data_offset
        if (flags & 0x004) q += 4; // first_sample_flags
        const per = (flags & 0x100 ? 4 : 0) + (flags & 0x200 ? 4 : 0) + (flags & 0x400 ? 4 : 0) + (flags & 0x800 ? 4 : 0);
        for (let i = 0; i < count; i++) {
          total += flags & 0x100 ? v.getUint32(q + i * per) : defaultDuration;
        }
      }

      const version = frag[tfdt.start + tfdt.header];
      const at = tfdt.start + tfdt.header + 4;
      if (version === 1) v.setBigUint64(at, BigInt(this.nextDts));
      else v.setUint32(at, this.nextDts >>> 0);
      advanced = Math.max(advanced, total);
      ok = true;
    }
    if (ok) this.nextDts += advanced || this.fallbackDuration;
    return ok;
  }
}
