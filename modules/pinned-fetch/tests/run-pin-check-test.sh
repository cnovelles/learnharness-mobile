#!/bin/sh
# The native pin check, on macOS (the iOS build is not needed):
#  1. PinCheck.swift gives the same pin as the fork's Node code.
#  2. PinnedSession sends a request to a server with the right certificate,
#     and sends NOTHING to a server with another certificate.
# Needs the Xcode command line tools, Node, and the fork at ../learnharness
# (or LH_FORK).
set -eu
here=$(cd "$(dirname "$0")" && pwd)
fork=${LH_FORK:-$here/../../../../learnharness}
out=$(mktemp -d)
trap 'rm -rf "$out"' EXIT

node -e '
const t = require(process.argv[1] + "/electron/phone-access-tls.cjs");
const { cert } = t.createCertificate();
require("fs").writeFileSync(process.argv[2] + "/cert.pem", cert);
process.stdout.write(t.spkiPin(cert));
' "$fork" "$out" > "$out/pin"
swiftc -O -o "$out/pin-check" "$here/../ios/PinCheck.swift" "$here/pin-check/main.swift"
"$out/pin-check" "$out/cert.pem" "$(cat "$out/pin")"

swiftc -O -o "$out/pinned-session" "$here/../ios/PinCheck.swift" "$here/../ios/PinnedSession.swift" "$here/pinned-session/main.swift"
node "$here/pinned-session-server.cjs" "$fork" "$out/pinned-session"
