package com.ahududu.common.api

import android.content.Context
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import java.io.File
import java.util.UUID

@Serializable
data class QueuedMessage(
    val clientMsgId: String,
    val body: String,
    val replyToId: String? = null,
    val mediaIds: List<String> = emptyList(),
    val createdAt: Long,
)

/**
 * Çevrimdışı gönderim kuyruğu — dosyada kalıcı (uygulama kapansa da kaybolmaz).
 * Aynı clientMsgId sunucuda idempotent olduğu için güvenle tekrar denenir.
 */
class OutboxQueue(context: Context) {
    private val file = File(context.filesDir, "outbox.json")
    private val json = Json { ignoreUnknownKeys = true; prettyPrint = false }
    private val mutex = Mutex()

    suspend fun enqueue(body: String, replyToId: String? = null, mediaIds: List<String> = emptyList()): QueuedMessage =
        mutex.withLock {
            val item = QueuedMessage(
                clientMsgId = UUID.randomUUID().toString(),
                body = body,
                replyToId = replyToId,
                mediaIds = mediaIds,
                createdAt = System.currentTimeMillis(),
            )
            write(read() + item)
            item
        }

    suspend fun pending(): List<QueuedMessage> = mutex.withLock { read() }

    suspend fun remove(clientMsgId: String) = mutex.withLock {
        write(read().filterNot { it.clientMsgId == clientMsgId })
    }

    suspend fun isEmpty(): Boolean = mutex.withLock { read().isEmpty() }

    private fun read(): List<QueuedMessage> = runCatching {
        if (!file.exists()) return@runCatching emptyList<QueuedMessage>()
        val text = file.readText()
        if (text.isBlank()) emptyList() else json.decodeFromString<List<QueuedMessage>>(text)
    }.getOrElse { emptyList() }

    private fun write(items: List<QueuedMessage>) {
        // Atomik yazım: yarım kalan dosya kuyruğu bozmasın.
        val tmp = File(file.parentFile, "${file.name}.tmp")
        tmp.writeText(json.encodeToString(items))
        if (!tmp.renameTo(file)) {
            file.writeText(tmp.readText())
            tmp.delete()
        }
    }
}
