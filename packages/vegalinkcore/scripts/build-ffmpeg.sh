#!/bin/sh
# Builds a minimal static, position-independent ffmpeg (H.264 + HEVC decoders)
# for the Fire TV Stick's armv7 userspace, using the Vega SDK's clang + sysroot.
# Output: third_party/ffmpeg/armv7/{include,lib}  (git-ignored)
set -eu
FFMPEG_VERSION=${FFMPEG_VERSION:-7.1.1}
HERE=$(cd "$(dirname "$0")/.." && pwd)
SDK=${VEGA_SDK:-$HOME/vega/sdk/vega-sdk/main/0.24.12112}
P=$SDK/packages
SR=$(echo $P/VodkaSysrootArmv7/*/AL2_x86_64/DEV.STD.PTHREAD/build/sysroot-armv7)
CL=$(echo $P/VodkaClangMac/*/AL2_x86_64/DEV.STD.PTHREAD/build/mac/bin)
GCCDIR=$(echo $SR/usr/lib/arm-oe-linux-gnueabi/*)
WORK=${TMPDIR:-/tmp}/vegalink-ffmpeg-build
OUT=$HERE/third_party/ffmpeg/armv7

mkdir -p "$WORK"
cat > "$WORK/armcc" <<CC
#!/bin/sh
exec "$CL/clang-15" --target=armv7a-linux-gnueabihf -march=armv7-a -mtune=cortex-a55 -mfpu=neon-vfpv4 -mfloat-abi=hard \\
  --sysroot="$SR" -fuse-ld=lld -rtlib=libgcc -unwindlib=libgcc -B"$GCCDIR" -L"$GCCDIR" -Wno-unused-command-line-argument "\$@"
CC
chmod +x "$WORK/armcc"

cd "$WORK"
[ -f "ffmpeg-$FFMPEG_VERSION.tar.xz" ] || curl -fsSLO "https://ffmpeg.org/releases/ffmpeg-$FFMPEG_VERSION.tar.xz"
rm -rf "ffmpeg-$FFMPEG_VERSION" && tar xf "ffmpeg-$FFMPEG_VERSION.tar.xz"
cd "ffmpeg-$FFMPEG_VERSION"
./configure --prefix="$OUT" --enable-cross-compile --target-os=linux --arch=arm --cpu=armv7-a \
  --cc="$WORK/armcc" --ar="$CL/llvm-ar" --ranlib="$CL/llvm-ranlib" --nm="$CL/llvm-nm" --strip="$CL/llvm-strip" \
  --enable-pic --enable-static --disable-shared --enable-neon --enable-pthreads \
  --disable-everything --disable-programs --disable-doc --disable-network --disable-autodetect \
  --disable-avdevice --disable-avformat --disable-swresample --disable-avfilter --disable-swscale \
  --enable-decoder=h264,hevc --enable-parser=h264,hevc >/dev/null
make -j"$(sysctl -n hw.ncpu 2>/dev/null || nproc)" >/dev/null
rm -rf "$OUT" && make install >/dev/null
rm -rf "$OUT/lib/pkgconfig"
echo "ffmpeg $FFMPEG_VERSION installed to $OUT"
