#pragma once

#include <apmf/apmf_base.h>
#include <apmf/ptr.h>
#include <apmf/string_view.h>
#include <apmf/iface/com/amazon/kepler/uitoolkit/react/ILayout.h>
#include <apmf/iface/com/amazon/kepler/uitoolkit/react/ILayoutDelegate.h>
#include <apmf/iface/com/amazon/kepler/uitoolkit/react/IViewManager.h>
#include <apmf/iface/com/amazon/kepler/uitoolkit/react/IViewManagerFactory.h>
#include <apmf/iface/com/amazon/kepler/uitoolkit/view/ISurfaceView.h>
#include <apmf/iface/com/amazon/kepler/uitoolkit/view/ISurfaceViewListener.h>
#include <apmf/iface/com/amazon/kepler/uitoolkit/view/IView.h>
#include <apmf/iface/com/amazon/kepler/uitoolkit/view/IViewModule.h>
#include <apmf/iface/com/amazon/kepler/uitoolkit/view/IKeplerMediaSurfaceProvider.h>

namespace vegalink {

namespace react = apmf::iface::com::amazon::kepler::uitoolkit::react;
namespace uiview = apmf::iface::com::amazon::kepler::uitoolkit::view;

/** Publishes the media surface of the view to SurfaceRegistry. */
struct VideoSurfaceListener : apmf::ApmfBase<VideoSurfaceListener, uiview::ISurfaceViewListener> {
  void onSurfaceCreated(apmf::View<uiview::ISurfaceView> surfaceView);
  void onSurfaceUpdated(apmf::View<uiview::ISurfaceView> surfaceView);
  void onSurfaceDestroyed(apmf::View<uiview::ISurfaceView> surfaceView);
};

/** <VegaLinkVideoView>: a native media SurfaceView that the stream is presented into. */
struct VideoViewManager : apmf::ApmfBase<VideoViewManager, react::IViewManager, react::ILayoutDelegate> {
  explicit VideoViewManager(apmf::View<uiview::IViewModule> viewModule);

  apmf::Ptr<uiview::IView> makeView();
  void updateLayout(apmf::View<uiview::IView> view, apmf::View<react::ILayout> newLayout);

 private:
  apmf::Ptr<uiview::IViewModule> viewModule_;
  apmf::Ptr<VideoSurfaceListener> listener_;
};

/**
 * Component "/com.vegalink.ui". Besides making view managers it implements
 * IKeplerMediaSurfaceProvider, which is how the TurboModule library (a separate
 * .so) fetches the media surface of the mounted video view:
 *   GetProcessObject()->getComponent("/com.vegalink.ui")
 *       .TryQueryInterface<IKeplerMediaSurfaceProvider>()->getMediaSurface()
 */
struct ViewManagerFactory
    : apmf::ApmfBase<ViewManagerFactory, react::IViewManagerFactory, uiview::IKeplerMediaSurfaceProvider> {
  apmf::Ptr<react::IViewManager> makeViewManager(apmf::StringView name);
  apmf::Ptr<apmf::iface::com::amazon::kepler::graphics::IMediaSurface> getMediaSurface();
};

}  // namespace vegalink
