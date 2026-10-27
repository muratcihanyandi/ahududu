package com.ahududu.common.api

import io.ktor.client.HttpClient
import io.ktor.client.call.body
import io.ktor.client.plugins.ClientRequestException
import io.ktor.client.plugins.HttpRequestTimeoutException
import io.ktor.client.request.delete
import io.ktor.client.request.forms.formData
import io.ktor.client.request.forms.submitFormWithBinaryData
import io.ktor.client.request.get
import io.ktor.client.request.header
import io.ktor.client.request.patch
import io.ktor.client.request.post
import io.ktor.client.request.put
import io.ktor.client.request.setBody
import io.ktor.http.ContentType
import io.ktor.http.Headers
import io.ktor.http.HttpHeaders
import io.ktor.http.contentType
import java.io.IOException
import kotlinx.serialization.Serializable

class ApiException(val status: Int, val code: String, message: String) : Exception(message)

/** Sunucu mesajı + makine kodu ile hata. status=0 → ağ hatası. */
class AhududuApi private constructor(private val client: HttpClient, private val baseUrl: String) {

    companion object {
        fun create(baseUrl: String): AhududuApi = AhududuApi(createAhududuHttpClient(), baseUrl)
    }

    /** baseUrl değiştiğinde (ayarlar) yeni istemci gerekir. */
    fun withBaseUrl(newBaseUrl: String): AhududuApi = create(newBaseUrl)

    val serverUrl: String get() = baseUrl

    // ---------- Auth ----------
    suspend fun health(): HealthResponse = guarded { client.get("$baseUrl/health").body() }

    suspend fun setup(request: SetupRequest): AuthResponse = guarded {
        client.post("$baseUrl/api/v1/auth/setup") { json(); setBody(request) }.body()
    }

    suspend fun join(request: JoinRequest): AuthResponse = guarded {
        client.post("$baseUrl/api/v1/auth/join") { json(); setBody(request) }.body()
    }

    suspend fun login(request: LoginRequest): AuthResponse = guarded {
        client.post("$baseUrl/api/v1/auth/login") { json(); setBody(request) }.body()
    }

    suspend fun me(token: String): MeResponse = guarded {
        client.get("$baseUrl/api/v1/me") { auth(token) }.body()
    }

    suspend fun logout(token: String) { guarded { client.post("$baseUrl/api/v1/auth/logout") { auth(token) }.body<Unit>() } }

    suspend fun updateProfile(token: String, displayName: String) { guarded {
        client.patch("$baseUrl/api/v1/me") {
            auth(token); json(); setBody(ProfileUpdateRequest(displayName))
        }.body<Unit>()
    } }

    suspend fun space(token: String): SpaceResponse = guarded {
        client.get("$baseUrl/api/v1/space") { auth(token) }.body()
    }

    suspend fun createInvite(token: String): InviteInfo = guarded {
        client.post("$baseUrl/api/v1/space/invite") { auth(token) }.body()
    }

    // ---------- Config ----------
    suspend fun config(token: String): String = guarded {
        client.get("$baseUrl/api/v1/config") { auth(token) }.body<String>()
    }

    // ---------- Mesajlar ----------
    suspend fun messages(token: String, before: String? = null, limit: Int = 50): MessagesResponse = guarded {
        client.get("$baseUrl/api/v1/messages") {
            auth(token)
            if (before != null) header("x-before", before)
            url.parameters.append("limit", limit.toString())
            if (before != null) url.parameters.append("before", before)
        }.body()
    }

    suspend fun sendMessage(token: String, request: SendMessageRequest): MessageDto = guarded {
        client.post("$baseUrl/api/v1/messages") { auth(token); json(); setBody(request) }.body()
    }

    suspend fun editMessage(token: String, id: String, body: String): MessageDto = guarded {
        client.patch("$baseUrl/api/v1/messages/$id") {
            auth(token); json(); setBody(MessageEditRequest(body))
        }.body()
    }

    suspend fun deleteMessage(token: String, id: String): MessageDto = guarded {
        client.delete("$baseUrl/api/v1/messages/$id") { auth(token) }.body()
    }

    suspend fun react(token: String, messageId: String, reaction: String): MessageDto = guarded {
        client.post("$baseUrl/api/v1/messages/$messageId/reactions") {
            auth(token); json(); setBody(ReactionRequest(reaction))
        }.body()
    }

    suspend fun unreact(token: String, messageId: String, reaction: String): MessageDto = guarded {
        client.delete("$baseUrl/api/v1/messages/$messageId/reactions/$reaction") { auth(token) }.body()
    }

    suspend fun markRead(token: String): Int = guarded {
        client.post("$baseUrl/api/v1/messages/read") { auth(token) }.body<Map<String, Int>>()["marked"] ?: 0
    }

    suspend fun unreadCount(token: String): Int = guarded {
        client.get("$baseUrl/api/v1/messages/unread") { auth(token) }.body<UnreadResponse>().unread
    }

