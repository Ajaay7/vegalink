#pragma once

#include <memory>
#include <mutex>

#include "generated/VegaLinkCoreSpec.h"

namespace vegalink {
class StreamSession;
}

namespace VegaLinkCoreTurboModule {

class VegaLinkCore : public VegaLinkCoreSpec {
public:
  VegaLinkCore();
  ~VegaLinkCore() noexcept;

  std::string getVersion() override;
  bool start(std::string host, double port, std::string surfaceHandle, double decodeThreads) override;
  void stop() override;
  std::string getStats() override;

private:
  std::mutex mutex_;
  std::unique_ptr<vegalink::StreamSession> session_;
};

} // namespace VegaLinkCoreTurboModule
