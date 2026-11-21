import AVFoundation
import AudioToolbox
import CoreHaptics
import CoreLocation
import React
import Speech
import Vision

@objc(NaviNative)
final class NaviNative: RCTEventEmitter, AVSpeechSynthesizerDelegate, CLLocationManagerDelegate {
  static weak var current: NaviNative?

  private let synthesizer = AVSpeechSynthesizer()
  private let locationManager = CLLocationManager()
  private let audioEngine = AVAudioEngine()
  private let speechRecognizer = SFSpeechRecognizer(locale: Locale(identifier: "en-US"))
  private var recognitionRequest: SFSpeechAudioBufferRecognitionRequest?
  private var recognitionTask: SFSpeechRecognitionTask?
  private var recognitionMode = "idle"
  private var voiceAgentEnabled = false
  private var speechRate = 1.0
  private var speechPromises: [ObjectIdentifier: RCTPromiseResolveBlock] = [:]
  private var locationPromise: (RCTPromiseResolveBlock, RCTPromiseRejectBlock)?
  private var permissionPromise: RCTPromiseResolveBlock?
  private var commandTimer: Timer?
  private var latestCommand = ""
  private var hasListeners = false
  private var audioTapInstalled = false
  private var hapticEngine: CHHapticEngine?
  private var hapticPlayer: CHHapticPatternPlayer?

  override init() {
    super.init()
    NaviNative.current = self
    synthesizer.delegate = self
    locationManager.delegate = self
    locationManager.desiredAccuracy = kCLLocationAccuracyBest
  }

  override static func requiresMainQueueSetup() -> Bool { true }

  override func supportedEvents() -> [String]! {
    ["NaviDetections", "NaviCorridor", "NaviCorridorError", "NaviCameraReady",
     "NaviCameraError", "NaviVoiceReady", "NaviVoiceWake", "NaviVoiceCommand",
     "NaviVoiceTimeout", "NaviVoiceError"]
  }

  override func startObserving() { hasListeners = true }
  override func stopObserving() { hasListeners = false }

  func emit(_ name: String, body: Any = [:]) {
    DispatchQueue.main.async { [weak self] in
      guard let self, self.hasListeners else { return }
      self.sendEvent(withName: name, body: body)
    }
  }

  @objc(checkPermission:resolver:rejecter:)
  func checkPermission(_ permission: String, resolver resolve: RCTPromiseResolveBlock,
                       rejecter reject: RCTPromiseRejectBlock) {
    switch permission {
    case "camera": resolve(AVCaptureDevice.authorizationStatus(for: .video) == .authorized)
    case "microphone": resolve(AVAudioSession.sharedInstance().recordPermission == .granted)
    case "location":
      let status = locationManager.authorizationStatus
      resolve(status == .authorizedWhenInUse || status == .authorizedAlways)
    default: reject("PERMISSION_UNKNOWN", "Unknown permission: \(permission)", nil)
    }
  }

  @objc(requestPermission:resolver:rejecter:)
  func requestPermission(_ permission: String, resolver resolve: @escaping RCTPromiseResolveBlock,
                         rejecter reject: RCTPromiseRejectBlock) {
    switch permission {
    case "camera":
      AVCaptureDevice.requestAccess(for: .video) { granted in resolve(granted) }
    case "microphone":
      AVAudioSession.sharedInstance().requestRecordPermission { granted in resolve(granted) }
    case "location":
      let status = locationManager.authorizationStatus
      if status == .authorizedWhenInUse || status == .authorizedAlways { resolve(true) }
      else if status == .denied || status == .restricted { resolve(false) }
      else {
        permissionPromise = resolve
        locationManager.requestWhenInUseAuthorization()
      }
    default: reject("PERMISSION_UNKNOWN", "Unknown permission: \(permission)", nil)
    }
  }

