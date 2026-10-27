package com.ahududu.app

import androidx.compose.foundation.layout.fillMaxWidth
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.ahududu.common.api.ApiException
import com.ahududu.common.api.MessageDto
import com.ahududu.common.api.SendMessageRequest
import com.ahududu.common.api.SocketEvent
import com.ahududu.common.api.QueuedMessage
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import org.json.JSONArray
import org.json.JSONObject
import java.util.UUID

data class ChatUiState(
    val messages: List<MessageDto> = emptyList(),
    val queued: List<QueuedMessage> = emptyList(),
    val loading: Boolean = true,
    val sending: Boolean = false,
    val connected: Boolean = false,
    val error: String? = null,
    val replyTo: MessageDto? = null,
    val uploading: Boolean = false,
)

class ChatViewModel(private val container: AppContainer) : ViewModel() {
    private val _state = MutableStateFlow(ChatUiState())
    val state: StateFlow<ChatUiState> = _state.asStateFlow()

    private val token get() = container.tokenStore.get()

    init {
        observeEvents()
        observeConnection()
        load()
    }

    private fun observeConnection() {
        viewModelScope.launch {
            container.socket.state.collect { s ->
                _state.update { it.copy(connected = s == com.ahududu.common.api.ConnectionState.CONNECTED) }
                if (s == com.ahududu.common.api.ConnectionState.CONNECTED) {
                    container.flushOutbox { load() }
                    load()
                }
            }
        }
    }

    private fun observeEvents() {
        viewModelScope.launch {
            container.socket.events.collect { event ->
                when (event.type) {
                    "message.new", "message.updated" -> {
                        val msg = parseMessage(event) ?: return@collect
                        _state.update { s ->
                            val without = s.messages.filterNot { it.id == msg.id }
                            s.copy(messages = (without + msg).sortedBy { it.createdAt })
                        }
                        if (!msg.mine) markRead()
                    }
                    "messages.read" -> load()
                }
            }
        }
    }

    private fun parseMessage(event: SocketEvent): MessageDto? = runCatching {
        val o = JSONObject(event.payloadJson)
        MessageDto(
            id = o.getString("id"),
            senderId = o.optString("senderId"),
            senderName = o.optString("senderName"),
            mine = o.optBoolean("mine"),
            replyToId = o.optString("replyToId").takeIf { it.isNotBlank() && it != "null" },
            body = o.optString("body"),
            deleted = o.optBoolean("deleted"),
            clientMsgId = o.optString("clientMsgId"),
            createdAt = o.optString("createdAt"),
            editedAt = o.optString("editedAt").takeIf { it.isNotBlank() && it != "null" },
            readAt = o.optString("readAt").takeIf { it.isNotBlank() && it != "null" },
            reactions = emptyList(),
            attachments = parseAttachments(o.optJSONArray("attachments")),
        )
    }.getOrNull()

    private fun parseAttachments(array: JSONArray?): List<com.ahududu.common.api.AttachmentDto> {
        if (array == null) return emptyList()
        return (0 until array.length()).mapNotNull { i ->
            val a = array.optJSONObject(i) ?: return@mapNotNull null
            com.ahududu.common.api.AttachmentDto(
                id = a.optString("id"),
                kind = a.optString("kind"),
                mime = a.optString("mime"),
                width = a.optInt("width").takeIf { it > 0 },
                height = a.optInt("height").takeIf { it > 0 },
                durationMs = a.optInt("durationMs").takeIf { it > 0 },
                caption = a.optString("caption"),
            )
        }
    }

    fun load() {
        val t = token ?: return
        viewModelScope.launch {
            try {
                val response = container.api.messages(t)
                val pending = container.outbox.pending()
                _state.update { it.copy(messages = response.messages, queued = pending, loading = false, error = null) }
                markRead()
            } catch (e: ApiException) {
                _state.update { it.copy(loading = false, error = e.message) }
            } catch (e: Exception) {
                _state.update { it.copy(loading = false) }
            }
        }
    }

    private fun markRead() {
        val t = token ?: return
        viewModelScope.launch { runCatching { container.api.markRead(t) } }
    }

    fun setReplyTo(message: MessageDto?) = _state.update { it.copy(replyTo = message) }

