import React, {useCallback, useEffect, useRef, useState} from 'react';
import {BackHandler, StyleSheet, Text, TextInput, TouchableOpacity, View} from 'react-native';
import {KeplerVideoSurfaceView} from '@amazon-devices/react-native-w3cmedia';
import {useGamepadEventHandler, GamepadEvent} from '@amazon-devices/react-native-kepler';
import {VideoSink, VideoSinkStats} from '../stream/VideoSink';
import {SpikeClient, SpikeHello, mimeForCodec} from './SpikeClient';

const DEFAULT_URL = 'ws://192.168.0.111:8765';

const CODEC_PROBES: Array<[string, string]> = [
  ['H.264 High', 'video/mp4; codecs="avc1.640028"'],
  ['HEVC Main', 'video/mp4; codecs="hvc1.1.6.L120.B0"'],
  ['HEVC Main10', 'video/mp4; codecs="hvc1.2.4.L153.B0"'],
  ['AV1', 'video/mp4; codecs="av01.0.08M.08"'],
];

type Transit = {last: number; avg: number};

/**
 * Phase 0 feasibility screen: connects to tools/spike-sender, plays the stream
 * through MSE and shows latency-related stats. Measure glass-to-glass latency
 * by filming the PC monitor (running a millisecond stopwatch) next to the TV.
 */
export const SpikeScreen = () => {
  const [url, setUrl] = useState(DEFAULT_URL);
  const [state, setState] = useState<string>('idle');
  const [streaming, setStreaming] = useState(false);
  const [hello, setHello] = useState<SpikeHello>();
  const [stats, setStats] = useState<VideoSinkStats>();
  const [rtt, setRtt] = useState<number>();
  const [transit, setTransit] = useState<Transit>();
  const [fragsPerSec, setFragsPerSec] = useState(0);
  const [pad, setPad] = useState<string>('none');

  const sinkRef = useRef<VideoSink | undefined>(undefined);
  const clientRef = useRef<SpikeClient | undefined>(undefined);
  const openRef = useRef<Promise<void> | undefined>(undefined);
  const fragCount = useRef(0);
  const transitRef = useRef<Transit>({last: 0, avg: 0});

  useGamepadEventHandler((e: GamepadEvent) => {
    if (e.eventType === 'axis' && e.axis) {
      const a = e.axis;
      setPad(`axis LX ${fmt(a.left_stick_x)} LY ${fmt(a.left_stick_y)} RX ${fmt(a.right_stick_x)} RY ${fmt(a.right_stick_y)} LT ${fmt(a.left_lower_trigger)} RT ${fmt(a.right_lower_trigger)}`);
    } else {
      setPad(`${e.eventType} action=${e.eventKeyAction} dev=${e.deviceIdentifier?.vendorId?.toString(16)}:${e.deviceIdentifier?.productId?.toString(16)}`);
    }
  });

  const stop = useCallback(() => {
    clientRef.current?.close();
    clientRef.current = undefined;
    setStreaming(false);
    setState('idle');
  }, []);

  useEffect(() => {
    const sink = new VideoSink({onStats: setStats});
    sinkRef.current = sink;
    sink.initialize().catch((e) => setState(`player init failed: ${e}`));
    const fpsTimer = setInterval(() => {
      setFragsPerSec(fragCount.current);
      fragCount.current = 0;
      setTransit({...transitRef.current});
    }, 1000);
    return () => {
      clearInterval(fpsTimer);
      clientRef.current?.close();
      sink.destroy();
    };
  }, []);

  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (streaming) {
        stop();
        return true;
      }
      return false;
    });
    return () => sub.remove();
  }, [streaming, stop]);

  const start = () => {
    const sink = sinkRef.current;
    if (!sink) return;
    setStreaming(true);
    const client = new SpikeClient({
      onState: (s, d) => setState(d ? `${s}: ${d}` : s),
      onRtt: setRtt,
      onHello: (h) => {
        setHello(h);
        openRef.current = sink.open(mimeForCodec(h.codec));
        openRef.current.catch((e) => setState(`MSE open failed: ${e}`));
      },
      onInit: (data) => {
        openRef.current?.then(() => sink.pushInit(data));
      },
      onFragment: (data, t) => {
        fragCount.current++;
        if (t !== undefined) {
          const tr = transitRef.current;
          tr.last = t;
          tr.avg = tr.avg === 0 ? t : tr.avg * 0.95 + t * 0.05;
        }
        openRef.current?.then(() => sink.pushFragment(data));
      },
    });
    clientRef.current = client;
    client.connect(url);
  };

  return (
    <View style={styles.root}>
      <KeplerVideoSurfaceView
        style={styles.video}
        onSurfaceViewCreated={(h) => sinkRef.current?.setSurface(h)}
        onSurfaceViewDestroyed={(h) => sinkRef.current?.clearSurface(h)}
      />

      {!streaming && (
        <View style={styles.panel}>
          <Text style={styles.title}>VegaLink — latency spike</Text>
          <Text style={styles.label}>Sender URL (run tools/spike-sender on the PC)</Text>
          <TextInput style={styles.input} value={url} onChangeText={setUrl} autoCapitalize="none" />
          <TouchableOpacity style={styles.button} onPress={start} hasTVPreferredFocus>
            <Text style={styles.buttonText}>Connect</Text>
          </TouchableOpacity>
          <Text style={styles.label}>Decoder support (MediaSource.isTypeSupported)</Text>
          {CODEC_PROBES.map(([name, mime]) => (
            <Text key={name} style={styles.small}>
              {name}: {VideoSink.supports(mime) ? 'yes' : 'no'}
            </Text>
          ))}
          <Text style={styles.label}>Last gamepad event</Text>
          <Text style={styles.small}>{pad}</Text>
          <Text style={styles.small}>Status: {state}</Text>
        </View>
      )}

      {streaming && (
        <View style={styles.hud} pointerEvents="none">
          <Text style={styles.hudText}>
            {state} | {hello ? `${hello.codec} ${hello.size}@${hello.fps} ${hello.encoder}` : '…'}
          </Text>
          <Text style={styles.hudText}>
            recv {fragsPerSec} fps | rtt {rtt ?? '-'} ms | transit {transit ? `${transit.last.toFixed(0)} (avg ${transit.avg.toFixed(0)})` : '-'} ms
          </Text>
          <Text style={styles.hudText}>
            buffer lead {stats?.leadMs ?? '-'} ms | queued {stats?.queued ?? 0} | skips {stats?.skips ?? 0} | dropped {stats?.droppedFrames ?? 0}/{stats?.totalFrames ?? 0} | {stats?.videoWidth}x{stats?.videoHeight}
          </Text>
          {stats?.error && <Text style={[styles.hudText, styles.err]}>{stats.error}</Text>}
          <Text style={styles.hudText}>pad: {pad}</Text>
          <Text style={styles.hudText}>Back to disconnect</Text>
        </View>
      )}
    </View>
  );
};

