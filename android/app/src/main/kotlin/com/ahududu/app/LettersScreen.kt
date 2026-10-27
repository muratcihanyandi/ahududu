package com.ahududu.app

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
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
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.FilterChip
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.ahududu.common.api.ApiException
import com.ahududu.common.api.LetterDto
import com.ahududu.common.api.LetterPageDto
import com.ahududu.common.api.SaveDraftRequest
import com.ahududu.common.api.StrokeDto
import com.ahududu.common.api.UpdateLetterRequest
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import java.util.UUID

data class LettersUiState(
    val letters: List<LetterDto> = emptyList(),
    val loading: Boolean = true,
    val box: String = "all",
    val favoriteOnly: Boolean = false,
    val error: String? = null,
    /** Editör: null kapalı; EditTarget.New → yeni; EditTarget.Existing → açılan mektup */
    val editor: LetterEditorState? = null,
    val reader: LetterDto? = null,
    val saveState: SaveState = SaveState.Idle,
)

data class LetterEditorState(
    val letterId: String?,
    val clientDraftId: String,
    val title: String,
    val body: String,
    val paperStyle: String,
    val envelopeStyle: String,
    val pages: MutableList<MutableList<StrokeDto>>,
    val isSent: Boolean,
    val pageIndex: Int = 0,
)

