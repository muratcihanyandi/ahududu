package com.ahududu.app

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.ahududu.common.api.ApiException
import com.ahududu.common.api.InteractionDefinition
import com.ahududu.common.api.InteractionDto
import com.ahududu.common.api.SocketEvent
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import org.json.JSONObject

data class InteractionUiState(
    val definitions: List<InteractionDefinition> = emptyList(),
    val recent: List<InteractionDto> = emptyList(),
    val incoming: InteractionDto? = null,
    val incomingMessage: String? = null,
    val busyKind: String? = null,
    val error: String? = null,
    val status: String? = null,
)

class InteractionsViewModel(private val container: AppContainer) : ViewModel() {
    private val _state = MutableStateFlow(InteractionUiState())
    val state: StateFlow<InteractionUiState> = _state.asStateFlow()
    private val token get() = container.tokenStore.get()

    init {
        loadDefinitions()
        observe()
    }

    private fun loadDefinitions() {
        val t = token ?: return
        viewModelScope.launch {
            runCatching { container.api.interactionDefinitions(t) }
                .onSuccess { r -> _state.update { it.copy(definitions = r.definitions) } }
            runCatching { container.api.interactions(t) }
                .onSuccess { r -> _state.update { it.copy(recent = r.interactions) } }
        }
    }

    private fun observe() {
        viewModelScope.launch {
            container.socket.events.collect { event ->
                when (event.type) {
                    "interaction.new" -> {
                        val o = runCatching { JSONObject(event.payloadJson) }.getOrNull() ?: return@collect
                        val item = InteractionDto(
                            id = o.optString("id"),
                            senderId = o.optString("senderId"),
                            senderName = o.optString("senderName"),
                            kind = o.optString("kind"),
                            status = o.optString("status", "pending"),
                            createdAt = o.optString("createdAt"),
                        )
                        val message = o.optString("message")
                        val mine = o.optBoolean("mine", false)
                        _state.update { s ->
                            s.copy(
                                recent = (listOf(item) + s.recent).take(30),
                                incoming = if (!mine && item.status == "pending") item else s.incoming,
                                incomingMessage = if (!mine) message else s.incomingMessage,
                            )
                        }
                    }
                    "interaction.answered" -> {
                        val o = runCatching { JSONObject(event.payloadJson) }.getOrNull() ?: return@collect
                        _state.update { s ->
                            s.copy(
                                status = "${o.optString("byName")} yanıtladı: ${o.optString("reply")}".trim(),
                                incoming = null,
                                incomingMessage = null,
                            )
                        }
                        loadDefinitions()
                    }
                }
            }
        }
    }

    fun send(kind: String) {
        val t = token ?: return
        if (_state.value.busyKind != null) return
        _state.update { it.copy(busyKind = kind, error = null, status = null) }
        viewModelScope.launch {
            try {
                val def = _state.value.definitions.firstOrNull { it.kind == kind }
                container.api.sendInteraction(t, kind)
                _state.update {
                    it.copy(busyKind = null, status = def?.message ?: "Gönderildi 💗")
                }
            } catch (e: ApiException) {
                _state.update { it.copy(busyKind = null, error = e.message) }
            }
        }
    }

    fun answer(reply: String) {
        val t = token ?: return
        val incoming = _state.value.incoming ?: return
        viewModelScope.launch {
            try {
                container.api.answerInteraction(t, incoming.id, reply)
                _state.update { it.copy(incoming = null, incomingMessage = null, status = "Yanıtın gönderildi 💗") }
            } catch (e: ApiException) {
                _state.update { it.copy(error = e.message) }
            }
        }
    }

    fun dismissStatus() = _state.update { it.copy(status = null, error = null) }
}

@Composable
fun InteractionsSection(container: AppContainer) {
    val vm: InteractionsViewModel = androidx.lifecycle.viewmodel.compose.viewModel { InteractionsViewModel(container) }
    val state by vm.state.collectAsState()

    state.incoming?.let { incoming ->
        AlertDialog(
            onDismissRequest = { vm.dismissStatus() },
            title = { Text(incoming.senderName, style = MaterialTheme.typography.titleLarge) },
            text = { Text(state.incomingMessage ?: "Sana bir işaret gönderdi 💗") },
            confirmButton = {
                TextButton(onClick = { vm.answer("Buradayım 💗") }) { Text("Yanıtla") }
            },
            dismissButton = {
                TextButton(onClick = { vm.dismissStatus() }) { Text("Sonra") }
            },
        )
    }

    Column(Modifier.fillMaxSize().padding(horizontal = 20.dp)) {
        Text(
            "Birbirimize",
            style = MaterialTheme.typography.headlineMedium,
            color = MaterialTheme.colorScheme.primary,
            modifier = Modifier.padding(top = 16.dp, bottom = 4.dp),
        )
        Text(
            "Tek dokunuşla sevgiline küçük bir işaret gönder.",
            style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        Spacer(Modifier.height(16.dp))

        LazyVerticalGrid(
            columns = GridCells.Fixed(2),
            horizontalArrangement = Arrangement.spacedBy(10.dp),
            verticalArrangement = Arrangement.spacedBy(10.dp),
            modifier = Modifier.weight(1f),
        ) {
            items(state.definitions) { def ->
                val busy = state.busyKind == def.kind
                Card(
                    shape = MaterialTheme.shapes.medium,
                    colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
                    modifier = Modifier.height(112.dp),
                ) {
                    Column(
                        Modifier.fillMaxSize().padding(14.dp),
                        verticalArrangement = Arrangement.SpaceBetween,
                    ) {
                        Text(
                            interactionEmoji(def.kind),
                            style = MaterialTheme.typography.headlineMedium,
                        )
                        Column {
                            Text(def.label, style = MaterialTheme.typography.titleMedium)
                            Spacer(Modifier.height(6.dp))
                            Button(
                                onClick = { vm.send(def.kind) },
                                enabled = !busy,
                                modifier = Modifier.fillMaxWidth().height(34.dp),
                                shape = MaterialTheme.shapes.small,
                                contentPadding = PaddingValues(0.dp),
                            ) {
                                Text(if (busy) "…" else "Gönder", style = MaterialTheme.typography.labelLarge)
                            }
                        }
                    }
                }
            }
        }

        state.status?.let {
            Text(
                it,
                style = MaterialTheme.typography.bodyLarge,
                color = MaterialTheme.colorScheme.primary,
                modifier = Modifier.fillMaxWidth().padding(vertical = 12.dp),
                textAlign = TextAlign.Center,
            )
        }
        state.error?.let {
            Text(
                it,
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.error,
                modifier = Modifier.fillMaxWidth().padding(vertical = 8.dp),
                textAlign = TextAlign.Center,
            )
        }
    }
}

private fun interactionEmoji(kind: String): String = when (kind) {
    "attention" -> "💗"
    "heart" -> "❤️"
    "kiss" -> "😘"
    "hug" -> "🤗"
    "star" -> "✨"
    "flower" -> "🌸"
    else -> "💞"
}
