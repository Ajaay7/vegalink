#include "RecordReader.h"

#include <cstring>

namespace vegalink {

namespace {
constexpr size_t kHeader = 6;                 // 'V' 'L' + u32 length
constexpr uint32_t kMaxRecord = 16u << 20;    // sanity bound
}  // namespace

void RecordReader::push(const uint8_t* data, size_t size) {
  // Compact consumed bytes before growing.
  if (start_ > 0 && start_ >= buf_.size() / 2) {
    buf_.erase(buf_.begin(), buf_.begin() + static_cast<std::ptrdiff_t>(start_));
    start_ = 0;
  }
  buf_.insert(buf_.end(), data, data + size);
}

bool RecordReader::next(Record& out) {
  for (;;) {
    size_t avail = buf_.size() - start_;
    const uint8_t* p = buf_.data() + start_;
    if (avail < 2) return false;
    if (p[0] != 'V' || p[1] != 'L') {
      ++start_;
      ++resync_;
      continue;
    }
    if (avail < kHeader) return false;
    uint32_t n = (uint32_t(p[2]) << 24) | (uint32_t(p[3]) << 16) | (uint32_t(p[4]) << 8) | uint32_t(p[5]);
    if (n < 9 || n > kMaxRecord) {
      ++start_;
      ++resync_;
      continue;
    }
    if (avail < kHeader + n) return false;

    const uint8_t* body = p + kHeader;
    out.kind = body[0];
    uint64_t bits = 0;
    for (int i = 0; i < 8; ++i) bits = (bits << 8) | body[1 + i];
    std::memcpy(&out.sentAtMs, &bits, sizeof(bits));
    out.payload.assign(body + 9, body + n);
    start_ += kHeader + n;
    return true;
  }
}

}  // namespace vegalink
