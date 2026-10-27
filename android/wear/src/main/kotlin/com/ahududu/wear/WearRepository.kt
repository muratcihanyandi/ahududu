package com.ahududu.wear

import android.content.Context
import android.os.Build
import android.os.VibrationAttributes
import android.os.VibrationEffect
import android.os.Vibrator
import android.os.VibratorManager
import android.util.Log
import com.ahududu.common.api.AhududuApi
import com.ahududu.common.api.AhududuSocket
import com.ahududu.common.api.ConnectionState
import com.ahududu.common.api.PartnerHealth
import com.ahududu.common.api.SocketEvent
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import org.json.JSONObject
import java.time.Instant

data class WearUiState(
    val connected: Boolean = false,
    val hasCredentials: Boolean = false,
    val partnerName: String = "",
    val partnerHeart: Int? = null,
    val partnerHeartAgeSec: Int? = null,
    val partnerSteps: Int? = null,
    val partnerStepsAgeSec: Int? = null,
    val partnerStress: Int? = null,
    val partnerStressAgeSec: Int? = null,
    val myHeart: Int? = null,
    val mySteps: Int? = null,
    val myStress: Int? = null,
    val busy: Boolean = false,
    val error: String? = null,
    val info: String? = null,
    val celebration: Celebration? = null,
)

enum class Celebration(val label: String) {
    HEART("Kalp"),
    KISS("Öpücük"),
    HUG("Sarılma"),
    BUZZ("Dokunuş"),
    AHUDUDU("Ahududu"),
    STARRY("Yıldızlar"),
}

/**
 * Saatin sunucu bağlantısı: kendi sağlık verisini gönderir, partnerinkini okur,
 * titreşim/dokunuş gönderir ve gelen dokunuşta saati titretir.
 */
