#include "SurfaceRegistry.h"

namespace vegalink {

SurfaceRegistry& SurfaceRegistry::instance() {
  static SurfaceRegistry registry;
  return registry;
}

void SurfaceRegistry::set(MediaSurface surface) {
  std::lock_guard<std::mutex> lock(mutex_);
  surface_ = std::move(surface);
  ++generation_;
}

void SurfaceRegistry::clear() {
  std::lock_guard<std::mutex> lock(mutex_);
  surface_ = nullptr;
  ++generation_;
}

SurfaceRegistry::MediaSurface SurfaceRegistry::get() {
  std::lock_guard<std::mutex> lock(mutex_);
  return surface_;
}

unsigned SurfaceRegistry::generation() {
  std::lock_guard<std::mutex> lock(mutex_);
  return generation_;
}

}  // namespace vegalink