function fmt(v?: number): string {
  return v === undefined ? '-' : v.toFixed(2);
}

const styles = StyleSheet.create({
  root: {flex: 1, backgroundColor: '#000'},
  video: {position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, zIndex: 0},
  panel: {margin: 64, padding: 32, backgroundColor: 'rgba(20,20,28,0.92)', borderRadius: 16, width: 900, zIndex: 1},
  title: {color: '#fff', fontSize: 40, fontWeight: '600', marginBottom: 24},
  label: {color: '#9aa4b2', fontSize: 20, marginTop: 20, marginBottom: 6},
  input: {color: '#fff', fontSize: 26, borderWidth: 2, borderColor: '#4a5568', borderRadius: 8, paddingHorizontal: 16, paddingVertical: 10},
  button: {marginTop: 20, backgroundColor: '#3b82f6', borderRadius: 8, paddingVertical: 14, alignItems: 'center'},
  buttonText: {color: '#fff', fontSize: 26, fontWeight: '600'},
  small: {color: '#e2e8f0', fontSize: 20},
  hud: {position: 'absolute', top: 16, left: 16, padding: 12, backgroundColor: 'rgba(0,0,0,0.6)', borderRadius: 8, zIndex: 2},
  hudText: {color: '#9ef01a', fontSize: 18, fontFamily: 'monospace'},
  err: {color: '#ff6b6b'},
});
