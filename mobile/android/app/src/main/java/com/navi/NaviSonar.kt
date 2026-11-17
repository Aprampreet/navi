package com.navi

import android.content.Context
import android.media.AudioAttributes
import android.media.AudioFormat
import android.media.AudioRecord
import android.media.AudioTrack
import android.media.MediaRecorder
import android.os.Process
import android.os.SystemClock
import android.util.Log
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import kotlin.math.PI
import kotlin.math.abs
import kotlin.math.cos
import kotlin.math.max
import kotlin.math.min
import kotlin.math.sin
import kotlin.math.sqrt

data class AcousticMeasurement(
  val distanceMeters: Double?,
  val distanceReliable: Boolean,
  val reflectionStrength: String,
  val responseRatio: Double,
  val confidence: Double,
  val readings: Int,
  val latencyMs: Long,
  val spreadMeters: Double,
)

/**
 * Experimental monostatic acoustic ranging using only the phone speaker and
 * microphone. It measures a reflected chirp, not the identity of an object.
 */
class NaviSonar(private val context: Context) {
  private data class Ping(val distance: Double?, val confidence: Double, val responseRatio: Double)

  fun measure(): AcousticMeasurement {
    val started = SystemClock.elapsedRealtime()
    val attempts = mutableListOf<Ping>()
    repeat(PING_COUNT) {
      attempts += ping()
      if (it < PING_COUNT - 1) Thread.sleep(PING_GAP_MS)
    }
    val responseRatio = attempts.map { it.responseRatio }.sorted()[attempts.size / 2]
    val reflectionStrength = when {
      responseRatio >= STRONG_RESPONSE_RATIO -> "strong"
      responseRatio >= MODERATE_RESPONSE_RATIO -> "moderate"
      else -> "weak"
    }
    val readings = attempts.filter { it.distance != null }
    if (readings.size < MIN_CONSISTENT_READINGS) return AcousticMeasurement(
      null, false, reflectionStrength, responseRatio, 0.0, attempts.size,
      SystemClock.elapsedRealtime() - started, 0.0)

    val median = readings.map { it.distance!! }.sorted()[readings.size / 2]
    val consistent = readings.filter { abs(it.distance!! - median) <= CONSISTENCY_METERS }
    if (consistent.size < MIN_CONSISTENT_READINGS) return AcousticMeasurement(
      null, false, reflectionStrength, responseRatio, 0.0, attempts.size,
      SystemClock.elapsedRealtime() - started, 0.0)
    val distance = consistent.map { it.distance!! }.sorted()[consistent.size / 2]
    val spread = consistent.maxOf { it.distance!! } - consistent.minOf { it.distance!! }
    val confidence = (consistent.map { it.confidence }.average() *
      (1.0 - spread / (CONSISTENCY_METERS * 2.0)).coerceIn(0.35, 1.0) *
      (consistent.size.toDouble() / PING_COUNT)).coerceIn(0.0, 1.0)
    if (confidence < MIN_RESULT_CONFIDENCE) return AcousticMeasurement(
      null, false, reflectionStrength, responseRatio, confidence, attempts.size,
      SystemClock.elapsedRealtime() - started, spread)
    Log.i("NAVI_SONAR", "accepted distance=${distance} confidence=${confidence} " +
      "readings=${consistent.map { it.distance }} spread=${spread}")
    return AcousticMeasurement(distance, true, reflectionStrength, responseRatio,
      confidence, consistent.size, SystemClock.elapsedRealtime() - started, spread)
  }

