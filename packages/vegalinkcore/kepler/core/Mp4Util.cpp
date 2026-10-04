#include "Mp4Util.h"

#include <cstring>

namespace vegalink {

namespace {

uint32_t be32(const uint8_t* p) {
  return (uint32_t(p[0]) << 24) | (uint32_t(p[1]) << 16) | (uint32_t(p[2]) << 8) | uint32_t(p[3]);
}

uint64_t be64(const uint8_t* p) { return (uint64_t(be32(p)) << 32) | be32(p + 4); }

// Containers whose children are plain boxes directly after the header.
bool isContainer(const uint8_t* type) {
  static const char* kContainers[] = {"moov", "trak", "mdia", "minf", "stbl", "moof", "traf", "mvex", "edts", "dinf"};
  for (const char* c : kContainers) {
    if (std::memcmp(type, c, 4) == 0) return true;
  }
  return false;
}

// Boxes whose children start after a fixed-size header of their own.
size_t childOffset(const uint8_t* type) {
  if (std::memcmp(type, "stsd", 4) == 0) return 8;   // fullbox header + entry_count
  if (std::memcmp(type, "avc1", 4) == 0) return 78;  // VisualSampleEntry fields
  if (std::memcmp(type, "avc3", 4) == 0) return 78;
  return 0;
}

}  // namespace

ByteSpan findBoxPayload(const uint8_t* data, size_t size, const char type[4]) {
  size_t off = 0;
  while (off + 8 <= size) {
    uint64_t boxSize = be32(data + off);
    size_t header = 8;
    const uint8_t* boxType = data + off + 4;
    if (boxSize == 1) {
      if (off + 16 > size) break;
      boxSize = be64(data + off + 8);
      header = 16;
    } else if (boxSize == 0) {
      boxSize = size - off;
    }
    if (boxSize < header || boxSize > size - off) break;

    const uint8_t* payload = data + off + header;
    size_t payloadSize = size_t(boxSize) - header;
    if (std::memcmp(boxType, type, 4) == 0) return {payload, payloadSize};

    size_t skip = childOffset(boxType);
    if ((isContainer(boxType) || skip > 0) && payloadSize > skip) {
      ByteSpan found = findBoxPayload(payload + skip, payloadSize - skip, type);
      if (!found.empty()) return found;
    }
    off += size_t(boxSize);
  }
  return {};
}

std::vector<uint8_t> extractAvcC(const uint8_t* init, size_t size) {
  ByteSpan avcc = findBoxPayload(init, size, "avcC");
  return std::vector<uint8_t>(avcc.data, avcc.data + avcc.size);
}

ByteSpan extractMdat(const uint8_t* fragment, size_t size) { return findBoxPayload(fragment, size, "mdat"); }

}  // namespace vegalink
