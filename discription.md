# NAVI — AI-Powered Voice Navigation and Obstacle Awareness

## Project overview
NAVI is an Android-first assistive mobility prototype for people who are blind or have low vision. It combines voice-based destination selection, a Google Maps walking route, GPS-based guidance, and on-device camera-based object detection with concise spoken alerts. The initial implementation is an **18-hour hackathon MVP**, not a certified or safety-validated navigation aid.

## Example user journey
1. User starts NAVI using an accessible Start Assistance control.
2. User taps the microphone and says: **“Let's go to Heritage Street.”**
3. Speech recognition transcribes the command. A lightweight intent parser extracts `Heritage Street` as the destination.
4. Google Places searches for likely matches, prioritizing nearby results. NAVI speaks the selected place and asks for confirmation when ambiguous.
5. Google Maps shows the current GPS location, a destination marker, and a pedestrian route requested through Google Routes API.
6. The user confirms **Start Navigation**. NAVI announces upcoming route steps using Android TTS, with GPS progress updates.
7. Simultaneously, a forward-facing, unobstructed phone camera feeds an on-device object detector. It may announce **“Three people detected ahead in the camera view”**, **“Bicycle detected on the right”**, or **“Chair detected near the centre.”**
8. The user can pause camera assistance, mute voice, stop navigation, and repeat the last instruction.

## Core product capabilities
### Voice commands
- Recognize phrases such as “Navigate to Golden Temple”, “Let's go to Heritage Street”, “Stop navigation”, “Repeat instruction”, and “Pause obstacle alerts”.
- MVP: Android SpeechRecognizer with tap-to-talk, not always-listening wake-word recognition.
- Extract destinations using a deterministic parser; an LLM is **not necessary** for MVP.
- Ask for confirmation before starting a route. Handle unclear transcription and multiple place matches.
- Speech recognition may need internet depending on the installed Android recognition service; do not claim fully offline voice commands without device testing.

### Maps and pedestrian guidance
- Google Maps display in React Native with user position, destination marker, and route polyline.
- Google Places API for destination lookup; Google Routes API for pedestrian route and route steps.
- GPS updates through Android location services, and step-progress logic in TypeScript.
- Speak clear, concise route steps; do not read HTML instruction markup literally.
- Handle location denial, missing GPS fix, API errors, lost connectivity, route deviation, and route arrival.
- API keys must be restricted appropriately; server-side web-service keys must not be exposed in the app. For a production-grade architecture, use a thin proxy for protected Places/Routes web-service requests or an appropriate supported client SDK.
- Google routing generally needs connectivity. Offline maps/routing are future work.
- Do not infer safe crossings, accessible sidewalks, or obstacle-free paths from Google Maps.

### Camera and on-device object detection
- Android-first camera preview and controlled-rate frame processing.
- Pretrained lightweight YOLO model exported from Python to a tested ONNX format.
- Mobile inference using ONNX Runtime, with preprocessing, output decoding, NMS as required by the export, and confidence filtering.
- Recognize only supported classes such as person, bicycle, car, motorcycle, bus, dog, chair, etc., subject to model accuracy.
- Count detected people **per frame** and optionally use tracking/persistence across frames for stable counts. Never sum the same person over frames.
- Divide the image into left/centre/right zones using bounding-box center; describe these as image-space positions, not proven collision locations.
- Prioritize alerts, enforce cooldowns, avoid speech overlap, and suppress jitter or repeated announcements.
- Use cautious language such as “Two people detected in front of the camera”; do not claim “safe to proceed.”
- Generic COCO-pretrained YOLO does **not** include a tree class. Tree, pothole, curb, step, open drain and uneven-road recognition require suitable additional training/models and validation; do not fake detections.
- Bounding boxes alone do not provide reliable metric distance. Defer exact distance and collision predictions.

### Accessibility and controls
- Large touch targets, accessible labels, high-contrast UI, screen-reader compatibility, and a simple minimal interface.
- Clear Start/Stop Assistance, destination search, confirm route, pause alerts, and repeat instruction controls.
- Voice alerts should not drown out critical route cues; critical detections may interrupt routine announcements.
- Require camera to be exposed and forward-facing (e.g., suitable mount); a pocketed phone cannot see obstacles.

