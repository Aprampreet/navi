package com.navi

import android.Manifest
import android.content.pm.PackageManager
import android.os.Handler
import android.os.Looper
import android.util.Log
import androidx.core.content.ContextCompat
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.modules.core.DeviceEventManagerModule
import org.json.JSONObject
import org.vosk.Model
import org.vosk.Recognizer
import org.vosk.android.RecognitionListener
import org.vosk.android.SpeechService
import java.io.File
import java.util.concurrent.Executors

/** Local Vosk speech input. "Hi NAVI" is a phrase match, not a trained keyword model. */
class NaviOfflineVoice(private val context: ReactApplicationContext) : RecognitionListener {
  private enum class Mode { OFF, WAKE, COMMAND, PROCESSING }
  private val main = Handler(Looper.getMainLooper())
  private val worker = Executors.newSingleThreadExecutor()
  private var wanted = false
  private var loading = false
  private var mode = Mode.OFF
  private var model: Model? = null
  private var recognizer: Recognizer? = null
  private var service: SpeechService? = null
  private var speechActive = false
  private var awaitingAcknowledgement = false
  private var commandTimeout: Runnable? = null
  private var pendingStart: Promise? = null
  private var restartCount = 0
  private var lastPause: Boolean? = null
  private var commandContext = "SEARCH"
  private val modelName = "vosk-model-small-en-us-0.15"
  private val wakePattern = Regex("\\b(?:hi|high|hey|hello) (?:navi|navy)\\b")
  private val wakeGrammar = """["hi navy","high navy","hey navy","hello navy","hi navi","hey navi","[unk]"]"""
  private val commonCommands = listOf("start camera assistance", "stop camera assistance",
    "describe my surroundings", "read the last text", "repeat", "pause alerts",
    "resume alerts", "mute", "unmute", "turn on haptics", "turn off haptics",
    "stop", "cancel")
  private fun commandGrammar(): String? {
    val routeCommands = when (commandContext) {
      "CONFIRM" -> listOf("confirm destination", "confirm first destination",
        "confirm second destination", "confirm third destination", "confirm fourth destination",
        "confirm fifth destination", "choose option one", "choose option two",
        "choose option three", "choose option four", "choose option five", "change destination")
      "READY" -> listOf("start walking guidance", "start navigation", "route status",
        "repeat instruction", "refresh my location", "stop navigation", "change destination")
      "NAVIGATING" -> listOf("repeat instruction", "what is the next turn", "route status",
        "refresh my location", "pause navigation", "resume navigation",
        "stop navigation", "change destination")
      else -> return null // Open vocabulary is needed for spoken place names.
    }
    return (commonCommands + routeCommands + "[unk]").joinToString(",", "[", "]") { JSONObject.quote(it) }
  }

  fun setCommandContext(value: String, promise: Promise) {
    if (value !in setOf("SEARCH", "CONFIRM", "READY", "NAVIGATING")) {
      promise.reject("VOICE_CONTEXT_INVALID", "Unknown voice command context")
      return
    }
    commandContext = value
    promise.resolve(null)
  }

  private fun emit(name: String, text: String = "") {
    context.getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
      .emit(name, Arguments.createMap().apply { putString("text", text) })
  }

