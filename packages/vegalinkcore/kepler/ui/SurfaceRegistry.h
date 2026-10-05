#pragma once

#include <apmf/ptr.h>
#include <apmf/iface/com/amazon/kepler/graphics/IMediaSurface.h>

#include <mutex>

namespace vegalink {

/**
 * Hands the IMediaSurface created by the on-screen VegaLinkVideoView (UI thread)
 * to the streaming session (decode thread). Single slot: one video view at a time.
 */
class SurfaceRegistry {
 public:
  using MediaSurface = apmf::Ptr<apmf::iface::com::amazon::kepler::graphics::IMediaSurface>;

  static SurfaceRegistry& instance();

  void set(MediaSurface surface);
  void clear();
  MediaSurface get();
  /** Incremented every time the surface changes, so presenters can notice. */
  unsigned generation();

 private:
  std::mutex mutex_;
  MediaSurface surface_;
  unsigned generation_ = 0;
};

}  // namespace vegalink
