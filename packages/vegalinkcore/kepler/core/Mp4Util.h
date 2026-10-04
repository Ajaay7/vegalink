#pragma once

#include <cstddef>
#include <cstdint>
#include <vector>

namespace vegalink {

struct ByteSpan {
  const uint8_t* data = nullptr;
  size_t size = 0;
  bool empty() const { return size == 0; }
};

/** Returns the payload of the first box of `type` (searching nested containers), or empty. */
ByteSpan findBoxPayload(const uint8_t* data, size_t size, const char type[4]);

/**
 * Extracts the AVCDecoderConfigurationRecord (avcC payload) from an fMP4 init
 * segment (ftyp+moov). This is the decoder "extradata" carrying SPS/PPS.
 */
std::vector<uint8_t> extractAvcC(const uint8_t* init, size_t size);

/** Returns the mdat payload (length-prefixed NAL units) of a moof+mdat fragment. */
ByteSpan extractMdat(const uint8_t* fragment, size_t size);

}  // namespace vegalink
