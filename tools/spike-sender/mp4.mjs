// Splits a byte stream into top-level ISO-BMFF boxes (ftyp, moov, moof, mdat, ...).
export class Mp4BoxSplitter {
  constructor(onBox) {
    this.onBox = onBox;
    this.buf = Buffer.alloc(0);
  }

  push(chunk) {
    this.buf = this.buf.length ? Buffer.concat([this.buf, chunk]) : chunk;
    let off = 0;
    for (;;) {
      if (this.buf.length - off < 8) break;
      let size = this.buf.readUInt32BE(off);
      const type = this.buf.toString('latin1', off + 4, off + 8);
      if (size === 1) {
        if (this.buf.length - off < 16) break;
        size = Number(this.buf.readBigUInt64BE(off + 8));
      } else if (size === 0) {
        break; // box extends to end of stream; never used by fragmented output
      }
      if (size < 8) throw new Error(`invalid box size ${size} for '${type}'`);
      if (this.buf.length - off < size) break;
      this.onBox(type, this.buf.subarray(off, off + size));
      off += size;
    }
    this.buf = off ? Buffer.from(this.buf.subarray(off)) : this.buf;
  }
}
