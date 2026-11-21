# NAVI iOS development

The iOS target reuses NAVI's React Native screens, tracking logic, alert queue,
route search and accessibility labels. Native Swift modules provide:

- camera permission and a rear-camera preview;
- local YOLO11n object detection through ONNX Runtime;
- low-frequency SegFormer walking-surface evidence through ONNX Runtime;
- local text recognition with Apple Vision;
- on-device speech recognition and speech synthesis;
- current location through Core Location;
- a native MapKit route view;
- distinct Core Haptics patterns;
- foreground shake detection and a user-confirmed emergency SMS draft.

The iOS detector uses the same bundled ONNX files, supported COCO classes,
confidence thresholds, class-aware suppression and three-zone surface rules as
Android. YOLO runs on sampled camera frames; SegFormer runs about once every
three seconds. Both pipelines remain camera-relative evidence: they do not
measure depth, collision probability or certify a safe walking path.

Apple Vision provides offline OCR and `SFSpeechRecognizer` is explicitly
restricted to on-device recognition. Route search and map data still require
the local proxy and an internet connection.

## Run locally

1. Install Xcode, Node.js 22 or newer and CocoaPods.
2. From `mobile/`, run `npm ci`.
3. From `mobile/ios/`, run `pod install`.
4. Open `NAVI.xcworkspace`, select the NAVI target and choose a Development Team.
5. Connect an iPhone, enable Developer Mode and run the NAVI scheme.

The ONNX Runtime pod is pinned to 1.24.3. If Microsoft's pod CDN is temporarily
unavailable, use a checksum-verified local copy by setting
`NAVI_ORT_POD_PATH=/absolute/path/to/extracted/pod` for `pod install`; do not
commit that local path to `Podfile.lock`.

You can also run `npm run ios -- "Your iPhone name"` after the dependencies are
installed. A physical iPhone is required to validate the camera, microphone,
haptics, GPS, Messages composer and VoiceOver behaviour.

If Xcode reports that CoreSimulator is out of date, update macOS/Xcode so their
versions match and restart the Mac before trying the simulator again.
