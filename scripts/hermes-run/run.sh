#!/bin/sh
# Bundle one entry file with the fork's esbuild and run it on the app's own
# Hermes VM (macOS build from ios/Pods). Needs `npx expo run:ios` (or
# `pod install`) to have made ios/Pods first. The bundle calls `print(...)`.
# Usage: scripts/hermes-run/run.sh <entry.ts>
set -eu
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
HERMES="$ROOT/ios/Pods/hermes-engine/destroot"
OUT="${TMPDIR:-/tmp}/lh-hermes-run"
mkdir -p "$OUT"
if [ ! -x "$OUT/host" ] || [ "$ROOT/scripts/hermes-run/host.cpp" -nt "$OUT/host" ]; then
	clang++ -std=c++20 -O1 "$ROOT/scripts/hermes-run/host.cpp" \
		-I "$HERMES/include" -F "$HERMES/Library/Frameworks/macosx" \
		-framework hermesvm -Wl,-rpath,"$HERMES/Library/Frameworks/macosx" \
		-o "$OUT/host"
fi
"$ROOT/../learnharness/node_modules/.bin/esbuild" "$1" --bundle --format=iife \
	--target=es2020 --platform=neutral --main-fields=module,main \
	--outfile="$OUT/bundle.js" --log-level=warning
"$OUT/host" "$OUT/bundle.js"