    // ---------- Medya ----------
    suspend fun uploadMedia(
        token: String,
        bytes: ByteArray,
        fileName: String,
        mime: String,
        caption: String = "",
    ): MediaDto = guarded {
        client.submitFormWithBinaryData(
            url = "$baseUrl/api/v1/media",
            formData = formData {
                append("caption", caption)
                append(
                    "file",
                    bytes,
                    Headers.build {
                        append(HttpHeaders.ContentType, mime)
                        append(HttpHeaders.ContentDisposition, "filename=\"$fileName\"")
                    },
                )
            },
        ) { auth(token) }.body()
    }

    suspend fun gallery(token: String, kind: String? = null, limit: Int = 60): MediaListResponse = guarded {
        client.get("$baseUrl/api/v1/media") {
            auth(token)
            if (kind != null) url.parameters.append("kind", kind)
            url.parameters.append("limit", limit.toString())
        }.body()
    }

    suspend fun storage(token: String): StorageInfo = guarded {
        client.get("$baseUrl/api/v1/storage") { auth(token) }.body()
    }

    fun mediaFileUrl(id: String, thumb: Boolean): String =
        "$baseUrl/api/v1/media/$id/file${if (thumb) "?thumb=1" else ""}"

    // ---------- Notlar ----------
    suspend fun notes(token: String, query: String? = null): NotesResponse = guarded {
        client.get("$baseUrl/api/v1/notes") {
            auth(token)
            if (!query.isNullOrBlank()) url.parameters.append("q", query)
        }.body()
    }

    suspend fun createNote(token: String, request: CreateNoteRequest): NoteDto = guarded {
        client.post("$baseUrl/api/v1/notes") { auth(token); json(); setBody(request) }.body()
    }

    suspend fun updateNote(token: String, id: String, request: UpdateNoteRequest): NoteDto = guarded {
        client.patch("$baseUrl/api/v1/notes/$id") { auth(token); json(); setBody(request) }.body()
    }

    suspend fun deleteNote(token: String, id: String) { guarded {
        client.delete("$baseUrl/api/v1/notes/$id") { auth(token) }.body<Unit>()
    } }

    // ---------- Etkileşimler ----------
    suspend fun interactionDefinitions(token: String): InteractionDefinitionsResponse = guarded {
        client.get("$baseUrl/api/v1/interactions/definitions") { auth(token) }.body()
    }

    suspend fun sendInteraction(token: String, kind: String): InteractionDto = guarded {
        client.post("$baseUrl/api/v1/interactions") { auth(token); json(); setBody(SendInteractionRequest(kind)) }.body()
    }

    suspend fun answerInteraction(token: String, id: String, reply: String): Unit = guarded {
        client.post("$baseUrl/api/v1/interactions/$id/answer") {
            auth(token); json(); setBody(AnswerInteractionRequest(reply))
        }.body<Unit>()
    }

    suspend fun interactions(token: String, limit: Int = 30): InteractionsResponse = guarded {
        client.get("$baseUrl/api/v1/interactions") {
            auth(token); url.parameters.append("limit", limit.toString())
        }.body()
    }

    // ---------- Mektuplar ----------
    suspend fun letters(token: String, box: String? = null, favoriteOnly: Boolean = false): LettersResponse = guarded {
        client.get("$baseUrl/api/v1/letters") {
            auth(token)
            if (box != null) url.parameters.append("box", box)
            if (favoriteOnly) url.parameters.append("favorite", "1")
        }.body()
    }

    suspend fun letter(token: String, id: String): LetterDto = guarded {
        client.get("$baseUrl/api/v1/letters/$id") { auth(token) }.body()
    }

    suspend fun saveDraft(token: String, request: SaveDraftRequest): LetterDto = guarded {
        client.post("$baseUrl/api/v1/letters") { auth(token); json(); setBody(request) }.body()
    }

    suspend fun updateLetter(token: String, id: String, request: UpdateLetterRequest): LetterDto = guarded {
        client.patch("$baseUrl/api/v1/letters/$id") { auth(token); json(); setBody(request) }.body()
    }

    suspend fun sendLetter(token: String, id: String): LetterDto = guarded {
        client.post("$baseUrl/api/v1/letters/$id/send") { auth(token) }.body()
    }

    suspend fun markLetterRead(token: String, id: String) { guarded {
        client.post("$baseUrl/api/v1/letters/$id/read") { auth(token) }.body<Unit>()
    } }

    suspend fun favoriteLetter(token: String, id: String, favorite: Boolean): Unit = guarded {
        if (favorite) client.post("$baseUrl/api/v1/letters/$id/favorite") { auth(token) }.body<Unit>()
        else client.delete("$baseUrl/api/v1/letters/$id/favorite") { auth(token) }.body<Unit>()
    }

    suspend fun deleteLetter(token: String, id: String) { guarded {
        client.delete("$baseUrl/api/v1/letters/$id") { auth(token) }.body<Unit>()
    } }

