package com.navi

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import androidx.camera.core.ImageCapture
import androidx.camera.core.ImageCaptureException
import androidx.camera.core.ImageProxy
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.google.mlkit.vision.common.InputImage
import com.google.mlkit.vision.text.TextRecognizer
import com.google.mlkit.vision.text.TextRecognition
import com.google.mlkit.vision.text.latin.TextRecognizerOptions
import java.util.concurrent.Executor
import java.util.concurrent.atomic.AtomicBoolean

/** One-shot, in-memory OCR using the model packaged in com.google.mlkit:text-recognition. */
class NaviOcrController {
  @Volatile private var capture: ImageCapture? = null
  @Volatile private var callbackExecutor: Executor? = null
  private val main = Handler(Looper.getMainLooper())
  private val busy = AtomicBoolean(false)
  private var recognizer: TextRecognizer? = null

  fun attach(imageCapture: ImageCapture, executor: Executor) {
    capture = imageCapture
    callbackExecutor = executor
  }

  fun detach() {
    capture = null
    callbackExecutor = null
  }

  private fun getRecognizer(): TextRecognizer = synchronized(this) {
    recognizer ?: TextRecognition.getClient(TextRecognizerOptions.DEFAULT_OPTIONS)
      .also { recognizer = it }
  }

  fun read(promise: Promise) {
    val camera = capture
    val executor = callbackExecutor
    if (camera == null || executor == null) {
      promise.reject("OCR_CAMERA_OFF", "Start camera assistance before reading surroundings")
      return
    }
    if (!busy.compareAndSet(false, true)) {
      promise.reject("OCR_BUSY", "A surroundings reading is already in progress")
      return
    }
    val started = SystemClock.elapsedRealtime()
    val finished = AtomicBoolean(false)
    val timeout = Runnable {
      if (finished.compareAndSet(false, true)) {
        busy.set(false)
        promise.reject("OCR_TIMEOUT", "The camera reading timed out")
      }
    }
    main.postDelayed(timeout, 15000)
    fun fail(code: String, message: String) {
      if (finished.compareAndSet(false, true)) {
        main.removeCallbacks(timeout)
        busy.set(false)
        promise.reject(code, message)
      }
    }
    try {
      camera.takePicture(executor, object : ImageCapture.OnImageCapturedCallback() {
        override fun onCaptureSuccess(image: ImageProxy) {
          var decoded: Bitmap? = null
          try {
            val rotation = image.imageInfo.rotationDegrees
            val media = image.image
            val input = if (media != null) InputImage.fromMediaImage(media, rotation) else {
              val buffer = image.planes.firstOrNull()?.buffer
                ?: throw IllegalStateException("Captured image has no pixels")
              val bytes = ByteArray(buffer.remaining())
              buffer.get(bytes)
              decoded = BitmapFactory.decodeByteArray(bytes, 0, bytes.size)
                ?: throw IllegalStateException("Captured image could not be decoded")
              InputImage.fromBitmap(decoded!!, rotation)
            }
            val width = if (rotation % 180 == 0) image.width else image.height
            val height = if (rotation % 180 == 0) image.height else image.width
            getRecognizer().process(input)
              .addOnSuccessListener(executor) { result ->
                val blocks = Arguments.createArray()
                result.textBlocks.forEach { block ->
                  val rect = block.boundingBox ?: return@forEach
                  val value = block.text.trim()
                  if (value.isNotEmpty()) blocks.pushMap(Arguments.createMap().apply {
                    putString("text", value)
                    putDouble("x", (rect.left.toDouble() / width).coerceIn(0.0, 1.0))
                    putDouble("y", (rect.top.toDouble() / height).coerceIn(0.0, 1.0))
                    putDouble("width", (rect.width().toDouble() / width).coerceIn(0.0, 1.0))
                    putDouble("height", (rect.height().toDouble() / height).coerceIn(0.0, 1.0))
                  })
                }
                if (finished.compareAndSet(false, true)) {
                  main.removeCallbacks(timeout)
                  busy.set(false)
                  promise.resolve(Arguments.createMap().apply {
                    putArray("blocks", blocks)
                    putInt("width", width)
                    putInt("height", height)
                    putDouble("processingMs", (SystemClock.elapsedRealtime() - started).toDouble())
                  })
                }
              }
              .addOnFailureListener(executor) { error ->
                fail("OCR_FAILED", error.message ?: "Local text recognition failed")
              }
              .addOnCompleteListener(executor) {
                image.close()
                decoded?.recycle()
              }
          } catch (error: Exception) {
            image.close()
            decoded?.recycle()
            fail("OCR_CAPTURE_FAILED", error.message ?: "Captured frame could not be read")
          }
        }

        override fun onError(error: ImageCaptureException) {
          fail("OCR_CAPTURE_FAILED", error.message ?: "Camera capture failed")
        }
      })
    } catch (error: Exception) {
      fail("OCR_CAPTURE_FAILED", error.message ?: "Camera capture could not start")
    }
  }

  fun close() {
    detach()
    synchronized(this) { recognizer?.close(); recognizer = null }
  }
}
