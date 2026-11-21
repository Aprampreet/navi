import CoreGraphics
import CoreImage
import Foundation

struct NaviDetection {
  let label: String
  let confidence: Float
  let x: Float
  let y: Float
  let width: Float
  let height: Float

  var dictionary: [String: Any] {
    ["label": label, "confidence": confidence, "x": x, "y": y,
     "width": width, "height": height]
  }
}

private struct NaviRenderedImage {
  let bytes: [UInt8]
  let sourceWidth: Float
  let sourceHeight: Float
  let scale: Float
  let dx: Float
  let dy: Float
  let size: Int
}

private enum NaviVisionError: LocalizedError {
  case missingModel(String)
  case invalidImage
  case invalidOutput(String)

  var errorDescription: String? {
    switch self {
    case .missingModel(let name): return "The bundled model \(name) is missing."
    case .invalidImage: return "The camera frame could not be prepared for on-device AI."
    case .invalidOutput(let message): return message
    }
  }
}

private func modelPath(_ name: String) throws -> String {
  guard let path = Bundle.main.path(forResource: name, ofType: "onnx") else {
    throw NaviVisionError.missingModel("\(name).onnx")
  }
  return path
}

private func render(_ image: CGImage, size: Int, letterbox: Bool) throws -> NaviRenderedImage {
  let sourceWidth = Float(image.width)
  let sourceHeight = Float(image.height)
  guard sourceWidth > 0, sourceHeight > 0 else { throw NaviVisionError.invalidImage }
  let scale = letterbox ? min(Float(size) / sourceWidth, Float(size) / sourceHeight) : 1
  let drawWidth = letterbox ? sourceWidth * scale : Float(size)
  let drawHeight = letterbox ? sourceHeight * scale : Float(size)
  let dx = letterbox ? (Float(size) - drawWidth) / 2 : 0
  let dy = letterbox ? (Float(size) - drawHeight) / 2 : 0
  var bytes = [UInt8](repeating: 114, count: size * size * 4)
  for index in stride(from: 3, to: bytes.count, by: 4) { bytes[index] = 255 }
  guard let context = CGContext(data: &bytes, width: size, height: size,
                                bitsPerComponent: 8, bytesPerRow: size * 4,
                                space: CGColorSpaceCreateDeviceRGB(),
                                bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue) else {
    throw NaviVisionError.invalidImage
  }
  context.interpolationQuality = .high
  context.translateBy(x: 0, y: CGFloat(size))
  context.scaleBy(x: 1, y: -1)
  let rect = CGRect(x: CGFloat(dx), y: CGFloat(dy),
                    width: CGFloat(drawWidth), height: CGFloat(drawHeight))
  context.draw(image, in: rect)
  return NaviRenderedImage(bytes: bytes, sourceWidth: sourceWidth,
                           sourceHeight: sourceHeight, scale: scale,
                           dx: dx, dy: dy, size: size)
}

private func floatData(_ values: [Float]) -> Data {
  values.withUnsafeBytes { Data($0) }
}

private func floats(from data: Data) -> [Float] {
  data.withUnsafeBytes { raw in Array(raw.bindMemory(to: Float.self)) }
}

final class NaviObjectDetector {
  private let session: NaviORTSession
  private let labels = [0: "person", 1: "bicycle", 2: "car", 3: "motorcycle",
                        5: "bus", 16: "dog", 56: "chair"]

  init() throws {
    session = try NaviORTSession(modelPath: modelPath("yolo11n"), threads: 2)
  }

