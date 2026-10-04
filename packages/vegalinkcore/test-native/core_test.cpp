// Host-side tests for the platform-independent parsing code.
// Build & run: test-native/run.sh [path/to/clip.mp4]
#include <cassert>
#include <cstdio>
#include <cstring>
#include <fstream>
#include <iterator>
#include <vector>

#include "../kepler/core/Mp4Util.h"
#include "../kepler/core/RecordReader.h"

using namespace vegalink;

static std::vector<uint8_t> box(const char* type, std::vector<uint8_t> payload) {
  std::vector<uint8_t> out(8);
  uint32_t n = uint32_t(8 + payload.size());
  out[0] = n >> 24; out[1] = n >> 16; out[2] = n >> 8; out[3] = n;
  std::memcpy(&out[4], type, 4);
  out.insert(out.end(), payload.begin(), payload.end());
  return out;
}

static std::vector<uint8_t> record(uint8_t kind, double ts, const std::vector<uint8_t>& payload) {
  std::vector<uint8_t> out = {'V', 'L', 0, 0, 0, 0, kind};
  uint32_t n = uint32_t(9 + payload.size());
  out[2] = n >> 24; out[3] = n >> 16; out[4] = n >> 8; out[5] = n;
  uint64_t bits;
  std::memcpy(&bits, &ts, 8);
  for (int i = 7; i >= 0; --i) out.push_back(uint8_t(bits >> (i * 8)));
  out.insert(out.end(), payload.begin(), payload.end());
  return out;
}

int main(int argc, char** argv) {
  // mdat extraction from a moof+mdat fragment.
  auto moof = box("moof", box("mfhd", {0, 0, 0, 0, 0, 0, 0, 1}));
  auto mdat = box("mdat", {0, 0, 0, 2, 0x65, 0x88});
  std::vector<uint8_t> frag = moof;
  frag.insert(frag.end(), mdat.begin(), mdat.end());
  ByteSpan m = extractMdat(frag.data(), frag.size());
  assert(m.size == 6 && m.data[4] == 0x65);

  // Record reader with byte-by-byte delivery and leading garbage.
  std::vector<uint8_t> stream = {1, 2, 3};
  auto r1 = record(0, 1234.5, {9, 9});
  auto r2 = record(1, 99, frag);
  stream.insert(stream.end(), r1.begin(), r1.end());
  stream.insert(stream.end(), r2.begin(), r2.end());
  RecordReader rr;
  std::vector<RecordReader::Record> got;
  for (uint8_t b : stream) {
    rr.push(&b, 1);
    RecordReader::Record rec;
    while (rr.next(rec)) got.push_back(rec);
  }
  assert(got.size() == 2);
  assert(got[0].kind == 0 && got[0].sentAtMs == 1234.5 && got[0].payload.size() == 2);
  assert(got[1].kind == 1 && got[1].payload == frag);
  assert(rr.resyncBytes() == 3);

  // avcC from a real MP4 (moov of the game clip), if given.
  if (argc > 1) {
    std::ifstream f(argv[1], std::ios::binary);
    std::vector<uint8_t> file((std::istreambuf_iterator<char>(f)), {});
    auto avcc = extractAvcC(file.data(), file.size());
    assert(avcc.size() > 7 && avcc[0] == 1);
    std::printf("avcC: %zu bytes, profile=%u level=%u nal_length_size=%u\n", avcc.size(), avcc[1], avcc[3], (avcc[4] & 3) + 1);
  }
  std::printf("core_test: all passed\n");
  return 0;
}