class LettersViewModel(private val container: AppContainer) : ViewModel() {
    private val _state = MutableStateFlow(LettersUiState())
    val state: StateFlow<LettersUiState> = _state.asStateFlow()
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
                val box = _state.value.box.takeIf { it != "all" }
                val r = container.api.letters(t, box, _state.value.favoriteOnly)
                _state.update { it.copy(letters = r.letters, loading = false, error = null) }
            } catch (e: ApiException) {
                _state.update { it.copy(loading = false, error = e.message) }
            }
        }
    }

    private fun observe() {
        viewModelScope.launch {
            container.socket.events.collect { event ->
                if (event.type == "letter.new" || event.type == "letter.read") load()
            }
        }
    }

    fun setBox(box: String) {
        _state.update { it.copy(box = box, loading = true) }
        load()
    }

    fun toggleFavoriteFilter() {
        _state.update { it.copy(favoriteOnly = !it.favoriteOnly, loading = true) }
        load()
    }

    fun openNew() {
        val pages = mutableListOf<MutableList<StrokeDto>>(mutableListOf())
        _state.update {
            it.copy(
                editor = LetterEditorState(
                    letterId = null,
                    clientDraftId = UUID.randomUUID().toString(),
                    title = "",
                    body = "",
                    paperStyle = "klasik",
                    envelopeStyle = "klasik",
                    pages = pages,
                    isSent = false,
                ),
                saveState = SaveState.Idle,
            )
        }
    }

    fun openDraft(letter: LetterDto) {
        val t = token ?: return
        viewModelScope.launch {
            try {
                val full = container.api.letter(t, letter.id)
                val pages = mutableListOf<MutableList<StrokeDto>>()
                if (full.pages.isEmpty()) {
                    pages.add(mutableListOf())
                } else {
                    full.pages.forEach { p -> pages.add(p.strokes.toMutableList()) }
                }
                _state.update {
                    it.copy(
                        editor = LetterEditorState(
                            letterId = full.id,
                            clientDraftId = "existing-${full.id}",
                            title = full.title,
                            body = full.bodyMd,
                            paperStyle = full.paperStyle,
                            envelopeStyle = full.envelopeStyle,
                            pages = pages,
                            isSent = full.status != "draft",
                        ),
                        saveState = SaveState.Idle,
                    )
                }
            } catch (e: ApiException) {
                _state.update { it.copy(error = e.message) }
            }
        }
    }

    fun openReader(letter: LetterDto) {
        val t = token ?: return
        viewModelScope.launch {
            try {
                val full = container.api.letter(t, letter.id)
                _state.update { it.copy(reader = full) }
                if (!full.mine && full.firstReadAt == null) {
                    runCatching { container.api.markLetterRead(t, full.id) }
                }
            } catch (e: ApiException) {
                _state.update { it.copy(error = e.message) }
            }
        }
    }

    fun closeReader() = _state.update { it.copy(reader = null) }
    fun closeEditor() {
        autoSaveJob?.cancel()
        _state.update { it.copy(editor = null, saveState = SaveState.Idle) }
    }

    fun updateEditor(transform: (LetterEditorState) -> LetterEditorState) {
        _state.update { current ->
            val editor = current.editor ?: return@update current
            current.copy(editor = transform(editor))
        }
        scheduleAutoSave()
    }

    fun scheduleAutoSave() {
        autoSaveJob?.cancel()
        autoSaveJob = viewModelScope.launch {
            delay(1500)
            persistEditor()
        }
    }

    fun persistEditor() {
        val t = token ?: return
        val editor = _state.value.editor ?: return
        if (editor.isSent) return
        if (editor.title.isBlank() && editor.body.isBlank() && editor.pages.all { it.isEmpty() }) return
        viewModelScope.launch {
            _state.update { it.copy(saveState = SaveState.Saving) }
            try {
                val pages = editor.pages.mapIndexed { index, strokes ->
                    LetterPageDto(pageNo = index + 1, background = pageBackground(editor.paperStyle), strokes = strokes.toList())
                }
                if (editor.letterId == null) {
                    val created = container.api.saveDraft(
                        t,
                        SaveDraftRequest(
                            clientDraftId = editor.clientDraftId,
                            title = editor.title,
                            bodyMd = editor.body,
                            paperStyle = editor.paperStyle,
                            envelopeStyle = editor.envelopeStyle,
                        ),
                    )
                    container.api.updateLetter(t, created.id, UpdateLetterRequest(pages = pages))
                    _state.update { current ->
                        current.copy(
                            saveState = SaveState.Saved,
                            editor = current.editor?.copy(letterId = created.id),
                        )
                    }
                } else {
                    container.api.updateLetter(
                        t, editor.letterId,
                        UpdateLetterRequest(title = editor.title, bodyMd = editor.body, pages = pages),
                    )
                    _state.update { it.copy(saveState = SaveState.Saved) }
                }
            } catch (e: ApiException) {
                _state.update { it.copy(saveState = SaveState.Failed, error = e.message) }
            }
        }
    }

    fun send() {
        val t = token ?: return
        val editor = _state.value.editor ?: return
        viewModelScope.launch {
            try {
                persistEditorSuspending()
                val id = (_state.value.editor?.letterId) ?: run {
                    _state.update { it.copy(error = "Taslak kaydedilemedi, tekrar dene.") }
                    return@launch
                }
                val sent = container.api.sendLetter(t, id)
                _state.update { it.copy(editor = null, error = null, saveState = SaveState.Idle) }
                load()
                _state.update { it.copy(reader = sent) }
            } catch (e: ApiException) {
                _state.update { it.copy(error = e.message) }
            }
        }
    }

    private suspend fun persistEditorSuspending() {
        val t = token ?: return
        val editor = _state.value.editor ?: return
        val pages = editor.pages.mapIndexed { index, strokes ->
            LetterPageDto(pageNo = index + 1, background = pageBackground(editor.paperStyle), strokes = strokes.toList())
        }
        if (editor.letterId == null) {
            val created = container.api.saveDraft(
                t,
                SaveDraftRequest(
                    clientDraftId = editor.clientDraftId,
                    title = editor.title,
                    bodyMd = editor.body,
                    paperStyle = editor.paperStyle,
                    envelopeStyle = editor.envelopeStyle,
                ),
            )
            container.api.updateLetter(t, created.id, UpdateLetterRequest(pages = pages))
            _state.update { it.copy(editor = it.editor?.copy(letterId = created.id)) }
        } else {
            container.api.updateLetter(
                t, editor.letterId,
                UpdateLetterRequest(title = editor.title, bodyMd = editor.body, pages = pages),
            )
        }
    }

    fun toggleFavorite(letter: LetterDto) {
        val t = token ?: return
        viewModelScope.launch {
            runCatching { container.api.favoriteLetter(t, letter.id, !letter.favorite) }
            load()
            _state.update { s ->
                s.copy(reader = s.reader?.let { if (it.id == letter.id) it.copy(favorite = !it.favorite) else it })
            }
        }
    }

    fun delete(letter: LetterDto) {
        val t = token ?: return
        viewModelScope.launch {
            runCatching { container.api.deleteLetter(t, letter.id) }
            _state.update { it.copy(reader = null) }
            load()
        }
    }

    fun dismissError() = _state.update { it.copy(error = null) }
}

