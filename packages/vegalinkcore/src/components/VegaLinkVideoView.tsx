import {HostComponent, ViewProps} from 'react-native';
// @ts-ignore -- untyped default export
import register from '@amazon-devices/react-native-kepler/Libraries/Utilities/registerGeneratedViewConfig';

/**
 * Native media SurfaceView (kepler/ui/VideoViewManager.cpp) that the native
 * stream is presented into. Mount it, then call VegaLinkCore.start(..., 'main', ...).
 * The surface is composited *behind* the React UI ("hole punch"): anything drawn
 * on top of it must be transparent where the video should show.
 */
export type VegaLinkVideoViewProps = ViewProps;

const NAME = 'VegaLinkVideoView';

register(NAME, {
  uiViewClassName: NAME,
  validAttributes: {},
});

export const VegaLinkVideoView = NAME as unknown as HostComponent<VegaLinkVideoViewProps>;
