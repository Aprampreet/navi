# NAVI Android prototype

NAVI is an assistive walking-route and camera-awareness prototype. It is **not** a mobility aid that can authorize road crossings or guarantee an accessible or clear path. Use it only in controlled, supervised testing with the phone's rear camera uncovered and pointed forward.

## Implementation checklist

- [x] Expo SDK 58 development-build project with Android native code, large accessible controls, permissions, GPS, map view
- [x] USB ADB connection to Motorola edge 30, Android 14, arm64-v8a
- [x] Local arm64 debug APK built and installed on that phone; NAVI opens
- [x] CameraX analyzed live frames with on-device ONNX Runtime and detected a chair in the centre (first frame 561 ms; later UI samples 331–392 ms)
- [x] CameraX preview and native ONNX Runtime inference code with 640 px letterbox, YOLO11 output decoding and class-aware NMS
- [x] Image-space zones, per-class frame counts, three-frame scene smoothing, change-only cues and 5-second per-event cooldown
- [x] One priority speech queue for camera scene changes and walking instructions; pause, mute, repeat and stop controls
- [x] Lightweight on-device object tracking with temporary IDs, class-aware box association, motion prediction, short occlusion tolerance and camera-relative zone transitions
- [x] NAVI 3.0 relative image-scale estimator with timestamped track history, stable-reference and camera-motion gates, cautious approach/recede cues, UNKNOWN fallback and bounded speech queue
- [x] Android tap-to-talk speech, deterministic destination commands and TTS queue
- [x] Free open-map proxy, Leaflet map, walking polyline, destination confirmation and basic GPS step progress
- [x] Heritage Street (Town Hall entrance) confirmation and route line verified on phone; first spoken guidance and camera feed work together
- [x] TypeScript/unit tests
- [x] Expo Android JavaScript bundle without local Android tooling
- [ ] Verify offline camera detection, person counts, and bicycle class accuracy on-device
- [x] Verify a person cue and no repeated announcement for the unchanged person scene on the phone
- [x] Verify chair-left then chair-centre announcements and separate route/camera speech on the phone
- [x] Verify the new tracked chair-left-to-centre behavior, live feed and map on the phone after the tracking update
- [x] Verify one cautious "appears to be getting closer" cue with a stationary phone and no false closer cue when the phone moved in a controlled indoor test
- [ ] Verify a significant count-change cue with multiple supported objects on the phone
- [x] Record a short phone sample of detection FPS, inference latency, app memory and battery temperature
- [ ] Measure end-to-end audible cue latency, sustained battery drain and thermal behavior
- [ ] Test turn timing and off-route behavior on a supervised walk; choose a reachable proxy for use away from USB

## Current status

The source and a 10 MB YOLO11n ONNX model are present. The project uses Expo development-client tooling with the checked-in Android/Kotlin project. A physical Motorola edge 30 is connected over USB; no emulator or AVD is used. The Android arm64 APK built successfully, installed, and launched. CameraX delivered frames to on-device ONNX Runtime and NAVI displayed live person and chair detections. A preview surface layout fix was installed and verified with a live image and a stop/start cycle. Leaflet map tiles now render in Android's built-in WebView. The user confirmed the Heritage Street entrance result, walking route line, first spoken instruction and concurrent live camera feed on the phone. Phase 1 scene tracking now confirms class and zone changes across three frames, speaks only meaningful changes, and gives route instructions priority over camera cues. The user verified that a person cue did not repeat for the unchanged scene, a chair moving from left to centre produced the corresponding two cues, and route speech remained clear and separate from camera speech. Significant count changes remain to be checked on-device. Turn timing during walking, person counts, bicycle accuracy, and offline operation remain unverified. The app reports a camera/model error if the model is missing. The model is never replaced by simulated detections.

The advanced tracking update associates same-class boxes by overlap, size and predicted image position. Confirmed tracks keep temporary IDs through up to two missed frames, and stale tracks expire. A coordinated shift across at least three visible tracks suppresses movement wording; with one object or uncertain camera motion, NAVI announces the new image location instead of claiming that the object moved in the world. This does not estimate physical velocity, approach, distance or collision risk. The update is installed on the Motorola, automated tracking tests pass, and the user confirmed the chair-left-to-centre transition while the live feed and map continued working. Individual track IDs were verified in automated tests, not directly observed in the phone log.

## NAVI 3.0 relative approach evidence

