cmake_minimum_required(VERSION 3.17)

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
  kepler/ui/MediaSurfacePresenter.h
)
set(SOURCES
  kepler/turbo-modules/generated/VegaLinkCoreSpec.cpp
  kepler/turbo-modules/VegaLinkCore.cpp
  kepler/core/H264Decoder.cpp
  kepler/core/Mp4Util.cpp
  kepler/core/RecordReader.cpp
  kepler/core/StreamSession.cpp
  kepler/AutoLinkInit.cpp
  kepler/ui/MediaSurfacePresenter.cpp
)

find_package(turbomoduleAPI CONFIG REQUIRED)

# OS interfaces (IDL → generated C++ bindings): media surface + buffers for
# presenting decoded frames, and the UI toolkit for the native video view.
find_package(Apmf REQUIRED)
find_package(Kepler REQUIRED)
kepler_add_idl_import_library(vegalink_idl
  PACKAGES
  com.amazon.kepler.graphics
  com.amazon.kepler.buffer
  com.amazon.kepler.uitoolkit.graphics
  com.amazon.kepler.uitoolkit.view
  com.amazon.kepler.uitoolkit.react
)

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

target_link_libraries(VegaLinkCore PRIVATE vegalink_idl ${LIBRARIES})

install(TARGETS VegaLinkCore)

# <VegaLinkVideoView> native UI component: a separate APMF component library
# ("/com.vegalink.ui"), installed under the component's file name.
kepler_add_library(VegaLinkUI SHARED
  kepler/ui/SurfaceRegistry.cpp
  kepler/ui/VideoViewManager.cpp
)
target_link_libraries(VegaLinkUI PRIVATE vegalink_idl turbomoduleAPI::turbomoduleAPI)
kepler_install_components(VegaLinkUI IN_PROCESS "/com.vegalink.ui")
set(VEGALINK_UI_COMPONENT_FILE "com.vegalink.ui.so")
add_custom_command(
  TARGET VegaLinkUI
  POST_BUILD
  COMMAND ${CMAKE_COMMAND} ARGS -E copy $<TARGET_FILE:VegaLinkUI> ${CMAKE_CURRENT_BINARY_DIR}/${VEGALINK_UI_COMPONENT_FILE}
)
install(TARGETS VegaLinkUI)
install(FILES ${CMAKE_CURRENT_BINARY_DIR}/${VEGALINK_UI_COMPONENT_FILE} DESTINATION lib)