  private fun ping(): Ping {
    val chirp = createChirp()
    val captured = ShortArray(CAPTURE_SAMPLES)
    // Motorola's advertised UNPROCESSED source heavily attenuates the phone's
    // own chirp. The standard MIC path retains enough acoustic information for
    // this supervised experiment and is available on every supported device.
    val source = MediaRecorder.AudioSource.MIC
    val minimum = AudioRecord.getMinBufferSize(SAMPLE_RATE,
      AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT)
    if (minimum <= 0) throw IllegalStateException("This phone does not expose a compatible microphone format")
    val recorder = AudioRecord.Builder()
      .setAudioSource(source)
      .setAudioFormat(AudioFormat.Builder().setEncoding(AudioFormat.ENCODING_PCM_16BIT)
        .setSampleRate(SAMPLE_RATE).setChannelMask(AudioFormat.CHANNEL_IN_MONO).build())
      .setBufferSizeInBytes(max(minimum * 2, CAPTURE_SAMPLES * 2)).build()
    if (recorder.state != AudioRecord.STATE_INITIALIZED) {
      recorder.release()
      throw IllegalStateException("The microphone could not start acoustic ranging")
    }
    val outputMinimum = AudioTrack.getMinBufferSize(SAMPLE_RATE,
      AudioFormat.CHANNEL_OUT_MONO, AudioFormat.ENCODING_PCM_16BIT)
    if (outputMinimum <= 0) {
      recorder.release()
      throw IllegalStateException("This phone does not expose a compatible speaker format")
    }
    val track = AudioTrack.Builder()
      .setAudioAttributes(AudioAttributes.Builder()
        .setUsage(AudioAttributes.USAGE_ASSISTANCE_ACCESSIBILITY)
        .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION).build())
      .setAudioFormat(AudioFormat.Builder().setEncoding(AudioFormat.ENCODING_PCM_16BIT)
        .setSampleRate(SAMPLE_RATE).setChannelMask(AudioFormat.CHANNEL_OUT_MONO).build())
      // Streaming mode is more widely supported than a short static track on
      // Motorola/Qualcomm audio HALs. The chirp is still fully prepared before
      // playback, so this does not introduce a network or runtime dependency.
      .setTransferMode(AudioTrack.MODE_STREAM)
      .setBufferSizeInBytes(outputMinimum)
      .build()
    if (track.state != AudioTrack.STATE_INITIALIZED) {
      Log.e("NAVI_SONAR", "AudioTrack initialization failed; sampleRate=$SAMPLE_RATE " +
        "chirpBytes=${chirp.size * 2} minBytes=$outputMinimum")
      recorder.release(); track.release()
      throw IllegalStateException("The speaker could not start acoustic ranging")
    }
    track.setVolume(CHIRP_VOLUME)
    if (track.write(chirp, 0, chirp.size, AudioTrack.WRITE_BLOCKING) != chirp.size) {
      recorder.release(); track.release()
      throw IllegalStateException("The acoustic test signal could not be prepared")
    }

    val completed = CountDownLatch(1)
    var recorded = 0
    var readError: String? = null
    val reader = Thread({
      Process.setThreadPriority(Process.THREAD_PRIORITY_URGENT_AUDIO)
      try {
        while (recorded < captured.size) {
          val count = recorder.read(captured, recorded, captured.size - recorded,
            AudioRecord.READ_BLOCKING)
          if (count <= 0) {
            readError = "Microphone capture failed with code $count"
            break
          }
          recorded += count
        }
      } catch (error: Exception) {
        readError = error.message ?: "Microphone capture failed"
      } finally { completed.countDown() }
    }, "NAVI-sonar-capture")