Each confirmed track retains at most six timestamped observations with its box, image centre, area, detector confidence, heuristic association confidence and available image-motion estimate. The estimator compares smoothed early and late box area over at least 1.2 seconds. It requires three consistent scale changes and two other stable tracked objects before saying that a centre-view object **appears** to be getting closer or moving away. A coordinated shift or scale change across the scene, unstable boxes, weak tracking, occlusion, a new ID, or missing reference objects yields `UNKNOWN`. An unchanged box yields `APPARENTLY_STABLE`. These are image observations, not depth measurements or proof of independent object motion.

The Motorola reports accelerometer and gyroscope features, but NAVI does not treat either sensor as a distance sensor. The current implementation uses agreement across tracked objects to suppress camera-wide motion claims; constant camera translation and depth differences can still fool a monocular camera. The user confirmed one cautious closer cue in a controlled stationary-phone test and no false closer cue when moving the phone. The first attempt produced only the ordinary person cue, so the estimator can miss an approach when evidence is insufficient.

Observed short-session phone samples: about 1.8–1.9 analyzed frames per second, 287–291 ms model inference, and about 1 ms from the native detection timestamp to the JavaScript event. Android reported roughly 379–388 MiB app PSS and battery temperature rising from 32°C to 34°C while charging. These are snapshots, not a sustained battery or thermal study. Audible speech onset latency has not been measured.

## Prerequisites and versions

- Node 22.11+; tested locally with Node 22.14.0 and npm 10.9.2.
- Expo SDK 58, React Native 0.88.1, React 19.3.0 and `expo-dev-client`. The checked-in Android project uses CameraX/Kotlin, ONNX Runtime and Android's built-in WebView with bundled Leaflet 1.9.4; the VisionCamera package is not installed. [Expo development builds](https://docs.expo.dev/develop/development-builds/introduction/) support custom native code; Expo Go does not.
- An Android phone with a rear camera and USB debugging. Tested connection: Motorola edge 30, Android 14, `arm64-v8a`, about 5.5 GB usable RAM.
- Local Android SDK command-line tools, API 37.0 platform, build-tools 37.0.0, platform-tools, and NDK 27.1.12297006. Gradle also installed build-tools 36.0.0 and CMake 3.22.1, which its native dependencies requested. The project reuses an existing JDK 17 in `~/.gradle/jdks`. No Android Studio, emulator, AVD, or system image is required. The native project targets SDK 36 and supports min SDK 24.
- Python 3.13 or a version supported by current PyTorch/Ultralytics wheels. Export dependencies are in `ai-engine/requirements.txt`.
- An internet connection for place search, route requests and map tiles. No Google Maps key or billing account is required. The built-in demo proxy uses public Nominatim and Valhalla services with caching and request spacing. Their availability and usage limits make them suitable only for small supervised tests. An optional free openrouteservice Standard API key can be kept on the proxy instead.

## Model export

```sh
python3 -m venv ai-engine/.venv
ai-engine/.venv/bin/pip install -r ai-engine/requirements.txt
ai-engine/.venv/bin/python ai-engine/scripts/export_model.py
ai-engine/.venv/bin/python ai-engine/scripts/inspect_model.py
```

The script downloads Ultralytics' COCO-pretrained `yolo11n.pt` and exports ONNX with `imgsz=640`, opset 12, static `[1,3,640,640]` float RGB input normalized to `[0,1]`, no embedded NMS, and expected `[1,84,N]` output. It copies the checked model to `mobile/android/app/src/main/assets/yolo11n.onnx`. Android supports only COCO classes person (0), bicycle (1), car (2), motorcycle (3), bus (5), dog (16), and chair (56). **Trees, potholes, curbs and drains are not detected.** Review [Ultralytics licensing](https://www.ultralytics.com/license) before distribution; YOLO11 is subject to Ultralytics' licensing terms.

The generated artifact was inspected with ONNX Runtime: input `images [1,3,640,640]`, output `output0 [1,84,8400]`, SHA-256 `adc2cde0b1ea00ff2ffaa0c042ff87def4688e2b8b9652fcdf3194cb3664d57e`.

## Free map and routing setup

