package com.navi

import android.os.SystemClock
import android.util.Log
import androidx.camera.core.CameraSelector
import androidx.camera.core.ImageAnalysis
import androidx.camera.core.ImageCapture
import androidx.camera.core.Preview
import androidx.camera.view.PreviewView
import androidx.camera.lifecycle.ProcessCameraProvider
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleOwner
import androidx.lifecycle.LifecycleRegistry
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.modules.core.DeviceEventManagerModule
import com.facebook.react.uimanager.SimpleViewManager
import com.facebook.react.uimanager.annotations.ReactProp
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicBoolean

class NaviCameraViewManager(private val context: ReactApplicationContext,
  private val ocrController: NaviOcrController) : SimpleViewManager<PreviewView>() {
  private class CameraLifecycleOwner : LifecycleOwner {
    private val registry = LifecycleRegistry(this)
    override val lifecycle: Lifecycle get() = registry
    fun start() { registry.currentState = Lifecycle.State.STARTED }
    fun stop() { registry.currentState = Lifecycle.State.DESTROYED }
  }
  private val executor = Executors.newSingleThreadExecutor()
  private val segmentationExecutor = Executors.newSingleThreadExecutor()
  private var provider: ProcessCameraProvider? = null
  private var detector: NaviDetector? = null
  @Volatile private var segmenter: NaviSegmenter? = null
  private var lifecycleOwner: CameraLifecycleOwner? = null
  private var activeView: PreviewView? = null
  private var cameraGeneration = 0
  private var lastFrame = 0L
  private var lastSegmentationFrame = 0L
  private val segmentationInFlight = AtomicBoolean(false)
  private var loggedFirstFrame = false
  override fun getName() = "NaviCameraView"
  override fun createViewInstance(reactContext: com.facebook.react.uimanager.ThemedReactContext): PreviewView =
    PreviewView(reactContext).apply {
      // TextureView keeps PreviewView's transform correct when React Native
      // moves this mounted view between the visible and retained tab positions.
      implementationMode = PreviewView.ImplementationMode.COMPATIBLE
      scaleType = PreviewView.ScaleType.FILL_CENTER
    }

  private fun stopCamera() {
    cameraGeneration++
    ocrController.detach()
    activeView = null
    lifecycleOwner?.stop()
    lifecycleOwner = null
    provider?.unbindAll()
    val oldDetector = detector
    detector = null
    if (oldDetector != null) executor.execute { oldDetector.close() }
    val oldSegmenter = segmenter
    segmenter = null
    if (oldSegmenter != null) segmentationExecutor.execute { oldSegmenter.close() }
    segmentationInFlight.set(false)
  }

  @ReactProp(name = "active", defaultBoolean = false)
  fun setActive(view: PreviewView, active: Boolean) {
    if (!active) { if (activeView === view) stopCamera(); return }
    if (activeView === view && lifecycleOwner != null) return
    if (activeView != null) stopCamera()
    val owner = CameraLifecycleOwner()
    lifecycleOwner = owner
    activeView = view
    val generation = ++cameraGeneration
    loggedFirstFrame = false
    lastFrame = 0L
    lastSegmentationFrame = 0L
    val future = ProcessCameraProvider.getInstance(context)
    future.addListener({
      if (lifecycleOwner !== owner || activeView !== view) return@addListener
      try {
        detector = NaviDetector(context)
        segmentationExecutor.execute {
          try {
            val candidate = NaviSegmenter(context)
            if (cameraGeneration == generation && activeView === view) {
              segmenter = candidate
              Log.i("NAVI", "Offline SegFormer corridor model ready")
            } else candidate.close()
          } catch (error: Exception) {
            Log.e("NAVI", "Segmentation model unavailable", error)
            if (cameraGeneration == generation) emitCorridorError(
              error.message ?: "Walking-surface model unavailable")
          }
        }
        provider = future.get()
        view.previewStreamState.observe(owner) { state ->
          if (cameraGeneration == generation && activeView === view &&
              state == PreviewView.StreamState.STREAMING) {
            Log.i("NAVI", "Camera preview streaming")
            emitReady()
          }
        }
        bindCamera(view, owner, generation, 0)
      } catch (error: Exception) { emitError(error.message ?: "Camera unavailable") }
    }, androidx.core.content.ContextCompat.getMainExecutor(context))
  }

  private fun bindCamera(view: PreviewView, owner: CameraLifecycleOwner, generation: Int, attempt: Int) {
    view.post {
      if (cameraGeneration != generation || activeView !== view) return@post
      if (!view.isAttachedToWindow || view.width == 0 || view.height == 0) {
        if (attempt < 3) view.postDelayed({ bindCamera(view, owner, generation, attempt + 1) }, 500)
        else emitError("Camera preview could not attach to the screen")
        return@post
      }
      try {
        provider?.unbindAll()
        ocrController.detach()
        val preview = Preview.Builder().build().also { it.surfaceProvider = view.surfaceProvider }
        val analysis = ImageAnalysis.Builder()
          .setTargetResolution(android.util.Size(640, 480))
          .setOutputImageFormat(ImageAnalysis.OUTPUT_IMAGE_FORMAT_RGBA_8888)
          .setBackpressureStrategy(ImageAnalysis.STRATEGY_KEEP_ONLY_LATEST).build()
        val capture = ImageCapture.Builder()
          .setCaptureMode(ImageCapture.CAPTURE_MODE_MINIMIZE_LATENCY)
          .setTargetResolution(android.util.Size(1920, 1080)).build()
        analysis.setAnalyzer(executor) { frame ->
          try {
            if (!loggedFirstFrame) Log.i("NAVI", "Analyzer received ${frame.width}x${frame.height} frame")
            val now = SystemClock.elapsedRealtime()
            if (now - lastFrame >= 500 && cameraGeneration == generation) {
              lastFrame = now
              val (boxes, latency) = detector?.detect(frame) ?: (emptyList<Box>() to 0L)
              if (!loggedFirstFrame) {
                Log.i("NAVI", "First analyzed frame: ${boxes.size} boxes, ${latency} ms")
                loggedFirstFrame = true
              }
              val event = Arguments.createMap()
              val items = Arguments.createArray()
              boxes.forEach { box ->
                items.pushMap(Arguments.createMap().apply {
                  putString("label", box.label); putDouble("confidence", box.confidence.toDouble())
                  putDouble("x", box.x.toDouble()); putDouble("y", box.y.toDouble())
                  putDouble("width", box.width.toDouble()); putDouble("height", box.height.toDouble())
                })
              }
              event.putArray("detections", items)
              event.putDouble("timestamp", System.currentTimeMillis().toDouble())
              event.putDouble("latencyMs", latency.toDouble())
              context.getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
                .emit("NaviDetections", event)
              val currentSegmenter = segmenter
              if (currentSegmenter != null && now - lastSegmentationFrame >= 3000 &&
                segmentationInFlight.compareAndSet(false, true)) {
                lastSegmentationFrame = now
                val bitmap = NaviSegmenter.copyRotatedBitmap(frame)
                val boxSnapshot = boxes.toList()
                segmentationExecutor.execute {
                  try {
                    val result = currentSegmenter.analyze(bitmap, boxSnapshot)
                    if (cameraGeneration == generation) emitCorridor(result)
                  } catch (error: Exception) {
                    Log.e("NAVI", "Corridor analysis failed", error)
                    if (cameraGeneration == generation) emitCorridorError(
                      error.message ?: "Walking-surface analysis failed")
                  } finally {
                    bitmap.recycle()
                    segmentationInFlight.set(false)
                  }
                }
              }
            }
          } catch (error: Exception) {
            Log.e("NAVI", "Analyzer failed", error)
            emitError(error.message ?: "Detector failed")
          } finally { frame.close() }
        }
        owner.start()
        provider?.bindToLifecycle(owner, CameraSelector.DEFAULT_BACK_CAMERA, preview, analysis, capture)
        ocrController.attach(capture, executor)
        Log.i("NAVI", "CameraX bound; attempt=$attempt size=${view.width}x${view.height}")
        // Fabric supplies PreviewView's bounds before CameraX creates its
        // TextureView. Relayout PreviewView itself after that child exists so
        // CameraX recomputes its crop and rotation from the real native bounds.
        view.postDelayed({ refreshPreviewLayout(view, generation) }, 100)
        view.postDelayed({ refreshPreviewLayout(view, generation) }, 500)
        view.postDelayed({
          if (cameraGeneration != generation || activeView !== view) return@postDelayed
          if (view.previewStreamState.value == PreviewView.StreamState.STREAMING) {
            return@postDelayed
          } else if (attempt < 2) {
            Log.w("NAVI", "Preview not streaming after 7s; retrying bind")
            bindCamera(view, owner, generation, attempt + 1)
          } else emitError("Camera preview did not start after three attempts")
        }, 7000)
      } catch (error: Exception) { emitError(error.message ?: "Camera unavailable") }
    }
  }

  private fun refreshPreviewLayout(view: PreviewView, generation: Int) {
    if (cameraGeneration != generation || activeView !== view || !view.isAttachedToWindow) return
    val width = view.width
    val height = view.height
    if (width <= 0 || height <= 0) return
    val widthSpec = android.view.View.MeasureSpec.makeMeasureSpec(width,
      android.view.View.MeasureSpec.EXACTLY)
    val heightSpec = android.view.View.MeasureSpec.makeMeasureSpec(height,
      android.view.View.MeasureSpec.EXACTLY)
    view.measure(widthSpec, heightSpec)
    view.forceLayout()
    view.layout(view.left, view.top, view.right, view.bottom)
    view.scaleType = PreviewView.ScaleType.FILL_CENTER
    view.invalidate()
    Log.i("NAVI", "Preview relaid out: ${width}x${height} children=${view.childCount}")
  }

  private fun emitReady() {
    context.getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
      .emit("NaviCameraReady", Arguments.createMap())
  }

  private fun emitError(message: String) {
    context.getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
      .emit("NaviCameraError", Arguments.createMap().apply { putString("message", message) })
  }

  private fun emitCorridor(result: CorridorAnalysis) {
    Log.i("NAVI", "Corridor ${result.zones.joinToString { "${it.name}:${it.status}" }} " +
      "${result.latencyMs} ms brightness=${result.meanBrightness} contrast=${result.contrast}")
    val event = Arguments.createMap()
    val zones = Arguments.createArray()
    result.zones.forEach { zone ->
      zones.pushMap(Arguments.createMap().apply {
        putString("name", zone.name)
        putString("status", zone.status.name)
        putString("surface", zone.surface.name)
        putDouble("confidence", zone.confidence.toDouble())
        putArray("obstacles", Arguments.createArray().apply {
          zone.obstacleLabels.forEach { pushString(it) }
        })
      })
    }
    event.putArray("zones", zones)
    event.putString("summary", result.summary)
    event.putDouble("timestamp", System.currentTimeMillis().toDouble())
    event.putDouble("latencyMs", result.latencyMs.toDouble())
    event.putDouble("meanBrightness", result.meanBrightness.toDouble())
    event.putDouble("contrast", result.contrast.toDouble())
    context.getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
      .emit("NaviCorridor", event)
  }

  private fun emitCorridorError(message: String) {
    context.getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
      .emit("NaviCorridorError", Arguments.createMap().apply { putString("message", message) })
  }

  override fun onDropViewInstance(view: PreviewView) {
    if (activeView === view) stopCamera()
    super.onDropViewInstance(view)
  }
}
