import type {KeplerTurboModule} from '@amazon-devices/keplerscript-turbomodule-api';
import {TurboModuleRegistry} from '@amazon-devices/keplerscript-turbomodule-api';

/**
 * Native streaming core: receives the stream over TCP, decodes H.264 in
 * software (ffmpeg) and presents frames to a native video surface.
 */
export interface VegaLinkCore extends KeplerTurboModule {
  getVersion: () => string;
  /** Connects to the sender's raw TCP port and starts decoding. Returns false if already running. */
  start: (host: string, port: number, surfaceHandle: string, decodeThreads: number) => boolean;
  stop: () => void;
  /** JSON string with counters since the previous call (see NativeStats in src/index.ts). */
  getStats: () => string;
}

export default TurboModuleRegistry.getEnforcing<VegaLinkCore>('VegaLinkCore');
