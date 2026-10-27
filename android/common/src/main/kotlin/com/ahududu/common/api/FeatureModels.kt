package com.ahududu.common.api

import kotlinx.serialization.Serializable

// Mesajlar
@Serializable
data class ReactionDto(val user_id: String, val reaction: String)

@Serializable
data class AttachmentDto(
    val id: String,
    val kind: String,
    val mime: String,
    val width: Int? = null,
    val height: Int? = null,
    val durationMs: Int? = null,
    val caption: String = "",
)

@Serializable
data class MessageDto(
    val id: String,
    val senderId: String,
    val senderName: String,
    val mine: Boolean,
    val replyToId: String? = null,
    val body: String = "",
    val deleted: Boolean = false,
    val clientMsgId: String = "",
    val createdAt: String,
    val editedAt: String? = null,
    val reactions: List<ReactionDto> = emptyList(),
    val attachments: List<AttachmentDto> = emptyList(),
    val readAt: String? = null,
)

@Serializable
data class MessagesResponse(val messages: List<MessageDto>)

@Serializable
data class SendMessageRequest(
    val clientMsgId: String,
    val body: String = "",
    val replyToId: String? = null,
    val mediaIds: List<String> = emptyList(),
)

@Serializable
data class UnreadResponse(val unread: Int)

// Medya
@Serializable
data class MediaDto(
    val id: String,
    val kind: String,
    val mime: String,
    val sizeBytes: Long = 0,
    val width: Int? = null,
    val height: Int? = null,
    val durationMs: Int? = null,
    val caption: String = "",
    val takenAt: String? = null,
    val createdAt: String,
    val uploadedBy: String,
    val uploaderName: String,
    val hasThumb: Boolean = true,
)

@Serializable
data class MediaListResponse(val items: List<MediaDto>)

// Notlar
@Serializable
data class ChecklistItem(val id: String, val text: String, val done: Boolean = false)

@Serializable
data class NoteDto(
    val id: String,
    val title: String = "",
    val body: String = "",
    val color: String = "krem",
    val pinned: Boolean = false,
    val done: Boolean = false,
    val checklist: List<ChecklistItem> = emptyList(),
    val version: Int = 1,
    val createdAt: String,
    val updatedAt: String,
    val createdBy: String,
    val editorName: String? = null,
)

@Serializable
data class NotesResponse(val notes: List<NoteDto>)

@Serializable
data class CreateNoteRequest(
    val title: String = "",
    val body: String = "",
    val color: String = "krem",
    val checklist: List<ChecklistItem> = emptyList(),
)

@Serializable
data class UpdateNoteRequest(
    val baseVersion: Int,
    val title: String? = null,
    val body: String? = null,
    val color: String? = null,
    val pinned: Boolean? = null,
    val done: Boolean? = null,
    val checklist: List<ChecklistItem>? = null,
)

// Etkileşimler
@Serializable
data class InteractionDefinition(
    val kind: String,
    val label: String,
    val message: String,
    val cooldownSec: Int,
    val notify: Boolean,
)

@Serializable
data class InteractionDefinitionsResponse(val definitions: List<InteractionDefinition>)

@Serializable
data class InteractionDto(
    val id: String,
    val senderId: String,
    val senderName: String,
    val kind: String,
    val status: String,
    val answeredAt: String? = null,
    val createdAt: String,
)

@Serializable
data class SendInteractionRequest(val kind: String)

@Serializable
data class AnswerInteractionRequest(val reply: String = "")

// Mektuplar
@Serializable
data class LetterPageDto(
    val pageNo: Int,
    val background: String = "plain",
    val strokes: List<StrokeDto> = emptyList(),
    val updatedAt: String? = null,
)

@Serializable
data class StrokeDto(
    val tool: String = "pen",
    val color: String = "#3E2B31",
    val width: Float = 3f,
    val points: List<List<Float>> = emptyList(),
)

@Serializable
data class LetterDto(
    val id: String,
    val authorId: String,
    val authorName: String,
    val mine: Boolean,
    val title: String = "",
    val paperStyle: String = "klasik",
    val envelopeStyle: String = "klasik",
    val status: String = "draft",
    val bodyMd: String = "",
    val sentAt: String? = null,
    val firstReadAt: String? = null,
    val createdAt: String,
    val updatedAt: String,
    val favorite: Boolean = false,
    val pageCount: Int = 0,
    val pages: List<LetterPageDto> = emptyList(),
)

@Serializable
data class LettersResponse(val letters: List<LetterDto>)

@Serializable
data class SaveDraftRequest(
    val clientDraftId: String,
    val title: String = "",
    val bodyMd: String = "",
    val paperStyle: String = "klasik",
    val envelopeStyle: String = "klasik",
)

@Serializable
data class UpdateLetterRequest(
    val title: String? = null,
    val bodyMd: String? = null,
    val paperStyle: String? = null,
    val envelopeStyle: String? = null,
    val pages: List<LetterPageDto>? = null,
)

// Konum / sağlık
@Serializable
data class PartnerLocation(
    val userId: String,
    val displayName: String,
    val sharing: String,
    val lat: Double? = null,
    val lng: Double? = null,
    val accuracyM: Double? = null,
    val recordedAt: String? = null,
    val ageSeconds: Int? = null,
    val fresh: Boolean = false,
)

@Serializable
data class PartnerLocationResponse(val partner: PartnerLocation? = null, val reason: String? = null)

@Serializable
data class HealthSample(
    val value: Double,
    val unit: String,
    val recordedAt: String,
    val source: String = "unknown",
    val ageSeconds: Int? = null,
    val stale: Boolean = false,
)

@Serializable
data class PartnerHealth(
    val userId: String,
    val displayName: String,
    val type: String,
    val sample: HealthSample? = null,
)

@Serializable
data class PartnerHealthResponse(val partner: PartnerHealth? = null)

// Sürüm
@Serializable
data class AppRelease(
    val platform: String,
    val versionCode: Int,
    val versionName: String,
    val changelog: String = "",
    val sizeBytes: Long = 0,
    val sha256: String = "",
    val createdAt: String,
    val downloadPath: String,
)

@Serializable
data class AppReleaseResponse(val release: AppRelease? = null)

// WebSocket olay zarfı
@Serializable
data class SocketEnvelope(
    val type: String,
    val seq: Long? = null,
    val serverTs: String? = null,
)

@Serializable
data class EventItem(val seq: Long, val type: String, val payloadJson: String, val createdAt: String)

@Serializable
data class RawEventsResponse(val events: List<RawEventItem>)

@Serializable
data class RawEventItem(
    val seq: Long,
    val type: String,
    val payload: kotlinx.serialization.json.JsonElement,
    val createdAt: String,
)
