// VegaLink Phase 0 latency spike sender.
//
// Captures the desktop (or a test pattern), encodes low-latency H.264/HEVC with
// ffmpeg as fragmented MP4 with one fragment per frame, and pushes each
// fragment to the Fire TV app over a WebSocket.
//
// Wire format: binary WebSocket data is treated as a byte stream of records
// (the Vega WebSocket may split one message into several), each record:
//   ['V' 'L'][u32 BE n = bytes after this field][u8 kind][f64 BE sender ms][payload]
//   kind 0 = init segment (ftyp+moov), kind 1 = media fragment (moof+mdat)
// Text messages carry JSON for clock sync: {"t":"ping","c":<clientMs>} ->
// {"t":"pong","c":<clientMs>,"s":<serverMs>} and a {"t":"hello",...} banner.
//
// One viewer at a time: every new connection restarts ffmpeg so the viewer
// always starts on a fresh init segment + IDR frame.

import {spawn} from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import {WebSocketServer} from 'ws';
import {Mp4BoxSplitter} from './mp4.mjs';

const args = parseArgs(process.argv.slice(2));
const PORT = Number(args.port ?? 8765);
const TCP_PORT = Number(args['tcp-port'] ?? PORT + 1);
// H.264 Constrained Baseline + CAVLC: ~1.5x faster to software-decode on the stick.
const BASELINE = args.baseline === 'true';
const SOURCE = args.source ?? (process.platform === 'win32' ? 'desktop' : 'test');
const ENCODER = args.encoder ?? 'libx264';
const CODEC = args.codec ?? 'h264';
const SIZE = args.size ?? '1920x1080';
const FPS = Number(args.fps ?? 60);
const BITRATE = args.bitrate ?? '15M';
const FFMPEG = args.ffmpeg ?? findFfmpeg();

// Prefer ffmpeg on PATH; on Windows also look where winget/choco/scoop put it,
// since a terminal opened before installing won't have the updated PATH.
function findFfmpeg() {
  const exe = process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg';
  for (const dir of (process.env.PATH ?? '').split(path.delimiter)) {
    if (dir && fs.existsSync(path.join(dir, exe))) return path.join(dir, exe);
  }
  if (process.platform !== 'win32') return 'ffmpeg';
  const local = process.env.LOCALAPPDATA ?? '';
  const candidates = [
    path.join(local, 'Microsoft', 'WinGet', 'Links', exe),
    path.join(process.env.USERPROFILE ?? '', 'scoop', 'shims', exe),
    path.join(process.env.ProgramData ?? 'C:\\ProgramData', 'chocolatey', 'bin', exe),
    'C:\\ffmpeg\\bin\\ffmpeg.exe',
  ];
  // winget's Gyan.FFmpeg package: ...\WinGet\Packages\Gyan.FFmpeg_*\ffmpeg-*\bin\ffmpeg.exe
  const pkgs = path.join(local, 'Microsoft', 'WinGet', 'Packages');
  try {
    for (const p of fs.readdirSync(pkgs).filter((d) => /ffmpeg/i.test(d))) {
      for (const sub of fs.readdirSync(path.join(pkgs, p))) {
        candidates.push(path.join(pkgs, p, sub, 'bin', exe));
      }
    }
  } catch {}
  return candidates.find((c) => fs.existsSync(c)) ?? 'ffmpeg';
}

function parseArgs(argv) {
  const out = {};
  for (const a of argv) {
    const m = /^--([^=]+)(?:=(.*))?$/.exec(a);
    if (m) out[m[1]] = m[2] ?? 'true';
  }
  return out;
}

function inputArgs() {
  switch (SOURCE) {
    case 'desktop':
      if (process.platform === 'win32') {
        // ddagrab (DXGI desktop duplication) is much faster than gdigrab when available.
        if (args.grab === 'gdigrab') {
          return ['-f', 'gdigrab', '-framerate', String(FPS), '-draw_mouse', '1', '-i', 'desktop'];
        }
        return ['-f', 'lavfi', '-i', `ddagrab=framerate=${FPS}:draw_mouse=1,hwdownload,format=bgra`];
      }
      if (process.platform === 'darwin') {
        return ['-f', 'avfoundation', '-framerate', String(FPS), '-capture_cursor', '1', '-i', args.screen ?? '1:none'];
      }
      return ['-f', 'x11grab', '-framerate', String(FPS), '-i', process.env.DISPLAY ?? ':0'];
    case 'test':
    default:
      // Test pattern with a running timestamp burned in.
      return [
        '-re', '-f', 'lavfi',
        '-i', `testsrc2=size=${SIZE}:rate=${FPS},drawtext=text='%{pts\\:hms}':fontsize=96:fontcolor=white:box=1:boxcolor=black@0.6:x=40:y=40`,
      ];
  }
}

