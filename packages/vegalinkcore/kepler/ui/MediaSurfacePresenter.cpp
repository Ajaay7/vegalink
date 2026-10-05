#include "MediaSurfacePresenter.h"

#include <apmf/apmf_base.h>
#include <apmf/data_object.h>
#include <apmf/process.h>
#include <apmf/iface/com/amazon/apmf/IByteBufferMapping.h>
#include <apmf/iface/com/amazon/apmf/IMutableByteBufferMapping.h>
#include <apmf/iface/com/amazon/apmf/IDataObject.h>
#include <apmf/iface/com/amazon/kepler/buffer/IBuffer.h>
#include <apmf/iface/com/amazon/kepler/graphics/BufferMime.h>
#include <apmf/iface/com/amazon/kepler/graphics/BufferPixelFormat.h>
#include <apmf/iface/com/amazon/kepler/graphics/BufferUsage.h>
#include <apmf/iface/com/amazon/kepler/graphics/GraphicsBufferData.h>
#include <apmf/iface/com/amazon/kepler/graphics/GraphicsBufferGroupData.h>
#include <apmf/iface/com/amazon/kepler/graphics/IBufferReleaseListener.h>
#include <apmf/iface/com/amazon/kepler/graphics/PresentResult.h>

#include <Kepler/turbomodule/TMLog.h>

#include <cstring>

#include <apmf/iface/com/amazon/kepler/uitoolkit/view/IKeplerMediaSurfaceProvider.h>

