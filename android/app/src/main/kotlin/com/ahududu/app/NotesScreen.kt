package com.ahududu.app

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.Checkbox
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.FilterChip
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.ahududu.common.api.ApiException
import com.ahududu.common.api.ChecklistItem
import com.ahududu.common.api.CreateNoteRequest
import com.ahududu.common.api.NoteDto
import com.ahududu.common.api.UpdateNoteRequest
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

data class NotesUiState(
    val notes: List<NoteDto> = emptyList(),
    val loading: Boolean = true,
    val error: String? = null,
    /** null = editör kapalı, EditorTarget.New = yeni not */
    val editor: EditorTarget? = null,
    /** Otomatik kaydetme durumu (kullanıcıya gösterilir). */
    val saveState: SaveState = SaveState.Idle,
    val conflict: ConflictInfo? = null,
)

sealed interface EditorTarget {
    data object New : EditorTarget
    data class Existing(val note: NoteDto) : EditorTarget
}

enum class SaveState { Idle, Saving, Saved, Failed }

data class ConflictInfo(val message: String, val current: NoteDto)

class NotesViewModel(private val container: AppContainer) : ViewModel() {
    private val _state = MutableStateFlow(NotesUiState())
    val state: StateFlow<NotesUiState> = _state.asStateFlow()
    private val token get() = container.tokenStore.get()
    private var autoSaveJob: Job? = null

    init {
        load()
        observe()
    }

    fun load() {
        val t = token ?: return
        viewModelScope.launch {
            try {
                val r = container.api.notes(t)
                _state.update { current ->
                    // Editör açıksa güncel notu da tazele (karşı taraf değiştirmiş olabilir).
                    val editor = current.editor
                    val fresh = if (editor is EditorTarget.Existing) {
                        r.notes.firstOrNull { it.id == editor.note.id }?.let { EditorTarget.Existing(it) }
                            ?: editor
                    } else editor
                    current.copy(notes = r.notes, loading = false, error = null, editor = fresh)
                }
            } catch (e: ApiException) {
                _state.update { it.copy(loading = false, error = e.message) }
            }
        }
    }

    private fun observe() {
        viewModelScope.launch {
            container.socket.events.collect { event ->
                when (event.type) {
                    "note.updated", "note.deleted" -> load()
                }
            }
        }
    }

    fun search() = load()

    fun openNew() = _state.update { it.copy(editor = EditorTarget.New, saveState = SaveState.Idle, conflict = null) }

    fun edit(note: NoteDto) = _state.update {
        it.copy(editor = EditorTarget.Existing(note), saveState = SaveState.Idle, conflict = null)
    }

    fun closeEditor() {
        autoSaveJob?.cancel()
        _state.update { it.copy(editor = null, saveState = SaveState.Idle, conflict = null) }
    }

    /**
     * Otomatik kaydetme: kullanıcı yazmayı bıraktıktan 1.2 sn sonra.
     * Mevcut not ise version ile iyimser kilitleme; çakışma → ConflictInfo (sessiz ezme yok).
     */
    fun scheduleAutoSave(title: String, body: String, checklist: List<ChecklistItem>) {
        val target = _state.value.editor ?: return
        autoSaveJob?.cancel()
        autoSaveJob = viewModelScope.launch {
            delay(1200)
            save(title, body, checklist, target, pinned = null)
        }
    }

    fun saveNow(title: String, body: String, checklist: List<ChecklistItem>, pinned: Boolean?) {
        val target = _state.value.editor ?: return
        autoSaveJob?.cancel()
        viewModelScope.launch { save(title, body, checklist, target, pinned) }
    }

    private suspend fun save(
        title: String,
        body: String,
        checklist: List<ChecklistItem>,
        target: EditorTarget,
        pinned: Boolean?,
    ) {
        val t = token ?: return
        if (title.isBlank() && body.isBlank() && checklist.isEmpty()) return
        _state.update { it.copy(saveState = SaveState.Saving) }
        try {
            when (target) {
                EditorTarget.New -> {
                    val created = container.api.createNote(
                        t,
                        CreateNoteRequest(title = title, body = body, checklist = checklist),
                    )
                    _state.update { it.copy(saveState = SaveState.Saved, editor = EditorTarget.Existing(created)) }
                    load()
                }
                is EditorTarget.Existing -> {
                    val updated = container.api.updateNote(
                        t,
                        target.note.id,
                        UpdateNoteRequest(
                            baseVersion = target.note.version,
                            title = title,
                            body = body,
                            checklist = checklist,
                            pinned = pinned,
                        ),
                    )
                    _state.update {
                        it.copy(saveState = SaveState.Saved, editor = EditorTarget.Existing(updated))
                    }
                    if (pinned != null) load()
                }
            }
        } catch (e: ApiException) {
            if (e.status == 409) {
                // Sunucu güncel belgeyi döndürür; kullanıcıya seçim sunulur.
                val latest = runCatching { container.api.notes(t).notes.firstOrNull { n ->
                    (target as? EditorTarget.Existing)?.note?.id == n.id
                } }.getOrNull()
                _state.update {
                    it.copy(
                        saveState = SaveState.Failed,
                        conflict = ConflictInfo(
                            e.message ?: "Not başka bir yerde değiştirildi.",
                            latest ?: (target as EditorTarget.Existing).note,
                        ),
                    )
                }
            } else {
                _state.update { it.copy(saveState = SaveState.Failed, error = e.message) }
            }
        }
    }

