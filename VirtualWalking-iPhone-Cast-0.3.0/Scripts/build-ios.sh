#!/bin/bash
set -euo pipefail
vw_project_dir="$(cd "$(dirname "$0")/.." && pwd)"
if ! command -v xcodebuild >/dev/null 2>&1; then
  echo 'Dieser Schritt benötigt einen Mac mit Xcode. Es wurde kein iPhone-Build erstellt.' >&2
  exit 2
fi
python3 "$vw_project_dir/Scripts/build_web.py"
xcodebuild -project "$vw_project_dir/VirtualWalkingTV.xcodeproj" \
  -scheme VirtualWalkingTV -configuration Debug \
  -destination 'generic/platform=iOS Simulator' \
  -derivedDataPath "$vw_project_dir/.build" CODE_SIGNING_ALLOWED=NO build
