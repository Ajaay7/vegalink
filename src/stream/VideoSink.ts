import {
  MediaSource,
  SourceBuffer,
  VideoPlayer,
} from '@amazon-devices/react-native-w3cmedia';

export type VideoSinkStats = {
  /** Seconds of media buffered ahead of the playhead. */
  leadMs: number;
  /** Fragments waiting in JS because the SourceBuffer was busy. */
  queued: number;
  /** Fragments appended since the last stats tick. */
  appended: number;
  /** Times the playhead was pushed forward to cut latency. */
  skips: number;
  droppedFrames: number;
  totalFrames: number;
  videoWidth: number;
  videoHeight: number;
  error?: string;
};

export type VideoSinkOptions = {
  /** Seek forward when buffered lead exceeds this. */
  maxLeadMs?: number;
  /** Where to put the playhead (behind live edge) after a seek. */
  targetLeadMs?: number;
  onStats?: (s: VideoSinkStats) => void;
};

/**
 * Feeds fragmented MP4 (one moof+mdat per frame) into the Vega hardware
 * decoder through MSE, keeping the playhead as close to the live edge as the
 * player allows. The w3cmedia player has no low-latency or playbackRate
 * controls, so latency is bounded by seeking the playhead forward.
 */
export class VideoSink {
  private readonly player = new VideoPlayer();
  private mediaSource?: MediaSource;
  private sourceBuffer?: SourceBuffer;
  private pending: Uint8Array[] = [];
  private initSegment?: Uint8Array;
  private timer?: ReturnType<typeof setInterval>;
  private lastTrim = 0;
  private playing = false;
  private surfaceHandle?: string;
  private stats: VideoSinkStats = VideoSink.emptyStats();
  private readonly maxLead: number;
  private readonly targetLead: number;

  constructor(private readonly opts: VideoSinkOptions = {}) {
    this.maxLead = (opts.maxLeadMs ?? 120) / 1000;
    this.targetLead = (opts.targetLeadMs ?? 20) / 1000;
  }

  private static emptyStats(): VideoSinkStats {
    return {leadMs: 0, queued: 0, appended: 0, skips: 0, droppedFrames: 0, totalFrames: 0, videoWidth: 0, videoHeight: 0};
  }

  static supports(mime: string): boolean {
    try {
      return MediaSource.isTypeSupported(mime);
    } catch {
      return false;
    }
  }

  async initialize(): Promise<void> {
    await this.player.initialize();
  }

  setSurface(handle: string): void {
    this.surfaceHandle = handle;
    this.player.setSurfaceHandle(handle);
    this.maybePlay();
  }

  clearSurface(handle: string): void {
    this.surfaceHandle = undefined;
    this.player.clearSurfaceHandle(handle);
  }

  /** Opens a new MediaSource for the given MIME, e.g. `video/mp4; codecs="avc1.640028"`. */
  open(mime: string): Promise<void> {
    this.closeSource();
    const ms = new MediaSource();
    this.mediaSource = ms;
    return new Promise((resolve, reject) => {
      ms.addEventListener('sourceopen', () => {
        try {
          try {
            ms.duration = Infinity;
          } catch {
            // Not all players accept an infinite duration; harmless.
          }
          const sb = ms.addSourceBuffer(mime);
          sb.addEventListener('updateend', () => this.drain());
          sb.addEventListener('error', () => {
            this.stats.error = 'SourceBuffer error';
          });
          this.sourceBuffer = sb;
          this.timer = setInterval(() => this.tick(), 100);
          resolve();
        } catch (e) {
          reject(e);
        }
      });
      this.player.src = URL.createObjectURL(ms as unknown as Blob);
    });
  }

  pushInit(data: Uint8Array): void {
    this.initSegment = data;
    this.enqueue(data);
  }

  pushFragment(data: Uint8Array): void {
    if (!this.initSegment) return;
    this.enqueue(data);
  }

  private enqueue(data: Uint8Array): void {
    this.pending.push(data);
    this.drain();
  }

  private drain(): void {
    const sb = this.sourceBuffer;
    if (!sb || sb.updating || this.pending.length === 0) return;
    // Concatenate whatever piled up while the buffer was busy into one append:
    // back-to-back moof+mdat pairs are a valid media segment sequence.
    let chunk: Uint8Array;
    if (this.pending.length === 1) {
      chunk = this.pending[0];
    } else {
      const total = this.pending.reduce((n, b) => n + b.byteLength, 0);
      chunk = new Uint8Array(total);
      let off = 0;
      for (const b of this.pending) {
        chunk.set(b, off);
        off += b.byteLength;
      }
    }
    this.stats.appended += this.pending.length;
    this.pending = [];
    try {
      sb.appendBuffer(chunk);
    } catch (e) {
      this.stats.error = `append: ${String(e)}`;
    }
  }

  private maybePlay(): void {
    if (this.playing || !this.surfaceHandle || !this.sourceBuffer) return;
    const b = this.sourceBuffer.buffered;
    if (b.length === 0) return;
    this.player.currentTime = Math.max(b.start(0), b.end(b.length - 1) - this.targetLead);
    this.player.play();
    this.playing = true;
  }

  private tick(): void {
    const sb = this.sourceBuffer;
    if (!sb) return;
    this.maybePlay();
    const b = sb.buffered;
    if (b.length > 0) {
      const liveEdge = b.end(b.length - 1);
      const lead = liveEdge - this.player.currentTime;
      this.stats.leadMs = Math.round(lead * 1000);
      if (this.playing && lead > this.maxLead) {
        this.player.currentTime = liveEdge - this.targetLead;
        this.stats.skips++;
      }
      // Keep the buffer small so the player never sits on seconds of history.
      const now = Date.now();
      if (!sb.updating && now - this.lastTrim > 5000 && this.player.currentTime - b.start(0) > 4) {
        this.lastTrim = now;
        try {
          sb.remove(b.start(0), this.player.currentTime - 2);
        } catch {
          // Retry on the next interval.
        }
      }
    }
    try {
      const q = this.player.getVideoPlaybackQuality();
      this.stats.droppedFrames = q.droppedVideoFrames;
      this.stats.totalFrames = q.totalVideoFrames;
    } catch {
      // Quality info is optional.
    }
    this.stats.videoWidth = this.player.videoWidth;
    this.stats.videoHeight = this.player.videoHeight;
    this.stats.queued = this.pending.length;
    this.opts.onStats?.({...this.stats});
    this.stats.appended = 0;
  }

  private closeSource(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
    this.pending = [];
    this.initSegment = undefined;
    this.sourceBuffer = undefined;
    this.mediaSource = undefined;
    this.playing = false;
    this.stats = VideoSink.emptyStats();
  }

  async destroy(): Promise<void> {
    this.closeSource();
    try {
      this.player.pause();
    } catch {
      // Already stopped.
    }
    await this.player.deinitialize();
  }
}
