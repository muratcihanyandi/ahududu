package com.ahududu.app

import android.content.Context
import android.os.Build
import android.os.VibrationAttributes
import android.os.VibrationEffect
import android.os.Vibrator
import android.os.VibratorManager
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import org.json.JSONObject

/** Titreşim desenleri — sunucudaki beyaz liste ile aynı adlar. */
enum class BuzzPattern(val wire: String, val label: String) {
    SHORT("short", "Kısa dokunuş"),
    LONG("long", "Uzun titreşim"),
    HEARTBEAT("heartbeat", "Kalp atışı"),
    SOS("sos", "SOS"),
    KISS("kiss", "Öpücük");

    /** [bekleme, titreşim, bekleme, ...] milisaniye. */
    fun timings(): LongArray = when (this) {
        SHORT -> longArrayOf(0, 160)
        LONG -> longArrayOf(0, 900)
        HEARTBEAT -> longArrayOf(0, 120, 160, 120, 420, 120, 160, 120)
        SOS -> longArrayOf(0, 150, 120, 150, 120, 150, 300, 400, 120, 400, 120, 400, 300, 150, 120, 150, 120, 150)
        KISS -> longArrayOf(0, 90, 90, 90, 90, 180)
    }

    companion object {
        fun fromWire(value: String?): BuzzPattern =
            entries.firstOrNull { it.wire == value } ?: SHORT
    }
}

data class IncomingBuzz(val pattern: BuzzPattern, val senderName: String, val note: String, val at: Long)

/**
 * Gelen titreşimleri dinler ve cihazı gerçekten titreştirir.
 * Uygulama açıkken çalışır; kendi gönderdiğimiz titreşimde tetiklenmez.
 */
class BuzzController(
    private val context: Context,
    private val scope: CoroutineScope,
    private val socket: com.ahududu.common.api.AhududuSocket,
) {
    private val vibrator: Vibrator? = runCatching {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            val manager = context.getSystemService(Context.VIBRATOR_MANAGER_SERVICE) as VibratorManager
            manager.defaultVibrator
        } else {
            @Suppress("DEPRECATION")
            context.getSystemService(Context.VIBRATOR_SERVICE) as Vibrator
        }
    }.getOrNull()

    private val _incoming = MutableStateFlow<IncomingBuzz?>(null)
    val incoming: StateFlow<IncomingBuzz?> = _incoming.asStateFlow()

    @Volatile
    private var myUserId: String? = null

    fun setMyUserId(id: String?) {
        myUserId = id
    }

    fun start() {
        scope.launch {
            socket.events.collect { event ->
                if (event.type != "device.buzz") return@collect
                val parsed = parse(event.payloadJson) ?: return@collect
                if (parsed.senderId == myUserId) return@collect
                play(parsed.pattern)
                _incoming.value = IncomingBuzz(
                    pattern = parsed.pattern,
                    senderName = parsed.senderName,
                    note = parsed.note,
                    at = System.currentTimeMillis(),
                )
            }
        }
    }

    private data class ParsedBuzz(
        val senderId: String,
        val senderName: String,
        val pattern: BuzzPattern,
        val note: String,
    )

    private fun parse(json: String): ParsedBuzz? = runCatching {
        val o = JSONObject(json)
        ParsedBuzz(
            senderId = o.optString("senderId"),
            senderName = o.optString("senderName"),
            pattern = BuzzPattern.fromWire(o.optString("pattern")),
            note = o.optString("note"),
        )
    }.getOrNull()

    /** Cihazı verilen desende titreştirir. */
    fun play(pattern: BuzzPattern) {
        val v = vibrator ?: return
        if (!v.hasVibrator()) return
        val timings = pattern.timings()
        val amplitudes = IntArray(timings.size) { index ->
            // Çift indeksler bekleme (0 genlik), tek indeksler titreşim.
            if (index % 2 == 1) 200 else 0
        }
        runCatching {
            v.vibrate(
                VibrationEffect.createWaveform(timings, amplitudes, -1),
                VibrationAttributes.createForUsage(VibrationAttributes.USAGE_NOTIFICATION),
            )
        }.onFailure {
            runCatching { v.vibrate(VibrationEffect.createWaveform(timings, -1)) }
        }
    }

    fun clearIncoming() {
        _incoming.value = null
    }
}