private fun pageBackground(paperStyle: String): String = when (paperStyle) {
    "cizgili" -> "lined"
    "minimal" -> "plain"
    else -> "lined"
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun LettersScreen(container: AppContainer) {
    val vm: LettersViewModel = androidx.lifecycle.viewmodel.compose.viewModel { LettersViewModel(container) }
    val state by vm.state.collectAsState()

    state.reader?.let { letter ->
        LetterReader(vm, letter)
        return
    }
    val editor = state.editor
    if (editor != null) {
        LetterEditor(vm, state, editor)
        return
    }

    Column(Modifier.fillMaxSize()) {
        Row(
            Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 12.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text(
                "Mektuplar",
                style = MaterialTheme.typography.headlineMedium,
                color = MaterialTheme.colorScheme.primary,
                modifier = Modifier.weight(1f),
            )
            Button(onClick = { vm.openNew() }, shape = MaterialTheme.shapes.small) { Text("Yaz") }
        }
        Row(Modifier.fillMaxWidth().padding(horizontal = 12.dp)) {
            FocusChip("Tümü", state.box == "all") { vm.setBox("all") }
            FocusChip("Gelen", state.box == "inbox") { vm.setBox("inbox") }
            FocusChip("Gönderilen", state.box == "sent") { vm.setBox("sent") }
            FocusChip("Taslaklar", state.box == "drafts") { vm.setBox("drafts") }
            FocusChip("★", state.favoriteOnly) { vm.toggleFavoriteFilter() }
        }
        Spacer(Modifier.height(8.dp))

        when {
            state.loading -> Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                CircularProgressIndicator(color = MaterialTheme.colorScheme.primary)
            }
            state.letters.isEmpty() -> Box(
                Modifier.fillMaxSize().padding(32.dp),
                contentAlignment = Alignment.Center,
            ) {
                Column(horizontalAlignment = Alignment.CenterHorizontally) {
                    Text(
                        "Henüz mektup yok",
                        style = MaterialTheme.typography.titleLarge,
                        color = MaterialTheme.colorScheme.primary,
                    )
                    Spacer(Modifier.height(8.dp))
                    Text(
                        "Bir mektup, birkaç satır, belki küçük bir çizim… İlkini sen yaz.",
                        style = MaterialTheme.typography.bodyMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        textAlign = TextAlign.Center,
                    )
                }
            }
            else -> LazyColumn(
                contentPadding = PaddingValues(horizontal = 16.dp, vertical = 8.dp),
                verticalArrangement = Arrangement.spacedBy(10.dp),
                modifier = Modifier.weight(1f),
            ) {
                items(state.letters, key = { it.id }) { letter ->
                    LetterCard(
                        letter,
                        onClick = {
                            if (letter.status == "draft") vm.openDraft(letter) else vm.openReader(letter)
                        },
                    )
                }
            }
        }
        state.error?.let {
            Text(
                it,
                color = MaterialTheme.colorScheme.error,
                style = MaterialTheme.typography.bodyMedium,
                modifier = Modifier.padding(12.dp),
            )
        }
    }
}

@Composable
private fun FocusChip(label: String, selected: Boolean, onClick: () -> Unit) {
    Box(Modifier.padding(end = 6.dp)) {
        FilterChip(selected = selected, onClick = onClick, label = { Text(label) })
    }
}

