# NAVI iOS development

The iOS target reuses NAVI's React Native screens, tracking logic, alert queue,
route search and accessibility labels. Native Swift modules provide:

- camera permission and a rear-camera preview;
- local text recognition with Apple Vision;
- on-device speech recognition and speech synthesis;
- current location through Core Location;
- a native MapKit route view;
- distinct Core Haptics patterns;
- foreground shake detection and a user-confirmed emergency SMS draft.

The Android YOLO11n and SegFormer pipelines have not yet been ported. The iOS
camera deliberately does not emit fabricated detections or walking-surface
claims. ONNX Runtime integration and physical-device benchmarking belong in a
follow-up change.

## Run locally

1. Install Xcode, Node.js 22 or newer and CocoaPods.
2. From `mobile/`, run `npm ci`.
3. From `mobile/ios/`, run `pod install`.
4. Open `NAVI.xcworkspace`, select the NAVI target and choose a Development Team.
5. Connect an iPhone, enable Developer Mode and run the NAVI scheme.

You can also run `npm run ios -- "Your iPhone name"` after the dependencies are
installed. A physical iPhone is required to validate the camera, microphone,
haptics, GPS, Messages composer and VoiceOver behaviour.

If Xcode reports that CoreSimulator is out of date, update macOS/Xcode so their
versions match and restart the Mac before trying the simulator again.
