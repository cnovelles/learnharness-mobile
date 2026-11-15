#!/bin/sh
# Run one Maestro flow against the test Mac (npm run e2e:mac). Usage:
#   sh scripts/e2e-test.sh e2e/first-turn.yaml [more maestro options]
set -e
export JAVA_HOME="${JAVA_HOME:-$(/usr/libexec/java_home -v 17)}"
export PATH="$HOME/.maestro/bin:$PATH"
export MAESTRO_CLI_NO_ANALYTICS=1
flow="$1"
shift
maestro test -e PAIRING="$(cat e2e/.pairing.txt)" -e CONTROL="$(cat e2e/.control.txt)" "$@" "$flow"