  func detect(_ image: CGImage) throws -> (detections: [NaviDetection], latencyMs: Int) {
    let started = DispatchTime.now().uptimeNanoseconds
    let rendered = try render(image, size: 640, letterbox: true)
    let pixelCount = 640 * 640
    var input = [Float](repeating: 0, count: pixelCount * 3)
    for index in 0..<pixelCount {
      let offset = index * 4
      input[index] = Float(rendered.bytes[offset]) / 255
      input[index + pixelCount] = Float(rendered.bytes[offset + 1]) / 255
      input[index + pixelCount * 2] = Float(rendered.bytes[offset + 2]) / 255
    }
    let result = try session.runFloatTensor(floatData(input), shape: [1, 3, 640, 640])
    guard let shape = result["shape"] as? [NSNumber], shape.count == 3,
          shape[0].intValue == 1, shape[1].intValue == 84,
          let output = result["data"] as? Data else {
      throw NaviVisionError.invalidOutput("YOLO returned an unexpected output shape.")
    }
    let values = floats(from: output)
    let count = shape[2].intValue
    guard values.count == 84 * count else {
      throw NaviVisionError.invalidOutput("YOLO returned an incomplete output tensor.")
    }
    var candidates: [NaviDetection] = []
    for index in 0..<count {
      var bestClass = -1
      var score: Float = 0
      for classID in 0..<80 {
        let value = values[(4 + classID) * count + index]
        if value > score { score = value; bestClass = classID }
      }
      guard score >= 0.45, let label = labels[bestClass] else { continue }
      let centerX = values[index]
      let centerY = values[count + index]
      let boxWidth = values[count * 2 + index]
      let boxHeight = values[count * 3 + index]
      let left = max(0, min(rendered.sourceWidth,
                            (centerX - boxWidth / 2 - rendered.dx) / rendered.scale))
      let top = max(0, min(rendered.sourceHeight,
                           (centerY - boxHeight / 2 - rendered.dy) / rendered.scale))
      let right = max(0, min(rendered.sourceWidth,
                             (centerX + boxWidth / 2 - rendered.dx) / rendered.scale))
      let bottom = max(0, min(rendered.sourceHeight,
                              (centerY + boxHeight / 2 - rendered.dy) / rendered.scale))
      if right > left, bottom > top {
        candidates.append(NaviDetection(label: label, confidence: score,
          x: left / rendered.sourceWidth, y: top / rendered.sourceHeight,
          width: (right - left) / rendered.sourceWidth,
          height: (bottom - top) / rendered.sourceHeight))
      }
    }
    var kept: [NaviDetection] = []
    for candidate in candidates.sorted(by: { $0.confidence > $1.confidence }) {
      if kept.count >= 30 { break }
      if !kept.contains(where: { $0.label == candidate.label && iou($0, candidate) > 0.5 }) {
        kept.append(candidate)
      }
    }
    let elapsed = Int((DispatchTime.now().uptimeNanoseconds - started) / 1_000_000)
    return (kept, elapsed)
  }

  private func iou(_ first: NaviDetection, _ second: NaviDetection) -> Float {
    let left = max(first.x, second.x)
    let top = max(first.y, second.y)
    let right = min(first.x + first.width, second.x + second.width)
    let bottom = min(first.y + first.height, second.y + second.height)
    let intersection = max(0, right - left) * max(0, bottom - top)
    return intersection / (first.width * first.height + second.width * second.height - intersection + 0.000001)
  }
}

private enum NaviSurface: Int, CaseIterable {
  case pedestrian, road, stairs, vegetation, other, poorVisibility

  var name: String {
    switch self {
    case .pedestrian: return "PEDESTRIAN_SURFACE"
    case .road: return "ROAD"
    case .stairs: return "STAIRS"
    case .vegetation: return "VEGETATION"
    case .other: return "OTHER"
    case .poorVisibility: return "POOR_VISIBILITY"
    }
  }
}

private struct NaviSurfaceEvidence {
  var counts = [Int](repeating: 0, count: NaviSurface.allCases.count)
  var confidenceSums = [Float](repeating: 0, count: NaviSurface.allCases.count)
  var total = 0

  mutating func add(_ surface: NaviSurface, confidence: Float) {
    counts[surface.rawValue] += 1
    confidenceSums[surface.rawValue] += confidence
    total += 1
  }

  func fraction(_ surface: NaviSurface) -> Float {
    total == 0 ? 0 : Float(counts[surface.rawValue]) / Float(total)
  }

