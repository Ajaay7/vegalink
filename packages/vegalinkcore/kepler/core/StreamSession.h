#pragma once

#include <atomic>
#include <chrono>
#include <memory>
#include <mutex>
#include <string>
#include <thread>

#include "Presenter.h"

namespace vegalink {

/**
 * Receives the sender's record stream over TCP, decodes it and hands frames to
 * a Presenter, all on one background thread (plus the decoder's own threads).
 */
class StreamSession {
 public:
  StreamSession(std::string host, int port, int decodeThreads, std::unique_ptr<Presenter> presenter);
  ~StreamSession();

  void start();
  void stop();
  /** Stats since the previous call, as a JSON object string. */
  std::string takeStatsJson();

 private:
  void run();
  bool connectSocket(std::string& error);
  void setState(const char* state, const std::string& error = {});

  const std::string host_;
  const int port_;
  const int decodeThreads_;
  std::unique_ptr<Presenter> presenter_;
  std::thread thread_;
  std::atomic<bool> stopping_{false};
  std::atomic<int> fd_{-1};

  std::mutex statsMutex_;
  std::string state_ = "idle";
  std::string error_;
  int received_ = 0;
  int decoded_ = 0;
  int presented_ = 0;
  int dropped_ = 0;
  double decodeMsSum_ = 0;
  double decodeMsMax_ = 0;
  double pipelineMsSum_ = 0;
  long long bytes_ = 0;
  int width_ = 0;
  int height_ = 0;
  std::chrono::steady_clock::time_point lastStats_ = std::chrono::steady_clock::now();
};

}  // namespace vegalink
