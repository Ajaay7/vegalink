#pragma once

#include <atomic>
#include <chrono>
#include <cstdint>
#include <mutex>
#include <string>
#include <vector>

#include <apmf/ptr.h>
#include <apmf/iface/com/amazon/apmf/ISubscription.h>
#include <apmf/iface/com/amazon/kepler/buffer/IBufferGroup.h>
#include <apmf/iface/com/amazon/kepler/graphics/IMediaSurface.h>
#include <apmf/iface/com/amazon/kepler/graphics/IObjectFactory.h>

#include "../core/Presenter.h"

namespace vegalink {

/**
 * Presents software-decoded I420 frames on the IMediaSurface published by
 * VegaLinkVideoView. Frames are copied into a small pool of CPU-writable
 * graphics buffers and presented without a PTS (shown as soon as possible).
 * If the pool is exhausted (display slower than decode) the frame is dropped
 * rather than queued, to keep latency bounded.
 */
class MediaSurfacePresenter : public Presenter {
 public:
  MediaSurfacePresenter();
  ~MediaSurfacePresenter() override;

  std::string name() const override;
  bool present(const YuvFrame& frame) override;

  /** Called from the buffer release listener. */
  void onReleased(int64_t bufferId);

 private:
  struct Slot {
    apmf::Ptr<apmf::iface::com::amazon::kepler::buffer::IBufferGroup> group;
    int64_t id = 0;
    bool busy = false;
    int stride[3] = {0, 0, 0};
    int planeHeight[3] = {0, 0, 0};
    int planes = 0;
  };

  bool ensureSurface();
  bool allocate(int width, int height);
  void reset();
  bool copyInto(Slot& slot, const YuvFrame& frame);

  apmf::Ptr<apmf::iface::com::amazon::kepler::graphics::IObjectFactory> factory_;
  apmf::Ptr<apmf::iface::com::amazon::kepler::graphics::IMediaSurface> surface_;
  apmf::Ptr<apmf::iface::com::amazon::apmf::ISubscription> releaseSub_;
  std::chrono::steady_clock::time_point lastSurfaceCheck_{};

  std::mutex slotsMutex_;
  std::vector<Slot> slots_;
  int width_ = 0;
  int height_ = 0;
  bool nv12_ = false;
  std::string status_ = "waiting for surface";
  std::atomic<int> lastResult_{-1};
};

}  // namespace vegalink
