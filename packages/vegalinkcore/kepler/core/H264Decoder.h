#pragma once

#include <cstddef>
#include <cstdint>
#include <functional>
#include <memory>
#include <string>
#include <vector>

#include "Presenter.h"

namespace vegalink {

/**
 * Software H.264 decoder (ffmpeg libavcodec). Input is AVCC (length-prefixed
 * NAL units) as found in fMP4 mdat, configured with the avcC record.
 * Only available when built with VEGALINK_HAVE_FFMPEG; otherwise open() fails.
 */
class H264Decoder {
 public:
  /** pts is the value passed to decode() for the access unit this frame came from. */
  using FrameCallback = std::function<void(const YuvFrame&, int64_t pts)>;

  H264Decoder();
  ~H264Decoder();

  static bool available();

  /** threads: 1 = lowest latency; 2+ = frame threading (adds threads-1 frames of delay). */
  bool open(const std::vector<uint8_t>& avcC, int threads, std::string& error);
  /** Decodes one access unit; invokes onFrame for every frame that becomes ready. */
  bool decode(const uint8_t* data, size_t size, int64_t pts, const FrameCallback& onFrame, std::string& error);
  void close();

 private:
  struct Impl;
  std::unique_ptr<Impl> impl_;
};

}  // namespace vegalink