1. Connect the phone over USB and run `../.android-sdk/platform-tools/adb reverse tcp:8787 tcp:8787` from `mobile/`.
2. Run `node proxy/server.mjs` from the workspace root. With no key, the proxy uses public [Nominatim](https://operations.osmfoundation.org/policies/nominatim/) search and [Valhalla](https://github.com/valhalla/valhalla#demo-server) pedestrian routing for a single-device prototype. Requests are spaced at least 1.1 seconds apart and searches are cached. It binds to loopback by default.
3. Optional: export `ORS_API_KEY` in the proxy shell to use an [openrouteservice free Standard key](https://staging.openrouteservice.org/plans/) for both search and walking routes. Never put the key in the mobile app.
4. Run Metro with `EXPO_PUBLIC_NAVI_PROXY_URL=http://127.0.0.1:8787`. Keep the proxy and USB connection available while requesting places and routes. For walking beyond USB range, configure a reachable proxy address. A public deployment needs HTTPS, access controls and quotas.

The Android map uses bundled Leaflet and [OpenStreetMap tiles](https://operations.osmfoundation.org/policies/tiles/) with visible attribution. Public tiles are for normal interactive viewing; they may not be bulk downloaded for offline use. If search cannot find “Heritage Street Amritsar”, NAVI offers the **approximate Town Hall entrance near the Partition Museum** as an explicitly labelled result for confirmation. The street spans about a kilometre, so this is a point at one end, not the whole street. Walking routes do not certify sidewalk accessibility or safe crossings.

## Local USB development build on your phone

**Expo Go cannot run the native CameraX and ONNX detector.** Build and install NAVI's custom Expo development client directly over USB once. After that, Expo Metro can serve JavaScript changes without rebuilding. Native Kotlin or dependency changes require another local build. The script below sets `ANDROID_HOME`, `ANDROID_SDK_ROOT`, and the existing JDK 17, confirms ADB authorization, and targets only the connected phone's ABI.

```sh
cd mobile
npm ci
npx tsc --noEmit
npm test -- --runInBand
../.android-sdk/platform-tools/adb devices -l
./scripts/run-usb-android.sh
# Later JavaScript-only edits:
EXPO_PUBLIC_NAVI_PROXY_URL=http://127.0.0.1:8787 npm start
```

The debug APK is created under `mobile/android/app/build/outputs/apk/debug/` and installed by `expo run:android --device`. To test offline detection, first load the app, then disable both Wi-Fi and mobile data and tap Start Assistance. Online map routing will be unavailable while disconnected; speech recognition offline support depends on the device's recognition service.

### Ambient visible text reading (offline OCR)

Starting camera assistance or walking guidance also starts periodic still captures from the same CameraX session. The bundled ML Kit Latin OCR model reads English text locally. Prominent text must appear in two captures before NAVI announces its exact recognized words and approximate left, ahead, or right position. The last announcement is shown below the camera preview. Route turns have higher speech priority. Pause alerts, mute, and stop controls apply to text cues too. A local voice is used only if Android reports it as installed and not requiring a network connection; otherwise NAVI shows the text and an error. OCR needs no proxy, backend, or model download at first use.

The existing **Speak Guidance** command path uses Android's default speech recognizer, which is not guaranteed offline. Spoken commands such as “Read that sign” are not yet an offline feature. Place search, route computation, and live map tiles also require internet. A self-contained release APK, rather than the Metro-dependent debug build, is required for a meaningful airplane-mode restart test.

The script targets only the phone's `arm64-v8a` ABI to avoid building emulator architectures. The map reuses Android's built-in WebView and bundles about 170 KB of Leaflet files; it required no additional Android SDK or Gradle downloads.

## Device test checklist

- [ ] Confirm camera preview and at least person, bicycle, and chair labels on real Android hardware; record device model, OS, RAM and CPU/GPU.
- [ ] Show three separate people in one frame; verify a stable count and no announcement every frame.
- [ ] Move one supported object across left, centre, right; compare labels to the **image** coordinates.
- [ ] Disable all network and verify detection still emits live results.
- [x] Say “Let's go to Heritage Street Amritsar”; confirm the labelled Town Hall entrance, marker, walking polyline and first spoken step on the USB phone.
- [ ] Check that route and detection speech never overlap, and repeat/pause/mute/stop work.
- [ ] Deny camera/microphone/location; test no network, invalid keys, speech timeout, app backgrounding and poor GPS.
- [ ] Record inference latency, approximate FPS, heating and battery drain after a sustained session.

## Limitations and safety

The detector reports classes in the camera image, not collision risk or metric distance. Objects can be missed due to occlusion, lighting, motion, phone angle or model bias. GPS and walking directions can be wrong. The app does not upload camera frames. A blind or low-vision user should not use this unvalidated prototype independently.