    fun send(body: String, mediaIds: List<String> = emptyList()) {
        val text = body.trim()
        if (text.isEmpty() && mediaIds.isEmpty()) return
        val t = token ?: return
        val replyTo = _state.value.replyTo?.id
        _state.update { it.copy(sending = true, replyTo = null) }
        viewModelScope.launch {
            try {
                val sent = container.api.sendMessage(
                    t,
                    SendMessageRequest(
                        clientMsgId = UUID.randomUUID().toString(),
                        body = text,
                        replyToId = replyTo,
                        mediaIds = mediaIds,
                    ),
                )
                _state.update { s ->
                    s.copy(
                        messages = (s.messages.filterNot { it.id == sent.id } + sent).sortedBy { it.createdAt },
                        sending = false,
                    )
                }
            } catch (e: ApiException) {
                // Ağ hatası → kuyruğa al (kaybolmaz). 4xx → kullanıcıya göster.
                if (e.status == 0) {
                    val item = container.outbox.enqueue(text, replyTo, mediaIds)
                    _state.update { s -> s.copy(queued = container.outbox.pending(), sending = false) }
                    _state.update { it.copy(error = "Bağlantı yok — mesaj kuyruğa alındı (${item.body.take(20)}…)") }
                } else {
                    _state.update { it.copy(sending = false, error = e.message) }
                }
            } catch (e: Exception) {
                container.outbox.enqueue(text, replyTo, mediaIds)
                _state.update { s -> s.copy(queued = container.outbox.pending(), sending = false) }
            }
        }
    }

    /** Seçilen dosyayı yükler ve id'sini döner. Galeriye de düşer. */
    fun uploadAttachment(
        context: android.content.Context,
        uri: android.net.Uri,
        onUploaded: (String) -> Unit,
    ) {
        viewModelScope.launch {
            val (bytes, mime) = kotlinx.coroutines.withContext(kotlinx.coroutines.Dispatchers.IO) {
                val resolver = context.contentResolver
                val type = resolver.getType(uri) ?: "image/jpeg"
                val stream = resolver.openInputStream(uri)
                    ?: throw IllegalStateException("Dosya açılamadı")
                stream.use { it.readBytes() } to type
            }
            uploadBytes(bytes, mime, onUploaded)
        }
    }

    /** Yerel dosyayı (ses kaydı) yükler. */
    fun uploadFile(file: java.io.File, mime: String, onUploaded: (String) -> Unit) {
        viewModelScope.launch {
            val bytes = kotlinx.coroutines.withContext(kotlinx.coroutines.Dispatchers.IO) { file.readBytes() }
            uploadBytes(bytes, mime, onUploaded)
        }
    }

    private suspend fun uploadBytes(bytes: ByteArray, mime: String, onUploaded: (String) -> Unit) {
        val t = token ?: return
        if (bytes.size > 200L * 1024 * 1024) {
            _state.update { it.copy(uploading = false, error = "Dosya çok büyük (en fazla 200 MB).") }
            return
        }
        _state.update { it.copy(uploading = true, error = null) }
        try {
            val ext = when {
                mime.startsWith("video/") -> "mp4"
                mime.startsWith("audio/") -> if (mime.contains("mp4")) "m4a" else mime.substringAfter('/').take(4)
                mime == "image/png" -> "png"
                mime == "image/webp" -> "webp"
                else -> "jpg"
            }
            val media = container.api.uploadMedia(t, bytes, "ek.$ext", mime)
            _state.update { it.copy(uploading = false) }
            onUploaded(media.id)
        } catch (e: ApiException) {
            _state.update { it.copy(uploading = false, error = e.message) }
        } catch (e: Exception) {
            _state.update { it.copy(uploading = false, error = "Yükleme başarısız: ${e.message}") }
        }
    }

    fun delete(message: MessageDto) {
        val t = token ?: return
        viewModelScope.launch {
            try {
                val updated = container.api.deleteMessage(t, message.id)
                _state.update { s ->
                    s.copy(messages = s.messages.map { if (it.id == updated.id) updated else it })
                }
            } catch (e: ApiException) {
                _state.update { it.copy(error = e.message) }
            }
        }
    }

    fun react(message: MessageDto) {
        val t = token ?: return
        viewModelScope.launch {
            try {
                val updated = container.api.react(t, message.id, "❤")
                _state.update { s ->
                    s.copy(messages = s.messages.map { if (it.id == updated.id) updated else it })
                }
            } catch (_: Exception) { }
        }
    }

    fun dismissError() = _state.update { it.copy(error = null) }
}
