#include "StreamSession.h"

#include <arpa/inet.h>
#include <fcntl.h>
#include <netdb.h>
#include <netinet/in.h>
#include <netinet/tcp.h>
#include <poll.h>
#include <sys/socket.h>
#include <unistd.h>

#include <cerrno>
#include <cstdio>
#include <cstring>
#include <vector>

#include "H264Decoder.h"
#include "Mp4Util.h"
#include "RecordReader.h"

namespace vegalink {

namespace {

using Clock = std::chrono::steady_clock;

double msSince(Clock::time_point t) {
  return std::chrono::duration<double, std::milli>(Clock::now() - t).count();
}

std::string jsonEscape(const std::string& s) {
  std::string out;
  for (char c : s) {
    if (c == '"' || c == '\\') out += '\\';
    if (static_cast<unsigned char>(c) < 0x20) continue;
    out += c;
  }
  return out;
}

}  // namespace

StreamSession::StreamSession(std::string host, int port, int decodeThreads, std::unique_ptr<Presenter> presenter)
    : host_(std::move(host)), port_(port), decodeThreads_(decodeThreads), presenter_(std::move(presenter)) {}

StreamSession::~StreamSession() { stop(); }

void StreamSession::start() {
  stopping_ = false;
  thread_ = std::thread([this] { run(); });
}

void StreamSession::stop() {
  stopping_ = true;
  int fd = fd_.load();
  if (fd >= 0) ::shutdown(fd, SHUT_RDWR);  // unblocks recv()
  if (thread_.joinable()) thread_.join();
}

void StreamSession::setState(const char* state, const std::string& error) {
  std::lock_guard<std::mutex> lock(statsMutex_);
  state_ = state;
  if (!error.empty()) error_ = error;
}

bool StreamSession::connectSocket(std::string& error) {
  addrinfo hints{};
  hints.ai_family = AF_INET;
  hints.ai_socktype = SOCK_STREAM;
  addrinfo* res = nullptr;
  std::string port = std::to_string(port_);
  int rc = getaddrinfo(host_.c_str(), port.c_str(), &hints, &res);
  if (rc != 0 || !res) {
    error = std::string("resolve ") + host_ + ": " + gai_strerror(rc);
    return false;
  }
  int fd = ::socket(res->ai_family, res->ai_socktype, res->ai_protocol);
  if (fd < 0) {
    error = std::string("socket: ") + std::strerror(errno);
    freeaddrinfo(res);
    return false;
  }
  // Non-blocking connect with a timeout, then back to blocking reads.
  int flags = fcntl(fd, F_GETFL, 0);
  fcntl(fd, F_SETFL, flags | O_NONBLOCK);
  rc = ::connect(fd, res->ai_addr, res->ai_addrlen);
  freeaddrinfo(res);
  if (rc < 0 && errno == EINPROGRESS) {
    pollfd p{fd, POLLOUT, 0};
    rc = poll(&p, 1, 5000);
    int soErr = 0;
    socklen_t len = sizeof(soErr);
    getsockopt(fd, SOL_SOCKET, SO_ERROR, &soErr, &len);
    if (rc <= 0 || soErr != 0) {
      error = rc == 0 ? "connect timed out" : std::string("connect: ") + std::strerror(soErr ? soErr : errno);
      ::close(fd);
      return false;
    }
  } else if (rc < 0) {
    error = std::string("connect: ") + std::strerror(errno);
    ::close(fd);
    return false;
  }
  fcntl(fd, F_SETFL, flags);
  int one = 1;
  setsockopt(fd, IPPROTO_TCP, TCP_NODELAY, &one, sizeof(one));
  int rcvbuf = 1 << 20;
  setsockopt(fd, SOL_SOCKET, SO_RCVBUF, &rcvbuf, sizeof(rcvbuf));
  fd_ = fd;
  return true;
}

void StreamSession::run() {
  setState("connecting");
  std::string error;
  if (!connectSocket(error)) {
    setState("error", error);
    return;
  }
  setState("streaming");

  H264Decoder decoder;
  RecordReader reader;
  RecordReader::Record rec;
  std::vector<uint8_t> buf(256 * 1024);
  bool decoderOpen = false;
  constexpr int64_t kArrivalSlots = 64;
  Clock::time_point arrivals[kArrivalSlots];
  int64_t nextSeq = 0;

  while (!stopping_) {
    ssize_t n = ::recv(fd_, buf.data(), buf.size(), 0);
    if (n <= 0) {
      if (!stopping_) setState("error", n == 0 ? "sender closed the connection" : std::string("recv: ") + std::strerror(errno));
      break;
    }
    reader.push(buf.data(), static_cast<size_t>(n));
    {
      std::lock_guard<std::mutex> lock(statsMutex_);
      bytes_ += n;
    }

    while (!stopping_ && reader.next(rec)) {
      Clock::time_point receivedAt = Clock::now();
      if (rec.kind == 0) {
        std::vector<uint8_t> avcC = extractAvcC(rec.payload.data(), rec.payload.size());
        if (avcC.empty()) {
          setState("error", "init segment has no avcC (only H.264 is supported)");
          continue;
        }
        if (!decoder.open(avcC, decodeThreads_, error)) {
          setState("error", error);
          continue;
        }
        decoderOpen = true;
      } else if (rec.kind == 1 && decoderOpen) {
        ByteSpan au = extractMdat(rec.payload.data(), rec.payload.size());
        if (au.empty()) continue;
        {
          std::lock_guard<std::mutex> lock(statsMutex_);
          ++received_;
        }
        // Remember when each access unit arrived so the frame that comes out
        // of the (possibly frame-threaded) decoder can be timed end to end.
        const int64_t seq = nextSeq++;
        arrivals[seq % kArrivalSlots] = receivedAt;
        decoder.decode(au.data, au.size, seq, [&](const YuvFrame& frame, int64_t pts) {
          Clock::time_point decodedAt = Clock::now();
          bool known = pts >= 0 && pts > seq - kArrivalSlots && pts <= seq;
          Clock::time_point arrivedAt = known ? arrivals[pts % kArrivalSlots] : receivedAt;
          // Arrival -> decoded: includes any frame-threading delay.
          double decodeMs = std::chrono::duration<double, std::milli>(decodedAt - arrivedAt).count();
          bool shown = presenter_->present(frame);
          double totalMs = msSince(arrivedAt);
          std::lock_guard<std::mutex> lock(statsMutex_);
          ++decoded_;
          decodeMsSum_ += decodeMs;
          if (decodeMs > decodeMsMax_) decodeMsMax_ = decodeMs;
          if (shown) {
            ++presented_;
            pipelineMsSum_ += totalMs;
          } else {
            ++dropped_;
          }
          width_ = frame.width;
          height_ = frame.height;
        }, error);
      }
    }
  }

  decoder.close();
  int fd = fd_.exchange(-1);
  if (fd >= 0) ::close(fd);
  std::lock_guard<std::mutex> lock(statsMutex_);
  if (state_ != "error") state_ = "idle";
}

std::string StreamSession::takeStatsJson() {
  std::lock_guard<std::mutex> lock(statsMutex_);
  double intervalMs = msSince(lastStats_);
  lastStats_ = Clock::now();
  char out[1024];
  std::snprintf(out, sizeof(out),
                "{\"state\":\"%s\",\"error\":\"%s\",\"received\":%d,\"decoded\":%d,\"presented\":%d,\"dropped\":%d,"
                "\"decodeMsAvg\":%.2f,\"decodeMsMax\":%.2f,\"pipelineMsAvg\":%.2f,\"bytes\":%lld,"
                "\"intervalMs\":%.0f,\"width\":%d,\"height\":%d,\"renderer\":\"%s\"}",
                state_.c_str(), jsonEscape(error_).c_str(), received_, decoded_, presented_, dropped_,
                decoded_ ? decodeMsSum_ / decoded_ : 0.0, decodeMsMax_,
                presented_ ? pipelineMsSum_ / presented_ : 0.0, bytes_, intervalMs, width_, height_,
                presenter_ ? jsonEscape(presenter_->name()).c_str() : "none");
  received_ = decoded_ = presented_ = dropped_ = 0;
  decodeMsSum_ = decodeMsMax_ = pipelineMsSum_ = 0;
  bytes_ = 0;
  return out;
}

}  // namespace vegalink
