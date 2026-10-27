package com.ahududu.app

import android.Manifest
import android.annotation.SuppressLint
import android.content.Context
import android.content.pm.PackageManager
import android.media.AudioAttributes
import android.media.AudioFormat
import android.media.AudioRecord
import android.media.AudioTrack
import android.media.MediaRecorder
import android.util.Base64
import androidx.core.content.ContextCompat
import com.ahududu.common.api.AhududuSocket
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import org.json.JSONObject
import kotlin.math.abs

enum class AudioSessionState {
    IDLE,
    REQUESTING,
    LISTENING,   // Karşı tarafın sesini dinliyoruz
    STREAMING    // Biz sesimizi karşıya iletiyoruz
}

/**
 * Canlı ses bağlantısı / ortam dinleme yöneticisi.
 *
 * Sevgililerin birbirinin sesini/ortamını canlı dinlemesi için tasarlanmıştır.
 * WebSocket üzerinden düşük gecikmeli (PCM 16kHz Mono) ses parçaları aktarır.
 */
class AudioStreamManager(
    private val context: Context,
    private val scope: CoroutineScope,
    private val socket: AhududuSocket,
) {
    private val _sessionState = MutableStateFlow(AudioSessionState.IDLE)
    val sessionState: StateFlow<AudioSessionState> = _sessionState.asStateFlow()

    private val _amplitude = MutableStateFlow(0f)
    val amplitude: StateFlow<Float> = _amplitude.asStateFlow()

    private val _statusText = MutableStateFlow<String?>(null)
    val statusText: StateFlow<String?> = _statusText.asStateFlow()

    private var recordJob: Job? = null
    private var audioTrack: AudioTrack? = null
    private var audioRecord: AudioRecord? = null

    init {
        observeSocketEvents()
    }

    fun hasRecordPermission(): Boolean {
        return ContextCompat.checkSelfPermission(
            context,
            Manifest.permission.RECORD_AUDIO
        ) == PackageManager.PERMISSION_GRANTED
    }

    /** Karşı taraftan canlı ses dinleme isteği gönder. */
    fun requestListen() {
        if (_sessionState.value != AudioSessionState.IDLE) return
        _sessionState.value = AudioSessionState.REQUESTING
        _statusText.value = "Ses bağlantısı kuruluyor…"

        val sent = socket.send(
            JSONObject(mapOf(
                "type" to "audio.listen_request",
                "payload" to emptyMap<String, Any>()
            )).toString()
        )
        if (!sent) {
            _sessionState.value = AudioSessionState.IDLE
            _statusText.value = "Bağlantı kurulamadı (çevrimdışı)."
            return
        }

        // 8 saniye içinde yanıt gelmezse zaman aşımı
        scope.launch {
            delay(8_000)
            if (_sessionState.value == AudioSessionState.REQUESTING) {
                _sessionState.value = AudioSessionState.IDLE
                _statusText.value = "Bağlantı zaman aşımına uğradı."
            }
        }
    }

    /** Dinlemeyi veya akışı sonlandır. */
    fun stop() {
        socket.send(
            JSONObject(mapOf(
                "type" to "audio.listen_stop",
                "payload" to emptyMap<String, Any>()
            )).toString()
        )
        stopInternal()
        _statusText.value = "Ses bağlantısı sonlandırıldı."
    }

    private fun stopInternal() {
        recordJob?.cancel()
        recordJob = null

        runCatching {
            audioRecord?.stop()
            audioRecord?.release()
        }
        audioRecord = null

        runCatching {
            audioTrack?.stop()
            audioTrack?.release()
        }
        audioTrack = null

        _sessionState.value = AudioSessionState.IDLE
        _amplitude.value = 0f
    }

    private fun observeSocketEvents() {
        scope.launch {
            socket.events.collect { event ->
                when (event.type) {
                    "audio.listen_request" -> handleIncomingRequest()
                    "audio.chunk" -> handleIncomingChunk(event.payloadJson)
                    "audio.listen_stop" -> {
                        stopInternal()
                        _statusText.value = "Karşı taraf bağlantıyı kapattı."
                    }
                }
            }
        }
    }

    @SuppressLint("MissingPermission")
    private fun handleIncomingRequest() {
        if (!hasRecordPermission()) {
            _statusText.value = "Ses dinleme isteği geldi fakat mikrofon izni verilmemiş."
            return
        }
        if (_sessionState.value == AudioSessionState.STREAMING) return

        stopInternal()
        _sessionState.value = AudioSessionState.STREAMING
        _statusText.value = "Canlı ses paylaşılıyor…"

        startRecordingAndStreaming()
    }

    @SuppressLint("MissingPermission")
    private fun startRecordingAndStreaming() {
        recordJob?.cancel()
        recordJob = scope.launch(Dispatchers.IO) {
            val sampleRate = 16000
            val channelConfig = AudioFormat.CHANNEL_IN_MONO
            val audioFormat = AudioFormat.ENCODING_PCM_16BIT
            val minBufSize = AudioRecord.getMinBufferSize(sampleRate, channelConfig, audioFormat)
            val bufferSize = (minBufSize * 2).coerceAtLeast(1280)

            val record = try {
                AudioRecord(
                    MediaRecorder.AudioSource.MIC,
                    sampleRate,
                    channelConfig,
                    audioFormat,
                    bufferSize
                )
            } catch (e: Exception) {
                _statusText.value = "Mikrofon başlatılamadı: ${e.message}"
                _sessionState.value = AudioSessionState.IDLE
                return@launch
            }

            audioRecord = record
            val buffer = ByteArray(1280) // 40ms'lik parçalar
            var seq = 0L

            try {
                record.startRecording()
                while (isActive && _sessionState.value == AudioSessionState.STREAMING) {
                    val read = record.read(buffer, 0, buffer.size)
                    if (read > 0) {
                        // Ses seviyesini hesapla (RMS / genlik)
                        var sum = 0L
                        for (i in 0 until read step 2) {
                            val sample = (buffer[i].toInt() and 0xFF) or (buffer[i + 1].toInt() shl 8)
                            sum += abs(sample.toShort().toLong())
                        }
                        val avg = (sum / (read / 2)).toFloat()
                        _amplitude.value = (avg / 32768f).coerceIn(0f, 1f)

                        val b64 = Base64.encodeToString(buffer, 0, read, Base64.NO_WRAP)
                        val payload = JSONObject().apply {
                            put("data", b64)
                            put("seq", seq++)
                        }
                        socket.send(
                            JSONObject(mapOf(
                                "type" to "audio.chunk",
                                "payload" to payload
                            )).toString()
                        )
                    }
                }
            } catch (e: Exception) {
                _statusText.value = "Kayıt hatası: ${e.message}"
            } finally {
                runCatching {
                    record.stop()
                    record.release()
                }
                audioRecord = null
                _amplitude.value = 0f
            }
        }
    }

    private fun handleIncomingChunk(payloadJson: String) {
        if (_sessionState.value == AudioSessionState.REQUESTING) {
            _sessionState.value = AudioSessionState.LISTENING
            _statusText.value = "Canlı dinleniyor 🎧"
        }
        if (_sessionState.value != AudioSessionState.LISTENING) return

        try {
            val json = JSONObject(payloadJson)
            val b64 = json.optString("data")
            if (b64.isEmpty()) return
            val bytes = Base64.decode(b64, Base64.NO_WRAP)

            // AudioTrack hazır değilse oluştur
            if (audioTrack == null) {
                val sampleRate = 16000
                val minBuf = AudioTrack.getMinBufferSize(
                    sampleRate,
                    AudioFormat.CHANNEL_OUT_MONO,
                    AudioFormat.ENCODING_PCM_16BIT
                )
                audioTrack = AudioTrack.Builder()
                    .setAudioAttributes(
                        AudioAttributes.Builder()
                            .setUsage(AudioAttributes.USAGE_MEDIA)
                            .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
                            .build()
                    )
                    .setAudioFormat(
                        AudioFormat.Builder()
                            .setEncoding(AudioFormat.ENCODING_PCM_16BIT)
                            .setSampleRate(sampleRate)
                            .setChannelMask(AudioFormat.CHANNEL_OUT_MONO)
                            .build()
                    )
                    .setBufferSizeInBytes((minBuf * 2).coerceAtLeast(bytes.size * 4))
                    .setTransferMode(AudioTrack.MODE_STREAM)
                    .build().apply { play() }
            }

            audioTrack?.write(bytes, 0, bytes.size)

            // Görsel dalga için genlik
            var sum = 0L
            for (i in 0 until bytes.size step 2) {
                val sample = (bytes[i].toInt() and 0xFF) or (bytes[i + 1].toInt() shl 8)
                sum += abs(sample.toShort().toLong())
            }
            val avg = (sum / (bytes.size / 2)).toFloat()
            _amplitude.value = (avg / 32768f).coerceIn(0f, 1f)

        } catch (e: Exception) {
            // Parça çözümleme hatası
        }
    }

    fun clearStatus() {
        _statusText.value = null
    }
}