class WearRepository(private val context: Context, private val credentials: WearCredentials) {

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)

    @Volatile
    private var api: AhududuApi = AhududuApi.create(credentials.serverUrl)

    private val socket = AhududuSocket(
        scope = scope,
        apiProvider = { api },
        tokenProvider = { credentials.token },
    )

    private val _state = MutableStateFlow(WearUiState(hasCredentials = credentials.isReady))
    val state: StateFlow<WearUiState> = _state.asStateFlow()

    private val vibrator: Vibrator? = runCatching {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            (context.getSystemService(Context.VIBRATOR_MANAGER_SERVICE) as VibratorManager).defaultVibrator
        } else {
            @Suppress("DEPRECATION")
            context.getSystemService(Context.VIBRATOR_SERVICE) as Vibrator
        }
    }.getOrNull()

    private var pollJob: Job? = null
    private var healthJob: Job? = null
    private var myUserId: String? = null

    fun start() {
        val token = credentials.token ?: run {
            _state.update { it.copy(hasCredentials = false) }
            return
        }
        _state.update { it.copy(hasCredentials = true) }
        api = AhududuApi.create(credentials.serverUrl)
        socket.connect()
        observeStates()
        observeEvents()
        startPolling()
        startHealthPush()
    }

    fun stop() {
        pollJob?.cancel()
        healthJob?.cancel()
        socket.disconnect()
    }

    private fun observeStates() {
        scope.launch {
            socket.state.collect { s ->
                _state.update { it.copy(connected = s == ConnectionState.CONNECTED) }
            }
        }
    }

    private fun observeEvents() {
        scope.launch {
            socket.events.collect { event -> handleEvent(event) }
        }
    }

    private fun handleEvent(event: SocketEvent) {
        when (event.type) {
            "device.buzz" -> {
                val o = runCatching { JSONObject(event.payloadJson) }.getOrNull() ?: return
                if (o.optString("senderId") == myUserId) return
                vibrateLoop()
                _state.update {
                    it.copy(
                        celebration = Celebration.BUZZ,
                        info = "${o.optString("senderName")} sana dokundu",
                    )
                }
            }
            "interaction.new" -> {
                val o = runCatching { JSONObject(event.payloadJson) }.getOrNull() ?: return
                if (o.optBoolean("mine")) return
                val kind = o.optString("kind")
                val celebration = when (kind) {
                    "heart" -> Celebration.HEART
                    "kiss" -> Celebration.KISS
                    "hug" -> Celebration.HUG
                    "ahududu" -> Celebration.AHUDUDU
                    "star" -> Celebration.STARRY
                    else -> Celebration.HEART
                }
                vibrateLoop()
                _state.update {
                    it.copy(celebration = celebration, info = "${o.optString("senderName")} bir işaret gönderdi")
                }
            }
            "health.updated", "presence.updated" -> refreshPartner()
        }
    }

    private fun startPolling() {
        if (pollJob?.isActive == true) return
        pollJob = scope.launch {
            while (isActive) {
                refreshPartner()
                delay(60_000)
            }
        }
    }

    private fun startHealthPush() {
        if (healthJob?.isActive == true) return
        healthJob = scope.launch {
            while (isActive) {
                pushOwnHealth()
                delay(120_000)
            }
        }
    }

    fun refreshPartner() {
        val token = credentials.token ?: return
        scope.launch {
            try {
                val heart = runCatching { api.partnerHealth(token, "heart_rate") }.getOrNull()
                val steps = runCatching { api.partnerHealth(token, "steps") }.getOrNull()
                val stress = runCatching { api.partnerHealth(token, "stress") }.getOrNull()
                _state.update {
                    it.copy(
                        partnerName = heart?.partner?.displayName
                            ?: steps?.partner?.displayName
                            ?: stress?.partner?.displayName
                            ?: it.partnerName,
                        partnerHeart = heart?.partner?.sample?.value?.toInt(),
                        partnerHeartAgeSec = heart?.partner?.sample?.ageSeconds,
                        partnerSteps = steps?.partner?.sample?.value?.toInt(),
                        partnerStepsAgeSec = steps?.partner?.sample?.ageSeconds,
                        partnerStress = stress?.partner?.sample?.value?.toInt(),
                        partnerStressAgeSec = stress?.partner?.sample?.ageSeconds,
                        error = null,
                    )
                }
            } catch (e: Exception) {
                _state.update { it.copy(error = "Sunucuya ulaşılamadı") }
            }
        }
    }

    /** Kendi ölçümlerini gönderir; değer yoksa hiçbir şey göndermez (sahte veri yok). */
    fun pushOwnHealth() {
        val token = credentials.token ?: return
        val heart = _state.value.myHeart
        val steps = _state.value.mySteps
        val stress = _state.value.myStress
        scope.launch {
            if (heart != null) {
                runCatching { api.postHealth(token, "heart_rate", heart.toDouble(), "watch") }
            }
            if (steps != null) {
                runCatching { api.postHealth(token, "steps", steps.toDouble(), "watch") }
            }
            if (stress != null) {
                runCatching { api.postHealth(token, "stress", stress.toDouble(), "watch") }
            }
        }
    }

    fun setOwnMeasurements(heart: Int?, steps: Int?, stress: Int? = null) {
        _state.update { it.copy(myHeart = heart, mySteps = steps, myStress = stress) }
    }

    fun sendBuzz(pattern: String) {
        val token = credentials.token ?: return
        if (_state.value.busy) return
        _state.update { it.copy(busy = true, error = null) }
        scope.launch {
            try {
                api.sendBuzz(token, pattern, source = "watch")
                vibrateLoop()
                _state.update { it.copy(busy = false, info = "Dokunuş gönderildi", celebration = Celebration.BUZZ) }
            } catch (e: Exception) {
                _state.update { it.copy(busy = false, error = e.message ?: "Gönderilemedi") }
            }
        }
    }

    fun sendInteraction(kind: String) {
        val token = credentials.token ?: return
        if (_state.value.busy) return
        _state.update { it.copy(busy = true, error = null) }
        scope.launch {
            try {
                api.sendInteraction(token, kind)
                vibrateLoop()
                _state.update {
                    it.copy(
                        busy = false,
                        info = "Gönderildi",
                        celebration = when (kind) {
                            "kiss" -> Celebration.KISS
                            "hug" -> Celebration.HUG
                            else -> Celebration.HEART
                        },
                    )
                }
            } catch (e: Exception) {
                _state.update { it.copy(busy = false, error = e.message ?: "Gönderilemedi") }
            }
        }
    }

    fun clearCelebration() = _state.update { it.copy(celebration = null) }

    fun clearMessages() = _state.update { it.copy(info = null, error = null) }

    fun vibrateLoop() {
        val v = vibrator ?: return
        if (!v.hasVibrator()) return
        val timings = longArrayOf(0, 120, 100, 120, 300, 120, 100, 120)
        val amplitudes = intArrayOf(0, 200, 0, 200, 0, 200, 0, 200)
        runCatching {
            v.vibrate(
                VibrationEffect.createWaveform(timings, amplitudes, -1),
                VibrationAttributes.createForUsage(VibrationAttributes.USAGE_NOTIFICATION),
            )
        }.onFailure {
            runCatching { v.vibrate(VibrationEffect.createWaveform(timings, -1)) }
        }
    }

    /** Oturum sahibini bulmak için (kendi olaylarımızı ayırt etmek). */
    fun loadIdentity() {
        val token = credentials.token ?: return
        scope.launch {
            runCatching { api.me(token) }.onSuccess { me ->
                myUserId = me.user.id
                _state.update {
                    it.copy(
                        partnerName = me.members.firstOrNull { m -> m.id != me.user.id }?.displayName
                            ?: it.partnerName,
                    )
                }
            }
        }
    }

    /** Saat ekranı açıkken kendi ölçümlerini durum nesnesine yansıtır. */
    fun publishOwn(heart: Int?, steps: Int?, stress: Int? = null) {
        _state.update { it.copy(myHeart = heart, mySteps = steps, myStress = stress) }
    }
}
