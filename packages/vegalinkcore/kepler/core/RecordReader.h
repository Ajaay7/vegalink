#pragma once

#include <cstddef>
#include <cstdint>
#include <vector>

namespace vegalink {

/**
 * Incremental parser for the sender's record stream:
 *   ['V' 'L'][u32 BE n][n bytes: u8 kind, f64 BE sentAtMs, payload]
 * kind 0 = fMP4 init segment, 1 = fragment (moof+mdat), 2 = JSON hello.
 */
class RecordReader {
 public:
  struct Record {
    uint8_t kind = 0;
    double sentAtMs = 0;
    std::vector<uint8_t> payload;
  };

  /** Appends received bytes. */
  void push(const uint8_t* data, size_t size);
  /** Pops the next complete record; returns false when more bytes are needed. */
  bool next(Record& out);
  /** Bytes skipped looking for a record marker (should stay 0). */
  size_t resyncBytes() const { return resync_; }

 private:
  std::vector<uint8_t> buf_;
  size_t start_ = 0;
  size_t resync_ = 0;
};

}  // namespace vegalink
