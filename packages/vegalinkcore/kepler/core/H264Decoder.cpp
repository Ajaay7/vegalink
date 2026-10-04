#include "H264Decoder.h"

#ifdef VEGALINK_HAVE_FFMPEG
extern "C" {
#include <libavcodec/avcodec.h>
#include <libavutil/error.h>
#include <libavutil/mem.h>
}
#endif

#include <cstring>

namespace vegalink {

#ifdef VEGALINK_HAVE_FFMPEG

namespace {
std::string avError(int err) {
  char buf[AV_ERROR_MAX_STRING_SIZE] = {0};
  av_strerror(err, buf, sizeof(buf));
  return buf;
}
}  // namespace

struct H264Decoder::Impl {
  AVCodecContext* ctx = nullptr;
  AVPacket* pkt = nullptr;
  AVFrame* frame = nullptr;
};

H264Decoder::H264Decoder() : impl_(std::make_unique<Impl>()) {}
H264Decoder::~H264Decoder() { close(); }

bool H264Decoder::available() { return true; }

bool H264Decoder::open(const std::vector<uint8_t>& avcC, int threads, std::string& error) {
  close();
  const AVCodec* codec = avcodec_find_decoder(AV_CODEC_ID_H264);
  if (!codec) {
    error = "H.264 decoder not built in";
    return false;
  }
  AVCodecContext* ctx = avcodec_alloc_context3(codec);
  ctx->extradata = static_cast<uint8_t*>(av_mallocz(avcC.size() + AV_INPUT_BUFFER_PADDING_SIZE));
  std::memcpy(ctx->extradata, avcC.data(), avcC.size());
  ctx->extradata_size = static_cast<int>(avcC.size());
  ctx->thread_count = threads < 1 ? 1 : threads;
  if (threads <= 1) {
    // Output every frame as soon as it is decoded; no reordering delay.
    ctx->flags |= AV_CODEC_FLAG_LOW_DELAY;
    ctx->thread_type = FF_THREAD_SLICE;
  } else {
    ctx->thread_type = FF_THREAD_FRAME;
  }
  ctx->flags2 |= AV_CODEC_FLAG2_FAST;
  int err = avcodec_open2(ctx, codec, nullptr);
  if (err < 0) {
    error = "avcodec_open2: " + avError(err);
    avcodec_free_context(&ctx);
    return false;
  }
  impl_->ctx = ctx;
  impl_->pkt = av_packet_alloc();
  impl_->frame = av_frame_alloc();
  return true;
}

bool H264Decoder::decode(const uint8_t* data, size_t size, const FrameCallback& onFrame, std::string& error) {
  if (!impl_->ctx) {
    error = "decoder not open";
    return false;
  }
  AVPacket* pkt = impl_->pkt;
  // libavcodec needs padded input; copy into a refcounted packet buffer.
  if (av_new_packet(pkt, static_cast<int>(size)) < 0) {
    error = "out of memory";
    return false;
  }
  std::memcpy(pkt->data, data, size);
  int err = avcodec_send_packet(impl_->ctx, pkt);
  av_packet_unref(pkt);
  if (err < 0 && err != AVERROR(EAGAIN)) {
    // Corrupt input: keep going, the next keyframe resynchronises.
    error = "send_packet: " + avError(err);
  }
  for (;;) {
    err = avcodec_receive_frame(impl_->ctx, impl_->frame);
    if (err == AVERROR(EAGAIN) || err == AVERROR_EOF) break;
    if (err < 0) {
      error = "receive_frame: " + avError(err);
      return false;
    }
    AVFrame* f = impl_->frame;
    if (f->format == AV_PIX_FMT_YUV420P || f->format == AV_PIX_FMT_YUVJ420P) {
      YuvFrame yuv;
      yuv.width = f->width;
      yuv.height = f->height;
      for (int i = 0; i < 3; ++i) {
        yuv.plane[i] = f->data[i];
        yuv.stride[i] = f->linesize[i];
      }
      onFrame(yuv);
    } else {
      error = "unsupported pixel format " + std::to_string(f->format);
    }
    av_frame_unref(f);
  }
  return true;
}

void H264Decoder::close() {
  if (!impl_) return;
  if (impl_->ctx) avcodec_free_context(&impl_->ctx);
  if (impl_->pkt) av_packet_free(&impl_->pkt);
  if (impl_->frame) av_frame_free(&impl_->frame);
}

#else  // !VEGALINK_HAVE_FFMPEG

struct H264Decoder::Impl {};
H264Decoder::H264Decoder() : impl_(std::make_unique<Impl>()) {}
H264Decoder::~H264Decoder() = default;
bool H264Decoder::available() { return false; }
bool H264Decoder::open(const std::vector<uint8_t>&, int, std::string& error) {
  error = "built without ffmpeg for this architecture";
  return false;
}
bool H264Decoder::decode(const uint8_t*, size_t, const FrameCallback&, std::string& error) {
  error = "built without ffmpeg";
  return false;
}
void H264Decoder::close() {}

#endif

}  // namespace vegalink