    // ---------- Konum / sağlık ----------
    suspend fun updateLocation(
        token: String,
        sharing: String,
        lat: Double? = null,
        lng: Double? = null,
        accuracyM: Double? = null,
        recordedAt: String? = null,
    ): Unit = guarded {
        client.put("$baseUrl/api/v1/location/status") {
            auth(token); json()
            setBody(LocationStatusRequest(sharing, lat, lng, accuracyM, recordedAt))
        }.body<Unit>()
    }

    suspend fun partnerLocation(token: String): PartnerLocationResponse = guarded {
        client.get("$baseUrl/api/v1/location/partner") { auth(token) }.body()
    }

    suspend fun partnerHealth(token: String, type: String): PartnerHealthResponse = guarded {
        client.get("$baseUrl/api/v1/health/partner") {
            auth(token); url.parameters.append("type", type)
        }.body()
    }

    suspend fun myHealth(token: String, type: String): Map<String, HealthSample?> = guarded {
        @Suppress("UNCHECKED_CAST")
        client.get("$baseUrl/api/v1/health/me") {
            auth(token); url.parameters.append("type", type)
        }.body<Map<String, HealthSample?>>()
    }

    suspend fun postHealth(token: String, type: String, value: Double, source: String): Unit = guarded {
        client.post("$baseUrl/api/v1/health/samples") {
            auth(token); json()
            setBody(HealthSampleRequest(type, value, java.time.Instant.now().toString(), source))
        }.body<Unit>()
    }

    // ---------- Cihaz komutları ----------
    suspend fun sendBuzz(token: String, pattern: String, note: String = "", source: String = "phone"): BuzzDto = guarded {
        client.post("$baseUrl/api/v1/devices/buzz") {
            auth(token); json(); setBody(BuzzRequest(pattern, note, source))
        }.body()
    }

    suspend fun incomingBuzzes(token: String, limit: Int = 20): BuzzListResponse = guarded {
        client.get("$baseUrl/api/v1/devices/buzz") {
            auth(token); url.parameters.append("limit", limit.toString())
        }.body()
    }

    // ---------- Sürüm ----------
    suspend fun latestRelease(token: String, platform: String): AppReleaseResponse = guarded {
        client.get("$baseUrl/api/v1/app/latest") {
            auth(token); url.parameters.append("platform", platform)
        }.body()
    }

    /** APK indirme adresi — kimlik doğrulamalı. */
    fun releaseDownloadUrl(downloadPath: String): String = "$baseUrl$downloadPath"

    // ---------- Olaylar (WS kopma telafisi) ----------
    suspend fun eventsSince(token: String, since: Long): List<EventItem> = guarded {
        val response: RawEventsResponse = client.get("$baseUrl/api/v1/events") {
            auth(token)
            url.parameters.append("since", since.toString())
        }.body()
        response.events.map {
            EventItem(
                seq = it.seq,
                type = it.type,
                payloadJson = it.payload.toString(),
                createdAt = it.createdAt,
            )
        }
    }

    // ---------- Yardımcılar ----------
    private fun io.ktor.client.request.HttpRequestBuilder.json() {
        contentType(ContentType.Application.Json)
    }

    private fun io.ktor.client.request.HttpRequestBuilder.auth(token: String) {
        header("Authorization", "Bearer $token")
    }

    private suspend fun <T> guarded(block: suspend () -> T): T = try {
        block()
    } catch (e: ClientRequestException) {
        val body = try { e.response.body<ApiErrorEnvelope>().error } catch (_: Exception) { null }
        throw ApiException(
            status = e.response.status.value,
            code = body?.code ?: "http_error",
            message = body?.message ?: "Sunucu isteği reddetti (${e.response.status.value}).",
        )
    } catch (e: HttpRequestTimeoutException) {
        throw ApiException(0, "timeout", "Sunucuya ulaşılamadı. Ev ağında mısın?")
    } catch (e: IOException) {
        throw ApiException(0, "network", "Bağlantı kurulamadı. Sunucu adresini ve ağını kontrol et.")
    } catch (e: kotlinx.coroutines.CancellationException) {
        // İptal bir hata değil: çağıranın akışına bırakılır.
        throw e
    } catch (e: Exception) {
        // Beklenmeyen yanıt biçimi (şema uyuşmazlığı vb.) uygulamayı çökertmemeli.
        throw ApiException(
            status = 0,
            code = "unexpected_response",
            message = "Sunucudan beklenmeyen bir yanıt geldi (${e::class.simpleName}).",
        )
    }
}

@Serializable
data class StorageInfo(val files: Int, val totalBytes: Long)

/** Uygulama görünen sürümü (Ayarlar ekranında gösterilir). */
const val APP_VERSION_LABEL = "0.2.0"

@Serializable
data class InteractionsResponse(val interactions: List<InteractionDto>)

@Serializable
data class SpaceResponse(
    val space: SpaceInfo,
    val members: List<MemberInfo>,
    val invite: InviteStatus,
)

@Serializable
data class InviteStatus(val active: Boolean, val expiresAt: String? = null)
