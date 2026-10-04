import {RecordStream} from '../src/spike/RecordStream';

function record(kind: number, sentAt: number, payload: number[]): Uint8Array {
  const out = new Uint8Array(15 + payload.length);
  const v = new DataView(out.buffer);
  out[0] = 0x56;
  out[1] = 0x4c;
  v.setUint32(2, 9 + payload.length, false);
  out[6] = kind;
  v.setFloat64(7, sentAt, false);
  out.set(payload, 15);
  return out;
}

function concat(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let off = 0;
  for (const p of parts) {
    out.set(p, off);
    off += p.length;
  }
  return out;
}

describe('RecordStream', () => {
  const big = Array.from({length: 70000}, (_, i) => i & 0xff);
  const stream = concat([record(0, 1000.5, [1, 2, 3]), record(1, 2000, big), record(1, 3000, [0x56, 0x4c, 9])]);

  it.each([1, 7, 1439, 11575, 16384, stream.length])('reassembles records split into %i-byte chunks', (size) => {
    const rs = new RecordStream();
    const got = [];
    for (let i = 0; i < stream.length; i += size) got.push(...rs.push(stream.subarray(i, i + size)));
    expect(got.map((r) => [r.kind, r.sentAt, r.payload.length])).toEqual([
      [0, 1000.5, 3],
      [1, 2000, 70000],
      [1, 3000, 3],
    ]);
    expect(Array.from(got[1].payload.subarray(0, 5))).toEqual([0, 1, 2, 3, 4]);
    expect(rs.resyncBytes).toBe(0);
  });

  it('records stay intact after later pushes reuse the buffer', () => {
    const rs = new RecordStream();
    const [first] = rs.push(record(1, 1, [9, 9, 9]));
    rs.push(record(1, 2, [7, 7, 7]));
    expect(Array.from(first.payload)).toEqual([9, 9, 9]);
  });

  it('skips garbage before a record', () => {
    const rs = new RecordStream();
    const got = rs.push(concat([new Uint8Array([1, 2, 0x56, 3]), record(1, 5, [4])]));
    expect(got).toHaveLength(1);
    expect(rs.resyncBytes).toBe(4);
  });
});