function encoderArgs() {
  const gop = String(FPS * 4);
  const common = ['-g', gop, '-bf', '0', '-b:v', BITRATE, '-maxrate', BITRATE, '-bufsize', BITRATE, ...baselineArgs()];
  switch (ENCODER) {
    case 'nvenc':
      return ['-c:v', CODEC === 'hevc' ? 'hevc_nvenc' : 'h264_nvenc', '-preset', 'p1', '-tune', 'ull', '-zerolatency', '1', '-rc', 'cbr', ...common];
    case 'amf':
      return ['-c:v', CODEC === 'hevc' ? 'hevc_amf' : 'h264_amf', '-usage', 'ultralowlatency', '-rc', 'cbr', ...common];
    case 'qsv':
      return ['-c:v', CODEC === 'hevc' ? 'hevc_qsv' : 'h264_qsv', '-preset', 'veryfast', '-low_power', '1', ...common];
    case 'videotoolbox':
      return ['-c:v', CODEC === 'hevc' ? 'hevc_videotoolbox' : 'h264_videotoolbox', '-realtime', '1', '-prio_speed', '1', ...common];
    case 'libx264':
    default:
      return ['-c:v', 'libx264', '-preset', 'ultrafast', '-tune', 'zerolatency', '-profile:v', 'high', '-x264-params', 'sliced-threads=1:rc-lookahead=0', ...common];
  }
}

function baselineArgs() {
  if (!BASELINE || CODEC !== 'h264') return [];
  switch (ENCODER) {
    case 'amf': return ['-profile:v', 'constrained_baseline', '-coder', 'cavlc'];
    case 'nvenc': return ['-profile:v', 'baseline'];
    case 'qsv': return ['-profile:v', 'constrained_baseline'];
    default: return ['-profile:v', 'baseline'];
  }
}

function ffmpegArgs() {
  return [
    '-hide_banner', '-loglevel', 'warning',
    '-fflags', 'nobuffer', '-flags', 'low_delay',
    ...inputArgs(),
    // fps= makes the output constant-rate: desktop capture only emits frames when
    // the screen changes, and gaps in timestamps stall MSE until the next keyframe.
    '-vf', `fps=${FPS},scale=${SIZE.replace('x', ':')},format=yuv420p`,
    '-an',
    ...encoderArgs(),
    ...(CODEC === 'hevc' ? ['-tag:v', 'hvc1'] : []),
    '-f', 'mp4',
    '-movflags', 'empty_moov+default_base_moof+frag_every_frame+omit_tfhd_offset',
    '-flush_packets', '1',
    'pipe:1',
  ];
}

const wss = new WebSocketServer({port: PORT, perMessageDeflate: false});
let current = null; // {t: transport, proc}

function stopCurrent() {
  if (!current) return;
  current.proc.kill('SIGKILL');
  try { current.t.close(); } catch {}
  current = null;
}

function frame(kind, payload) {
  const msg = Buffer.allocUnsafe(15 + payload.length);
  msg.write('VL', 0, 'latin1');
  msg.writeUInt32BE(9 + payload.length, 2);
  msg.writeUInt8(kind, 6);
  msg.writeDoubleBE(Date.now(), 7);
  payload.copy(msg, 15);
  return msg;
}

