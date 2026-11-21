import CoreLocation
import CoreMotion
import MessageUI
import React
import UIKit

@objc(NaviGuardian)
final class NaviGuardian: RCTEventEmitter, MFMessageComposeViewControllerDelegate {
  private let defaults = UserDefaults.standard
  private let motion = CMMotionManager()
  private let location = CLLocationManager()
  private var phase = "IDLE"
  private var detail = ""
  private var remaining = 0
  private var countdown: Timer?
  private var peaks = 0
  private var firstPeak = Date.distantPast
  private var lastPeak = Date.distantPast
  private var aboveThreshold = false
  private var hasListeners = false

  override static func requiresMainQueueSetup() -> Bool { true }
  override func supportedEvents() -> [String]! { ["NaviGuardianState"] }
  override func startObserving() { hasListeners = true }
  override func stopObserving() { hasListeners = false }

  override init() {
    super.init()
    phase = defaults.string(forKey: "navi.guardian.phase") ?? "IDLE"
    detail = defaults.string(forKey: "navi.guardian.detail") ?? ""
    if ["COUNTDOWN", "LOCATING"].contains(phase) {
      phase = "CANCELLED"
      detail = "An interrupted SOS countdown was cancelled; no message was sent."
      persistStatus()
    }
    NotificationCenter.default.addObserver(self, selector: #selector(refreshMotion),
      name: UIApplication.didBecomeActiveNotification, object: nil)
    NotificationCenter.default.addObserver(self, selector: #selector(stopMotion),
      name: UIApplication.willResignActiveNotification, object: nil)
    DispatchQueue.main.async { [weak self] in self?.refreshMotion() }
  }

  private var name: String { defaults.string(forKey: "navi.guardian.name") ?? "" }
  private var phone: String { defaults.string(forKey: "navi.guardian.phone") ?? "" }
  private var enabled: Bool { defaults.bool(forKey: "navi.guardian.enabled") }
  private var sensitivity: String { defaults.string(forKey: "navi.guardian.sensitivity") ?? "normal" }
  private var seconds: Int {
    let value = defaults.integer(forKey: "navi.guardian.seconds")
    return value == 0 ? 10 : value
  }

  private func snapshot() -> [String: Any] {
    ["name": name, "phone": phone, "enabled": enabled, "sensitivity": sensitivity,
     "seconds": seconds, "phase": phase, "detail": detail, "remaining": remaining,
     "accelerometerAvailable": motion.isAccelerometerAvailable,
     "monitoring": motion.isAccelerometerActive,
     "smsPermission": MFMessageComposeViewController.canSendText(),
     "history": defaults.array(forKey: "navi.guardian.history") ?? []]
  }

  private func emit() {
    guard hasListeners else { return }
    sendEvent(withName: "NaviGuardianState", body: snapshot())
  }

  private func update(_ next: String, _ message: String, record: Bool = false) {
    phase = next; detail = message
    persistStatus()
    if record {
      var history = defaults.array(forKey: "navi.guardian.history") as? [[String: Any]] ?? []
      history.append(["status": next, "detail": message,
                      "timestamp": Date().timeIntervalSince1970 * 1000])
      defaults.set(Array(history.suffix(5)), forKey: "navi.guardian.history")
    }
    emit()
  }

  private func persistStatus() {
    defaults.set(phase, forKey: "navi.guardian.phase")
    defaults.set(detail, forKey: "navi.guardian.detail")
  }

  @objc(getState:rejecter:)
  func getState(_ resolve: RCTPromiseResolveBlock, rejecter reject: RCTPromiseRejectBlock) {
    resolve(snapshot())
  }

  @objc(saveSettings:number:confirmation:enabled:sensitivity:seconds:resolver:rejecter:)
  func saveSettings(_ contactName: String, number: String, confirmation: String,
                    enabled useShake: Bool, sensitivity level: String, seconds countdownSeconds: Int,
                    resolver resolve: RCTPromiseResolveBlock, rejecter reject: RCTPromiseRejectBlock) {
    let cleaned = number.replacingOccurrences(of: "[\\s()-]", with: "", options: .regularExpression)
    let again = confirmation.replacingOccurrences(of: "[\\s()-]", with: "", options: .regularExpression)
    let validNumber = cleaned.range(of: "^\\+?[0-9]{7,15}$", options: .regularExpression) != nil
    guard !contactName.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
          validNumber, cleaned == again else {
      reject("GUARDIAN_CONTACT_INVALID", "Enter a name and matching valid phone numbers", nil); return
    }
    guard ["high", "normal", "low"].contains(level), (5...30).contains(countdownSeconds) else {
      reject("GUARDIAN_SETTINGS_INVALID", "Choose a valid sensitivity and a 5–30 second countdown", nil); return
    }
    defaults.set(contactName.trimmingCharacters(in: .whitespacesAndNewlines), forKey: "navi.guardian.name")
    defaults.set(cleaned, forKey: "navi.guardian.phone")
    defaults.set(useShake, forKey: "navi.guardian.enabled")
    defaults.set(level, forKey: "navi.guardian.sensitivity")
    defaults.set(countdownSeconds, forKey: "navi.guardian.seconds")
    refreshMotion()
    resolve(snapshot()); emit()
  }