  func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) {
    guard let resolve = permissionPromise else { return }
    let status = manager.authorizationStatus
    if status == .notDetermined { return }
    permissionPromise = nil
    resolve(status == .authorizedWhenInUse || status == .authorizedAlways)
  }

  @objc(speak:resolver:rejecter:)
  func speak(_ text: String, resolver resolve: @escaping RCTPromiseResolveBlock,
             rejecter reject: RCTPromiseRejectBlock) {
    speakText(text, resolver: resolve, rejecter: reject)
  }

  @objc(speakOffline:resolver:rejecter:)
  func speakOffline(_ text: String, resolver resolve: @escaping RCTPromiseResolveBlock,
                    rejecter reject: RCTPromiseRejectBlock) {
    speakText(text, resolver: resolve, rejecter: reject)
  }

  private func speakText(_ text: String, resolver resolve: @escaping RCTPromiseResolveBlock,
                         rejecter reject: RCTPromiseRejectBlock) {
    guard !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
      resolve(nil); return
    }
    stopRecognition(keepAgentEnabled: true)
    let utterance = AVSpeechUtterance(string: text)
    utterance.voice = AVSpeechSynthesisVoice(language: "en-IN") ??
      AVSpeechSynthesisVoice(language: "en-US")
    let normal = AVSpeechUtteranceDefaultSpeechRate
    utterance.rate = max(AVSpeechUtteranceMinimumSpeechRate,
                         min(AVSpeechUtteranceMaximumSpeechRate, normal * Float(speechRate)))
    speechPromises[ObjectIdentifier(utterance)] = resolve
    synthesizer.speak(utterance)
  }

  func speechSynthesizer(_ synthesizer: AVSpeechSynthesizer,
                         didFinish utterance: AVSpeechUtterance) {
    speechPromises.removeValue(forKey: ObjectIdentifier(utterance))?(nil)
  }

  func speechSynthesizer(_ synthesizer: AVSpeechSynthesizer,
                         didCancel utterance: AVSpeechUtterance) {
    speechPromises.removeValue(forKey: ObjectIdentifier(utterance))?(nil)
  }

  @objc(stopSpeech:rejecter:)
  func stopSpeech(_ resolve: RCTPromiseResolveBlock, rejecter reject: RCTPromiseRejectBlock) {
    synthesizer.stopSpeaking(at: .immediate)
    speechPromises.values.forEach { $0(nil) }
    speechPromises.removeAll()
    resolve(nil)
  }

  @objc(setSpeechRate:resolver:rejecter:)
  func setSpeechRate(_ rate: Double, resolver resolve: RCTPromiseResolveBlock,
                     rejecter reject: RCTPromiseRejectBlock) {
    guard rate >= 0.7 && rate <= 1.3 else {
      reject("INVALID_SPEECH_RATE", "Speech rate must be between 0.7 and 1.3", nil); return
    }
    speechRate = rate
    resolve(nil)
  }

  @objc(getOfflineVoiceStatus:rejecter:)
  func getOfflineVoiceStatus(_ resolve: RCTPromiseResolveBlock,
                             rejecter reject: RCTPromiseRejectBlock) {
    let voice = AVSpeechSynthesisVoice(language: "en-IN") ?? AVSpeechSynthesisVoice(language: "en-US")
    resolve(["available": voice != nil, "voice": voice?.name ?? "",
             "language": voice?.language ?? Locale.current.identifier])
  }

  @objc(getLocation:rejecter:)
  func getLocation(_ resolve: @escaping RCTPromiseResolveBlock,
                   rejecter reject: @escaping RCTPromiseRejectBlock) {
    let status = locationManager.authorizationStatus
    guard status == .authorizedWhenInUse || status == .authorizedAlways else {
      reject("LOCATION_DENIED", "Location permission is required", nil); return
    }
    locationPromise = (resolve, reject)
    locationManager.requestLocation()
  }

  func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
    guard let promise = locationPromise, let location = locations.last else { return }
    locationPromise = nil
    promise.0(["latitude": location.coordinate.latitude,
               "longitude": location.coordinate.longitude,
               "accuracy": location.horizontalAccuracy])
  }

  func locationManager(_ manager: CLLocationManager, didFailWithError error: Error) {
    guard let promise = locationPromise else { return }
    locationPromise = nil
    promise.1("LOCATION_ERROR", error.localizedDescription, error)
  }

  @objc(readSurroundings:rejecter:)
  func readSurroundings(_ resolve: @escaping RCTPromiseResolveBlock,
                        rejecter reject: @escaping RCTPromiseRejectBlock) {
    guard let image = NaviFrameStore.shared.image else {
      reject("OCR_CAMERA_OFF", "Start camera assistance before reading surroundings", nil); return
    }
    let request = VNRecognizeTextRequest { request, error in
      if let error { reject("OCR_FAILED", error.localizedDescription, error); return }
      let blocks = (request.results as? [VNRecognizedTextObservation] ?? []).compactMap { observation -> [String: Any]? in
        guard let text = observation.topCandidates(1).first?.string,
              !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { return nil }
        let box = observation.boundingBox
        return ["text": text, "x": box.minX, "y": 1 - box.maxY,
                "width": box.width, "height": box.height]
      }
      resolve(["blocks": blocks, "width": image.width, "height": image.height])
    }
    request.recognitionLevel = .accurate
    request.usesLanguageCorrection = true
    DispatchQueue.global(qos: .userInitiated).async {
      do { try VNImageRequestHandler(cgImage: image, orientation: .right).perform([request]) }
      catch { reject("OCR_FAILED", error.localizedDescription, error) }
    }
  }

  @objc(startVoiceAgent:rejecter:)
  func startVoiceAgent(_ resolve: @escaping RCTPromiseResolveBlock,
                       rejecter reject: @escaping RCTPromiseRejectBlock) {
    voiceAgentEnabled = true
    authorizeSpeech { [weak self] allowed in
      guard let self else { return }
      guard allowed else { reject("VOICE_PERMISSION_DENIED", "Speech recognition permission is required", nil); return }
      do { try self.startRecognition(mode: "wake"); self.emit("NaviVoiceReady"); resolve(nil) }
      catch { reject("OFFLINE_VOICE_UNAVAILABLE", error.localizedDescription, error) }
    }
  }

  @objc(stopVoiceAgent:rejecter:)
  func stopVoiceAgent(_ resolve: RCTPromiseResolveBlock, rejecter reject: RCTPromiseRejectBlock) {
    voiceAgentEnabled = false
    stopRecognition(keepAgentEnabled: false)
    resolve(nil)
  }

  @objc(beginVoiceCommand:rejecter:)
  func beginVoiceCommand(_ resolve: RCTPromiseResolveBlock, rejecter reject: RCTPromiseRejectBlock) {
    do { try startRecognition(mode: "command"); resolve(nil) }
    catch { reject("VOICE_COMMAND_FAILED", error.localizedDescription, error) }
  }

  @objc(resumeVoiceCommand:rejecter:)
  func resumeVoiceCommand(_ resolve: RCTPromiseResolveBlock, rejecter reject: RCTPromiseRejectBlock) {
    do { try startRecognition(mode: "command"); resolve(nil) }
    catch { reject("VOICE_COMMAND_FAILED", error.localizedDescription, error) }
  }

  @objc(finishVoiceCommand:rejecter:)
  func finishVoiceCommand(_ resolve: RCTPromiseResolveBlock, rejecter reject: RCTPromiseRejectBlock) {
    stopRecognition(keepAgentEnabled: true)
    if voiceAgentEnabled {
      do { try startRecognition(mode: "wake") }
      catch { reject("VOICE_RESTART_FAILED", error.localizedDescription, error); return }
    }
    resolve(nil)
  }

  @objc(setVoiceCommandContext:resolver:rejecter:)
  func setVoiceCommandContext(_ value: String, resolver resolve: RCTPromiseResolveBlock,
                              rejecter reject: RCTPromiseRejectBlock) { resolve(nil) }

  @objc(measureAcousticDistance:rejecter:)
  func measureAcousticDistance(_ resolve: RCTPromiseResolveBlock,
                               rejecter reject: RCTPromiseRejectBlock) {
    reject("SONAR_UNAVAILABLE", "Experimental acoustic ranging is not available on iOS", nil)
  }

  @objc(vibrate:)
  func vibrate(_ values: [NSNumber]) {
    guard CHHapticEngine.capabilitiesForHardware().supportsHaptics else {
      AudioServicesPlaySystemSound(kSystemSoundID_Vibrate); return
    }
    do {
      if hapticEngine == nil { hapticEngine = try CHHapticEngine() }
      try hapticEngine?.start()
      var time = 0.0
      var events: [CHHapticEvent] = []
      for (index, value) in values.enumerated() {
        let duration = max(0, value.doubleValue) / 1000
        if index % 2 == 1 && duration > 0 {
          events.append(CHHapticEvent(eventType: .hapticContinuous,
            parameters: [CHHapticEventParameter(parameterID: .hapticIntensity, value: 0.85),
                         CHHapticEventParameter(parameterID: .hapticSharpness, value: 0.45)],
            relativeTime: time, duration: duration))
        }
        time += duration
      }
      let pattern = try CHHapticPattern(events: events, parameters: [])
      hapticPlayer = try hapticEngine?.makePlayer(with: pattern)
      try hapticPlayer?.start(atTime: 0)
    } catch {
      AudioServicesPlaySystemSound(kSystemSoundID_Vibrate)
    }
  }

  @objc(cancelHaptics)
  func cancelHaptics() {
    try? hapticPlayer?.stop(atTime: 0)
    hapticPlayer = nil
  }

  private func authorizeSpeech(_ completion: @escaping (Bool) -> Void) {
    let continueWithSpeech = {
      let status = SFSpeechRecognizer.authorizationStatus()
      if status == .authorized { completion(true) }
      else if status == .notDetermined {
        SFSpeechRecognizer.requestAuthorization { result in
          DispatchQueue.main.async { completion(result == .authorized) }
        }
      } else { completion(false) }
    }
    if AVAudioSession.sharedInstance().recordPermission == .granted { continueWithSpeech() }
    else {
      AVAudioSession.sharedInstance().requestRecordPermission { granted in
        DispatchQueue.main.async { granted ? continueWithSpeech() : completion(false) }
      }
    }
  }

  private func startRecognition(mode: String) throws {
    guard let recognizer = speechRecognizer, recognizer.isAvailable,
          recognizer.supportsOnDeviceRecognition else {
      throw NSError(domain: "NAVI", code: 1,
                    userInfo: [NSLocalizedDescriptionKey: "On-device speech recognition is unavailable"])
    }
    stopRecognition(keepAgentEnabled: true)
    recognitionMode = mode
    latestCommand = ""
    let session = AVAudioSession.sharedInstance()
    try session.setCategory(.record, mode: .measurement, options: [.duckOthers])
    try session.setActive(true, options: .notifyOthersOnDeactivation)
    let request = SFSpeechAudioBufferRecognitionRequest()
    request.requiresOnDeviceRecognition = true
    request.shouldReportPartialResults = true
    recognitionRequest = request
    let input = audioEngine.inputNode
    let format = input.outputFormat(forBus: 0)
    input.installTap(onBus: 0, bufferSize: 1024, format: format) { buffer, _ in
      request.append(buffer)
    }
    audioTapInstalled = true
    audioEngine.prepare()
    try audioEngine.start()
    recognitionTask = recognizer.recognitionTask(with: request) { [weak self] result, error in
      guard let self else { return }
      if let result {
        let text = result.bestTranscription.formattedString.trimmingCharacters(in: .whitespacesAndNewlines)
        if mode == "wake" && text.lowercased().replacingOccurrences(of: "hey", with: "hi").contains("hi navi") {
          self.stopRecognition(keepAgentEnabled: true)
          self.emit("NaviVoiceWake")
          return
        }
        if mode == "command" {
          self.latestCommand = text
          if result.isFinal { self.finishRecognizedCommand(result) }
        }
      }
      if let error, self.recognitionMode != "idle" {
        self.stopRecognition(keepAgentEnabled: true)
        self.emit("NaviVoiceError", body: ["text": error.localizedDescription])
      }
    }
    if mode == "command" {
      commandTimer = Timer.scheduledTimer(withTimeInterval: 7, repeats: false) { [weak self] _ in
        guard let self else { return }
        let text = self.latestCommand
        self.stopRecognition(keepAgentEnabled: true)
        if text.isEmpty { self.emit("NaviVoiceTimeout", body: ["text": "I did not hear a command"] ) }
        else { self.emit("NaviVoiceCommand", body: ["text": text, "alternatives": [text]]) }
      }
    }
  }

  private func finishRecognizedCommand(_ result: SFSpeechRecognitionResult) {
    let alternatives = result.transcriptions.prefix(3).map(\.formattedString)
    let text = result.bestTranscription.formattedString
    stopRecognition(keepAgentEnabled: true)
    emit("NaviVoiceCommand", body: ["text": text, "alternatives": alternatives])
  }

  private func stopRecognition(keepAgentEnabled: Bool) {
    commandTimer?.invalidate(); commandTimer = nil
    recognitionRequest?.endAudio()
    recognitionTask?.cancel()
    recognitionTask = nil; recognitionRequest = nil
    if audioEngine.isRunning { audioEngine.stop() }
    if audioTapInstalled {
      audioEngine.inputNode.removeTap(onBus: 0)
      audioTapInstalled = false
    }
    recognitionMode = "idle"
    if !keepAgentEnabled { voiceAgentEnabled = false }
    try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
  }

  override func invalidate() {
    stopRecognition(keepAgentEnabled: false)
    synthesizer.stopSpeaking(at: .immediate)
    cancelHaptics()
    hapticEngine?.stop()
    NaviNative.current = nil
    super.invalidate()
  }
}