// A viewer transport: WebSocket (JS/MSE client) or raw TCP (native client).
// Both carry the same 'VL' records; TCP also gets the hello as a kind-2 record.
function startSession(t) {
  console.log(`[spike] ${t.label} viewer connected from ${t.remote}`);
  stopCurrent();

  const ffArgs = ffmpegArgs();
  console.log(`[spike] ${FFMPEG} ${ffArgs.join(' ')}`);
  const proc = spawn(FFMPEG, ffArgs, {stdio: ['ignore', 'pipe', 'inherit']});
  const session = {t, proc};
  current = session;

  t.sendHello({t: 'hello', codec: CODEC, size: SIZE, fps: FPS, encoder: ENCODER, source: SOURCE, baseline: BASELINE});

  let initSent = false;
  let pendingMoof = null;
  let frames = 0;
  let bytes = 0;
  const statTimer = setInterval(() => {
    console.log(`[spike] ${frames} fps, ${(bytes * 8 / 1e6).toFixed(1)} Mbps, ${t.label} buffered ${t.buffered()} B`);
    frames = 0;
    bytes = 0;
  }, 1000);

  const initParts = [];
  const splitter = new Mp4BoxSplitter((type, box) => {
    if (!initSent) {
      if (type === 'ftyp' || type === 'moov') {
        initParts.push(box);
        if (type === 'moov') {
          t.send(frame(0, Buffer.concat(initParts)));
          initSent = true;
        }
      }
      return;
    }
    if (type === 'moof') {
      pendingMoof = box;
    } else if (type === 'mdat' && pendingMoof) {
      // Drop frames rather than queue if the link is congested; the decoder
      // recovers on the next keyframe in the worst case.
      if (t.buffered() > 2_000_000) return;
      const payload = Buffer.concat([pendingMoof, box]);
      pendingMoof = null;
      t.send(frame(1, payload));
      frames++;
      bytes += payload.length;
    }
  });

  proc.on('error', (err) => {
    const hint = err.code === 'ENOENT'
      ? `ffmpeg not found. Install it (e.g. "winget install Gyan.FFmpeg", then open a new terminal) or pass --ffmpeg=C:\\path\\to\\ffmpeg.exe`
      : err.message;
    console.error(`[spike] failed to start ffmpeg: ${hint}`);
    t.close();
    if (current === session) current = null;
  });

  proc.stdout.on('data', (chunk) => splitter.push(chunk));
  proc.on('exit', (code) => {
    console.log(`[spike] ffmpeg exited (${code})`);
    if (current === session) stopCurrent();
  });

  return {
    closed() {
      clearInterval(statTimer);
      console.log(`[spike] ${t.label} viewer disconnected`);
      if (current === session) stopCurrent();
    },
  };
}

wss.on('connection', (ws, req) => {
  req.socket.setNoDelay(true);
  const s = startSession({
    label: 'ws',
    remote: req.socket.remoteAddress,
    send: (buf) => ws.send(buf),
    sendHello: (obj) => ws.send(JSON.stringify(obj)),
    buffered: () => ws.bufferedAmount,
    close: () => { try { ws.close(1011, 'ffmpeg failed to start'); } catch {} },
  });
  ws.on('message', (data, isBinary) => {
    if (isBinary) return;
    try {
      const msg = JSON.parse(data.toString());
      if (msg.t === 'ping') ws.send(JSON.stringify({t: 'pong', c: msg.c, s: Date.now()}));
    } catch {}
  });
  ws.on('close', () => s.closed());
});

// Raw TCP for the native client: same records, hello as kind 2 (JSON payload).
const tcpServer = net.createServer((sock) => {
  sock.setNoDelay(true);
  const s = startSession({
    label: 'tcp',
    remote: sock.remoteAddress,
    send: (buf) => sock.write(buf),
    sendHello: (obj) => sock.write(frame(2, Buffer.from(JSON.stringify(obj)))),
    buffered: () => sock.writableLength,
    close: () => sock.destroy(),
  });
  sock.on('error', () => {});
  sock.on('close', () => s.closed());
});
tcpServer.listen(TCP_PORT);

console.log(`[spike] listening on ws://0.0.0.0:${PORT} and tcp://0.0.0.0:${TCP_PORT}  source=${SOURCE} encoder=${ENCODER} codec=${CODEC} ${SIZE}@${FPS} ${BITRATE}`);
console.log(`[spike] using ffmpeg: ${FFMPEG}${FFMPEG === 'ffmpeg' ? '  (not found on PATH or in common install folders!)' : ''}`);
