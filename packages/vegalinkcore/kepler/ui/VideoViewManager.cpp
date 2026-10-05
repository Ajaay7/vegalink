#include "VideoViewManager.h"

#include <apmf/component.h>
#include <apmf/process.h>
#include <apmf/iface/com/amazon/apmf/InvalidArgumentError.h>
#include <apmf/iface/com/amazon/kepler/uitoolkit/react/IFrame.h>
#include <apmf/iface/com/amazon/kepler/uitoolkit/view/IKeplerMediaSurfaceProvider.h>

#include <Kepler/turbomodule/TMLog.h>

#include "SurfaceRegistry.h"

namespace vegalink {

namespace {
void publish(apmf::View<uiview::ISurfaceView> surfaceView, const char* event) {
  auto provider = apmf::Ptr<uiview::ISurfaceView>(surfaceView).TryQueryInterface<uiview::IKeplerMediaSurfaceProvider>();
  if (!provider) {
    TMERROR(std::string("VegaLinkVideoView: ") + event + ": view has no IKeplerMediaSurfaceProvider");
    return;
  }
  auto surface = provider->getMediaSurface();
  if (!surface) {
    TMWARN(std::string("VegaLinkVideoView: ") + event + ": media surface not available yet");
    return;
  }
  SurfaceRegistry::instance().set(surface);
  TMINFO(std::string("VegaLinkVideoView: ") + event + ": media surface published");
}
}  // namespace

void VideoSurfaceListener::onSurfaceCreated(apmf::View<uiview::ISurfaceView> surfaceView) {
  publish(surfaceView, "created");
}

void VideoSurfaceListener::onSurfaceUpdated(apmf::View<uiview::ISurfaceView> surfaceView) {
  publish(surfaceView, "updated");
}

void VideoSurfaceListener::onSurfaceDestroyed(apmf::View<uiview::ISurfaceView>) {
  SurfaceRegistry::instance().clear();
  TMINFO("VegaLinkVideoView: surface destroyed");
}

VideoViewManager::VideoViewManager(apmf::View<uiview::IViewModule> viewModule) : viewModule_(viewModule) {}

apmf::Ptr<uiview::IView> VideoViewManager::makeView() {
  listener_ = apmf::Ptr<VideoSurfaceListener>::Make();
  auto surfaceView = viewModule_->makeMediaSurfaceView(listener_);
  TMINFO("VegaLinkVideoView: media surface view created");
  return surfaceView;
}

void VideoViewManager::updateLayout(apmf::View<uiview::IView> view, apmf::View<react::ILayout> newLayout) {
  view->setSize(newLayout->getContentFrame()->getSize());
}

apmf::Ptr<react::IViewManager> ViewManagerFactory::makeViewManager(apmf::StringView name) {
  auto viewModule = apmf::GetProcessObject()
                        ->getComponent("/com.amazon.kepler.uitoolkit.view")
                        .TryQueryInterface<uiview::IViewModule>();
  if (name == "VegaLinkVideoView" && viewModule) {
    return apmf::Ptr<VideoViewManager>::Make(viewModule);
  }
  throw apmf::InvalidArgumentError("VegaLinkCore: unknown UI component");
}

apmf::Ptr<apmf::iface::com::amazon::kepler::graphics::IMediaSurface> ViewManagerFactory::getMediaSurface() {
  return SurfaceRegistry::instance().get();
}

}  // namespace vegalink

// Must match uiComponentName in react-native.config.js.
APMF_COMPONENT("/com.vegalink.ui", vegalink::ViewManagerFactory);
