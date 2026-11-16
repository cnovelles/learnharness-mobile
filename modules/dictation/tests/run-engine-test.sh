#!/bin/sh
# The on-device dictation engine, on macOS 26 (the iOS build is not needed):
# `say` makes a short audio file, and the engine must find its words.
# Needs the Xcode command line tools. The first run can download the
# English speech model.
set -eu
here=$(cd "$(dirname "$0")" && pwd)
out=$(mktemp -d)
trap 'rm -rf "$out"' EXIT
say -o "$out/tides.aiff" "The moon pulls harder on the near side of the earth. That makes two bulges."
afconvert -f WAVE -d LEI16@16000 -c 1 "$out/tides.aiff" "$out/tides.wav"
swiftc -O -o "$out/engine" "$here/../ios/DictationEngine.swift" "$here/engine/main.swift"
"$out/engine" "$out/tides.wav"
