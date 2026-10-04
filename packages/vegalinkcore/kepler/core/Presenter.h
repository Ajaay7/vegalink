#pragma once

#include <cstdint>
#include <string>

namespace vegalink {

/** A decoded 8-bit 4:2:0 planar frame (I420). Plane pointers are only valid during present(). */
struct YuvFrame {
  int width = 0;
  int height = 0;
  const uint8_t* plane[3] = {nullptr, nullptr, nullptr};
  int stride[3] = {0, 0, 0};
};

/** Puts decoded frames on screen. Called from the decode thread. */
class Presenter {
 public:
  virtual ~Presenter() = default;
  virtual std::string name() const = 0;
  /** Returns false if the frame could not be shown (it is then counted as dropped). */
  virtual bool present(const YuvFrame& frame) = 0;
};

/** Discards frames; used to measure network + decode throughput on its own. */
class NullPresenter : public Presenter {
 public:
  std::string name() const override { return "null"; }
  bool present(const YuvFrame&) override { return true; }
};

}  // namespace vegalink
