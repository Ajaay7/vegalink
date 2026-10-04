# Request: low-latency native video decoder access on Vega OS

**Post to:** Amazon Developer Forums (Vega / Fire TV section) or Developer Support (developer.amazon.com/support)

---

**Subject:** Low-latency video decode API for a game-streaming app on Vega OS (Fire TV Stick 4K Select)

Hello,

We are building a game-streaming client for Vega OS, similar to Moonlight or Steam Link. It receives H.264/HEVC video from a PC over the LAN and needs to show each frame within a few milliseconds of receiving it.

**What we tried**
- `@amazon-devices/react-native-w3cmedia` with MSE, appending one fMP4 fragment per frame (SDK 0.24, Fire TV Stick 4K Select).
- Hardware decode works once the `[[wants.service]]` entries from the media-player setup guide are added.
- The pipeline's buffering monitor always prerolls about 400 ms before playing, and again after every seek (`PipelineBufferingMonitor: sampleQueueDepth ... above min threshold - onReadyToPlay`). As a result, glass-to-glass latency stays around 0.5 s.
- `playbackRate` is not supported, and we found no low-latency or live option in the JS API.

**What we're asking**
1. Is there a supported way to use the platform hardware decoder with minimal buffering? For example:
   - the native Audio/Video Decoder / Media Transform API shown in the media-player architecture docs (the device has `com.amazon.kepler.media_transform` and `com.amazon.mediatransform.service`), together with `IMediaSurface` for presentation; or
   - a low-latency / live mode for the W3C media player (no preroll threshold, present on arrival).
2. If the native decoder API is available to partners, how can we request access to its headers and documentation? We understand VLC for Vega OS uses hardware decoding "through the platform media APIs".

**Device / SDK:** Fire TV Stick 4K Select (armv7), Vega SDK 0.24.12112, `react-native-w3cmedia` 2.3.x, React Native 0.83.

Thank you!
