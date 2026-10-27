package com.ahududu.app

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.ahududu.common.api.ApiException
import com.ahududu.common.api.AuthResponse
import com.ahududu.common.api.JoinRequest
import com.ahududu.common.api.LoginRequest
import com.ahududu.common.api.MeResponse
import com.ahududu.common.api.SetupRequest
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

enum class FormMode { SETUP, JOIN, LOGIN }
enum class Tab { HOME, MESSAGES, LETTERS, MEMORIES, NOTES }

sealed interface Screen {
    data object Loading : Screen
    data object Welcome : Screen
    data class Form(val mode: FormMode) : Screen
    data class Main(val me: MeResponse, val inviteCode: String?) : Screen
}

data class UiState(
    val screen: Screen = Screen.Loading,
    val tab: Tab = Tab.HOME,
    val busy: Boolean = false,
    val error: String? = null,
    val info: String? = null,
    val serverOnline: Boolean? = null,
    val socketConnected: Boolean = false,
    val unreadMessages: Int = 0,
)

open class AppViewModel(protected val container: AppContainer) : ViewModel() {

    private val _uiState = MutableStateFlow(UiState())
    val uiState: StateFlow<UiState> = _uiState.asStateFlow()

    protected val token: String? get() = container.tokenStore.get()
    protected val serverUrl: String get() = container.api.serverUrl

    init {
        checkServer()
        observeSocket()
    }

    private fun observeSocket() {
        viewModelScope.launch {
            container.socket.state.collect { state ->
                _uiState.update { it.copy(socketConnected = state == com.ahududu.common.api.ConnectionState.CONNECTED) }
                if (state == com.ahududu.common.api.ConnectionState.CONNECTED) {
                    container.flushOutbox { refreshUnread() }
                    refreshUnread()
                }
            }
        }
    }

    private fun checkServer() {
        viewModelScope.launch {
            val online = try { container.api.health().status == "ok" } catch (e: Exception) { false }
            _uiState.update { it.copy(serverOnline = online) }
            val t = token
            if (t == null) {
                _uiState.update { it.copy(screen = Screen.Welcome) }
            } else {
                container.startRealtime()
                refreshSession()
            }
        }
    }

    fun refreshSession(silent: Boolean = false) {
        val t = token ?: run {
            _uiState.update { it.copy(screen = Screen.Welcome) }
            return
        }
        viewModelScope.launch {
            try {
                val me = container.api.me(t)
                _uiState.update { current ->
                    val code = (current.screen as? Screen.Main)?.inviteCode
                    current.copy(screen = Screen.Main(me, code), serverOnline = true, error = null)
                }
                refreshUnread()
            } catch (e: ApiException) {
                if (e.status == 401) {
                    container.stopRealtime()
                    container.tokenStore.clear()
                    _uiState.update {
                        it.copy(screen = Screen.Welcome, error = "Oturumun sona ermiş, tekrar giriş yap.")
                    }
                } else if (!silent) {
                    _uiState.update { it.copy(serverOnline = false) }
                }
            } catch (e: Exception) {
                if (!silent) _uiState.update { it.copy(serverOnline = false) }
            }
        }
    }

    fun refreshIfLoggedIn() {
        if (token != null && !_uiState.value.busy) refreshSession(silent = true)
    }

    private fun refreshUnread() {
        val t = token ?: return
        viewModelScope.launch {
            runCatching { container.api.unreadCount(t) }
                .onSuccess { n -> _uiState.update { it.copy(unreadMessages = n) } }
        }
    }

    fun selectTab(tab: Tab) {
        _uiState.update { it.copy(tab = tab) }
    }

    fun openForm(mode: FormMode) {
        _uiState.update { it.copy(screen = Screen.Form(mode), error = null, info = null) }
    }

    fun backToWelcome() {
        _uiState.update { it.copy(screen = Screen.Welcome, error = null) }
    }

    fun setup(spaceName: String, username: String, displayName: String, password: String) {
        submit { api -> api.setup(SetupRequest(spaceName, username, displayName, password)) }
    }

    fun join(inviteCode: String, username: String, displayName: String, password: String) {
        submit { api -> api.join(JoinRequest(inviteCode.uppercase().trim(), username, displayName, password)) }
    }

