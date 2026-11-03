#!/usr/bin/env bash
set -euo pipefail

NAVI_WORKSPACE="$(cd "$(dirname "$0")/../.." && pwd)"
export ANDROID_HOME="$NAVI_WORKSPACE/.android-sdk"
export ANDROID_SDK_ROOT="$ANDROID_HOME"
export PATH="$ANDROID_HOME/platform-tools:$PATH"

for NAVI_JDK in "$HOME"/.gradle/jdks/*/jdk-17*/Contents/Home; do
  if [[ -x "$NAVI_JDK/bin/java" ]]; then
    export JAVA_HOME="$NAVI_JDK"
    break
  fi
done

if [[ ! -x "${JAVA_HOME:-}/bin/java" ]]; then
  echo "JDK 17 not found. Set JAVA_HOME to a JDK 17 installation." >&2
  exit 1
fi
if [[ ! -x "$ANDROID_HOME/platform-tools/adb" ]]; then
  echo "ADB not found at $ANDROID_HOME/platform-tools/adb" >&2
  exit 1
fi
if [[ ! -d "$ANDROID_HOME/platforms/android-37.0" || ! -d "$ANDROID_HOME/ndk/27.1.12297006" ]]; then
  echo "The minimum Android SDK platform and NDK have not been installed yet." >&2
  exit 1
fi

echo "Java: $JAVA_HOME"
echo "Android SDK: $ANDROID_HOME"
adb devices -l
NAVI_SERIAL="$(adb devices | awk 'NR>1 && $2 == "device" {print $1; exit}')"
if [[ -z "$NAVI_SERIAL" ]]; then
  echo "No authorized Android phone found. Enable USB debugging and accept the prompt on the phone." >&2
  exit 1
fi

NAVI_ABI="$(adb -s "$NAVI_SERIAL" shell getprop ro.product.cpu.abi | tr -d '\r')"
case "$NAVI_ABI" in
  arm64-v8a|armeabi-v7a|x86_64|x86)
    export ORG_GRADLE_PROJECT_reactNativeArchitectures="$NAVI_ABI"
    echo "Building for phone ABI: $NAVI_ABI"
    ;;
  *) echo "Unknown phone ABI: $NAVI_ABI; using project defaults" ;;
esac

export EXPO_PUBLIC_NAVI_PROXY_URL="${EXPO_PUBLIC_NAVI_PROXY_URL:-http://127.0.0.1:8787}"
adb -s "$NAVI_SERIAL" reverse tcp:8787 tcp:8787

cd "$NAVI_WORKSPACE/mobile"
npx expo run:android --device "$NAVI_SERIAL"
