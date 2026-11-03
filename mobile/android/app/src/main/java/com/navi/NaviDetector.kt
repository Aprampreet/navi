package com.navi

import android.content.Context
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Matrix
import android.graphics.Paint
import androidx.camera.core.ImageProxy
import ai.onnxruntime.OnnxTensor
import ai.onnxruntime.OrtEnvironment
import ai.onnxruntime.OrtSession
import java.nio.FloatBuffer
import kotlin.math.max
import kotlin.math.min

data class Box(val label: String, val confidence: Float, val x: Float, val y: Float,
               val width: Float, val height: Float)

class NaviDetector(context: Context) : AutoCloseable {
  private val env = OrtEnvironment.getEnvironment()
  private val session: OrtSession
  private val labels = mapOf(0 to "person", 1 to "bicycle", 2 to "car", 3 to "motorcycle",
    5 to "bus", 16 to "dog", 56 to "chair")

  init {
    val bytes = context.assets.open("yolo11n.onnx").use { it.readBytes() }
    session = env.createSession(bytes, OrtSession.SessionOptions().apply { setIntraOpNumThreads(2) })
    val shape = session.inputInfo.values.first().info as ai.onnxruntime.TensorInfo
    require(shape.shape.contentEquals(longArrayOf(1, 3, 640, 640))) { "Expected YOLO input [1,3,640,640]" }
  }

  fun detect(image: ImageProxy): Pair<List<Box>, Long> {
    val start = System.nanoTime()
    val plane = image.planes[0]
    val buffer = plane.buffer
    val pixels = IntArray(image.width * image.height)
    for (y in 0 until image.height) for (x in 0 until image.width) {
      val i = y * plane.rowStride + x * plane.pixelStride
      val r = buffer.get(i).toInt() and 255
      val g = buffer.get(i + 1).toInt() and 255
      val b = buffer.get(i + 2).toInt() and 255
      pixels[y * image.width + x] = Color.rgb(r, g, b)
    }
    val raw = Bitmap.createBitmap(pixels, image.width, image.height, Bitmap.Config.ARGB_8888)
    val rotated = Bitmap.createBitmap(raw, 0, 0, raw.width, raw.height,
      Matrix().apply { postRotate(image.imageInfo.rotationDegrees.toFloat()) }, true)
    raw.recycle()
    val imageWidth = rotated.width
    val imageHeight = rotated.height
    val scale = min(640f / imageWidth, 640f / imageHeight)
    val w = (imageWidth * scale).toInt()
    val h = (imageHeight * scale).toInt()
    val dx = (640 - w) / 2f
    val dy = (640 - h) / 2f
    val canvasBitmap = Bitmap.createBitmap(640, 640, Bitmap.Config.ARGB_8888)
    Canvas(canvasBitmap).apply {
      drawColor(Color.rgb(114, 114, 114))
      drawBitmap(rotated, null, android.graphics.RectF(dx, dy, dx + w, dy + h),
        Paint(Paint.FILTER_BITMAP_FLAG))
    }
    rotated.recycle()
    val rgb = IntArray(640 * 640)
    canvasBitmap.getPixels(rgb, 0, 640, 0, 0, 640, 640)
    canvasBitmap.recycle()
    val input = FloatArray(3 * 640 * 640)
    for (i in rgb.indices) {
      input[i] = Color.red(rgb[i]) / 255f
      input[i + rgb.size] = Color.green(rgb[i]) / 255f
      input[i + 2 * rgb.size] = Color.blue(rgb[i]) / 255f
    }
    val tensor = OnnxTensor.createTensor(env, FloatBuffer.wrap(input), longArrayOf(1, 3, 640, 640))
    val candidates = mutableListOf<Box>()
    tensor.use { t -> session.run(mapOf(session.inputNames.first() to t)).use { result ->
      val out = result[0] as OnnxTensor
      val shape = out.info.shape
      require(shape.size == 3 && shape[0] == 1L && shape[1] == 84L) {
        "Expected YOLO output [1,84,N], got ${shape.contentToString()}" }
      val data = out.floatBuffer
      val n = shape[2].toInt()
      for (i in 0 until n) {
        var bestClass = -1
        var score = 0f
        for (id in 0 until 80) {
          val s = data.get((4 + id) * n + i)
          if (s > score) { score = s; bestClass = id }
        }
        if (score < 0.45f || !labels.containsKey(bestClass)) continue
        val cx = data.get(i)
        val cy = data.get(n + i)
        val bw = data.get(2 * n + i)
        val bh = data.get(3 * n + i)
        val left = ((cx - bw / 2 - dx) / scale).coerceIn(0f, imageWidth.toFloat())
        val top = ((cy - bh / 2 - dy) / scale).coerceIn(0f, imageHeight.toFloat())
        val right = ((cx + bw / 2 - dx) / scale).coerceIn(0f, imageWidth.toFloat())
        val bottom = ((cy + bh / 2 - dy) / scale).coerceIn(0f, imageHeight.toFloat())
        if (right > left && bottom > top) candidates.add(Box(labels.getValue(bestClass), score,
          left / imageWidth, top / imageHeight,
          (right - left) / imageWidth, (bottom - top) / imageHeight))
      }
    } }
    val kept = mutableListOf<Box>()
    for (box in candidates.sortedByDescending { it.confidence }) {
      if (kept.size >= 30) break
      if (kept.none { it.label == box.label && iou(it, box) > 0.5f }) kept.add(box)
    }
    return kept to ((System.nanoTime() - start) / 1_000_000)
  }

  private fun iou(a: Box, b: Box): Float {
    val x1 = max(a.x, b.x); val y1 = max(a.y, b.y)
    val x2 = min(a.x + a.width, b.x + b.width)
    val y2 = min(a.y + a.height, b.y + b.height)
    val area = max(0f, x2 - x1) * max(0f, y2 - y1)
    return area / (a.width * a.height + b.width * b.height - area + 1e-6f)
  }

  override fun close() { session.close() }
}
