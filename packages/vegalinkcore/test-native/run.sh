#!/bin/sh
# Builds and runs the host-side native tests.
set -e
cd "$(dirname "$0")"
c++ -std=c++17 -O1 -g -fsanitize=address,undefined -I../kepler core_test.cpp ../kepler/core/Mp4Util.cpp ../kepler/core/RecordReader.cpp -o /tmp/vegalink_core_test
/tmp/vegalink_core_test "$@"
