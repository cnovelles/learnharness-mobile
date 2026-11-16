#!/bin/sh
# The Deepgram run, on macOS, against a fake Deepgram (deepgram-server.cjs):
# the fixed URL (the same as the desktop's), audio before the socket opens,
# a final result, a refused token, and a lost connection.
# Needs the Xcode command line tools, Node, and the fork at ../learnharness
# (or LH_FORK) for the desktop's URL and the `ws` package.
set -eu
here=$(cd "$(dirname "$0")" && pwd)
fork=${LH_FORK:-$here/../../../../learnharness}
out=$(mktemp -d)
trap 'rm -rf "$out"' EXIT
desktop=$(cd "$fork" && node_modules/.bin/tsx -e 'import("./src/core/dictation.ts").then((m) => process.stdout.write(m.deepgramListenUrl("en")))')
swiftc -O -o "$out/deepgram" "$here/../ios/DictationEngine.swift" "$here/../ios/MicrophoneCapture.swift" "$here/../ios/DeepgramRun.swift" "$here/deepgram/main.swift"
cat > "$out/run.sh" <<RUN
#!/bin/sh
exec "$out/deepgram" "\$1" "$desktop"
RUN
chmod +x "$out/run.sh"
LH_FORK="$fork" node "$here/deepgram-server.cjs" "$out/run.sh"