  func average(_ surface: NaviSurface) -> Float {
    let count = counts[surface.rawValue]
    return count == 0 ? 0 : confidenceSums[surface.rawValue] / Float(count)
  }

  func dominant() -> NaviSurface {
    [.pedestrian, .road, .stairs, .vegetation, .other]
      .max(by: { counts[$0.rawValue] < counts[$1.rawValue] }) ?? .other
  }
}

final class NaviSurfaceSegmenter {
  private let session: NaviORTSession
  private let pedestrian: Set<Int> = [3, 11, 52]
  private let road: Set<Int> = [6]
  private let stairs: Set<Int> = [53, 59, 121]
  private let vegetation: Set<Int> = [4, 9, 17]

  init() throws {
    session = try NaviORTSession(modelPath: modelPath("segformer_b0_ade20k_quantized"), threads: 1)
  }

  func analyze(_ image: CGImage, detections: [NaviDetection]) throws -> [String: Any] {
    let started = DispatchTime.now().uptimeNanoseconds
    let rendered = try render(image, size: 384, letterbox: false)
    let pixelCount = 384 * 384
    var luminanceSum = 0.0
    var luminanceSquared = 0.0
    var luminanceCount = 0
    for y in stride(from: 0, to: 384, by: 8) {
      for x in stride(from: 0, to: 384, by: 8) {
        let offset = (y * 384 + x) * 4
        let value = (0.2126 * Double(rendered.bytes[offset]) +
          0.7152 * Double(rendered.bytes[offset + 1]) +
          0.0722 * Double(rendered.bytes[offset + 2])) / 255
        luminanceSum += value
        luminanceSquared += value * value
        luminanceCount += 1
      }
    }
    let mean = luminanceSum / Double(luminanceCount)
    let contrast = sqrt(max(0, luminanceSquared / Double(luminanceCount) - mean * mean))
    let poorVisibility = mean < 0.07 || contrast < 0.025
    let means: [Float] = [0.485, 0.456, 0.406]
    let deviations: [Float] = [0.229, 0.224, 0.225]
    var input = [Float](repeating: 0, count: pixelCount * 3)
    for index in 0..<pixelCount {
      let offset = index * 4
      for channel in 0..<3 {
        input[index + channel * pixelCount] =
          (Float(rendered.bytes[offset + channel]) / 255 - means[channel]) / deviations[channel]
      }
    }
    let result = try session.runFloatTensor(floatData(input), shape: [1, 3, 384, 384])
    guard let shape = result["shape"] as? [NSNumber], shape.count == 4,
          shape[0].intValue == 1, shape[1].intValue == 150,
          let output = result["data"] as? Data else {
      throw NaviVisionError.invalidOutput("SegFormer returned an unexpected output shape.")
    }
    let values = floats(from: output)
    let height = shape[2].intValue
    let width = shape[3].intValue
    let plane = width * height
    guard values.count == 150 * plane else {
      throw NaviVisionError.invalidOutput("SegFormer returned an incomplete output tensor.")
    }
    var evidence = [NaviSurfaceEvidence(), NaviSurfaceEvidence(), NaviSurfaceEvidence()]
    for gridY in 0..<12 {
      for gridX in 0..<24 {
        let x = min(width - 1, Int((Float(gridX) + 0.5) * Float(width) / 24))
        let normalizedY = 0.42 + (Float(gridY) + 0.5) / 12 * 0.56
        let y = min(height - 1, Int(normalizedY * Float(height)))
        let offset = y * width + x
        var bestClass = 0
        var bestLogit = -Float.greatestFiniteMagnitude
        for classID in 0..<150 {
          let value = values[classID * plane + offset]
          if value > bestLogit { bestLogit = value; bestClass = classID }
        }
        var denominator = 0.0
        for classID in 0..<150 {
          denominator += exp(Double(values[classID * plane + offset] - bestLogit))
        }
        evidence[min(2, gridX * 3 / 24)].add(surface(for: bestClass),
                                             confidence: Float(1 / denominator))
      }
    }
    let names = ["LEFT", "CENTRE", "RIGHT"]
    var zones: [[String: Any]] = []
    for index in 0..<3 {
      let obstacles = obstacles(in: index, detections: detections)
      let dominant = evidence[index].dominant()
      let status: String
      let surface: NaviSurface
      let confidence: Float
      if !obstacles.isEmpty {
        status = "OBSTRUCTED"; surface = dominant; confidence = evidence[index].average(dominant)
      } else if poorVisibility {
        status = "UNKNOWN"; surface = .poorVisibility; confidence = 0
      } else if evidence[index].fraction(.pedestrian) >= 0.34 &&
                  evidence[index].average(.pedestrian) >= 0.38 {
        status = "POTENTIAL_GROUND"; surface = .pedestrian
        confidence = evidence[index].average(.pedestrian)
      } else {
        status = "UNKNOWN"; surface = dominant; confidence = evidence[index].average(dominant)
      }
      zones.append(["name": names[index], "status": status, "surface": surface.name,
                    "confidence": confidence, "obstacles": obstacles])
    }
    let summary: String
    if let centre = zones[1]["obstacles"] as? [String], centre.contains("person") {
      summary = "People detected ahead."
    } else if let possible = zones.first(where: { ($0["status"] as? String) == "POTENTIAL_GROUND" }),
              let name = possible["name"] as? String {
      let direction = name == "LEFT" ? "on the left" : name == "RIGHT" ? "on the right" : "ahead"
      summary = "Possible pedestrian surface visible \(direction)."
    } else {
      summary = "Unable to assess the walking surface."
    }
    return ["zones": zones, "summary": summary,
            "timestamp": Date().timeIntervalSince1970 * 1000,
            "latencyMs": Int((DispatchTime.now().uptimeNanoseconds - started) / 1_000_000),
            "meanBrightness": mean, "contrast": contrast]
  }

