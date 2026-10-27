package com.ahududu.common.api

import kotlinx.serialization.Serializable

// Sunucu sözleşmesi: docs/API.md — alan adları birebir sunucu yanıtlarıyla eşleşir.

@Serializable
data class HealthResponse(val status: String, val db: String, val version: String)

@Serializable
data class SetupRequest(
    val spaceName: String,
    val username: String,
    val displayName: String,
    val password: String,
)

@Serializable
data class JoinRequest(
    val inviteCode: String,
    val username: String,
    val displayName: String,
    val password: String,
)

@Serializable
data class LoginRequest(
    val username: String,
    val password: String,
    val deviceName: String? = null,
    val platform: String = "android",
)

@Serializable
data class UserInfo(val id: String, val username: String, val displayName: String)

@Serializable
data class SpaceInfo(val id: String, val name: String)

@Serializable
data class InviteInfo(val code: String, val expiresAt: String)

@Serializable
data class AuthResponse(
    val token: String,
    val expiresAt: String,
    val user: UserInfo,
    val space: SpaceInfo,
    val invite: InviteInfo? = null,
)

@Serializable
data class MemberInfo(
    val id: String,
    val username: String,
    val displayName: String,
    val lastSeenAt: String? = null,
)

@Serializable
data class DeviceInfo(
    val id: String,
    val name: String,
    val platform: String,
    val model: String? = null,
    val lastActiveAt: String? = null,
)

@Serializable
data class MeResponse(
    val user: UserInfo,
    val space: SpaceInfo,
    val members: List<MemberInfo>,
    val devices: List<DeviceInfo>,
)

// Hata zarfı: { "error": { "code": "...", "message": "..." } }
@Serializable
data class ApiErrorBody(val code: String, val message: String)

@Serializable
data class ApiErrorEnvelope(val error: ApiErrorBody)

@Serializable
data class ProfileUpdateRequest(val displayName: String)

@Serializable
data class MessageEditRequest(val body: String)

@Serializable
data class ReactionRequest(val reaction: String)
