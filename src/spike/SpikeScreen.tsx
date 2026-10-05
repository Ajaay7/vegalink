import React, {useCallback, useEffect, useRef, useState} from 'react';
import {BackHandler, StyleSheet, Text, View, useWindowDimensions} from 'react-native';
import {KeplerVideoSurfaceView} from '@amazon-devices/react-native-w3cmedia';
import {useGamepadEventHandler, GamepadEvent} from '@amazon-devices/react-native-kepler';
import {VideoSink, VideoSinkStats, codecFromInit} from '../stream/VideoSink';
import {SpikeClient, SpikeHello, mimeForCodec} from './SpikeClient';
import {FocusButton} from '../components/FocusButton';
import {AddressKeypad} from '../components/AddressKeypad';
import {VegaLinkCore, VegaLinkVideoView, readStats, NativeStats} from '@vegalink/core';

const DEFAULT_ADDRESS = '192.168.0.111:8765';

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
  // The system on-screen keyboard isn't available to this app (no IME service),
  // so the address is edited with our own D-pad keypad instead of a TextInput.
  const [address, setAddress] = useState(DEFAULT_ADDRESS);
  const [editing, setEditing] = useState(false);
  const {width, height} = useWindowDimensions();
  // 1u = 1/540 of the screen height: the TV's layout viewport is much smaller
  // than 1080p, so all sizes are expressed in this unit.
  const u = height / 540;
  const st = layout(u);
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
  const codecRef = useRef('h264');
  const [mime, setMime] = useState<string>();
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

  useEffect(() => {
    console.log(`[Spike] window ${width}x${height}, u=${u.toFixed(2)}`);
  }, [width, height, u]);

  // Native pipeline: TCP receive + ffmpeg decode in C++, optionally presented
  // into <VegaLinkVideoView>'s media surface ('render') or discarded ('decode').
  const [nativeMode, setNativeMode] = useState<'off' | 'decode' | 'render'>('off');
  const nativeRunning = nativeMode !== 'off';
  const [nativeStats, setNativeStats] = useState<NativeStats>();
  useEffect(() => {
    if (!nativeRunning) return;
    const timer = setInterval(() => {
      try {
        setNativeStats(readStats());
      } catch (e) {
        setState(`native stats failed: ${e}`);
      }
    }, 1000);
    return () => clearInterval(timer);
  }, [nativeRunning]);

  const stopNative = useCallback(() => {
    VegaLinkCore.stop();
    setNativeMode('off');
  }, []);

  const startNative = (mode: 'decode' | 'render') => {
    const [host, port] = address.split(':');
    const tcpPort = Number(port || 8765) + 1;
    console.log(`[Spike] native ${mode} ${host}:${tcpPort} (${VegaLinkCore.getVersion()})`);
    // 'main' = present into the mounted <VegaLinkVideoView>; '' = decode only.
    VegaLinkCore.start(host, tcpPort, mode === 'render' ? 'main' : '', 2);
    setNativeStats(undefined);
    setNativeMode(mode);
  };

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
      if (nativeMode === 'render') {
        stopNative();
        return true;
      }
      if (streaming) {
        stop();
        return true;
      }
      return false;
    });
    return () => sub.remove();
  }, [streaming, stop, nativeMode, stopNative]);

  const start = () => {
    const sink = sinkRef.current;
    if (!sink) return;
    setStreaming(true);
    const client = new SpikeClient({
      onState: (s, d) => setState(d ? `${s}: ${d}` : s),
      onRtt: setRtt,
      onHello: (h) => {
        setHello(h);
        codecRef.current = h.codec;
      },
      onInit: (data) => {
        // Open the MediaSource with the exact codec string from the encoder's init segment.
        const codec = codecFromInit(data);
        const mime = codec ? `video/mp4; codecs="${codec}"` : mimeForCodec(codecRef.current);
        console.log(`[Spike] init segment ${data.byteLength} bytes, mime ${mime}, supported=${VideoSink.supports(mime)}`);
        setMime(mime);
        openRef.current = sink.open(mime).then(() => sink.pushInit(data));
        openRef.current.catch((e) => setState(`MSE open failed: ${e}`));
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
    client.connect(`ws://${address}`);
  };

  if (nativeMode === 'render') {
    // The media surface is composited behind the React UI, so nothing opaque
    // may cover it: transparent root, HUD only.
    return (
      <View style={styles.nativeRoot}>
        <VegaLinkVideoView style={StyleSheet.absoluteFill} />
        <View style={st.hud} pointerEvents="none">
          <Text style={st.hudText}>
            native {nativeStats?.state ?? 'starting'} {nativeStats?.error ? `(${nativeStats.error})` : ''} | {nativeStats?.width}x{nativeStats?.height} |{' '}
            {nativeStats?.renderer}
          </Text>
          {nativeStats && (
            <Text style={st.hudText}>
              recv {nativeStats.received} | decoded {nativeStats.decoded} | shown {nativeStats.presented} | dropped {nativeStats.dropped} fps |{' '}
              decode {nativeStats.decodeMsAvg.toFixed(1)}/{nativeStats.decodeMsMax.toFixed(1)} ms | recv→shown {nativeStats.pipelineMsAvg.toFixed(1)} ms |{' '}
              {((nativeStats.bytes * 8) / 1e6).toFixed(1)} Mbps
            </Text>
          )}
          <Text style={st.hudText}>Back to stop</Text>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.root}>
      <KeplerVideoSurfaceView
        style={styles.video}
        onSurfaceViewCreated={(h) => sinkRef.current?.setSurface(h)}
        onSurfaceViewDestroyed={(h) => sinkRef.current?.clearSurface(h)}
      />

      {!streaming && (
        <View style={st.page}>
          <View style={st.column}>
            <Text style={st.title}>VegaLink</Text>
            <Text style={st.subtitle}>Latency test (Phase 0)</Text>
            {editing ? (
              <AddressKeypad
                u={u}
                initial={address}
                onCancel={() => setEditing(false)}
                onDone={(v) => {
                  if (v) setAddress(v);
                  setEditing(false);
                }}
              />
            ) : (
              <>
                <Text style={st.label}>PC address (run tools/spike-sender on the PC)</Text>
                <View style={st.addressBox}>
                  <Text style={st.addressText}>{address}</Text>
                </View>
                <View style={st.buttonRow}>
                  <FocusButton u={u} label="Connect" primary hasTVPreferredFocus onPress={start} style={st.grow} />
                  <FocusButton u={u} label="Native stream" onPress={() => startNative('render')} style={st.grow} />
                  <FocusButton
                    u={u}
                    label={nativeMode === 'decode' ? 'Stop decode test' : 'Decode test'}
                    onPress={() => (nativeMode === 'decode' ? stopNative() : startNative('decode'))}
                    style={st.grow}
                  />
                  <FocusButton u={u} label="Edit address" onPress={() => setEditing(true)} style={st.grow} />
                </View>
                <Text style={st.label}>Status</Text>
                <Text style={st.value}>{state}</Text>
                {nativeRunning && (
                  <>
                    <Text style={st.label}>Native pipeline (TCP {address.split(':')[0]}:{Number(address.split(':')[1] || 8765) + 1}, 2 decode threads)</Text>
                    <Text style={st.value}>
                      {nativeStats
                        ? `${nativeStats.state}${nativeStats.error ? ` (${nativeStats.error})` : ''} | ${nativeStats.width}x${nativeStats.height}`
                        : 'starting…'}
                    </Text>
                    {nativeStats && (
                      <Text style={st.value}>
                        recv {nativeStats.received} fps | decoded {nativeStats.decoded} fps | decode {nativeStats.decodeMsAvg.toFixed(1)} ms avg /{' '}
                        {nativeStats.decodeMsMax.toFixed(1)} max | recv→done {nativeStats.pipelineMsAvg.toFixed(1)} ms |{' '}
                        {((nativeStats.bytes * 8) / 1e6).toFixed(1)} Mbps | {nativeStats.renderer}
                      </Text>
                    )}
                  </>
                )}
              </>
            )}
          </View>

          <View style={[st.column, st.diagnostics]}>
            <Text style={st.label}>Hardware decoder support</Text>
            {CODEC_PROBES.map(([name, m]) => (
              <Text key={name} style={st.value}>
                {VideoSink.supports(m) ? '✓' : '✗'} {name}
              </Text>
            ))}
            <Text style={st.label}>Last gamepad event</Text>
            <Text style={st.value}>{pad}</Text>
            <Text style={st.label}>Screen</Text>
            <Text style={st.value}>
              {Math.round(width)}×{Math.round(height)} layout units
            </Text>
          </View>
        </View>
      )}

      {streaming && (
        <View style={st.hud} pointerEvents="none">
          <Text style={st.hudText}>
            {state} | {hello ? `${hello.codec} ${hello.size}@${hello.fps} ${hello.encoder}` : '…'} | {mime ?? ''}
          </Text>
          <Text style={st.hudText}>
            recv {fragsPerSec} fps | rtt {rtt ?? '-'} ms | transit {transit ? `${transit.last.toFixed(0)} (avg ${transit.avg.toFixed(0)})` : '-'} ms
          </Text>
          <Text style={st.hudText}>
            buffer lead {stats?.leadMs ?? '-'} ms | queued {stats?.queued ?? 0} | skips {stats?.skips ?? 0} | dropped {stats?.droppedFrames ?? 0}/{stats?.totalFrames ?? 0} | {stats?.videoWidth}x{stats?.videoHeight}
          </Text>
          {stats?.error && <Text style={[st.hudText, st.err]}>{stats.error}</Text>}
          <Text style={st.hudText}>pad: {pad}</Text>
          <Text style={st.hudText}>Back to disconnect</Text>
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
  nativeRoot: {flex: 1, backgroundColor: 'transparent'},
  video: {position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, zIndex: 0},
});

const layout = (u: number) =>
  StyleSheet.create({
    page: {
      ...StyleSheet.absoluteFillObject,
      zIndex: 1,
      flexDirection: 'row',
      paddingHorizontal: 40 * u,
      paddingVertical: 32 * u,
      backgroundColor: '#12141c',
    },
    column: {flex: 1, marginRight: 32 * u},
    diagnostics: {marginRight: 0, padding: 16 * u, borderRadius: 10 * u, backgroundColor: '#1b1f2a'},
    title: {color: '#fff', fontSize: 34 * u, fontWeight: '700'},
    subtitle: {color: '#9aa4b2', fontSize: 14 * u, marginBottom: 16 * u},
    label: {color: '#9aa4b2', fontSize: 12 * u, marginTop: 12 * u, marginBottom: 4 * u},
    value: {color: '#e2e8f0', fontSize: 14 * u},
    addressBox: {borderWidth: 1, borderColor: '#4a5568', borderRadius: 6 * u, paddingHorizontal: 10 * u, paddingVertical: 6 * u},
    addressText: {color: '#fff', fontSize: 18 * u},
    buttonRow: {flexDirection: 'row', marginTop: 12 * u, gap: 10 * u},
    grow: {flex: 1},
    hud: {position: 'absolute', top: 8 * u, left: 8 * u, padding: 6 * u, backgroundColor: 'rgba(0,0,0,0.6)', borderRadius: 4 * u, zIndex: 2},
    hudText: {color: '#9ef01a', fontSize: 10 * u, fontFamily: 'monospace'},
    err: {color: '#ff6b6b'},
  });
