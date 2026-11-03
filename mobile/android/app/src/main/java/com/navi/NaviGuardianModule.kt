package com.navi

import android.Manifest
import android.app.Activity
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.PackageManager
import android.hardware.Sensor
import android.hardware.SensorEvent
import android.hardware.SensorEventListener
import android.hardware.SensorManager
import android.location.Location
import android.net.Uri
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.os.VibrationEffect
import android.os.Vibrator
import android.telephony.SmsManager
import android.telephony.SubscriptionManager
import androidx.core.content.ContextCompat
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.LifecycleEventListener
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.modules.core.DeviceEventManagerModule
import com.facebook.react.common.LifecycleState
import com.google.android.gms.location.LocationServices
import com.google.android.gms.location.Priority
import com.google.android.gms.tasks.CancellationTokenSource
import org.json.JSONArray
import org.json.JSONObject
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import kotlin.math.abs
import kotlin.math.sqrt

/** Foreground-only SOS. No message leaves the phone before the user-configured countdown ends. */
class NaviGuardianModule(private val reactContext: ReactApplicationContext) :
  ReactContextBaseJavaModule(reactContext), LifecycleEventListener, SensorEventListener {
  override fun getName() = "NaviGuardian"
  private val main = Handler(Looper.getMainLooper())
  private val prefs = reactContext.getSharedPreferences("navi_guardian", Context.MODE_PRIVATE)
  private val sensors = reactContext.getSystemService(Context.SENSOR_SERVICE) as SensorManager
  private val accelerometer = sensors.getDefaultSensor(Sensor.TYPE_ACCELEROMETER)
  private val vibrator = reactContext.getSystemService(Context.VIBRATOR_SERVICE) as Vibrator
  private var foreground = false
  private var sensorRegistered = false
  private var phase = "IDLE"
  private var detail = ""
  private var deadline = 0L
  private var countdownTask: Runnable? = null
  private var cooldownUntil = 0L
  private var lastPeak = 0L
  private var firstPeak = 0L
  private var peaks = 0
  private var aboveThreshold = false
  private val gravity = FloatArray(3)
  private var sentParts = 0
  private var deliveredParts = 0
  private var totalParts = 0
  private var attemptId = ""
  private var lastEmittedRemaining = -1
  private val sentAction = "com.navi.GUARDIAN_SENT"
  private val deliveredAction = "com.navi.GUARDIAN_DELIVERED"

  private val smsReceiver = object : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
      if (intent.getStringExtra("attempt") != attemptId || phase !in setOf("REQUESTED", "SENT")) return
      if (intent.action == sentAction) {
        if (resultCode != Activity.RESULT_OK) {
          update("FAILED", "Cellular SMS send failed (code $resultCode). Delivery is not confirmed.")
        } else {
          sentParts++
          if (sentParts == totalParts) update("SENT", "SMS sent by the phone. Delivery is not yet confirmed.")
        }
      } else if (intent.action == deliveredAction && resultCode == Activity.RESULT_OK) {
        deliveredParts++
        if (deliveredParts == totalParts && sentParts == totalParts)
          update("DELIVERED", "The mobile network reported SMS delivery.")
      }
    }
  }

  init {
    reactContext.addLifecycleEventListener(this)
    val filter = IntentFilter().apply { addAction(sentAction); addAction(deliveredAction) }
    ContextCompat.registerReceiver(reactContext, smsReceiver, filter, ContextCompat.RECEIVER_NOT_EXPORTED)
    phase = prefs.getString("phase", "IDLE") ?: "IDLE"
    detail = prefs.getString("detail", "") ?: ""
    if (phase == "COUNTDOWN" || phase == "LOCATING") {
      phase = "CANCELLED"
      detail = "An interrupted SOS countdown was cancelled; no message was sent."
    } else if (phase == "REQUESTED") {
      phase = "UNCERTAIN"
      detail = "The app restarted before SMS status was confirmed. Check your messaging app."
    }
    prefs.edit().putString("phase", phase).putString("detail", detail).apply()
    // Native modules can be constructed after MainActivity has already resumed. In that
    // case onHostResume is not replayed, so seed the foreground state from React Native.
    foreground = reactContext.lifecycleState == LifecycleState.RESUMED
    main.post { refreshSensor() }
  }

  private fun contactName() = prefs.getString("name", "") ?: ""
  private fun phone() = prefs.getString("phone", "") ?: ""
  private fun enabled() = prefs.getBoolean("enabled", false)
  private fun sensitivity() = prefs.getString("sensitivity", "normal") ?: "normal"
  private fun seconds() = prefs.getInt("seconds", 10)

  private fun snapshot() = Arguments.createMap().apply {
    putString("name", contactName()); putString("phone", phone())
    putBoolean("enabled", enabled()); putString("sensitivity", sensitivity())
    putInt("seconds", seconds()); putString("phase", phase); putString("detail", detail)
    putInt("remaining", if (phase == "COUNTDOWN")
      ((deadline - SystemClock.elapsedRealtime() + 999) / 1000).toInt().coerceAtLeast(0) else 0)
    putBoolean("accelerometerAvailable", accelerometer != null)
    putBoolean("monitoring", sensorRegistered)
    putBoolean("smsPermission", ContextCompat.checkSelfPermission(reactContext, Manifest.permission.SEND_SMS) == PackageManager.PERMISSION_GRANTED)
    val history = Arguments.createArray()
    val entries = JSONArray(prefs.getString("history", "[]"))
    for (index in entries.length() - 1 downTo 0) {
      val entry = entries.optJSONObject(index) ?: continue
      history.pushMap(Arguments.createMap().apply {
        putString("status", entry.optString("status"))
        putString("detail", entry.optString("detail"))
        putDouble("timestamp", entry.optLong("timestamp").toDouble())
      })
    }
    putArray("history", history)
  }

  private fun emit() {
    if (reactContext.hasActiveReactInstance())
      reactContext.getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
        .emit("NaviGuardianState", snapshot())
  }

  private fun update(next: String, message: String) {
    phase = next; detail = message
    prefs.edit().putString("phase", phase).putString("detail", detail).apply()
    if (attemptId.isNotBlank() && next in setOf("REQUESTED", "SENT", "DELIVERED", "FAILED", "COMPOSER", "UNCERTAIN", "CANCELLED")) {
      val entries = JSONArray(prefs.getString("history", "[]"))
      var found = false
      for (index in 0 until entries.length()) {
        val entry = entries.optJSONObject(index) ?: continue
        if (entry.optString("id") == attemptId) {
          entry.put("status", next); entry.put("detail", message); found = true; break
        }
      }
      if (!found) entries.put(JSONObject().put("id", attemptId).put("timestamp", System.currentTimeMillis())
        .put("status", next).put("detail", message))
      val recent = JSONArray()
      for (index in (entries.length() - 5).coerceAtLeast(0) until entries.length())
        recent.put(entries.get(index))
      prefs.edit().putString("history", recent.toString()).apply()
    }
    emit()
  }

  @ReactMethod fun getState(promise: Promise) { main.post { promise.resolve(snapshot()) } }

  @ReactMethod fun saveSettings(name: String, number: String, confirmation: String,
    useShake: Boolean, level: String, countdown: Int, promise: Promise) {
    main.post {
      val cleaned = number.replace(Regex("[\\s()-]"), "")
      val again = confirmation.replace(Regex("[\\s()-]"), "")
      if (name.trim().length !in 1..60 || !cleaned.matches(Regex("\\+?[0-9]{7,15}")) || cleaned != again) {
        promise.reject("GUARDIAN_CONTACT_INVALID", "Enter a name and matching valid phone numbers")
        return@post
      }
      if (level !in setOf("high", "normal", "low") || countdown !in 5..30) {
        promise.reject("GUARDIAN_SETTINGS_INVALID", "Choose a valid sensitivity and a 5–30 second countdown")
        return@post
      }
      prefs.edit().putString("name", name.trim()).putString("phone", cleaned)
        .putBoolean("enabled", useShake).putString("sensitivity", level)
        .putInt("seconds", countdown).apply()
      refreshSensor()
      promise.resolve(snapshot()); emit()
    }
  }

  private fun refreshSensor() {
    if (sensorRegistered) { sensors.unregisterListener(this); sensorRegistered = false }
    if (foreground && enabled() && accelerometer != null && phase != "COUNTDOWN") {
      sensorRegistered = sensors.registerListener(this, accelerometer, 40_000)
      resetPattern()
    }
    emit()
  }

  private fun resetPattern() { peaks = 0; aboveThreshold = false; firstPeak = 0L; lastPeak = 0L }

  override fun onSensorChanged(event: SensorEvent) {
    if (event.sensor.type != Sensor.TYPE_ACCELEROMETER || !foreground || !enabled() ||
      phase == "COUNTDOWN" || SystemClock.elapsedRealtime() < cooldownUntil) return
    val linear = FloatArray(3)
    for (axis in 0..2) {
      gravity[axis] = 0.8f * gravity[axis] + 0.2f * event.values[axis]
      linear[axis] = event.values[axis] - gravity[axis]
    }
    val strength = sqrt(linear.sumOf { (it * it).toDouble() })
    val threshold = when (sensitivity()) { "high" -> 8.5; "low" -> 14.0; else -> 11.0 }
    if (strength < threshold * 0.55) { aboveThreshold = false; return }
    if (aboveThreshold || strength < threshold) return
    aboveThreshold = true
    val now = SystemClock.elapsedRealtime()
    // Require three separate strong movements. The below-threshold reset prevents one
    // impact from being counted repeatedly, while the timing rejects ordinary walking.
    if (peaks > 0 && (now - lastPeak < 160 || now - lastPeak > 1100)) peaks = 0
    if (now - firstPeak > 2500) peaks = 0
    if (peaks == 0) firstPeak = now
    peaks++; lastPeak = now
    if (peaks >= 3) { resetPattern(); startCountdown() }
  }
  override fun onAccuracyChanged(sensor: Sensor?, accuracy: Int) = Unit

  @ReactMethod fun startSOS(promise: Promise) { main.post {
    if (startCountdown()) promise.resolve(snapshot())
    else promise.reject("GUARDIAN_UNAVAILABLE", detail)
  } }

  private fun startCountdown(): Boolean {
    if (!foreground || phone().isBlank() || contactName().isBlank()) {
      detail = if (!foreground) "Open NAVI to start SOS" else "Set and confirm an emergency contact first"
      emit(); return false
    }
    if (phase == "COUNTDOWN" || SystemClock.elapsedRealtime() < cooldownUntil) return false
    attemptId = System.currentTimeMillis().toString()
    deadline = SystemClock.elapsedRealtime() + seconds() * 1000L
    lastEmittedRemaining = -1
    phase = "COUNTDOWN"; detail = "Emergency SOS countdown started. Cancel before sending."
    if (sensorRegistered) { sensors.unregisterListener(this); sensorRegistered = false }
    if (Build.VERSION.SDK_INT >= 26) vibrator.vibrate(VibrationEffect.createWaveform(
      longArrayOf(0, 280, 130, 280, 130, 600), -1))
    update("COUNTDOWN", detail)
    tick()
    return true
  }

  private fun tick() {
    countdownTask?.let(main::removeCallbacks)
    if (phase != "COUNTDOWN") return
    if (SystemClock.elapsedRealtime() >= deadline) { sendSOS(); return }
    val remaining = ((deadline - SystemClock.elapsedRealtime() + 999) / 1000).toInt().coerceAtLeast(0)
    if (remaining != lastEmittedRemaining) { lastEmittedRemaining = remaining; emit() }
    val task = Runnable { tick() }
    countdownTask = task
    main.postDelayed(task, 250)
  }

  @ReactMethod fun cancelSOS(promise: Promise) { main.post {
    if (phase != "COUNTDOWN") { promise.reject("GUARDIAN_NOT_PENDING", "No SOS countdown to cancel"); return@post }
    cancelPending("SOS cancelled before any message was sent")
    promise.resolve(snapshot())
  } }

  private fun cancelPending(reason: String) {
    countdownTask?.let(main::removeCallbacks); countdownTask = null
    cooldownUntil = SystemClock.elapsedRealtime() + 30_000
    update("CANCELLED", reason)
    attemptId = ""
    refreshSensor()
  }

  private fun sendSOS() {
    countdownTask?.let(main::removeCallbacks); countdownTask = null
    cooldownUntil = SystemClock.elapsedRealtime() + 60_000
    update("LOCATING", "Checking for a recent location before SMS")
    val client = LocationServices.getFusedLocationProviderClient(reactContext)
    if (ContextCompat.checkSelfPermission(reactContext, Manifest.permission.ACCESS_FINE_LOCATION) != PackageManager.PERMISSION_GRANTED) {
      sendWithLocation(null); return
    }
    var fallback: Location? = null
    var resolved = false
    val token = CancellationTokenSource()
    val timeout = Runnable {
      if (!resolved) { resolved = true; token.cancel(); sendWithLocation(fallback) }
    }
    main.postDelayed(timeout, 4500)
    client.lastLocation.addOnSuccessListener { last ->
      if (resolved) return@addOnSuccessListener
      if (last != null && System.currentTimeMillis() - last.time < 10 * 60_000 && last.accuracy <= 100)
        fallback = last
      client.getCurrentLocation(Priority.PRIORITY_HIGH_ACCURACY, token.token)
        .addOnCompleteListener { task ->
          if (!resolved) {
            resolved = true; main.removeCallbacks(timeout)
            val fresh = if (task.isSuccessful) task.result else null
            sendWithLocation(fresh?.takeIf { it.accuracy <= 100 } ?: fallback)
          }
        }
    }.addOnFailureListener { if (!resolved) { resolved = true; main.removeCallbacks(timeout); sendWithLocation(null) } }
  }

  private fun message(location: Location?, test: Boolean = false): String {
    val intro = if (test) "NAVI TEST MESSAGE: This is a user-confirmed test, not an emergency."
      else "NAVI SOS ALERT: I may need assistance. This emergency alert was triggered from my phone."
    val place = if (location == null) "Location unavailable."
      else {
        val lat = "%.6f".format(Locale.US, location.latitude)
        val lon = "%.6f".format(Locale.US, location.longitude)
        val date = SimpleDateFormat("yyyy-MM-dd HH:mm z", Locale.US).format(Date(location.time))
        "Last known location: $lat, $lon (±${location.accuracy.toInt()} m, $date).\nMap: https://maps.google.com/?q=$lat,$lon"
      }
    return "$intro\n\n$place\n\nPlease contact me or check on my safety."
  }

  private fun sendWithLocation(location: Location?) {
    if (!foreground) { update("CANCELLED", "SOS cancelled when NAVI left the foreground before sending"); return }
    val body = message(location)
    if (ContextCompat.checkSelfPermission(reactContext, Manifest.permission.SEND_SMS) != PackageManager.PERMISSION_GRANTED) {
      openComposer(body, "Automatic SMS permission unavailable; confirm Send in your messaging app")
      return
    }
    val sub = try { SmsManager.getDefaultSmsSubscriptionId() }
      catch (_: Exception) { SubscriptionManager.INVALID_SUBSCRIPTION_ID }
    if (sub == SubscriptionManager.INVALID_SUBSCRIPTION_ID) {
      openComposer(body, "No single default SMS SIM. Choose the SIM and confirm Send in your messaging app")
      return
    }
    try {
      @Suppress("DEPRECATION") val sms = SmsManager.getSmsManagerForSubscriptionId(sub)
      val parts = sms.divideMessage(body)
      totalParts = parts.size; sentParts = 0; deliveredParts = 0
      val sent = ArrayList<PendingIntent>(); val delivered = ArrayList<PendingIntent>()
      for (index in parts.indices) {
        val request = (System.currentTimeMillis() % 100_000).toInt() * 10 + index * 2
        fun callback(action: String, code: Int) = PendingIntent.getBroadcast(reactContext, code,
          Intent(action).setPackage(reactContext.packageName).putExtra("attempt", attemptId),
          PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
        sent.add(callback(sentAction, request)); delivered.add(callback(deliveredAction, request + 1))
      }
      update("REQUESTED", "SMS send requested. Waiting for the phone network result.")
      sms.sendMultipartTextMessage(phone(), null, parts, sent, delivered)
    } catch (error: Exception) {
      openComposer(body, "Automatic SMS failed: ${error.message ?: "unknown error"}. Confirm Send in your messaging app")
    }
  }

  private fun openComposer(body: String, reason: String) {
    try {
      val activity = reactContext.currentActivity ?: throw IllegalStateException("NAVI is not in the foreground")
      val intent = Intent(Intent.ACTION_SENDTO, Uri.parse("smsto:${phone()}"))
        .putExtra("sms_body", body)
      activity.startActivity(intent)
      update("COMPOSER", reason + ". Delivery is not confirmed.")
    } catch (error: Exception) { update("FAILED", reason + ". SMS composer unavailable: ${error.message}") }
  }

  @ReactMethod fun openTestComposer(promise: Promise) { main.post {
    if (phone().isBlank()) { promise.reject("GUARDIAN_NO_CONTACT", "Save a confirmed contact first"); return@post }
    try {
      val activity = reactContext.currentActivity ?: throw IllegalStateException("NAVI is not in the foreground")
      activity.startActivity(Intent(Intent.ACTION_SENDTO, Uri.parse("smsto:${phone()}"))
        .putExtra("sms_body", message(null, true)))
      promise.resolve("Test draft opened. You must tap Send yourself.")
    } catch (error: Exception) { promise.reject("GUARDIAN_TEST_UNAVAILABLE", error) }
  } }

  override fun onHostResume() { foreground = true; refreshSensor() }
  override fun onHostPause() {
    foreground = false
    if (phase == "COUNTDOWN") cancelPending("SOS cancelled because NAVI left the foreground; no message was sent")
    else if (phase == "LOCATING") update("CANCELLED", "SOS cancelled when NAVI left the foreground before sending")
    refreshSensor()
  }
  override fun onHostDestroy() = onHostPause()
  @ReactMethod fun addListener(eventName: String) = Unit
  @ReactMethod fun removeListeners(count: Int) = Unit
  override fun invalidate() {
    countdownTask?.let(main::removeCallbacks)
    if (sensorRegistered) sensors.unregisterListener(this)
    reactContext.unregisterReceiver(smsReceiver)
    reactContext.removeLifecycleEventListener(this)
    super.invalidate()
  }
}