    /** Çakışmada: güncel sürümü kabul et (kendi değişikliklerini bırak). */
    fun acceptTheirs() {
        val conflict = _state.value.conflict ?: return
        _state.update {
            it.copy(editor = EditorTarget.Existing(conflict.current), conflict = null, saveState = SaveState.Idle)
        }
    }

    fun dismissConflict() = _state.update { it.copy(conflict = null) }

    fun delete(note: NoteDto) {
        val t = token ?: return
        viewModelScope.launch {
            runCatching { container.api.deleteNote(t, note.id) }
            closeEditor()
            load()
        }
    }

    fun dismissError() = _state.update { it.copy(error = null) }
}

@Composable
fun NotesScreen(container: AppContainer) {
    val vm: NotesViewModel = androidx.lifecycle.viewmodel.compose.viewModel { NotesViewModel(container) }
    val state by vm.state.collectAsState()

    val editor = state.editor
    if (editor != null) {
        NoteEditor(vm, state, editor)
        return
    }

    var query by remember { mutableStateOf("") }

    Column(Modifier.fillMaxSize().padding(horizontal = 16.dp)) {
        Row(
            Modifier.fillMaxWidth().padding(top = 12.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text(
                "Ortak Notlar",
                style = MaterialTheme.typography.headlineMedium,
                color = MaterialTheme.colorScheme.primary,
                modifier = Modifier.weight(1f),
            )
            Button(onClick = { vm.openNew() }, shape = MaterialTheme.shapes.small) { Text("Yeni") }
        }
        Spacer(Modifier.height(8.dp))

        when {
            state.loading -> Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                CircularProgressIndicator(color = MaterialTheme.colorScheme.primary)
            }
            state.notes.isEmpty() -> Box(
                Modifier.fillMaxSize().padding(32.dp),
                contentAlignment = Alignment.Center,
            ) {
                Column(horizontalAlignment = Alignment.CenterHorizontally) {
                    Text(
                        "Henüz not yok",
                        style = MaterialTheme.typography.titleLarge,
                        color = MaterialTheme.colorScheme.primary,
                    )
                    Spacer(Modifier.height(8.dp))
                    Text(
                        "Alışveriş listesi, bir fikir ya da küçük bir hatırlatma — birlikte yazın.",
                        style = MaterialTheme.typography.bodyMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        textAlign = TextAlign.Center,
                    )
                }
            }
            else -> LazyColumn(
                verticalArrangement = Arrangement.spacedBy(10.dp),
                modifier = Modifier.weight(1f),
                contentPadding = PaddingValues(bottom = 16.dp),
            ) {
                items(state.notes, key = { it.id }) { note ->
                    Card(
                        shape = MaterialTheme.shapes.medium,
                        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
                        onClick = { vm.edit(note) },
                    ) {
                        Column(Modifier.padding(14.dp)) {
                            Row(verticalAlignment = Alignment.CenterVertically) {
                                Text(
                                    note.title.ifBlank { "(başlıksız)" },
                                    style = MaterialTheme.typography.titleMedium,
                                    modifier = Modifier.weight(1f),
                                )
                                if (note.pinned) Text("📌")
                            }
                            if (note.body.isNotBlank()) {
                                Spacer(Modifier.height(4.dp))
                                Text(
                                    note.body.take(180),
                                    style = MaterialTheme.typography.bodyMedium,
                                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                                    maxLines = 4,
                                )
                            }
                            if (note.checklist.isNotEmpty()) {
                                Spacer(Modifier.height(6.dp))
                                val done = note.checklist.count { it.done }
                                Text(
                                    "☑ $done/${note.checklist.size} tamamlandı",
                                    style = MaterialTheme.typography.bodyMedium,
                                    color = MaterialTheme.colorScheme.primary,
                                )
                            }
                        }
                    }
                }
            }
        }

        state.error?.let {
            Text(
                it,
                color = MaterialTheme.colorScheme.error,
                style = MaterialTheme.typography.bodyMedium,
                modifier = Modifier.padding(8.dp),
            )
        }
    }
}

