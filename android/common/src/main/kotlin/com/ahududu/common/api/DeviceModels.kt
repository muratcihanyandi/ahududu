package com.ahududu.common.api

import kotlinx.serialization.Serializable

// Cihaz komutları — partnerin telefonunu/saatini titreştirme.
@Serializable
data class BuzzRequest(
    val pattern: String,
    val note: String = "",
    val source: String = "phone",
)

@Serializable
data class BuzzDto(
    val id: String,
    val senderId: String,
    val senderName: String,
    val targetId: String,
    val pattern: String,
    val note: String = "",
    val source: String = "phone",
    val createdAt: String,
)

@Serializable
data class BuzzListResponse(val buzzes: List<BuzzDto>)

/** Konum paylaşım durumu — null alanlar "bilinmiyor" anlamına gelir. */
@Serializable
data class LocationStatusRequest(
    val sharing: String,
    val lat: Double? = null,
    val lng: Double? = null,
    val accuracyM: Double? = null,
    val recordedAt: String? = null,
)

@Serializable
data class HealthSampleRequest(
    val type: String,
    val value: Double,
    val recordedAt: String,
    val source: String = "watch",
)

@Serializable
data class OkResponse(val ok: Boolean = true)
