#!/bin/sh
# Run Maestro flows on one Simulator. The script starts a new test Mac
# (scripts/e2e-mac.ts) for each flow, because the pairing code is for one use
# and the scripted lesson is for one run. Metro must run already.
# Usage:
#   sh scripts/e2e-suite.sh <device udid> <output dir> [flow name ...]
# With no flow names, the script runs all flows in FLOWS below.
# Each flow writes its screenshots and logs to <output dir>/<flow name>/.
# The script writes one line for each flow to <output dir>/summary.txt.
# A flow that runs longer than FLOW_LIMIT seconds (default 600) fails.
# Warning: a flow clears the app state on the Simulator (a new pairing).

set -u
device="$1"
out="$2"
shift 2

# name|flow file|test Mac options
FLOWS="
first-turn|e2e/first-turn.yaml|
teach-cycle|e2e/teach-cycle.yaml|
rich-lesson|e2e/rich-lesson.yaml|LH_E2E_RICH=1
wide-content|e2e/wide-content.yaml|LH_E2E_RICH=1
practice|e2e/practice.yaml|
open-long|e2e/open-long-session.yaml|LH_E2E_GOLDEN=1 LH_E2E_MATH=1
teach-shelf|e2e/teach-shelf.yaml|LH_E2E_GOLDEN=1 LH_E2E_SHELF=1
teach-folders|e2e/teach-folders.yaml|LH_E2E_GOLDEN=1 LH_E2E_SHELF=1
practice-shelf|e2e/practice-shelf.yaml|LH_E2E_GOLDEN=1 LH_E2E_PRACTICE_SHELF=1
tabs|e2e/tabs.yaml|LH_E2E_GOLDEN=1 LH_E2E_SHELF=1 LH_E2E_PRACTICE_SHELF=1
graph-open|e2e/graph-open-message.yaml|LH_E2E_GOLDEN=1 LH_E2E_LINK=1
"
# Flows that run only by name. "dictation" needs Metro with the scripted text:
# EXPO_PUBLIC_LH_E2E_DICTATION_TEXT="The Moon makes two bulges." npx expo start --clear
EXTRA_FLOWS="
dictation|e2e/dictation-suite.yaml|
"

names="$*"
if [ -z "$names" ]; then
	names=$(echo "$FLOWS" | sed -n 's/^\([a-z-]*\)|.*/\1/p')
fi

export JAVA_HOME="${JAVA_HOME:-$(/usr/libexec/java_home -v 17)}"
export PATH="$HOME/.maestro/bin:$PATH"
export MAESTRO_CLI_NO_ANALYTICS=1
tsx=../learnharness/node_modules/.bin/tsx
mkdir -p "$out"
summary="$out/summary.txt"
FLOW_LIMIT="${FLOW_LIMIT:-600}"

mac_pid=""
stop_mac() {
	if [ -n "$mac_pid" ]; then
		kill -TERM "$mac_pid" 2>/dev/null
		# The test Mac stops its server, gateway and fake model (at most 30 s).
		i=0
		while kill -0 "$mac_pid" 2>/dev/null && [ $i -lt 30 ]; do
			sleep 1
			i=$((i + 1))
		done
		kill -KILL "$mac_pid" 2>/dev/null
		mac_pid=""
	fi
}
trap 'stop_mac; exit 130' INT TERM

for name in $names; do
	line=$(printf '%s\n%s\n' "$FLOWS" "$EXTRA_FLOWS" | grep "^$name|")
	if [ -z "$line" ]; then
		echo "$name: unknown flow" | tee -a "$summary"
		continue
	fi
	flow=$(echo "$line" | cut -d'|' -f2)
	options=$(echo "$line" | cut -d'|' -f3)
	dir="$out/$name"
	mkdir -p "$dir"
	rm -f e2e/.pairing.txt

	# A test Mac with the options of this flow. next dev can stop at its
	# first start to show a notice (about every second start), so the script
	# tries again, at most 3 times.
	try=1
	while [ $try -le 3 ]; do
		# shellcheck disable=SC2086
		env $options "$tsx" scripts/e2e-mac.ts >"$dir/mac.log" 2>&1 &
		mac_pid=$!
		i=0
		while ! grep -q "Test Mac ready" "$dir/mac.log" 2>/dev/null; do
			if ! kill -0 "$mac_pid" 2>/dev/null || [ $i -ge 300 ]; then
				break
			fi
			sleep 1
			i=$((i + 1))
		done
		if grep -q "Test Mac ready" "$dir/mac.log"; then
			break
		fi
		cp "$dir/mac.log" "$dir/mac-try-$try.log"
		stop_mac
		try=$((try + 1))
	done
	if ! grep -q "Test Mac ready" "$dir/mac.log"; then
		echo "$name: FAIL (the test Mac did not start, see $dir/mac.log)" | tee -a "$summary"
		stop_mac
		continue
	fi

	# Maestro can hang when its iOS driver fails ("Request for viewHierarchy
	# failed"). A flow that runs longer than FLOW_LIMIT seconds fails.
	start=$(date +%s)
	maestro --device "$device" test \
		-e PAIRING="$(cat e2e/.pairing.txt)" -e CONTROL="$(cat e2e/.control.txt)" \
		--test-output-dir "$dir" "$flow" >"$dir/maestro.log" 2>&1 &
	maestro_pid=$!
	while kill -0 "$maestro_pid" 2>/dev/null && [ $(($(date +%s) - start)) -lt "$FLOW_LIMIT" ]; do
		sleep 2
	done
	if kill -0 "$maestro_pid" 2>/dev/null; then
		pkill -TERM -P "$maestro_pid" 2>/dev/null
		kill -TERM "$maestro_pid" 2>/dev/null
		wait "$maestro_pid" 2>/dev/null
		result="FAIL (more than $FLOW_LIMIT s, see $dir/maestro.log)"
	elif wait "$maestro_pid"; then
		result="pass"
	else
		result="FAIL (see $dir/maestro.log)"
	fi
	echo "$name: $result ($(($(date +%s) - start)) s)" | tee -a "$summary"
	stop_mac
done
