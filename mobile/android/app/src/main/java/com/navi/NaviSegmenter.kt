package com.navi

import android.content.Context
import android.graphics.Bitmap
import android.graphics.Color
import android.graphics.Matrix
import androidx.camera.core.ImageProxy
import ai.onnxruntime.OnnxTensor
import ai.onnxruntime.OrtEnvironment
import ai.onnxruntime.OrtSession
import java.nio.FloatBuffer
import kotlin.math.exp
import kotlin.math.max
import kotlin.math.min
import kotlin.math.sqrt

enum class CorridorStatus { POTENTIAL_GROUND, OBSTRUCTED, UNKNOWN }
enum class SurfaceKind { PEDESTRIAN_SURFACE, ROAD, STAIRS, VEGETATION, OTHER, POOR_VISIBILITY }

data class CorridorZone(
  val name: String,
  val status: CorridorStatus,
  val surface: SurfaceKind,
  val confidence: Float,
  val obstacleLabels: List<String>,
)

data class CorridorAnalysis(
  val zones: List<CorridorZone>,
  val summary: String,
  val latencyMs: Long,
  val meanBrightness: Float,
  val contrast: Float,
)

/**
 * Low-frequency, fully local semantic segmentation. This class deliberately
 * produces only image-space evidence. It does not estimate depth or safety.
 */
class NaviSegmenter(context: Context) : AutoCloseable {
  private val env = OrtEnvironment.getEnvironment()
  private val session: OrtSession
  private val inputName: String

  private val pedestrian = setOf(3, 11, 52) // floor, sidewalk, path
  private val road = setOf(6)
  private val stairs = setOf(53, 59, 121) // stairs, stairway, step
  private val vegetation = setOf(4, 9, 17) // tree, grass, plant

  init {
    val bytes = context.assets.open("segformer_b0_ade20k_quantized.onnx").use { it.readBytes() }
    session = env.createSession(bytes, OrtSession.SessionOptions().apply {
      setIntraOpNumThreads(1)
      setInterOpNumThreads(1)
      // This model runs intermittently. Avoid retaining a large CPU arena and
      // dynamic-shape memory pattern between scans on a memory-constrained phone.
      setMemoryPatternOptimization(false)
      setCPUArenaAllocator(false)
    })
    inputName = session.inputNames.single()
    val input = session.inputInfo.getValue(inputName).info as ai.onnxruntime.TensorInfo
    require(input.shape.size == 4 && (input.shape[1] == -1L || input.shape[1] == 3L)) {
      "Expected SegFormer NCHW RGB input, got ${input.shape.contentToString()}"
    }
  }