    try {
      recorder.startRecording()
      reader.start()
      Thread.sleep(PRE_ROLL_MS)
      track.play()
      if (!completed.await(CAPTURE_TIMEOUT_MS, TimeUnit.MILLISECONDS))
        throw IllegalStateException("Acoustic capture timed out")
      readError?.let { throw IllegalStateException(it) }
      if (recorded < captured.size * 0.9) throw IllegalStateException("Acoustic capture was incomplete")
    } finally {
      try { if (recorder.recordingState == AudioRecord.RECORDSTATE_RECORDING) recorder.stop() } catch (_: Exception) { }
      try { if (track.playState == AudioTrack.PLAYSTATE_PLAYING) track.stop() } catch (_: Exception) { }
      recorder.release()
      track.release()
    }
    return analyze(captured, chirp)
  }

  private fun analyze(captured: ShortArray, chirp: ShortArray): Ping {
    val signal = FloatArray(captured.size) { captured[it] / 32768f }
    val reference = FloatArray(chirp.size) { chirp[it] / 32768f }
    val referenceEnergy = reference.sumOf { (it * it).toDouble() }
    val start = max(0, ((PRE_ROLL_MS - DIRECT_SEARCH_MARGIN_MS) * SAMPLE_RATE / 1000).toInt())
    val end = min(signal.size - reference.size,
      ((PRE_ROLL_MS + DIRECT_SEARCH_MARGIN_MS) * SAMPLE_RATE / 1000).toInt())
    val baselineEnd = min(signal.size, (PRE_ROLL_MS * SAMPLE_RATE / 2000).toInt())
    val baselineRms = rms(signal, 0, baselineEnd)
    val responseWindow = max(64, (RESPONSE_WINDOW_MS * SAMPLE_RATE / 1000).toInt())
    var peakRms = 0.0
    for (offset in start..max(start, end - responseWindow) step responseWindow / 4) {
      peakRms = max(peakRms, rms(signal, offset, min(signal.size, offset + responseWindow)))
    }
    val responseRatio = (peakRms / max(baselineRms, 1e-6)).coerceIn(0.0, 99.0)
    var directIndex = -1
    var directScore = 0.0
    for (offset in start..end step CORRELATION_STEP) {
      val score = correlation(signal, reference, referenceEnergy, offset)
      if (score > directScore) { directScore = score; directIndex = offset }
    }
    if (directIndex < 0 || directScore < MIN_DIRECT_SCORE)
      Log.i("NAVI_SONAR", "rejected direct score=$directScore index=$directIndex " +
        "window=$start..$end")
    if (directIndex < 0 || directScore < MIN_DIRECT_SCORE)
      return Ping(null, 0.0, responseRatio)

    // Refine the direct-path peak at full sample resolution.
    val coarse = directIndex
    for (offset in max(start, coarse - CORRELATION_STEP)..min(end, coarse + CORRELATION_STEP)) {
      val score = correlation(signal, reference, referenceEnergy, offset)
      if (score > directScore) { directScore = score; directIndex = offset }
    }

    val minimumDelay = (MIN_DISTANCE_METERS * 2 * SAMPLE_RATE / SPEED_OF_SOUND).toInt()
    val maximumDelay = (MAX_DISTANCE_METERS * 2 * SAMPLE_RATE / SPEED_OF_SOUND).toInt()
    var echoDelay = -1
    var echoScore = 0.0
    val echoEnd = min(signal.size - reference.size, directIndex + maximumDelay)
    for (offset in directIndex + minimumDelay..echoEnd step CORRELATION_STEP) {
      val score = correlation(signal, reference, referenceEnergy, offset)
      if (score > echoScore) { echoScore = score; echoDelay = offset - directIndex }
    }
    Log.i("NAVI_SONAR", "candidate direct=$directScore directIndex=$directIndex " +
      "echo=$echoScore delay=$echoDelay ratio=${echoScore / max(directScore, 1e-9)}")
    if (echoDelay < 0 || echoScore < MIN_ECHO_SCORE ||
      echoScore / directScore < MIN_ECHO_TO_DIRECT_RATIO)
      return Ping(null, 0.0, responseRatio)

    val coarseEcho = directIndex + echoDelay
    for (offset in max(directIndex + minimumDelay, coarseEcho - CORRELATION_STEP)..
      min(echoEnd, coarseEcho + CORRELATION_STEP)) {
      val score = correlation(signal, reference, referenceEnergy, offset)
      if (score > echoScore) { echoScore = score; echoDelay = offset - directIndex }
    }
    val distance = echoDelay.toDouble() * SPEED_OF_SOUND / (2.0 * SAMPLE_RATE)
    val ratio = echoScore / max(directScore, 1e-9)
    val confidence = ((echoScore - MIN_ECHO_SCORE) / 0.30 * 0.55 +
      (ratio - MIN_ECHO_TO_DIRECT_RATIO) / 0.30 * 0.45).coerceIn(0.0, 1.0)
    Log.i("NAVI_SONAR", "ping direct=${directScore} echo=${echoScore} ratio=${ratio} " +
      "distance=${distance} confidence=${confidence} sourceSamples=${captured.size}")
    return Ping(distance, confidence, responseRatio)
  }

  private fun rms(signal: FloatArray, start: Int, end: Int): Double {
    if (end <= start) return 0.0
    var energy = 0.0
    for (index in start until end) energy += signal[index] * signal[index]
    return sqrt(energy / (end - start))
  }

  private fun correlation(signal: FloatArray, reference: FloatArray,
    referenceEnergy: Double, offset: Int): Double {
    var dot = 0.0
    var energy = 0.0
    for (index in reference.indices) {
      val value = signal[offset + index]
      dot += value * reference[index]
      energy += value * value
    }
    if (energy < 1e-8) return 0.0
    return abs(dot) / sqrt(referenceEnergy * energy)
  }

  private fun createChirp(): ShortArray {
    val samples = (CHIRP_MS * SAMPLE_RATE / 1000).toInt()
    val output = ShortArray(samples)
    var phase = 0.0
    for (index in 0 until samples) {
      val progress = index.toDouble() / max(1, samples - 1)
      val frequency = START_FREQUENCY + (END_FREQUENCY - START_FREQUENCY) * progress
      phase += 2.0 * PI * frequency / SAMPLE_RATE
      val window = 0.5 - 0.5 * cos(2.0 * PI * progress)
      output[index] = (sin(phase) * window * Short.MAX_VALUE * 0.82).toInt()
        .coerceIn(Short.MIN_VALUE.toInt(), Short.MAX_VALUE.toInt()).toShort()
    }
    return output
  }

  private class NoEchoException(message: String) : Exception(message)

  companion object {
    private const val SAMPLE_RATE = 48000
    // A short audible band is intentional: the edge 30 filters near-ultrasonic
    // playback from microphone capture. This is a user-triggered experiment,
    // not an inaudible continuous sensor.
    private const val CHIRP_MS = 30
    private const val START_FREQUENCY = 5000.0
    private const val END_FREQUENCY = 11000.0
    private const val CHIRP_VOLUME = 0.68f
    private const val PRE_ROLL_MS = 70L
    private const val DIRECT_SEARCH_MARGIN_MS = 45L
    private const val CAPTURE_MS = 180
    private const val CAPTURE_SAMPLES = SAMPLE_RATE * CAPTURE_MS / 1000
    private const val CAPTURE_TIMEOUT_MS = 900L
    private const val PING_COUNT = 3
    private const val PING_GAP_MS = 70L
    private const val MIN_CONSISTENT_READINGS = 2
    private const val SPEED_OF_SOUND = 343.0
    private const val MIN_DISTANCE_METERS = 0.45
    private const val MAX_DISTANCE_METERS = 4.0
    private const val CONSISTENCY_METERS = 0.35
    private const val MIN_DIRECT_SCORE = 0.16
    private const val MIN_ECHO_SCORE = 0.055
    private const val MIN_ECHO_TO_DIRECT_RATIO = 0.045
    private const val MIN_RESULT_CONFIDENCE = 0.18
    private const val CORRELATION_STEP = 4
    private const val RESPONSE_WINDOW_MS = 8
    private const val MODERATE_RESPONSE_RATIO = 1.8
    private const val STRONG_RESPONSE_RATIO = 3.5
  }
}
