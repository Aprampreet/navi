#!/usr/bin/env bash
set -euo pipefail

NAVI_MOBILE_DIR="$(cd "$(dirname "$0")/.." && pwd)"
NAVI_XCODE_DIR="${DEVELOPER_DIR:-/Applications/Xcode.app/Contents/Developer}"

if [[ ! -x "$NAVI_XCODE_DIR/usr/bin/xcodebuild" ]]; then
  echo "Full Xcode is required at /Applications/Xcode.app." >&2
  exit 1
fi
if ! command -v node >/dev/null 2>&1 || ! command -v npx >/dev/null 2>&1; then
  echo "Node.js 22 or newer is required. Install it, then run npm ci in mobile/." >&2
  exit 1
fi

export DEVELOPER_DIR="$NAVI_XCODE_DIR"
cd "$NAVI_MOBILE_DIR"

if [[ $# -gt 0 ]]; then
  npx expo run:ios --device "$1"
else
  npx expo run:ios
fi
