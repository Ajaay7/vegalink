import VegaLinkCore from './turbo-modules/VegaLinkCore';

export {VegaLinkCore};

export type NativeStats = {
  state: 'idle' | 'connecting' | 'streaming' | 'error';
  error?: string;
  /** Frames received / decoded / presented since the previous getStats() call. */
  received: number;
  decoded: number;
  presented: number;
  /** Average decode time per frame (ms) and worst case in the interval. */
  decodeMsAvg: number;
  decodeMsMax: number;
  /** Average time from frame received to presented (ms). */
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
