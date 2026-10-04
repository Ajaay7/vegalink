#include "VegaLinkCore.h"

#include "../core/H264Decoder.h"
#include "../core/Presenter.h"
#include "../core/StreamSession.h"

using namespace com::amazon::kepler::turbomodule;

namespace VegaLinkCoreTurboModule {

VegaLinkCore::VegaLinkCore() {}

VegaLinkCore::~VegaLinkCore() noexcept {
  std::lock_guard<std::mutex> lock(mutex_);
  session_.reset();
}

std::string VegaLinkCore::getVersion() {
  return std::string("0.1.0 ffmpeg=") + (vegalink::H264Decoder::available() ? "yes" : "no");
}

bool VegaLinkCore::start(std::string host, double port, std::string surfaceHandle, double decodeThreads) {
  std::lock_guard<std::mutex> lock(mutex_);
  session_.reset();
  // TODO(render spike): replace NullPresenter with a surface presenter bound to surfaceHandle.
  (void)surfaceHandle;
  auto presenter = std::make_unique<vegalink::NullPresenter>();
  session_ = std::make_unique<vegalink::StreamSession>(host, static_cast<int>(port), static_cast<int>(decodeThreads),
                                                       std::move(presenter));
  session_->start();
  TMINFO("VegaLinkCore: started session to " + host + ":" + std::to_string(static_cast<int>(port)));
  return true;
}

void VegaLinkCore::stop() {
  std::lock_guard<std::mutex> lock(mutex_);
  session_.reset();
}

std::string VegaLinkCore::getStats() {
  std::lock_guard<std::mutex> lock(mutex_);
  if (!session_) return "{\"state\":\"idle\",\"received\":0,\"decoded\":0,\"presented\":0}";
  return session_->takeStatsJson();
}

} // namespace VegaLinkCoreTurboModule