## Recommended technology stack
| Area | Choice |
|---|---|
| Mobile UI | React Native + TypeScript |
| Android build | Expo Development Build or bare React Native (not Expo Go for custom native AI modules) |
| Camera | VisionCamera; CameraX native fallback |
| Model preparation | Python, Ultralytics YOLO, PyTorch, OpenCV |
| Inference | ONNX Runtime Mobile (verify compatibility) |
| Object counting | Detection post-processing; optional lightweight tracker |
| Voice input | Android SpeechRecognizer |
| Voice output | Android Text-to-Speech |
| Map UI | react-native-maps with Google Maps |
| Place search | Google Places API |
| Walking routes | Google Routes API |
| GPS | Android Fused Location Provider / supported React Native wrapper |
| Local state | AsyncStorage; SQLite only if needed |
| Native integration | Minimal Kotlin bridges where necessary |
| Backend | Not needed for local detection; optional minimal secure proxy for protected Google web APIs |

## Logical architecture
```text
Voice input -> SpeechRecognizer -> Command parser -> Destination resolver (Places)
                                                    -> Confirm -> Routes API
GPS -> Location manager -> Route-progress engine -> Navigation instructions --+
                                                                        Alert manager -> Android TTS
Camera -> Frame processor -> ONNX detector -> Filter/count/zone/persistence --+

React Native UI: map, route, camera state, controls, accessibility, errors
```

## MVP scope and acceptance criteria
**Must have:** Android app launches; camera permission and preview; pretrained model runs locally on actual Android hardware; at least person/chair/bicycle or car detections; count people in a single scene; left/centre/right classification; audible alerts with cooldown; microphone command for destination; Places resolution; destination marker; walking route polyline; GPS location; basic spoken route instruction; offline detection demo with Wi-Fi/mobile data disabled.

**Should have:** stable tracking/count smoothing; repeat instruction; voice command to stop; reroute notification; accessible onboarding; measurement of inference latency.

**Defer:** fully offline pedestrian routing; custom tree/pothole/open-drain model; reliable metric depth; autonomous safe-crossing advice; persistent wake word; complex agentic conversations; personal routine learning; full SOS system; iOS support.

## 18-hour implementation schedule
- **0–2 h:** Bootstrap Android project, permissions, camera and GPS/map UI.
- **2–7 h:** Prove ONNX inference on actual Android phone; implement preprocessing/post-processing.
- **7–10 h:** Counts, zones, stable spoken alerts, cooldown.
- **10–14 h:** Speech-to-text, destination parsing, Places, route polyline and navigation prompts.
- **14–16 h:** Integration, accessibility, errors, performance and offline tests.
- **16–18 h:** Controlled demo, fallback video, README, final rehearsal.

This schedule is aggressive. If inference integration stalls, preserve a working vertical slice rather than simulating successful AI detection. Mock data is acceptable for UI development only when clearly labeled.

## Testing and validation
- Unit-test destination parser, zone classifier, count aggregation, confidence thresholds, and alert cooldown.
- Verify permissions, GPS-denied state, ambiguous destinations, empty Places results, network failures, and TTS interruption.
- Test model class labels, bounding box scaling/orientation, performance, heat, battery and memory on target Android device.
- Test three distinct people in one frame, object moving between zones, repeated detections, and no-object scene.
- Demonstrate offline camera detection with connectivity disabled; explicitly distinguish online maps and speech services.
- Run early tests in controlled, supervised settings only; involve blind/low-vision participants and mobility specialists for meaningful later validation.

## Safety, privacy and limitations
NAVI is an **assistive information tool**, not a replacement for a white cane, guide dog, mobility training, or user judgment. It cannot guarantee a safe path or authorize road crossing. Missed detections, false positives, poor lighting, occlusion, phone angle, GPS drift, battery drain and speech overload can all cause harm. Prefer local camera inference and avoid uploading frames. Request only required permissions and clearly explain data use.

## Future roadmap
1. Dedicated hazard datasets for trees, steps, curbs, potholes and drains.
2. Validated depth, tracking, free-space analysis and uncertainty-aware alerts.
3. Offline pedestrian route graph with OpenStreetMap-compatible data and appropriate licensing.
4. Opt-in local memory of familiar destinations and saved places.
5. Better accessible interaction, multilingual speech, robust background operation, emergency workflows and field evaluation.

## Open implementation decisions
- Exact Android phone model, chipset, RAM, OS version and available acceleration.
- Camera integration and ONNX export/runtime compatibility.
- Google Maps Platform credentials, billing and supported APIs.
- Available on-device/offline speech services.
- Measured inference FPS/latency, heat, battery and alert responsiveness.