  fun analyze(source: Bitmap, boxes: List<Box>): CorridorAnalysis {
    val started = System.nanoTime()
    val scaled = Bitmap.createScaledBitmap(source, INPUT_SIZE, INPUT_SIZE, true)
    val pixels = IntArray(INPUT_SIZE * INPUT_SIZE)
    scaled.getPixels(pixels, 0, INPUT_SIZE, 0, 0, INPUT_SIZE, INPUT_SIZE)
    if (scaled !== source) scaled.recycle()

    var luminanceSum = 0.0
    var luminanceSquared = 0.0
    var luminanceCount = 0
    for (y in 0 until INPUT_SIZE step 8) for (x in 0 until INPUT_SIZE step 8) {
      val color = pixels[y * INPUT_SIZE + x]
      val value = (0.2126 * Color.red(color) + 0.7152 * Color.green(color) +
        0.0722 * Color.blue(color)) / 255.0
      luminanceSum += value
      luminanceSquared += value * value
      luminanceCount++
    }
    val meanBrightness = (luminanceSum / luminanceCount).toFloat()
    val variance = max(0.0, luminanceSquared / luminanceCount - meanBrightness * meanBrightness)
    val contrast = sqrt(variance).toFloat()
    val poorVisibility = meanBrightness < 0.07f || contrast < 0.025f

    val input = FloatArray(3 * pixels.size)
    for (i in pixels.indices) {
      input[i] = (Color.red(pixels[i]) / 255f - MEAN[0]) / STD[0]
      input[i + pixels.size] = (Color.green(pixels[i]) / 255f - MEAN[1]) / STD[1]
      input[i + 2 * pixels.size] = (Color.blue(pixels[i]) / 255f - MEAN[2]) / STD[2]
    }

    val evidence = Array(3) { Evidence() }
    OnnxTensor.createTensor(env, FloatBuffer.wrap(input),
      longArrayOf(1, 3, INPUT_SIZE.toLong(), INPUT_SIZE.toLong())).use { tensor ->
      session.run(mapOf(inputName to tensor)).use { result ->
        val output = result[0] as OnnxTensor
        val shape = output.info.shape
        require(shape.size == 4 && shape[0] == 1L && shape[1] == CLASS_COUNT.toLong()) {
          "Expected SegFormer output [1,$CLASS_COUNT,H,W], got ${shape.contentToString()}"
        }
        val height = shape[2].toInt()
        val width = shape[3].toInt()
        val plane = width * height
        val logits = output.floatBuffer
        // Sample a compact grid over the lower 58% of the image. It is enough
        // for three coarse corridors and keeps the confidence calculation cheap.
        for (gy in 0 until GRID_ROWS) for (gx in 0 until GRID_COLUMNS) {
          val x = min(width - 1, ((gx + 0.5f) * width / GRID_COLUMNS).toInt())
          val normalizedY = 0.42f + (gy + 0.5f) / GRID_ROWS * 0.56f
          val y = min(height - 1, (normalizedY * height).toInt())
          val offset = y * width + x
          var bestClass = 0
          var bestLogit = -Float.MAX_VALUE
          for (classId in 0 until CLASS_COUNT) {
            val value = logits.get(classId * plane + offset)
            if (value > bestLogit) { bestLogit = value; bestClass = classId }
          }
          var denominator = 0.0
          for (classId in 0 until CLASS_COUNT)
            denominator += exp((logits.get(classId * plane + offset) - bestLogit).toDouble())
          val confidence = (1.0 / denominator).toFloat()
          val zone = min(2, gx * 3 / GRID_COLUMNS)
          evidence[zone].add(kind(bestClass), confidence)
        }
      }
    }

    val names = listOf("LEFT", "CENTRE", "RIGHT")
    val zones = evidence.mapIndexed { index, value ->
      val obstacles = obstaclesFor(index, boxes)
      if (obstacles.isNotEmpty()) CorridorZone(names[index], CorridorStatus.OBSTRUCTED,
        value.dominantSurface(), value.bestConfidence(), obstacles)
      else if (poorVisibility) CorridorZone(names[index], CorridorStatus.UNKNOWN,
        SurfaceKind.POOR_VISIBILITY, 0f, emptyList())
      else if (value.pedestrianFraction() >= GROUND_FRACTION &&
        value.averagePedestrianConfidence() >= MIN_CONFIDENCE)
        CorridorZone(names[index], CorridorStatus.POTENTIAL_GROUND,
          SurfaceKind.PEDESTRIAN_SURFACE, value.averagePedestrianConfidence(), emptyList())
      else CorridorZone(names[index], CorridorStatus.UNKNOWN, value.dominantSurface(),
        value.bestConfidence(), emptyList())
    }
    return CorridorAnalysis(zones, summary(zones),
      (System.nanoTime() - started) / 1_000_000, meanBrightness, contrast)
  }

  private fun kind(classId: Int): SurfaceKind = when (classId) {
    in pedestrian -> SurfaceKind.PEDESTRIAN_SURFACE
    in road -> SurfaceKind.ROAD
    in stairs -> SurfaceKind.STAIRS
    in vegetation -> SurfaceKind.VEGETATION
    else -> SurfaceKind.OTHER
  }

