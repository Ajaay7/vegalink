import {Fmp4Timeline} from '../src/stream/Fmp4Timeline';

function box(type: string, ...parts: Uint8Array[]): Uint8Array {
  const len = 8 + parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(len);
  new DataView(out.buffer).setUint32(0, len);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  let off = 8;
  for (const p of parts) {
    out.set(p, off);
    off += p.length;
  }
  return out;
}

function u32s(...xs: number[]): Uint8Array {
  const out = new Uint8Array(xs.length * 4);
  const v = new DataView(out.buffer);
  xs.forEach((x, i) => v.setUint32(i * 4, x));
  return out;
}

/** ffmpeg-style fragment: tfhd with default duration, tfdt v1, trun with sizes only. */
function fragment(dts: number, defaultDuration: number, sampleDurations?: number[]): Uint8Array {
  const tfhd = box('tfhd', u32s(0x020008, 1, defaultDuration)); // default-base-is-moof + default duration
  const tfdtBody = new Uint8Array(12);
  const tv = new DataView(tfdtBody.buffer);
  tv.setUint32(0, 0x01000000); // version 1
  tv.setBigUint64(4, BigInt(dts));
  const tfdt = box('tfdt', tfdtBody);
  const trun = sampleDurations
    ? box('trun', u32s(0x000301, sampleDurations.length, 0, ...sampleDurations.flatMap((d) => [d, 100])))
    : box('trun', u32s(0x000201, 1, 0, 100));
  return new Uint8Array([...box('moof', box('mfhd', u32s(0, 1)), box('traf', tfhd, tfdt, trun)), ...box('mdat', new Uint8Array(4))]);
}

function readDts(frag: Uint8Array): number {
  // moof(8) + mfhd(16) + traf(8) + tfhd(20) + tfdt header(8) + version/flags(4)
  return Number(new DataView(frag.buffer).getBigUint64(8 + 16 + 8 + 20 + 8 + 4));
}

describe('Fmp4Timeline', () => {
  it('makes irregular capture timestamps contiguous', () => {
    const t = new Fmp4Timeline();
    // Desktop capture: frames at 0, 16ms, then a 67ms gap, then 300ms later.
    const frags = [fragment(0, 1000), fragment(1000, 1000), fragment(5000, 1000), fragment(23000, 1000)];
    frags.forEach((f) => expect(t.retime(f)).toBe(true));
    expect(frags.map(readDts)).toEqual([0, 1000, 2000, 3000]);
  });

  it('uses per-sample durations from trun when present', () => {
    const t = new Fmp4Timeline();
    const a = fragment(0, 1000, [500, 700]);
    const b = fragment(99999, 1000);
    t.retime(a);
    t.retime(b);
    expect(readDts(b)).toBe(1200);
  });

  it('leaves non-fragments untouched', () => {
    expect(new Fmp4Timeline().retime(box('ftyp', u32s(1)))).toBe(false);
  });
});
