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

class NaviCameraViewManager(private val context: ReactApplicationContext,
  private val ocrController: NaviOcrController) : SimpleViewManager<PreviewView>() {
  private class CameraLifecycleOwner : LifecycleOwner {
    private val registry = LifecycleRegistry(this)
    override val lifecycle: Lifecycle get() = registry
    fun start() { registry.currentState = Lifecycle.State.STARTED }
    fun stop() { registry.currentState = Lifecycle.State.DESTROYED }
  }
  private val executor = Executors.newSingleThreadExecutor()
  private var provider: ProcessCameraProvider? = null
  private var detector: NaviDetector? = null
  private var lifecycleOwner: CameraLifecycleOwner? = null
  private var activeView: PreviewView? = null
  private var cameraGeneration = 0
  private var lastFrame = 0L
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
    val future = ProcessCameraProvider.getInstance(context)
    future.addListener({
      if (lifecycleOwner !== owner || activeView !== view) return@addListener
      try {
        detector = NaviDetector(context)
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
        // Fabric sets the native view's bounds without always measuring its
        // children. PreviewView creates its SurfaceView after bind, so lay it
        // out once the surface child has been added.
        view.postDelayed({ layoutPreviewChildren(view, generation) }, 100)
        view.postDelayed({ layoutPreviewChildren(view, generation) }, 500)
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

  private fun layoutPreviewChildren(view: PreviewView, generation: Int) {
    if (cameraGeneration != generation || activeView !== view || !view.isAttachedToWindow) return
    val width = view.width
    val height = view.height
    if (width <= 0 || height <= 0) return
    val widthSpec = android.view.View.MeasureSpec.makeMeasureSpec(width, android.view.View.MeasureSpec.EXACTLY)
    val heightSpec = android.view.View.MeasureSpec.makeMeasureSpec(height, android.view.View.MeasureSpec.EXACTLY)
    for (index in 0 until view.childCount) {
      val child = view.getChildAt(index)
      child.measure(widthSpec, heightSpec)
      child.layout(0, 0, width, height)
    }
    Log.i("NAVI", "Preview children laid out: ${view.childCount}")
  }

  private fun emitReady() {
    context.getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
      .emit("NaviCameraReady", Arguments.createMap())
  }

  private fun emitError(message: String) {
    context.getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
      .emit("NaviCameraError", Arguments.createMap().apply { putString("message", message) })
  }

  override fun onDropViewInstance(view: PreviewView) {
    if (activeView === view) stopCamera()
    super.onDropViewInstance(view)
  }
}