  private fun obstaclesFor(zone: Int, boxes: List<Box>): List<String> {
    val left = zone / 3f
    val right = (zone + 1) / 3f
    return boxes.filter { box ->
      val overlap = max(0f, min(right, box.x + box.width) - max(left, box.x))
      box.confidence >= 0.5f && box.y + box.height >= 0.52f &&
        box.width * box.height >= 0.012f && overlap >= min(0.05f, box.width * 0.35f)
    }.map { it.label }.distinct().sorted()
  }

  private fun summary(zones: List<CorridorZone>): String {
    val centre = zones[1]
    if (centre.status == CorridorStatus.OBSTRUCTED && centre.obstacleLabels.contains("person"))
      return "People detected ahead."
    val possible = zones.firstOrNull { it.status == CorridorStatus.POTENTIAL_GROUND }
    if (possible != null) {
      val direction = when (possible.name) { "LEFT" -> "on the left"; "RIGHT" -> "on the right"; else -> "ahead" }
      return "Possible pedestrian surface visible $direction."
    }
    return "Unable to assess the walking surface."
  }

  override fun close() { session.close() }

  private class Evidence {
    private val counts = IntArray(SurfaceKind.entries.size)
    private val confidenceSums = FloatArray(SurfaceKind.entries.size)
    private var total = 0
    fun add(kind: SurfaceKind, confidence: Float) {
      counts[kind.ordinal]++
      confidenceSums[kind.ordinal] += confidence
      total++
    }
    fun pedestrianFraction() = if (total == 0) 0f else
      counts[SurfaceKind.PEDESTRIAN_SURFACE.ordinal].toFloat() / total
    fun averagePedestrianConfidence(): Float {
      val count = counts[SurfaceKind.PEDESTRIAN_SURFACE.ordinal]
      return if (count == 0) 0f else confidenceSums[SurfaceKind.PEDESTRIAN_SURFACE.ordinal] / count
    }
    fun dominantSurface(): SurfaceKind {
      val candidates = listOf(SurfaceKind.PEDESTRIAN_SURFACE, SurfaceKind.ROAD,
        SurfaceKind.STAIRS, SurfaceKind.VEGETATION, SurfaceKind.OTHER)
      return candidates.maxByOrNull { counts[it.ordinal] } ?: SurfaceKind.OTHER
    }
    fun bestConfidence(): Float {
      val kind = dominantSurface()
      val count = counts[kind.ordinal]
      return if (count == 0) 0f else confidenceSums[kind.ordinal] / count
    }
  }

  companion object {
    // The export has dynamic spatial dimensions. 384 preserves useful coarse
    // region evidence while substantially reducing sustained CPU work on the
    // Motorola edge 30 compared with the reference 512 preprocessor size.
    private const val INPUT_SIZE = 384
    private const val CLASS_COUNT = 150
    private const val GRID_COLUMNS = 24
    private const val GRID_ROWS = 12
    private const val GROUND_FRACTION = 0.34f
    private const val MIN_CONFIDENCE = 0.38f
    private val MEAN = floatArrayOf(0.485f, 0.456f, 0.406f)
    private val STD = floatArrayOf(0.229f, 0.224f, 0.225f)

    fun copyRotatedBitmap(image: ImageProxy): Bitmap {
      val plane = image.planes[0]
      val buffer = plane.buffer
      val pixels = IntArray(image.width * image.height)
      for (y in 0 until image.height) for (x in 0 until image.width) {
        val offset = y * plane.rowStride + x * plane.pixelStride
        pixels[y * image.width + x] = Color.rgb(
          buffer.get(offset).toInt() and 255,
          buffer.get(offset + 1).toInt() and 255,
          buffer.get(offset + 2).toInt() and 255,
        )
      }
      val raw = Bitmap.createBitmap(pixels, image.width, image.height, Bitmap.Config.ARGB_8888)
      if (image.imageInfo.rotationDegrees == 0) return raw
      val rotated = Bitmap.createBitmap(raw, 0, 0, raw.width, raw.height,
        Matrix().apply { postRotate(image.imageInfo.rotationDegrees.toFloat()) }, true)
      raw.recycle()
      return rotated
    }
  }
}
