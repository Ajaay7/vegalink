module.exports = {
  dependency: {
    platforms: {
      kepler: {
        autolink: {
          VegaLinkCore: {
            libraryName: 'libVegaLinkCore.so',
            linkDynamic: true,
            provider: 'application',
            components: [],
            turbomodules: ['VegaLinkCore'],
          },
          // Native UI component <VegaLinkVideoView> (APMF_COMPONENT in kepler/ui/VideoViewManager.cpp).
          VegaLinkUI: {
            uiComponentName: '/com.vegalink.ui',
            linkDynamic: true,
            provider: 'application',
            components: ['VegaLinkVideoView'],
            turbomodules: [],
          },
        },
      },
    },
  },
};
