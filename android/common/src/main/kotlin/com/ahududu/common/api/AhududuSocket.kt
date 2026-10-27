package com.ahududu.common.api

import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asSharedFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import java.util.concurrent.TimeUnit
import kotlin.coroutines.resume

enum class ConnectionState { DISCONNECTED, CONNECTING, CONNECTED }

data class SocketEvent(
    val type: String,
    val seq: Long?,
    val payloadJson: String,
    val serverTs: String?,
)

/**
 * Sunucu WebSocket istemcisi.
 * - Otomatik yeniden bağlanma (artan bekleme), OkHttp ping (30 sn).
 * - Bağlantı kurulunca son bilinen seq'ten sonrası REST'ten çekilir → kopma sırasında
 *   gelen olaylar kaybolmaz (docs/API.md olay sözleşmesi).
 */
class AhududuSocket(
    private val scope: CoroutineScope,
    private val apiProvider: () -> AhududuApi,
    private val tokenProvider: () -> String?,
) {
    private val json = Json { ignoreUnknownKeys = true }
    private val client = OkHttpClient.Builder()
        .pingInterval(30, TimeUnit.SECONDS)
        .readTimeout(0, TimeUnit.MILLISECONDS)
        .build()

    private val _state = MutableStateFlow(ConnectionState.DISCONNECTED)
    val state: StateFlow<ConnectionState> = _state.asStateFlow()

    private val _events = MutableSharedFlow<SocketEvent>(extraBufferCapacity = 256)
    val events: SharedFlow<SocketEvent> = _events.asSharedFlow()

    private var socket: WebSocket? = null
    private var loopJob: Job? = null
    private var lastSeq: Long = 0
    private var generation = 0

    fun connect() {
        if (loopJob?.isActive == true) return
        generation++
        val myGen = generation
        loopJob = scope.launch {
            var backoff = 1_000L
            while (isActive && myGen == generation) {
                val token = tokenProvider()
                if (token.isNullOrBlank()) {
                    _state.value = ConnectionState.DISCONNECTED
                    delay(3_000)
                    continue
                }
                _state.value = ConnectionState.CONNECTING
                val opened = openSocket(token)
                if (!opened) {
                    _state.value = ConnectionState.DISCONNECTED
                    delay(backoff)
                    backoff = (backoff * 2).coerceAtMost(30_000)
                } else {
                    backoff = 1_000L
                    while (isActive && _state.value == ConnectionState.CONNECTED && myGen == generation) {
                        delay(500)
                    }
                    if (myGen == generation) delay(1_000)
                }
            }
        }
    }

    /** Bağlantıyı kurar; açılırsa true döner (bağlantı sonrası yakalama yapılır). */
    private suspend fun openSocket(token: String): Boolean {
        val base = apiProvider().serverUrl
            .replaceFirst("https://", "wss://")
            .replaceFirst("http://", "ws://")
        val request = Request.Builder().url("$base/ws?token=$token").build()
        return suspendCancellableCoroutine { cont ->
            val ws = client.newWebSocket(request, object : WebSocketListener() {
                override fun onOpen(webSocket: WebSocket, response: Response) {
                    _state.value = ConnectionState.CONNECTED
                    if (cont.isActive) cont.resume(true)
                    scope.launch { catchUp(token) }
                }

                override fun onMessage(webSocket: WebSocket, text: String) = handleFrame(text)

                override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) {
                    _state.value = ConnectionState.DISCONNECTED
                    if (cont.isActive) cont.resume(false)
                }

                override fun onClosed(webSocket: WebSocket, code: Int, reason: String) {
                    _state.value = ConnectionState.DISCONNECTED
                    if (cont.isActive) cont.resume(false)
                }
            })
            socket = ws
            cont.invokeOnCancellation { ws.cancel() }
        }
    }

    /** Bağlantı koptuğu sürede kaçan olayları REST üzerinden sırayla çeker. */
    private suspend fun catchUp(token: String) {
        try {
            val missed = apiProvider().eventsSince(token, lastSeq)
            for (e in missed) {
                if (e.seq > lastSeq) lastSeq = e.seq
                _events.emit(SocketEvent(e.type, e.seq, e.payloadJson, e.createdAt))
            }
        } catch (_: Exception) {
            // Ağ hatası: sonraki bağlantıda tekrar denenir.
        }
    }

    fun disconnect() {
        generation++
        loopJob?.cancel()
        loopJob = null
        socket?.close(1000, "kapatıldı")
        socket = null
        _state.value = ConnectionState.DISCONNECTED
    }

    fun resetSequence() {
        lastSeq = 0
    }

    /** WebSocket üzerinden JSON metni iletir. */
    fun send(text: String): Boolean {
        val s = socket
        return if (s != null && _state.value == ConnectionState.CONNECTED) {
            s.send(text)
        } else {
            false
        }
    }

    private fun handleFrame(text: String) {
        runCatching {
            val obj = json.parseToJsonElement(text).jsonObject
            val type = obj["type"]?.jsonPrimitive?.content ?: return
            if (type == "pong") return
            val seq = obj["seq"]?.jsonPrimitive?.content?.toLongOrNull()
            if (seq != null && seq > lastSeq) lastSeq = seq
            val payload = obj["payload"]?.toString() ?: "null"
            _events.tryEmit(SocketEvent(type, seq, payload, obj["serverTs"]?.jsonPrimitive?.content))
        }
    }
}
