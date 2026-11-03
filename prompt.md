# NAVI — Master Implementation Prompt for Codex

You are a senior React Native Android engineer, edge-AI/mobile ML engineer, and accessibility-minded product engineer. Build **NAVI**, an Android-first hackathon prototype that combines voice-driven walking-route selection on Google Maps with **real on-device object detection and concise spoken obstacle-awareness cues**.

**Read `discription.md` completely first. Treat it as the product specification.** Implement actual working code, not just diagrams or UI mockups. Keep the 18-hour hackathon constraint central. Make safe, explicit assumptions and record unresolved hardware/API details. Never misrepresent simulated output as live detections.

## 0. First actions
1. Inspect the repository, existing code, installed SDKs, Node/Java/Android versions, and available device/emulator.
2. Ask only for blocking missing inputs: **Android phone model/OS/RAM** and whether **Google Maps Platform keys/billing** are available. Continue building independent modules while waiting.
3. Choose either Expo **Development Build** or bare React Native based on the actual camera/ONNX native-module compatibility. **Do not use Expo Go** if native dependencies require a custom build.
4. Validate current package and native compatibility before pinning versions. Document versions in README.
5. Create a prioritized checklist, then implement and test incrementally. Do not spend hours on ornamental UI before the camera-to-speech pipeline works.

## 1. Mandatory user story
The user taps a microphone and says, **“Let's go to Heritage Street.”** The app transcribes the utterance, extracts destination `Heritage Street`, resolves it through Google Places (prefer nearby Amritsar matches when location warrants it), confirms the result, places a marker on Google Maps, requests a **walking** route from the current GPS position, draws the polyline, and announces basic step guidance after confirmation. At the same time, with the forward-facing camera exposed, on-device YOLO inference detects supported objects. The app can say **“Three people detected ahead in the camera view”**, **“Bicycle detected on the right”**, or **“Chair detected in the centre.”** Route and detection speech share one prioritized queue with cooldowns.

## 2. Required stack
- React Native + TypeScript, Android first.
- VisionCamera and supported frame processor; if blocked, use a minimal CameraX/Kotlin bridge.
- Python + Ultralytics + PyTorch/OpenCV **for model preparation/export only**.
- A lightweight pretrained YOLO model, e.g. YOLO11n, exported to ONNX with verified input/output layout.
- ONNX Runtime Mobile or a verified compatible React Native native integration. No per-frame Python server and no cloud inference for core detections.
- Android SpeechRecognizer (tap-to-talk), Android Text-to-Speech.
- `react-native-maps` with Google Maps; Places API for destination lookup; Routes API for walking routes.
- Android fused location via an appropriate supported RN package/native API.
- AsyncStorage for preferences; optional minimal secure proxy only where required for Google web-service API keys.
- Kotlin only for necessary Android-specific bridges.

## 3. Suggested project layout
```text
NAVI/
  mobile/
    src/
      screens/{HomeScreen,NavigationScreen,SettingsScreen}.tsx
      components/{AccessibleButton,MapViewPanel,CameraPreview,StatusBanner}.tsx
      services/{speechRecognition,tts,places,routes,location}.ts
      ai/{modelLoader,preprocess,inference,postprocess,detectorTypes}.ts
      spatial/{classifyZone,countObjects,stabilizeDetections}.ts
      navigation/{commandParser,routeProgress,instructionFormatter}.ts
      alerts/{alertManager,priorities,cooldown}.ts
      state/
      config/
    android/
    assets/models/
  ai-engine/
    scripts/export_model.py
    scripts/inspect_model.py
    README.md
  tests/
  discription.md
  prompt.md
  .env.example
  README.md
```
Adapt structure to actual framework conventions. Do not create unnecessary placeholder files.

## 4. Build in vertical slices
### Slice A: Android shell
- Working Android install/build, permission requests (camera, microphone, fine location), screen-reader labels, large controls, start/pause/stop states.
- Map view with current position and clear error states. Never assume permissions granted.

### Slice B: Real local object detection (highest technical risk)
- Export a small pretrained model in Python. Record model source/license, export command, opset, input dimensions, normalization, output tensor format and class labels.
- Load bundled ONNX on Android, run frames at a controlled resolution/rate, perform correct orientation/resize/letterbox conversion, decode outputs, apply NMS if not integrated, and transform bounding boxes to camera coordinates.
- Confirm on a **real Android device** that the model detects people and at least two other supported classes.
- Calculate bounding-box centre ratio `x / imageWidth`: left `< 1/3`, centre `1/3..2/3`, right `> 2/3`.
- Count objects per frame, group by class and region, add short persistence/smoothing so counts don't fluctuate every frame. Tracking is optional; do not double-count across frames.
- Emit structured detections: `{classId,label,confidence,bbox,zone,frameTimestamp}`.
- **Do not invent tree detections**: generic COCO YOLO lacks a tree class. Keep custom tree/curb/pothole models out of the MVP unless supplied and validated.
- Do not estimate metres or guarantee collision risk from a bounding box.