namespace vegalink {

namespace kg = apmf::iface::com::amazon::kepler::graphics;
namespace kb = apmf::iface::com::amazon::kepler::buffer;
namespace ka = apmf::iface::com::amazon::apmf;

namespace {

constexpr int kPoolSize = 4;

struct ReleaseListener : apmf::ApmfBase<ReleaseListener, kg::IBufferReleaseListener> {
  explicit ReleaseListener(MediaSurfacePresenter* owner) : owner_(owner) {}
  void onBufferRelease(apmf::View<kb::IBufferGroup> buffer) {
    if (owner_ && buffer) owner_->onReleased(apmf::Ptr<kb::IBufferGroup>(buffer)->getUniqueId());
  }
  MediaSurfacePresenter* owner_;
};

uint8_t* mapPointer(apmf::Ptr<ka::IMutableByteBufferMapping> const& mapping) {
  return reinterpret_cast<uint8_t*>(static_cast<uintptr_t>(mapping->getMapPointer().pointer));
}

}  // namespace

MediaSurfacePresenter::MediaSurfacePresenter() {
  factory_ = apmf::GetProcessObject()
                 ->getComponent("/com.amazon.kepler.graphics.IObjectFactory")
                 .TryQueryInterface<kg::IObjectFactory>();
  if (!factory_) status_ = "graphics IObjectFactory unavailable";
}

MediaSurfacePresenter::~MediaSurfacePresenter() { reset(); }

std::string MediaSurfacePresenter::name() const {
  std::string n = "surface(" + std::string(nv12_ ? "NV12" : "I420") + ", " + status_;
  int r = lastResult_.load();
  if (r >= 0) n += ", last=" + std::to_string(r);
  return n + ")";
}

void MediaSurfacePresenter::reset() {
  releaseSub_ = nullptr;
  std::lock_guard<std::mutex> lock(slotsMutex_);
  slots_.clear();
  width_ = height_ = 0;
}

bool MediaSurfacePresenter::ensureSurface() {
  // The video view lives in the UI component library; ask it for the current surface.
  // Polled at most every 250 ms so a remounted view is picked up.
  auto now = std::chrono::steady_clock::now();
  if (surface_ && now - lastSurfaceCheck_ < std::chrono::milliseconds(250)) return true;
  lastSurfaceCheck_ = now;
  apmf::Ptr<kg::IMediaSurface> current;
  try {
    auto provider = apmf::GetProcessObject()
                        ->getComponent("/com.vegalink.ui")
                        .TryQueryInterface<apmf::iface::com::amazon::kepler::uitoolkit::view::IKeplerMediaSurfaceProvider>();
    if (provider) current = provider->getMediaSurface();
  } catch (std::exception const& e) {
    status_ = std::string("ui component unavailable: ") + e.what();
  }
  if (current && current.get() == surface_.get()) return true;
  reset();
  surface_ = current;
  if (!surface_) {
    status_ = "waiting for surface";
    return false;
  }
  releaseSub_ = surface_->addBufferReleaseListener(apmf::Ptr<ReleaseListener>::Make(this));
  status_ = "surface ready";
  TMINFO("VegaLinkCore: presenter attached to media surface");
  return true;
}

bool MediaSurfacePresenter::allocate(int width, int height) {
  auto usage = apmf::MakeBuilderFor<kg::BufferUsage>()
                   .QueryInterface<apmf::BuilderFor<kg::BufferUsage>>()
                   ->scanOut(true)
                   ->gpuWrite(false)
                   ->gpuRead(false)
                   ->cameraWrite(false)
                   ->cameraRead(false)
                   ->secured(false)
                   ->softwareReadOften(false)
                   ->softwareWriteOften(true)
                   ->softwareReadRarely(false)
                   ->softwareWriteRarely(false)
                   ->hardwareVideoDecoder(false)
                   ->hardwareVideoEncoder(false)
                   ->decrypt(false)
                   ->build()
                   .QueryInterface<kg::BufferUsage>();

  std::vector<Slot> slots;
  for (int attempt = 0; attempt < 2 && slots.empty(); ++attempt) {
    bool nv12 = attempt == 1;
    kg::BufferPixelFormat const& format = nv12 ? kg::BufferPixelFormat::NV12 : kg::BufferPixelFormat::YUV420;
    try {
      for (int i = 0; i < kPoolSize; ++i) {
        Slot slot;
        slot.group = factory_->createGraphicsBuffer(width, height, format, kg::BufferMime::NONE, usage);
        if (!slot.group) throw std::runtime_error("createGraphicsBuffer returned null");
        slot.id = slot.group->getUniqueId();
        auto meta = slot.group->getMetadata().TryQueryInterface<kg::GraphicsBufferGroupData>();
        if (meta) {
          auto planes = meta->bufferData();
          slot.planes = static_cast<int>(planes.size());
          for (int p = 0; p < slot.planes && p < 3; ++p) {
            slot.stride[p] = planes[p]->stride();
            slot.planeHeight[p] = planes[p]->planeHeight();
          }
        }
        slots.push_back(std::move(slot));
      }
      nv12_ = nv12;
    } catch (std::exception const& e) {
      TMWARN(std::string("VegaLinkCore: ") + (nv12 ? "NV12" : "I420") + " buffers unavailable: " + e.what());
      slots.clear();
    }
  }
  if (slots.empty()) {
    status_ = "buffer allocation failed";
    return false;
  }
  const Slot& s0 = slots.front();
  TMINFO("VegaLinkCore: allocated " + std::to_string(slots.size()) + " " + (nv12_ ? "NV12" : "I420") + " buffers " +
         std::to_string(width) + "x" + std::to_string(height) + " planes=" + std::to_string(s0.planes) +
         " strides=" + std::to_string(s0.stride[0]) + "/" + std::to_string(s0.stride[1]) + "/" + std::to_string(s0.stride[2]));
  std::lock_guard<std::mutex> lock(slotsMutex_);
  slots_ = std::move(slots);
  width_ = width;
  height_ = height;
  status_ = "presenting";
  return true;
}

void MediaSurfacePresenter::onReleased(int64_t bufferId) {
  std::lock_guard<std::mutex> lock(slotsMutex_);
  for (auto& s : slots_) {
    if (s.id == bufferId) s.busy = false;
  }
}

bool MediaSurfacePresenter::copyInto(Slot& slot, const YuvFrame& f) {
  auto buffers = slot.group->getBuffers();
  const int chromaH = (f.height + 1) / 2;
  const int chromaW = (f.width + 1) / 2;

  auto copyPlane = [](uint8_t* dst, int dstStride, const uint8_t* src, int srcStride, int bytes, int rows) {
    for (int y = 0; y < rows; ++y) std::memcpy(dst + y * dstStride, src + y * srcStride, bytes);
  };

  if (buffers.size() >= 3 && !nv12_) {
    // One IBuffer per plane: Y, U, V.
    for (int p = 0; p < 3; ++p) {
      auto mapping = buffers[p]->mapForWriteOnly();
      int w = p == 0 ? f.width : chromaW;
      int h = p == 0 ? f.height : chromaH;
      int stride = slot.stride[p] > 0 ? slot.stride[p] : w;
      copyPlane(mapPointer(mapping), stride, f.plane[p], f.stride[p], w, h);
      mapping->close();
    }
    return true;
  }

  if (buffers.empty()) return false;
  // Single contiguous buffer (planes back to back) or NV12 (Y + interleaved UV).
  auto mapping = buffers[0]->mapForWriteOnly();
  uint8_t* base = mapPointer(mapping);
  int yStride = slot.stride[0] > 0 ? slot.stride[0] : f.width;
  int yRows = slot.planeHeight[0] > 0 ? slot.planeHeight[0] : f.height;
  copyPlane(base, yStride, f.plane[0], f.stride[0], f.width, f.height);
  uint8_t* chroma = base + static_cast<size_t>(yStride) * yRows;
  if (nv12_) {
    int uvStride = slot.stride[1] > 0 ? slot.stride[1] : yStride;
    if (buffers.size() >= 2) {
      mapping->close();
      mapping = buffers[1]->mapForWriteOnly();
      chroma = mapPointer(mapping);
    }
    for (int y = 0; y < chromaH; ++y) {
      uint8_t* d = chroma + y * uvStride;
      const uint8_t* u = f.plane[1] + y * f.stride[1];
      const uint8_t* v = f.plane[2] + y * f.stride[2];
      for (int x = 0; x < chromaW; ++x) {
        d[2 * x] = u[x];
        d[2 * x + 1] = v[x];
      }
    }
  } else {
    int cStride = slot.stride[1] > 0 ? slot.stride[1] : yStride / 2;
    int cRows = slot.planeHeight[1] > 0 ? slot.planeHeight[1] : chromaH;
    copyPlane(chroma, cStride, f.plane[1], f.stride[1], chromaW, chromaH);
    copyPlane(chroma + static_cast<size_t>(cStride) * cRows, cStride, f.plane[2], f.stride[2], chromaW, chromaH);
  }
  mapping->close();
  return true;
}

bool MediaSurfacePresenter::present(const YuvFrame& frame) {
  if (!factory_ || !ensureSurface()) return false;
  if ((frame.width != width_ || frame.height != height_) && !allocate(frame.width, frame.height)) return false;

  Slot* slot = nullptr;
  {
    std::lock_guard<std::mutex> lock(slotsMutex_);
    for (auto& s : slots_) {
      if (!s.busy) {
        slot = &s;
        s.busy = true;
        break;
      }
    }
  }
  if (!slot) return false;  // display behind: drop instead of queueing

  try {
    if (!copyInto(*slot, frame)) {
      slot->busy = false;
      return false;
    }
    // pts = 0 / duration = 0: no timestamp, present as soon as possible.
    kg::PresentResult result = surface_->presentBuffer(slot->group, nullptr, nullptr, 0, 0);
    lastResult_ = result.value;
    if (result.value != kg::PresentResult::SUBMITTED.value && result.value != kg::PresentResult::QUEUED.value) {
      // Rejected buffers are never released by the surface; reclaim now.
      std::lock_guard<std::mutex> lock(slotsMutex_);
      slot->busy = false;
      return false;
    }
    return true;
  } catch (std::exception const& e) {
    status_ = std::string("present failed: ") + e.what();
    std::lock_guard<std::mutex> lock(slotsMutex_);
    slot->busy = false;
    return false;
  }
}

}  // namespace vegalink