    fun login(username: String, password: String) {
        submit { api -> api.login(LoginRequest(username, password, deviceName = android.os.Build.MODEL)) }
    }

    private fun submit(call: suspend (com.ahududu.common.api.AhududuApi) -> AuthResponse) {
        if (_uiState.value.busy) return
        _uiState.update { it.copy(busy = true, error = null) }
        viewModelScope.launch {
            try {
                val auth = call(container.api)
                container.tokenStore.save(auth.token)
                container.socket.resetSequence()
                container.startRealtime()
                val me = container.api.me(auth.token)
                _uiState.update {
                    it.copy(
                        busy = false,
                        screen = Screen.Main(me, inviteCode = auth.invite?.code),
                        tab = Tab.HOME,
                    )
                }
                refreshUnread()
            } catch (e: ApiException) {
                _uiState.update { it.copy(busy = false, error = e.message) }
            } catch (e: Exception) {
                _uiState.update {
                    it.copy(busy = false, error = "Beklenmeyen bir hata oluştu. Tekrar dener misin?")
                }
            }
        }
    }

    fun logout() {
        val t = token
        viewModelScope.launch {
            if (t != null) runCatching { container.api.logout(t) }
            container.stopRealtime()
            container.tokenStore.clear()
            // Saatteki kimlik de temizlenir: çıkış yapan hesap saatte açık kalmasın.
            container.publishWearCredentials()
            _uiState.update { UiState(screen = Screen.Welcome, serverOnline = it.serverOnline) }
        }
    }

    fun createInvite() {
        val t = token ?: return
        viewModelScope.launch {
            try {
                val invite = container.api.createInvite(t)
                refreshSession(silent = true)
                _uiState.update { current ->
                    val me = (current.screen as? Screen.Main)?.me
                    current.copy(
                        screen = if (me != null) Screen.Main(me, invite.code) else current.screen,
                        info = "Yeni davet kodu: ${invite.code}",
                    )
                }
            } catch (e: ApiException) {
                _uiState.update { it.copy(error = e.message) }
            }
        }
    }

    fun setServer(url: String) {
        container.setServer(url)
        _uiState.update { it.copy(info = "Sunucu adresi güncellendi: ${container.api.serverUrl}") }
        checkServer()
    }

    fun checkServerNow() {
        viewModelScope.launch {
            val online = runCatching { container.api.health().status == "ok" }.getOrElse { false }
            _uiState.update {
                it.copy(
                    serverOnline = online,
                    info = if (online) {
                        "Sunucuya ulaşıldı (${container.api.serverUrl})"
                    } else {
                        "Sunucuya ulaşılamadı: ${container.api.serverUrl}"
                    },
                )
            }
        }
    }

    fun updateDisplayName(displayName: String) {
        val t = token ?: return
        val trimmed = displayName.trim()
        if (trimmed.isEmpty()) {
            showError("Görünen ad boş olamaz.")
            return
        }
        viewModelScope.launch {
            try {
                container.api.updateProfile(t, trimmed)
                _uiState.update { it.copy(info = "Profil güncellendi.") }
                refreshSession(silent = true)
            } catch (e: ApiException) {
                _uiState.update { it.copy(error = e.message) }
            }
        }
    }

    /** Ana ekrandan tek dokunuşla etkileşim gönder. */
    fun sendQuickInteraction(kind: String) {
        val t = token ?: return
        viewModelScope.launch {
            try {
                container.api.sendInteraction(t, kind)
                val label = when (kind) {
                    "heart" -> "Kalbin yola çıktı ❤️"
                    "kiss" -> "Öpücüğünü gönderdin 😘"
                    "hug" -> "Sarılma gönderildi 🤗"
                    "attention" -> "İlgi isteğin iletildi 💗"
                    else -> "Gönderildi 💗"
                }
                _uiState.update { it.copy(info = label) }
            } catch (e: ApiException) {
                _uiState.update { it.copy(error = e.message) }
            }
        }
    }

    fun showError(message: String) = _uiState.update { it.copy(error = message) }
    fun showInfo(message: String) = _uiState.update { it.copy(info = message) }
    fun dismissError() = _uiState.update { it.copy(error = null) }
    fun dismissInfo() = _uiState.update { it.copy(info = null) }

    override fun onCleared() {
        super.onCleared()
        container.stopRealtime()
    }
}