  @objc(startSOS:rejecter:)
  func startSOS(_ resolve: RCTPromiseResolveBlock, rejecter reject: RCTPromiseRejectBlock) {
    guard !phone.isEmpty else { reject("GUARDIAN_CONTACT_MISSING", "Configure an emergency contact first", nil); return }
    guard phase != "COUNTDOWN" else { resolve(snapshot()); return }
    remaining = seconds
    update("COUNTDOWN", "Emergency alert countdown started.")
    stopMotion()
    countdown?.invalidate()
    countdown = Timer.scheduledTimer(withTimeInterval: 1, repeats: true) { [weak self] timer in
      guard let self else { timer.invalidate(); return }
      self.remaining -= 1
      if self.remaining <= 0 {
        timer.invalidate(); self.countdown = nil; self.presentComposer(test: false)
      } else { self.emit() }
    }
    resolve(snapshot())
  }

  @objc(cancelSOS:rejecter:)
  func cancelSOS(_ resolve: RCTPromiseResolveBlock, rejecter reject: RCTPromiseRejectBlock) {
    guard phase == "COUNTDOWN" else { resolve(snapshot()); return }
    countdown?.invalidate(); countdown = nil; remaining = 0
    update("CANCELLED", "Emergency SOS cancelled. No message was sent.", record: true)
    refreshMotion(); resolve(snapshot())
  }

  @objc(openTestComposer:rejecter:)
  func openTestComposer(_ resolve: RCTPromiseResolveBlock, rejecter reject: RCTPromiseRejectBlock) {
    guard !phone.isEmpty else { reject("GUARDIAN_CONTACT_MISSING", "Configure an emergency contact first", nil); return }
    presentComposer(test: true)
    resolve("Emergency message draft opened. Nothing is sent until you approve it in Messages.")
  }

  private func presentComposer(test: Bool) {
    remaining = 0
    guard MFMessageComposeViewController.canSendText() else {
      update("FAILED", "Text messaging is unavailable on this iPhone.", record: true)
      refreshMotion(); return
    }
    guard let presenter = Self.topViewController() else {
      update("FAILED", "The emergency message screen could not be opened.", record: true)
      refreshMotion(); return
    }
    let composer = MFMessageComposeViewController()
    composer.messageComposeDelegate = self
    composer.recipients = [phone]
    var body = test ? "NAVI Guardian test message. No emergency." :
      "Emergency alert from \(name). I may need assistance."
    if let coordinate = location.location?.coordinate {
      body += " My last available location: https://maps.apple.com/?ll=\(coordinate.latitude),\(coordinate.longitude)"
    }
    composer.body = body
    update("COMPOSER", "Emergency message prepared. Review and press Send in Messages.")
    presenter.present(composer, animated: true)
  }

  func messageComposeViewController(_ controller: MFMessageComposeViewController,
                                    didFinishWith result: MessageComposeResult) {
    controller.dismiss(animated: true)
    switch result {
    case .sent: update("SENT", "The Messages app accepted the emergency SMS for sending.", record: true)
    case .cancelled: update("CANCELLED", "Emergency message cancelled. No message was sent.", record: true)
    case .failed: update("FAILED", "The emergency message could not be sent.", record: true)
    @unknown default: update("UNCERTAIN", "Message status is unavailable. Check Messages.", record: true)
    }
    refreshMotion()
  }

  @objc private func refreshMotion() {
    stopMotion()
    guard enabled, phase != "COUNTDOWN", motion.isAccelerometerAvailable,
          UIApplication.shared.applicationState == .active else { emit(); return }
    motion.accelerometerUpdateInterval = 0.04
    motion.startAccelerometerUpdates(to: .main) { [weak self] data, _ in
      guard let self, let acceleration = data?.acceleration else { return }
      let strength = sqrt(acceleration.x * acceleration.x + acceleration.y * acceleration.y +
                          acceleration.z * acceleration.z)
      let threshold = self.sensitivity == "high" ? 2.1 : self.sensitivity == "low" ? 3.1 : 2.6
      if strength < threshold * 0.65 { self.aboveThreshold = false; return }
      guard !self.aboveThreshold, strength >= threshold else { return }
      self.aboveThreshold = true
      let now = Date()
      if now.timeIntervalSince(self.lastPeak) < 0.16 || now.timeIntervalSince(self.lastPeak) > 1.1 { self.peaks = 0 }
      if now.timeIntervalSince(self.firstPeak) > 2.5 { self.peaks = 0 }
      if self.peaks == 0 { self.firstPeak = now }
      self.peaks += 1; self.lastPeak = now
      if self.peaks >= 3 { self.peaks = 0; self.startSOS({ _ in }, rejecter: { _, _, _ in }) }
    }
    emit()
  }

  @objc private func stopMotion() {
    if motion.isAccelerometerActive { motion.stopAccelerometerUpdates() }
    emit()
  }

  private static func topViewController(_ base: UIViewController? = nil) -> UIViewController? {
    let root = base ?? UIApplication.shared.connectedScenes.compactMap { ($0 as? UIWindowScene)?.keyWindow }
      .first?.rootViewController
    if let navigation = root as? UINavigationController { return topViewController(navigation.visibleViewController) }
    if let tab = root as? UITabBarController { return topViewController(tab.selectedViewController) }
    if let presented = root?.presentedViewController { return topViewController(presented) }
    return root
  }

  override func invalidate() {
    countdown?.invalidate(); stopMotion()
    NotificationCenter.default.removeObserver(self)
    super.invalidate()
  }
}

private extension UIWindowScene {
  var keyWindow: UIWindow? { windows.first(where: \.isKeyWindow) }
}
