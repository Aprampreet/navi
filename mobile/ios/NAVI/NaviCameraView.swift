import AVFoundation
import React
import UIKit

final class NaviFrameStore {
  static let shared = NaviFrameStore()
  private let lock = NSLock()
  private var storedImage: CGImage?

  var image: CGImage? {
    lock.lock(); defer { lock.unlock() }
    return storedImage
  }

  func update(_ image: CGImage) {
    lock.lock(); storedImage = image; lock.unlock()
  }

  func clear() {
    lock.lock(); storedImage = nil; lock.unlock()
  }
}

final class NaviCameraPreview: UIView, AVCaptureVideoDataOutputSampleBufferDelegate {
  private let session = AVCaptureSession()
  private let sessionQueue = DispatchQueue(label: "com.navi.camera.session")
  private let frameQueue = DispatchQueue(label: "com.navi.camera.frames")
  private let context = CIContext(options: [.cacheIntermediates: false])
  private var configured = false
  private var frameNumber = 0
  private var visionPipeline: NaviVisionPipeline?
  private var visionErrorReported = false

  override class var layerClass: AnyClass { AVCaptureVideoPreviewLayer.self }
  private var previewLayer: AVCaptureVideoPreviewLayer { layer as! AVCaptureVideoPreviewLayer }

  @objc var active: Bool = false {
    didSet { active ? start() : stop() }
  }

  override init(frame: CGRect) {
    super.init(frame: frame)
    previewLayer.videoGravity = .resizeAspectFill
    previewLayer.session = session
    isAccessibilityElement = false
  }

  required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }

  private func start() {
    guard AVCaptureDevice.authorizationStatus(for: .video) == .authorized else {
      NaviNative.current?.emit("NaviCameraError", body: ["message": "Camera permission is required"])
      return
    }
    sessionQueue.async { [weak self] in
      guard let self else { return }
      do {
        if !self.configured { try self.configure() }
        guard !self.session.isRunning else { return }
        self.session.startRunning()
        NaviNative.current?.emit("NaviCameraReady")
      } catch {
        NaviNative.current?.emit("NaviCameraError", body: ["message": error.localizedDescription])
      }
    }
  }

  private func configure() throws {
    session.beginConfiguration()
    defer { session.commitConfiguration() }
    session.sessionPreset = .high
    guard let device = AVCaptureDevice.default(.builtInWideAngleCamera, for: .video, position: .back) else {
      throw NSError(domain: "NAVI", code: 2,
                    userInfo: [NSLocalizedDescriptionKey: "Rear camera is unavailable"])
    }
    let input = try AVCaptureDeviceInput(device: device)
    guard session.canAddInput(input) else {
      throw NSError(domain: "NAVI", code: 3,
                    userInfo: [NSLocalizedDescriptionKey: "Rear camera could not be opened"])
    }
    session.addInput(input)
    let output = AVCaptureVideoDataOutput()
    output.alwaysDiscardsLateVideoFrames = true
    output.videoSettings = [kCVPixelBufferPixelFormatTypeKey as String:
                              kCVPixelFormatType_32BGRA]
    output.setSampleBufferDelegate(self, queue: frameQueue)
    guard session.canAddOutput(output) else {
      throw NSError(domain: "NAVI", code: 4,
                    userInfo: [NSLocalizedDescriptionKey: "Camera frames are unavailable"])
    }
    session.addOutput(output)
    if let connection = output.connection(with: .video) {
      if #available(iOS 17.0, *) {
        if connection.isVideoRotationAngleSupported(90) { connection.videoRotationAngle = 90 }
      } else if connection.isVideoOrientationSupported {
        connection.videoOrientation = .portrait
      }
    }
    configured = true
  }

  private func stop() {
    sessionQueue.async { [weak self] in
      guard let self else { return }
      if self.session.isRunning { self.session.stopRunning() }
      NaviFrameStore.shared.clear()
    }
  }

  func captureOutput(_ output: AVCaptureOutput, didOutput sampleBuffer: CMSampleBuffer,
                     from connection: AVCaptureConnection) {
    frameNumber += 1
    guard frameNumber % 6 == 0, let buffer = CMSampleBufferGetImageBuffer(sampleBuffer) else { return }
    let image = CIImage(cvPixelBuffer: buffer)
    if let cgImage = context.createCGImage(image, from: image.extent) {
      NaviFrameStore.shared.update(cgImage)
      if visionPipeline == nil && !visionErrorReported {
        do { visionPipeline = try NaviVisionPipeline() }
        catch {
          visionErrorReported = true
          NaviNative.current?.emit("NaviCameraError", body: ["message": error.localizedDescription])
        }
      }
      visionPipeline?.process(cgImage, frameNumber: frameNumber)
    }
  }

  deinit { stop() }
}

@objc(NaviCameraViewManager)
final class NaviCameraViewManager: RCTViewManager {
  override static func requiresMainQueueSetup() -> Bool { true }
  override func view() -> UIView! { NaviCameraPreview() }
}
