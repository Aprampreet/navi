package com.navi

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Bundle
import android.speech.RecognitionListener
import android.speech.RecognizerIntent
import android.speech.SpeechRecognizer
import android.speech.tts.TextToSpeech
import android.speech.tts.UtteranceProgressListener
import android.speech.tts.Voice
import androidx.core.content.ContextCompat
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.modules.core.DeviceEventManagerModule
import com.google.android.gms.location.LocationServices
import com.google.android.gms.location.Priority
import com.google.android.gms.tasks.CancellationTokenSource
import java.util.Locale

class NaviNativeModule(private val context: ReactApplicationContext,
  private val ocrController: NaviOcrController) : ReactContextBaseJavaModule(context) {
  override fun getName() = "NaviNative"
  private var recognizer: SpeechRecognizer? = null
  private var pendingSpeech: Promise? = null
  @Volatile private var ttsReady = false
  @Volatile private var offlineVoice: Voice? = null
  private val tts: TextToSpeech = TextToSpeech(context) { status ->
    ttsReady = status == TextToSpeech.SUCCESS
    if (ttsReady) {
      val language = Locale.getDefault().language
      val selected = tts.voices?.filter { voice ->
        voice.locale.language == language && !voice.isNetworkConnectionRequired &&
          !voice.features.orEmpty().contains(TextToSpeech.Engine.KEY_FEATURE_NOT_INSTALLED)
      }?.sortedWith(compareByDescending<Voice> { it.locale.country == Locale.getDefault().country }
        .thenByDescending { it.quality })?.firstOrNull()
      if (selected != null && tts.setVoice(selected) == TextToSpeech.SUCCESS) offlineVoice = selected
    }
  }
  private val utterances = mutableMapOf<String, Promise>()

  init {
    tts.setOnUtteranceProgressListener(object : UtteranceProgressListener() {
      override fun onStart(utteranceId: String) = Unit
      override fun onDone(utteranceId: String) { synchronized(utterances) { utterances.remove(utteranceId)?.resolve(null) } }
      @Deprecated("Deprecated in Java")
      override fun onError(utteranceId: String) {
        synchronized(utterances) { utterances.remove(utteranceId)?.reject("TTS_ERROR", "Speech failed") }
      }
    })
  }

  @ReactMethod fun speak(text: String, promise: Promise) {
    if (!ttsReady) { promise.reject("TTS_UNAVAILABLE", "Text-to-speech is unavailable"); return }
    val id = System.nanoTime().toString()
    synchronized(utterances) { utterances[id] = promise }
    if (tts.speak(text, TextToSpeech.QUEUE_ADD, null, id) == TextToSpeech.ERROR) {
      synchronized(utterances) { utterances.remove(id)?.reject("TTS_ERROR", "Speech failed to start") }
    }
  }
  @ReactMethod fun getOfflineVoiceStatus(promise: Promise) {
    promise.resolve(com.facebook.react.bridge.Arguments.createMap().apply {
      putBoolean("available", ttsReady && offlineVoice != null)
      putString("voice", offlineVoice?.name)
      putString("language", Locale.getDefault().toLanguageTag())
    })
  }
  @ReactMethod fun speakOffline(text: String, promise: Promise) {
    val voice = offlineVoice
    if (!ttsReady || voice == null) {
      promise.reject("OFFLINE_TTS_UNAVAILABLE", "No installed offline voice for the selected language")
      return
    }
    if (tts.setVoice(voice) != TextToSpeech.SUCCESS) {
      promise.reject("OFFLINE_TTS_UNAVAILABLE", "The installed offline voice could not be selected")
      return
    }
    speak(text, promise)
  }
  @ReactMethod fun readSurroundings(promise: Promise) {
    ocrController.read(promise)
  }
  @ReactMethod fun stopSpeech(promise: Promise) {
    tts.stop()
    synchronized(utterances) {
      utterances.values.forEach { it.reject("TTS_STOPPED", "Speech stopped") }
      utterances.clear()
    }
    promise.resolve(null)
  }

  @ReactMethod fun listen(promise: Promise) {
    if (ContextCompat.checkSelfPermission(context, Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
      promise.reject("MIC_DENIED", "Microphone permission is required"); return
    }
    if (!SpeechRecognizer.isRecognitionAvailable(context)) {
      promise.reject("SPEECH_UNAVAILABLE", "No Android speech recognition service found"); return
    }
    context.currentActivity?.runOnUiThread {
      recognizer?.destroy()
      pendingSpeech?.reject("CANCELLED", "Previous recognition cancelled")
      pendingSpeech = promise
      recognizer = SpeechRecognizer.createSpeechRecognizer(context).apply {
      setRecognitionListener(object : RecognitionListener {
        override fun onReadyForSpeech(params: Bundle?) = Unit
        override fun onBeginningOfSpeech() = Unit
        override fun onRmsChanged(rmsdB: Float) = Unit
        override fun onBufferReceived(buffer: ByteArray?) = Unit
        override fun onEndOfSpeech() = Unit
        override fun onPartialResults(partialResults: Bundle?) = Unit
        override fun onEvent(eventType: Int, params: Bundle?) = Unit
        override fun onError(error: Int) { pendingSpeech?.reject("SPEECH_ERROR", "Recognition error $error"); pendingSpeech = null }
        override fun onResults(results: Bundle?) {
          pendingSpeech?.resolve(results?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)?.firstOrNull() ?: "")
          pendingSpeech = null
        }
      })
      startListening(Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH).apply {
        putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
        putExtra(RecognizerIntent.EXTRA_LANGUAGE, Locale.getDefault().toLanguageTag())
      })
      }
    } ?: promise.reject("NO_ACTIVITY", "App is not active")
  }
  @ReactMethod fun cancelListen(promise: Promise) {
    context.currentActivity?.runOnUiThread { recognizer?.cancel() }
    pendingSpeech?.reject("CANCELLED", "Recognition cancelled"); pendingSpeech = null
    promise.resolve(null)
  }

  @ReactMethod fun getLocation(promise: Promise) {
    if (ContextCompat.checkSelfPermission(context, Manifest.permission.ACCESS_FINE_LOCATION) != PackageManager.PERMISSION_GRANTED) {
      promise.reject("LOCATION_DENIED", "Precise location permission is required"); return
    }
    LocationServices.getFusedLocationProviderClient(context)
      .getCurrentLocation(Priority.PRIORITY_HIGH_ACCURACY, CancellationTokenSource().token)
      .addOnSuccessListener { loc ->
        if (loc == null) promise.reject("NO_FIX", "GPS position unavailable")
        else promise.resolve(com.facebook.react.bridge.Arguments.createMap().apply {
          putDouble("latitude", loc.latitude); putDouble("longitude", loc.longitude)
          putDouble("accuracy", loc.accuracy.toDouble())
        })
      }.addOnFailureListener { promise.reject("LOCATION_ERROR", it) }
  }
  @ReactMethod fun addListener(eventName: String) = Unit
  @ReactMethod fun removeListeners(count: Int) = Unit

  override fun invalidate() {
    recognizer?.destroy(); ocrController.close(); tts.shutdown(); super.invalidate()
  }
}