  private func surface(for classID: Int) -> NaviSurface {
    if pedestrian.contains(classID) { return .pedestrian }
    if road.contains(classID) { return .road }
    if stairs.contains(classID) { return .stairs }
    if vegetation.contains(classID) { return .vegetation }
    return .other
  }

  private func obstacles(in zone: Int, detections: [NaviDetection]) -> [String] {
    let left = Float(zone) / 3
    let right = Float(zone + 1) / 3
    return Array(Set(detections.filter { box in
      let overlap = max(0, min(right, box.x + box.width) - max(left, box.x))
      return box.confidence >= 0.5 && box.y + box.height >= 0.52 &&
        box.width * box.height >= 0.012 && overlap >= min(0.05, box.width * 0.35)
    }.map(\.label))).sorted()
  }
}

final class NaviVisionPipeline {
  private let detector: NaviObjectDetector
  private let segmenter: NaviSurfaceSegmenter
  private var lastDetections: [NaviDetection] = []
  private var detectorBusy = false

  init() throws {
    detector = try NaviObjectDetector()
    segmenter = try NaviSurfaceSegmenter()
  }

  func process(_ image: CGImage, frameNumber: Int) {
    guard !detectorBusy else { return }
    let runDetection = frameNumber % 12 == 0
    let runSegmentation = frameNumber % 90 == 0
    guard runDetection || runSegmentation else { return }
    detectorBusy = true
    defer { detectorBusy = false }
    do {
      if runDetection {
        let result = try detector.detect(image)
        lastDetections = result.detections
        NaviNative.current?.emit("NaviDetections", body: [
          "detections": result.detections.map(\.dictionary),
          "timestamp": Date().timeIntervalSince1970 * 1000,
          "latencyMs": result.latencyMs,
        ])
      }
      if runSegmentation {
        NaviNative.current?.emit("NaviCorridor",
                                 body: try segmenter.analyze(image, detections: lastDetections))
      }
    } catch {
      let event = runSegmentation ? "NaviCorridorError" : "NaviCameraError"
      NaviNative.current?.emit(event, body: ["message": error.localizedDescription])
    }
  }
}
