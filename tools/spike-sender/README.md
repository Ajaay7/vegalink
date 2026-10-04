# VegaLink Phase 0 — latency spike sender

This tool answers one question: is the Vega MSE video path fast enough for game streaming?
It captures the PC screen and encodes it with ffmpeg as fragmented MP4, one fragment per frame. Each fragment goes over a WebSocket to the VegaLink app on the Fire TV.

## Run on the Windows gaming PC
1. Install Node.js 20+ and a recent ffmpeg (6.1+, for `ddagrab`). Put ffmpeg on `PATH`, or pass `--ffmpeg=C:\path\ffmpeg.exe`.
2. Copy this folder to the PC, then run:
   ```
   npm install
   node sender.mjs --encoder=nvenc            # NVIDIA
   node sender.mjs --encoder=amf              # AMD
   node sender.mjs --encoder=qsv              # Intel
   node sender.mjs                            # CPU x264 fallback
   ```
3. Allow TCP port 8765 through Windows Firewall.

Options:

| Option | Values | Default |
|---|---|---|
| `--source` | `desktop` or `test` | `desktop` on Windows |
| `--codec` | `h264` or `hevc` | `h264` |
| `--size` | resolution | `1920x1080` |
| `--fps` | frame rate | `60` |
| `--bitrate` | bitrate | `15M` |
| `--grab` | `gdigrab` (if `ddagrab` fails) | `ddagrab` |
| `--port` | TCP port | `8765` |

## On the Fire TV
Open VegaLink and enter `ws://<PC-IP>:8765`, then press **Connect**. Press Back to disconnect.

What the HUD shows:
- **transit**: encoder output → app receive. This is network plus WebSocket delay, using a clock offset estimated by ping.
- **buffer lead**: how far the player's playhead sits behind the newest appended frame. Ideally it stays under 50 ms.
- **skips**: how many times the app jumped the playhead forward to cut latency. If this keeps climbing, the player is buffering on its own.

## Measuring glass-to-glass latency
1. On the PC, open a millisecond stopwatch (for example https://www.online-stopwatch.com/full-screen-stopwatch/).
2. Put the PC monitor next to the TV, with the TV in Game mode.
3. Take a few phone photos showing both screens. Latency is the PC stopwatch value minus the TV stopwatch value.
4. Compare against the go/no-go threshold in the plan: about 80 ms added on top of the monitor.

Try `--codec=hevc` and `--size=1280x720` as well. Report the numbers before Phase 1 starts.