  fun start(promise: Promise) {
    if (ContextCompat.checkSelfPermission(context, Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
      promise.reject("MIC_DENIED", "Microphone permission is required for offline voice control")
      return
    }
    wanted = true
    restartCount = 0
    if (service != null) { promise.resolve(true); return }
    if (loading) { promise.reject("VOICE_LOADING", "Offline speech model is still loading"); return }
    loading = true
    pendingStart = promise
    worker.execute {
      try {
        val path = ensureModelFiles()
        val loaded = Model(path.absolutePath)
        main.post {
          loading = false
          if (!wanted) { loaded.close(); pendingStart?.reject("VOICE_STOPPED", "Voice control stopped") }
          else {
            model = loaded
            try {
              openService()
              pendingStart?.resolve(true)
              emit("NaviVoiceReady")
            } catch (error: Exception) {
              loaded.close(); model = null
              pendingStart?.reject("VOICE_START_FAILED", error.message ?: "Offline microphone could not start")
              emit("NaviVoiceError", error.message ?: "Offline microphone could not start")
            }
          }
          pendingStart = null
        }
      } catch (error: Exception) {
        main.post {
          loading = false
          pendingStart?.reject("VOICE_MODEL_FAILED", error.message ?: "Bundled offline speech model is unavailable")
          pendingStart = null
          emit("NaviVoiceError", error.message ?: "Bundled offline speech model is unavailable")
        }
      }
    }
  }

  private fun ensureModelFiles(): File {
    val target = File(context.filesDir, modelName)
    val marker = File(target, ".navi-ready")
    if (marker.isFile && File(target, "am/final.mdl").isFile && File(target, "graph/HCLr.fst").isFile) return target
    val staging = File(context.filesDir, "$modelName.staging")
    if (staging.exists()) staging.deleteRecursively()
    staging.mkdirs()
    fun copyAsset(source: String, destination: File) {
      val children = context.assets.list(source).orEmpty()
      if (children.isEmpty()) {
        destination.parentFile?.mkdirs()
        context.assets.open(source).use { input -> destination.outputStream().use { input.copyTo(it) } }
      } else {
        destination.mkdirs()
        for (child in children) copyAsset("$source/$child", File(destination, child))
      }
    }
    copyAsset(modelName, staging)
    require(File(staging, "am/final.mdl").isFile && File(staging, "graph/HCLr.fst").isFile) {
      "Bundled Vosk model files are incomplete"
    }
    File(staging, ".navi-ready").writeText("bundled")
    if (target.exists()) target.deleteRecursively()
    check(staging.renameTo(target)) { "Could not prepare bundled offline speech model" }
    return target
  }

  private fun openService() {
    mode = Mode.WAKE
    replaceService(wakeGrammar)
  }

  private fun replaceService(grammar: String?) {
    service?.cancel()
    service?.shutdown()
    service = null
    recognizer?.close()
    recognizer = null
    val loaded = model ?: throw IllegalStateException("Offline model is not ready")
    val fresh = if (grammar == null) Recognizer(loaded, 16000.0f)
      else Recognizer(loaded, 16000.0f, grammar)
    try {
      val next = SpeechService(fresh, 16000.0f)
      recognizer = fresh
      service = next
      next.startListening(this)
    } catch (error: Exception) {
      fresh.close()
      throw error
    }
    lastPause = null
    applyPause()
  }

  private fun applyPause() {
    val paused = speechActive || awaitingAcknowledgement || mode == Mode.PROCESSING || mode == Mode.OFF
    service?.setPause(paused)
    if (lastPause != paused) {
      Log.i("NAVI_VOICE", "microphone paused=$paused mode=$mode speech=$speechActive")
      lastPause = paused
    }
  }

  fun setSpeechActive(active: Boolean) {
    speechActive = active
    applyPause()
    if (!active && mode == Mode.COMMAND && !awaitingAcknowledgement) service?.reset()
  }

  fun beginCommand(promise: Promise) {
    if (service == null) { promise.reject("VOICE_NOT_READY", "Offline voice control is not ready"); return }
    mode = Mode.COMMAND
    awaitingAcknowledgement = true
    try { replaceService(null) }
    catch (error: Exception) { promise.reject("VOICE_COMMAND_FAILED", error.message ?: "Microphone could not switch modes"); return }
    promise.resolve(null)
  }

  fun resumeCommand(promise: Promise) {
    if (mode == Mode.COMMAND) {
      awaitingAcknowledgement = false
      service?.reset()
      applyPause()
      scheduleTimeout()
    }
    promise.resolve(null)
  }

  fun finishCommand(promise: Promise) {
    clearTimeout()
    awaitingAcknowledgement = false
    mode = if (wanted) Mode.WAKE else Mode.OFF
    try { if (wanted) replaceService(wakeGrammar) else applyPause() }
    catch (error: Exception) { promise.reject("VOICE_WAKE_FAILED", error.message ?: "Wake listener could not restart"); return }
    promise.resolve(null)
  }

  private fun scheduleTimeout() {
    clearTimeout()
    val timeout = Runnable {
      if (mode == Mode.COMMAND) {
        mode = Mode.WAKE
        awaitingAcknowledgement = false
        try { replaceService(wakeGrammar) }
        catch (error: Exception) { emit("NaviVoiceError", error.message ?: "Wake listener could not restart") }
        emit("NaviVoiceTimeout", "I did not hear a command. Say Hi NAVI to try again.")
      }
    }
    commandTimeout = timeout
    main.postDelayed(timeout, 15000)
  }

  private fun clearTimeout() {
    commandTimeout?.let { main.removeCallbacks(it) }
    commandTimeout = null
  }

  fun stop(promise: Promise? = null) {
    wanted = false
    clearTimeout()
    mode = Mode.OFF
    awaitingAcknowledgement = false
    service?.cancel()
    service?.shutdown()
    service = null
    recognizer?.close(); recognizer = null
    model?.close(); model = null
    promise?.resolve(null)
  }

  private fun transcript(json: String): String = try {
    val value = JSONObject(json)
    value.optString("text").ifBlank { value.optString("partial") }.trim()
  } catch (_: Exception) { "" }

  private fun accept(json: String) {
    val text = transcript(json).lowercase()
    if (text.isBlank() || speechActive) return
    Log.i("NAVI_VOICE", "result mode=$mode wakeMatch=${wakePattern.containsMatchIn(text)} length=${text.length}")
    when (mode) {
      Mode.WAKE -> {
        if (wakePattern.containsMatchIn(text)) {
          mode = Mode.COMMAND
          awaitingAcknowledgement = true
          // Search needs open vocabulary. Once results or a route exist, restrict the
          // next command to relevant choices so short controls are easier to recognize.
          try { replaceService(commandGrammar()) }
          catch (error: Exception) { emit("NaviVoiceError", error.message ?: "Command listener could not start"); return }
          emit("NaviVoiceWake")
        }
      }
      Mode.COMMAND -> {
        if (awaitingAcknowledgement) return
        if (wakePattern.containsMatchIn(text)) {
          clearTimeout()
          awaitingAcknowledgement = true
          service?.reset()
          applyPause()
          emit("NaviVoiceWake")
          return
        }
        mode = Mode.PROCESSING
        clearTimeout()
        applyPause()
        emit("NaviVoiceCommand", text)
      }
      else -> Unit
    }
  }

  override fun onResult(hypothesis: String) = accept(hypothesis)
  override fun onFinalResult(hypothesis: String) = accept(hypothesis)
  override fun onPartialResult(hypothesis: String) = Unit
  override fun onTimeout() {
    if (mode == Mode.COMMAND) emit("NaviVoiceTimeout", "I did not hear a command")
  }
  override fun onError(error: Exception) {
    emit("NaviVoiceError", error.message ?: "Offline speech recognition failed")
    service?.cancel(); service?.shutdown(); service = null
    recognizer?.close(); recognizer = null
    if (wanted && model != null && restartCount++ < 2) {
      main.postDelayed({
        if (wanted && ContextCompat.checkSelfPermission(context, Manifest.permission.RECORD_AUDIO) ==
          PackageManager.PERMISSION_GRANTED) {
          try { openService(); emit("NaviVoiceReady") }
          catch (failure: Exception) { emit("NaviVoiceError", failure.message ?: "Microphone recovery failed") }
        }
      }, 1000L * restartCount)
    }
  }
}