### Slice C: Speech and alert manager
- Speak compact phrases: “Three people detected ahead in the camera view”, “Bicycle detected on the left”.
- Use a central TTS queue; route directions and detection alerts must not overlap.
- Deduplicate near-identical alerts, apply cooldown (start with configurable 4–6 seconds), and prioritize meaningful changes. Do not announce every frame.
- Provide mute, pause and stop; avoid claiming an object is an immediate hazard without evidence.

### Slice D: Voice destination intent
- Tap-to-talk via Android SpeechRecognizer, display recognized text, handle cancel/timeout/error.
- Deterministic extraction for “let's go to X”, “navigate to X”, “take me to X”, “directions to X”, and “stop navigation”.
- Never send raw speech to an LLM by default; an LLM is unnecessary for this scope.
- Confirm selected place if search results are ambiguous. Respect locale and permissions.

### Slice E: Google Maps and pedestrian route
- Google map displays user GPS dot, destination marker, and route polyline.
- Query Google Places for destination, select correct result, and call Routes API with walking mode.
- Decode route polyline and steps; format and speak step directions as user progresses via GPS.
- Handle missing location, denied permission, no route, poor GPS, API quotas, billing, key restrictions, and offline conditions.
- Google Places/Routes web-service credentials must not be hard-coded into client source. Use restricted Android SDK keys for SDK access; if using protected web-service endpoints, create a minimal secure proxy and document deployment/env variables.
- Do not claim Google walking directions guarantee accessibility or safe road crossings.
- Treat advanced rerouting as optional; MVP can announce deviation and prompt to refresh.

### Slice F: Combined navigation and detection
- Ensure both subsystems can operate concurrently without freezing UI.
- Shared alert priority: urgent *validated* awareness cues > immediate route turn > routine status; avoid unsupported urgency classifications.
- Show visible states: Listening, Destination Found, Route Ready, Navigating, Detecting, Paused, Offline/Map Unavailable, Error.
- Ensure detection works offline; maps route requests are online. Speech recognition offline status is device-dependent.

## 5. UX requirements
Minimal, high-contrast accessible UI; no unnecessary cards or complex flows. Primary actions: **Start Assistance**, **Speak Destination**, **Confirm Destination**, **Start Navigation**, **Repeat Instruction**, **Pause Alerts**, **Stop Navigation**. Include clear visual and spoken confirmation. Never require visually interpreting the map to operate the core controls.

## 6. Testing / acceptance gates
Do not mark a feature complete until tested. Create automated unit tests for command parsing, zone boundaries, object counts, alert cooldown, instruction formatting and route progress. Add device-level manual test checklist:
- Three distinct people visible in one frame -> one stable count announcement, not repeated every frame.
- Left/centre/right labels match actual image coordinates.
- Supported object class labels are accurate; unsupported classes are never fabricated.
- Offline camera detection works with Wi-Fi and mobile data disabled.
- “Let's go to Heritage Street” resolves to a confirmed place and shows destination marker + walking polyline when APIs/network work.
- Route instruction TTS and detection TTS never overlap.
- Denied permissions, missing network, invalid API key, speech errors and app backgrounding fail gracefully.
- Measure on-device inference latency, approximate FPS, heat/battery symptoms, and report limitations.

## 7. Safety and responsible behavior
This is an **assistive prototype**, not a substitute for a white cane, guide dog, orientation-and-mobility training, or user judgment. Never say “path clear”, “safe to cross”, or give autonomous crossing authorization. Do not assert reliable metric distance, collision probability, or detection of every obstacle. Camera must be exposed and correctly oriented. Early testing is controlled and supervised. Prefer local processing and do not upload camera frames by default.

## 8. Time-boxed delivery plan
- Hours 0–2: bootstrap Android project, permissions, preview, map shell.
- Hours 2–7: ONNX model integration and real device inference.
- Hours 7–10: counting, zones, cooldown, TTS.
- Hours 10–14: voice intent, Places search, route marker/polyline and basic GPS instruction.
- Hours 14–16: integration, accessibility and failures.
- Hours 16–18: tests, APK, demo and README.
If the native AI integration is blocked, prioritize a tested camera-to-detection-to-TTS vertical slice and a separately working map flow. Clearly label incomplete work; never silently replace live inference with mock alerts.

## 9. Deliverables
1. Runnable Android source code with real integrations and clean TypeScript types.
2. Python model export script, model provenance, compatible ONNX artifact or reproducible generation instructions.
3. `.env.example` with **placeholder** keys and safe configuration instructions (never commit secrets).
4. README with exact prerequisites, Android build/run commands, API enablement/billing, key restrictions, device compatibility, architecture, and troubleshooting.
5. Unit tests, device test checklist, and recorded benchmark observations.
6. Clear list of implemented, partially implemented and deferred features.
7. APK or reproducible build steps if signing/build environment permits.

## 10. Working method and final report
Work in small verified increments. After each major slice, state files changed, commands run, and test results. If you cannot run Android tooling or lack a device/API key, state that limitation plainly; implement code that can be tested later and give exact validation steps. Do not claim an APK or live detection exists without building/running it. Ask for missing critical inputs once, then continue with nonblocked work. At the end provide a concise implementation status matrix and exact next run commands.

**Start now:** inspect the repository and environment, read `discription.md`, then implement Slice A and the most technically risky portion of Slice B before polishing UI.
