cmake_minimum_required(VERSION 3.15)

project(VegaLinkCore
        VERSION 1.0
        LANGUAGES CXX C)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)
set(CMAKE_EXPORT_COMPILE_COMMANDS ON)

# Fail at compile time for unresolved symbols.
if(CMAKE_CXX_COMPILER_ID MATCHES "Clang")
  add_link_options("LINKER:--no-undefined" "LINKER:-z,defs")
endif()

set(HEADERS
  kepler/turbo-modules/generated/VegaLinkCoreSpec.h
  kepler/turbo-modules/VegaLinkCore.h
  kepler/core/H264Decoder.h
  kepler/core/Mp4Util.h
  kepler/core/Presenter.h
  kepler/core/RecordReader.h
  kepler/core/StreamSession.h
)
set(SOURCES
  kepler/turbo-modules/generated/VegaLinkCoreSpec.cpp
  kepler/turbo-modules/VegaLinkCore.cpp
  kepler/core/H264Decoder.cpp
  kepler/core/Mp4Util.cpp
  kepler/core/RecordReader.cpp
  kepler/core/StreamSession.cpp
  kepler/AutoLinkInit.cpp
)

find_package(turbomoduleAPI CONFIG REQUIRED)

kepler_add_turbo_module_library(VegaLinkCore SHARED ${HEADERS} ${SOURCES})

# Prebuilt static ffmpeg (scripts/build-ffmpeg.sh) per architecture. Architectures
# without it build a stub decoder so the full multi-arch app build still works.
if(CMAKE_SYSTEM_PROCESSOR MATCHES "^arm" AND NOT CMAKE_SYSTEM_PROCESSOR MATCHES "aarch64|arm64")
  set(VEGALINK_ARCH armv7)
elseif(CMAKE_SYSTEM_PROCESSOR MATCHES "aarch64|arm64")
  set(VEGALINK_ARCH aarch64)
else()
  set(VEGALINK_ARCH x86_64)
endif()
set(FFMPEG_DIR ${CMAKE_CURRENT_SOURCE_DIR}/third_party/ffmpeg/${VEGALINK_ARCH})
if(EXISTS ${FFMPEG_DIR}/lib/libavcodec.a)
  message(STATUS "VegaLinkCore: using ffmpeg from ${FFMPEG_DIR}")
  target_compile_definitions(VegaLinkCore PRIVATE VEGALINK_HAVE_FFMPEG=1)
  target_include_directories(VegaLinkCore PRIVATE ${FFMPEG_DIR}/include)
  list(APPEND LIBRARIES ${FFMPEG_DIR}/lib/libavcodec.a ${FFMPEG_DIR}/lib/libavutil.a m pthread)
else()
  message(STATUS "VegaLinkCore: no ffmpeg for ${VEGALINK_ARCH} (${CMAKE_SYSTEM_PROCESSOR}); decoder disabled")
endif()

target_link_libraries(VegaLinkCore PRIVATE ${LIBRARIES})

install(TARGETS VegaLinkCore)