@Composable
private fun LetterCard(letter: LetterDto, onClick: () -> Unit) {
    Card(
        shape = MaterialTheme.shapes.medium,
        colors = CardDefaults.cardColors(
            containerColor = if (letter.status == "draft") {
                MaterialTheme.colorScheme.surfaceVariant
            } else {
                MaterialTheme.colorScheme.surface
            },
        ),
        onClick = onClick,
        modifier = Modifier.fillMaxWidth(),
    ) {
        Column(Modifier.padding(16.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(
                    letter.title.ifBlank { "(başlıksız)" },
                    style = MaterialTheme.typography.titleLarge,
                    modifier = Modifier.weight(1f),
                )
                if (letter.favorite) Text("★")
            }
            Spacer(Modifier.height(4.dp))
            val meta = buildString {
                append(if (letter.mine) "Sen" else letter.authorName)
                append(" · ")
                append(formatDate(letter.sentAt ?: letter.updatedAt))
                when (letter.status) {
                    "draft" -> append(" · taslak")
                    "read" -> append(" · okundu")
                    else -> append(" · gönderildi")
                }
                if (letter.pageCount > 0) append(" · ${letter.pageCount} sayfa")
            }
            Text(
                meta,
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            if (letter.bodyMd.isNotBlank()) {
                Spacer(Modifier.height(6.dp))
                Text(
                    letter.bodyMd.lineSequence().take(2).joinToString(" ").take(140),
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        }
    }
}

@Composable
private fun LetterEditor(vm: LettersViewModel, state: LettersUiState, editor: LetterEditorState) {
    Column(Modifier.fillMaxSize()) {
        Row(
            Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 8.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            TextButton(onClick = {
                vm.persistEditor()
                vm.closeEditor()
            }) { Text("Geri") }
            Text(
                when (state.saveState) {
                    SaveState.Saving -> "kaydediliyor…"
                    SaveState.Saved -> "kaydedildi"
                    SaveState.Failed -> "kaydedilemedi"
                    SaveState.Idle -> if (editor.isSent) "mektup" else "taslak"
                },
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.weight(1f),
            )
            if (!editor.isSent) {
                Button(
                    onClick = { vm.send() },
                    enabled = editor.title.isNotBlank() || editor.body.isNotBlank() || editor.pages.any { it.isNotEmpty() },
                    shape = MaterialTheme.shapes.small,
                ) { Text("Gönder") }
            }
        }

        Column(
            Modifier.weight(1f).verticalScroll(rememberScrollState()).padding(horizontal = 16.dp),
        ) {
            OutlinedTextField(
                value = editor.title,
                onValueChange = { value -> vm.updateEditor { it.copy(title = value) } },
                label = { Text("Başlık") },
                singleLine = true,
                modifier = Modifier.fillMaxWidth(),
            )
            Spacer(Modifier.height(8.dp))
            Row {
                listOf("klasik" to "Klasik", "cizgili" to "Çizgili", "minimal" to "Minimal", "ozelgun" to "Özel gün")
                    .forEach { (id, label) ->
                        FocusChip(label, editor.paperStyle == id) {
                            vm.updateEditor { it.copy(paperStyle = id) }
                        }
                    }
            }
            Spacer(Modifier.height(10.dp))
            OutlinedTextField(
                value = editor.body,
                onValueChange = { value -> vm.updateEditor { it.copy(body = value) } },
                label = { Text("Mektubun") },
                modifier = Modifier.fillMaxWidth().heightIn(min = 180.dp),
                maxLines = 20,
            )
        }

        // Çizim alanı — sayfa seçici ile
        Surface(color = MaterialTheme.colorScheme.background, tonalElevation = 2.dp) {
            Column(Modifier.fillMaxWidth()) {
                Row(
                    Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 4.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Text(
                        "Çizim · sayfa ${editor.pageIndex + 1}/${editor.pages.size}",
                        style = MaterialTheme.typography.bodyMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        modifier = Modifier.weight(1f),
                    )
                    TextButton(onClick = {
                        vm.updateEditor {
                            val pages = it.pages
                            pages.add(mutableListOf())
                            it.copy(pages = pages, pageIndex = pages.size - 1)
                        }
                    }) { Text("+ Sayfa") }
                    if (editor.pages.size > 1) {
                        TextButton(onClick = {
                            vm.updateEditor {
                                val pages = it.pages
                                if (pages.size > 1) {
                                    pages.removeAt(pages.lastIndex)
                                    it.copy(pages = pages, pageIndex = minOf(it.pageIndex, pages.lastIndex))
                                } else it
                            }
                        }) { Text("Sayfayı sil") }
                    }
                }
                if (editor.pageIndex < editor.pages.size) {
                    DrawingCanvas(
                        strokes = editor.pages[editor.pageIndex],
                        onStrokesChanged = { vm.scheduleAutoSave() },
                        paperStyle = pageBackground(editor.paperStyle),
                        modifier = Modifier.fillMaxWidth().height(320.dp),
                    )
                }
            }
        }
    }
}

@Composable
private fun LetterReader(vm: LettersViewModel, letter: LetterDto) {
    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(20.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            TextButton(onClick = { vm.closeReader() }) { Text("Geri") }
            Spacer(Modifier.weight(1f))
            TextButton(onClick = { vm.toggleFavorite(letter) }) {
                Text(if (letter.favorite) "★ Favori" else "☆ Favorile")
            }
        }

        Card(
            shape = MaterialTheme.shapes.large,
            colors = CardDefaults.cardColors(containerColor = paperColorFor(letter.paperStyle)),
            modifier = Modifier.fillMaxWidth(),
        ) {
            Column(Modifier.padding(24.dp)) {
                Text(
                    letter.title.ifBlank { "(başlıksız)" },
                    style = MaterialTheme.typography.headlineMedium.copy(fontFamily = FontFamily.Serif),
                    color = MaterialTheme.colorScheme.onSurface,
                )
                Spacer(Modifier.height(6.dp))
                Text(
                    "${letter.authorName} · ${formatDate(letter.sentAt ?: letter.createdAt)}",
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                Spacer(Modifier.height(20.dp))
                Text(
                    letter.bodyMd,
                    style = MaterialTheme.typography.bodyLarge.copy(lineHeight = MaterialTheme.typography.bodyLarge.lineHeight * 1.35f),
                )
            }
        }

        // Çizim sayfaları
        letter.pages.forEach { page ->
            if (page.strokes.isNotEmpty()) {
                Spacer(Modifier.height(12.dp))
                Card(
                    shape = MaterialTheme.shapes.medium,
                    colors = CardDefaults.cardColors(containerColor = paperColorFor(letter.paperStyle)),
                    modifier = Modifier.fillMaxWidth(),
                ) {
                    Box(Modifier.fillMaxWidth().height(340.dp)) {
                        DrawingView(strokes = page.strokes, paperStyle = page.background)
                    }
                }
            }
        }

        Spacer(Modifier.height(16.dp))
        if (letter.mine) {
            TextButton(onClick = { vm.delete(letter) }) {
                Text("Mektubu sil", color = MaterialTheme.colorScheme.error)
            }
        }
    }
}

@Composable
private fun DrawingView(strokes: List<StrokeDto>, paperStyle: String) {
    val holder = remember(strokes) { mutableStateListOf<StrokeDto>().also { it.addAll(strokes) } }
    Box(Modifier.fillMaxSize()) {
        DrawingCanvas(
            strokes = holder,
            onStrokesChanged = { },
            paperStyle = paperStyle,
            modifier = Modifier.fillMaxSize(),
        )
    }
}

private fun paperColorFor(style: String) = when (style) {
    "cizgili" -> androidx.compose.ui.graphics.Color(0xFFFFFEFA)
    "minimal" -> androidx.compose.ui.graphics.Color(0xFFFAF6EF)
    "ozelgun" -> androidx.compose.ui.graphics.Color(0xFFFDEEF2)
    else -> androidx.compose.ui.graphics.Color(0xFFFDF8F3)
}

private val dateFormatter = java.time.format.DateTimeFormatter
    .ofPattern("d MMM yyyy")
    .withZone(java.time.ZoneId.systemDefault())
    .withLocale(java.util.Locale("tr", "TR"))

fun formatDate(iso: String): String = runCatching {
    dateFormatter.format(java.time.Instant.parse(iso))
}.getOrElse { "" }