@Composable
private fun NoteEditor(vm: NotesViewModel, state: NotesUiState, target: EditorTarget) {
    val existing = (target as? EditorTarget.Existing)?.note
    var title by remember(existing?.id) { mutableStateOf(existing?.title ?: "") }
    var body by remember(existing?.id) { mutableStateOf(existing?.body ?: "") }
    var checklist by remember(existing?.id) { mutableStateOf(existing?.checklist ?: emptyList<ChecklistItem>()) }
    var pinned by remember(existing?.id) { mutableStateOf(existing?.pinned ?: false) }
    var newItem by remember { mutableStateOf("") }

    Column(
        Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(
                if (existing == null) "Yeni not" else "Notu düzenle",
                style = MaterialTheme.typography.titleLarge,
                modifier = Modifier.weight(1f),
            )
            Text(
                when (state.saveState) {
                    SaveState.Saving -> "kaydediliyor…"
                    SaveState.Saved -> "kaydedildi"
                    SaveState.Failed -> "kaydedilemedi"
                    SaveState.Idle -> ""
                },
                style = MaterialTheme.typography.bodyMedium,
                color = if (state.saveState == SaveState.Failed) {
                    MaterialTheme.colorScheme.error
                } else {
                    MaterialTheme.colorScheme.onSurfaceVariant
                },
            )
            TextButton(onClick = {
                vm.saveNow(title, body, checklist, pinned)
                vm.closeEditor()
            }) { Text("Kapat") }
        }
        Spacer(Modifier.height(8.dp))
        OutlinedTextField(
            value = title,
            onValueChange = {
                title = it
                vm.scheduleAutoSave(title, body, checklist)
            },
            label = { Text("Başlık") },
            singleLine = true,
            modifier = Modifier.fillMaxWidth(),
        )
        Spacer(Modifier.height(8.dp))
        OutlinedTextField(
            value = body,
            onValueChange = {
                body = it
                vm.scheduleAutoSave(title, body, checklist)
            },
            label = { Text("Not") },
            modifier = Modifier.fillMaxWidth().heightIn(min = 140.dp),
            maxLines = 12,
        )

        Spacer(Modifier.height(16.dp))
        Text("Kontrol listesi", style = MaterialTheme.typography.titleMedium)
        checklist.forEachIndexed { index, item ->
            Row(verticalAlignment = Alignment.CenterVertically) {
                Checkbox(
                    checked = item.done,
                    onCheckedChange = { checked ->
                        checklist = checklist.toMutableList().also { it[index] = item.copy(done = checked) }
                        vm.scheduleAutoSave(title, body, checklist)
                    },
                )
                Text(item.text, Modifier.weight(1f), style = MaterialTheme.typography.bodyLarge)
                TextButton(onClick = {
                    checklist = checklist.filterIndexed { i, _ -> i != index }
                    vm.scheduleAutoSave(title, body, checklist)
                }) { Text("✕") }
            }
        }
        Row(verticalAlignment = Alignment.CenterVertically) {
            OutlinedTextField(
                value = newItem,
                onValueChange = { newItem = it },
                placeholder = { Text("Madde ekle…") },
                singleLine = true,
                modifier = Modifier.weight(1f),
            )
            Spacer(Modifier.width(8.dp))
            Button(onClick = {
                if (newItem.isNotBlank()) {
                    checklist = checklist + ChecklistItem(java.util.UUID.randomUUID().toString(), newItem.trim())
                    newItem = ""
                    vm.scheduleAutoSave(title, body, checklist)
                }
            }) { Text("Ekle") }
        }

        Spacer(Modifier.height(12.dp))
        FilterChip(
            selected = pinned,
            onClick = {
                pinned = !pinned
                vm.saveNow(title, body, checklist, pinned)
            },
            label = { Text("Sabitle") },
        )

        Spacer(Modifier.height(16.dp))
        Button(
            onClick = {
                vm.saveNow(title, body, checklist, pinned)
                vm.closeEditor()
            },
            modifier = Modifier.fillMaxWidth().height(52.dp),
            shape = MaterialTheme.shapes.medium,
        ) { Text("Kaydet ve kapat", style = MaterialTheme.typography.labelLarge) }

        if (existing != null) {
            Spacer(Modifier.height(8.dp))
            TextButton(onClick = { vm.delete(existing) }) {
                Text("Notu sil", color = MaterialTheme.colorScheme.error)
            }
        }
        Spacer(Modifier.height(24.dp))
    }

    state.conflict?.let { conflict ->
        androidx.compose.material3.AlertDialog(
            onDismissRequest = { vm.dismissConflict() },
            title = { Text("Not başka yerde değişti") },
            text = {
                Text(
                    "${conflict.message}\n\nSenin yazdıklarınla karşı tarafınki çakışıyor. " +
                        "Güncel sürümü açıp yeniden düzenleyebilirsin.",
                )
            },
            confirmButton = {
                TextButton(onClick = { vm.acceptTheirs() }) { Text("Günceli aç") }
            },
            dismissButton = { TextButton(onClick = { vm.dismissConflict() }) { Text("Kapat") } },
        )
    }
}
