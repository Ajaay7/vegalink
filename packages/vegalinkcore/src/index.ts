import VegaLinkCore from './turbo-modules/VegaLinkCore';

export {VegaLinkCore};

export type NativeStats = {
  state: 'idle' | 'connecting' | 'streaming' | 'error';
  error?: string;
  /** Frames received / decoded / presented since the previous getStats() call. */
  received: number;
  decoded: number;
  presented: number;
  /** Decoded frames not shown (no free surface buffer, or rejected by the surface). */
  dropped: number;
  /** Time from access unit received to frame decoded (ms): average and worst in the interval. */
  decodeMsAvg: number;
  decodeMsMax: number;
  /** Average time from access unit received to frame handed to the display (ms). */
  pipelineMsAvg: number;
  bytes: number;
  intervalMs: number;
  width: number;
  height: number;
  renderer: string;
};

export function readStats(): NativeStats {
  return JSON.parse(VegaLinkCore.getStats()) as NativeStats;
}

export {VegaLinkVideoView} from './components/VegaLinkVideoView';
export type {VegaLinkVideoViewProps} from './components/VegaLinkVideoView';
