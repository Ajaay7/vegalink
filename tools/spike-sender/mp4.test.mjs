import assert from 'node:assert/strict';
import {test} from 'node:test';
import {Mp4BoxSplitter} from './mp4.mjs';

function box(type, payloadLen) {
  const b = Buffer.alloc(8 + payloadLen, 0xab);
  b.writeUInt32BE(8 + payloadLen, 0);
  b.write(type, 4, 'latin1');
  return b;
}

test('splits boxes across arbitrary chunk boundaries', () => {
  const stream = Buffer.concat([box('ftyp', 12), box('moov', 300), box('moof', 90), box('mdat', 5000), box('moof', 90), box('mdat', 1)]);
  for (const chunkSize of [1, 3, 7, 64, 1000, stream.length]) {
    const seen = [];
    const s = new Mp4BoxSplitter((type, b) => seen.push([type, b.length]));
    for (let i = 0; i < stream.length; i += chunkSize) s.push(stream.subarray(i, i + chunkSize));
    assert.deepEqual(seen, [['ftyp', 20], ['moov', 308], ['moof', 98], ['mdat', 5008], ['moof', 98], ['mdat', 9]]);
  }
});

test('handles 64-bit largesize boxes', () => {
  const b = Buffer.alloc(16 + 4);
  b.writeUInt32BE(1, 0);
  b.write('mdat', 4, 'latin1');
  b.writeBigUInt64BE(20n, 8);
  const seen = [];
  new Mp4BoxSplitter((t, x) => seen.push([t, x.length])).push(b);
  assert.deepEqual(seen, [['mdat', 20]]);
});
