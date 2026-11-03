package com.navi

import android.Manifest
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.media.AudioAttributes
import android.media.AudioFocusRequest
import android.media.AudioManager
import android.os.Build
import android.os.Handler
import android.os.Looper
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
  private val voice = NaviOfflineVoice(context)
  private val mainHandler = Handler(Looper.getMainLooper())
  private val audioManager = context.getSystemService(Context.AUDIO_SERVICE) as AudioManager
  private val focusListener = AudioManager.OnAudioFocusChangeListener { }
  private val focusRequest: AudioFocusRequest? = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O)
    AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN_TRANSIENT_MAY_DUCK)
      .setAudioAttributes(AudioAttributes.Builder()
        .setUsage(AudioAttributes.USAGE_ASSISTANCE_ACCESSIBILITY)
        .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH).build())
      .setOnAudioFocusChangeListener(focusListener).build() else null

  @Suppress("DEPRECATION")
  private fun requestSpeechFocus(): Boolean = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O)
    audioManager.requestAudioFocus(focusRequest!!) == AudioManager.AUDIOFOCUS_REQUEST_GRANTED
  else audioManager.requestAudioFocus(focusListener,
    AudioManager.STREAM_MUSIC, AudioManager.AUDIOFOCUS_GAIN_TRANSIENT_MAY_DUCK) ==
    AudioManager.AUDIOFOCUS_REQUEST_GRANTED

  @Suppress("DEPRECATION")
  private fun abandonSpeechFocus() {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) audioManager.abandonAudioFocusRequest(focusRequest!!)
    else audioManager.abandonAudioFocus(focusListener)
  }
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
      override fun onDone(utteranceId: String) {
        synchronized(utterances) { utterances.remove(utteranceId)?.resolve(null) }
        mainHandler.postDelayed({ if (synchronized(utterances) { utterances.isEmpty() }) {
          voice.setSpeechActive(false); abandonSpeechFocus()
        } }, 250)
      }
      @Deprecated("Deprecated in Java")
      override fun onError(utteranceId: String) {
        synchronized(utterances) { utterances.remove(utteranceId)?.reject("TTS_ERROR", "Speech failed") }
        mainHandler.post { voice.setSpeechActive(false); abandonSpeechFocus() }
      }
    })
  }

  @ReactMethod fun speak(text: String, promise: Promise) {
    if (!ttsReady) { promise.reject("TTS_UNAVAILABLE", "Text-to-speech is unavailable"); return }
    if (!requestSpeechFocus()) { promise.reject("AUDIO_FOCUS_DENIED", "Speech audio is unavailable"); return }
    val id = System.nanoTime().toString()
    synchronized(utterances) { utterances[id] = promise }
    voice.setSpeechActive(true)
    if (tts.speak(text, TextToSpeech.QUEUE_ADD, null, id) == TextToSpeech.ERROR) {
      synchronized(utterances) { utterances.remove(id)?.reject("TTS_ERROR", "Speech failed to start") }
      voice.setSpeechActive(false)
      abandonSpeechFocus()
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
    voice.setSpeechActive(false)
    abandonSpeechFocus()
    synchronized(utterances) {
      utterances.values.forEach { it.reject("TTS_STOPPED", "Speech stopped") }
      utterances.clear()
    }
    promise.resolve(null)
  }

  @ReactMethod fun startVoiceAgent(promise: Promise) { mainHandler.post { voice.start(promise) } }
  @ReactMethod fun stopVoiceAgent(promise: Promise) { mainHandler.post { voice.stop(promise) } }
  @ReactMethod fun beginVoiceCommand(promise: Promise) { mainHandler.post { voice.beginCommand(promise) } }
  @ReactMethod fun resumeVoiceCommand(promise: Promise) { mainHandler.post { voice.resumeCommand(promise) } }
  @ReactMethod fun finishVoiceCommand(promise: Promise) { mainHandler.post { voice.finishCommand(promise) } }

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
    voice.stop(); ocrController.close(); tts.shutdown(); super.invalidate()
  }
}
