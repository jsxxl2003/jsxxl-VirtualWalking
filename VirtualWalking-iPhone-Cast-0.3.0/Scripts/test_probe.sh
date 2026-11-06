#!/bin/bash
set -euo pipefail
vw_project_dir="$(cd "$(dirname "$0")/.." && pwd)"
vw_probe_binary="$(mktemp -t vw-probe.XXXXXX)"
trap 'rm -f "$vw_probe_binary"' EXIT
cc -std=c17 -Wall -Wextra -Werror -Wno-misleading-indentation -fsanitize=address,undefined \
  "$vw_project_dir/Tests/probe-wire.c" -o "$vw_probe_binary"
"$vw_probe_binary"
