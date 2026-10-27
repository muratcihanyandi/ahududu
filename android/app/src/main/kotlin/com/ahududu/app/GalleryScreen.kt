package com.ahududu.app

import android.graphics.BitmapFactory
import android.net.Uri
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.PickVisualMediaRequest
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.ahududu.common.api.ApiException
import com.ahududu.common.api.MediaDto
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.net.URL
import java.net.URLEncoder

data class GalleryUiState(
    val items: List<MediaDto> = emptyList(),
    val loading: Boolean = true,
    val uploading: Boolean = false,
    val error: String? = null,
    val storageBytes: Long = 0,
    val storageFiles: Int = 0,
    val viewer: MediaDto? = null,
)

class GalleryViewModel(private val container: AppContainer) : ViewModel() {
    private val _state = MutableStateFlow(GalleryUiState())
    val state: StateFlow<GalleryUiState> = _state.asStateFlow()
    private val token get() = container.tokenStore.get()
    private val thumbs = mutableMapOf<String, android.graphics.Bitmap>()

    init {
        load()
        observe()
    }

    fun load() {
        val t = token ?: return
        viewModelScope.launch {
            try {
                val r = container.api.gallery(t)
                val storage = runCatching { container.api.storage(t) }.getOrNull()
                _state.update {
                    it.copy(
                        items = r.items,
                        loading = false,
                        error = null,
                        storageBytes = storage?.totalBytes ?: it.storageBytes,
                        storageFiles = storage?.files ?: it.storageFiles,
                    )
                }
            } catch (e: ApiException) {
                _state.update { it.copy(loading = false, error = e.message) }
            }
        }
    }

    private fun observe() {
        viewModelScope.launch {
            container.socket.events.collect { event ->
                if (event.type == "media.new" || event.type == "media.deleted") load()
            }
        }
    }

    /** Küçük resmi indirir (bellek önbellekli). */
    suspend fun thumbnail(media: MediaDto): android.graphics.Bitmap? {
        thumbs[media.id]?.let { return it }
        return withContext(Dispatchers.IO) {
            runCatching {
                val url = container.api.mediaFileUrl(media.id, thumb = true)
                val conn = URL(url).openConnection() as java.net.HttpURLConnection
                conn.setRequestProperty("Authorization", "Bearer ${token ?: return@runCatching null}")
                conn.connectTimeout = 10_000
                conn.readTimeout = 15_000
                val bytes = conn.inputStream.use { it.readBytes() }
                BitmapFactory.decodeByteArray(bytes, 0, bytes.size)?.also { thumbs[media.id] = it }
            }.getOrNull()
        }
    }

    suspend fun fullImage(media: MediaDto): android.graphics.Bitmap? = withContext(Dispatchers.IO) {
        runCatching {
            val url = container.api.mediaFileUrl(media.id, thumb = false)
            val conn = URL(url).openConnection() as java.net.HttpURLConnection
            conn.setRequestProperty("Authorization", "Bearer ${token ?: return@runCatching null}")
            conn.connectTimeout = 15_000
            conn.readTimeout = 30_000
            val bytes = conn.inputStream.use { it.readBytes() }
            BitmapFactory.decodeByteArray(bytes, 0, bytes.size)
        }.getOrNull()
    }

    fun upload(context: android.content.Context, uri: Uri, caption: String = "") {
        val t = token ?: return
        _state.update { it.copy(uploading = true, error = null) }
        viewModelScope.launch {
            try {
                val (bytes, mime) = withContext(Dispatchers.IO) {
                    val resolver = context.contentResolver
                    val type = resolver.getType(uri) ?: "image/jpeg"
                    val stream = resolver.openInputStream(uri)
                        ?: throw IllegalStateException("Dosya açılamadı")
                    stream.use { it.readBytes() } to type
                }
                val fileName = mime.substringAfter('/').let { "media.$it" }
                container.api.uploadMedia(t, bytes, fileName, mime, caption)
                _state.update { it.copy(uploading = false) }
                load()
            } catch (e: ApiException) {
                _state.update { it.copy(uploading = false, error = e.message) }
            } catch (e: Exception) {
                _state.update { it.copy(uploading = false, error = "Yükleme başarısız: ${e.message}") }
            }
        }
    }

    fun openViewer(media: MediaDto) = _state.update { it.copy(viewer = media) }
    fun closeViewer() = _state.update { it.copy(viewer = null) }
    fun dismissError() = _state.update { it.copy(error = null) }
}

@Composable
fun GalleryScreen(container: AppContainer) {
    val vm: GalleryViewModel = androidx.lifecycle.viewmodel.compose.viewModel { GalleryViewModel(container) }
    val state by vm.state.collectAsState()
    val context = LocalContext.current

    val picker = rememberLauncherForActivityResult(ActivityResultContracts.PickVisualMedia()) { uri ->
        if (uri != null) vm.upload(context, uri)
    }

    state.viewer?.let { media ->
        FullScreenViewer(vm, media, onClose = { vm.closeViewer() })
        return
    }

    Column(Modifier.fillMaxSize().padding(horizontal = 16.dp)) {
        Row(
            Modifier.fillMaxWidth().padding(top = 12.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Column(Modifier.weight(1f)) {
                Text(
                    "Ortak Anılar",
                    style = MaterialTheme.typography.headlineMedium,
                    color = MaterialTheme.colorScheme.primary,
                )
                Text(
                    "${state.storageFiles} anı · ${formatBytes(state.storageBytes)}",
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
            Button(
                onClick = {
                    picker.launch(PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.ImageAndVideo))
                },
                enabled = !state.uploading,
                shape = MaterialTheme.shapes.small,
            ) { Text(if (state.uploading) "Yükleniyor…" else "Ekle") }
        }
        Spacer(Modifier.height(12.dp))

        when {
            state.loading -> Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                CircularProgressIndicator(color = MaterialTheme.colorScheme.primary)
            }
            state.items.isEmpty() -> Box(
                Modifier.fillMaxSize().padding(32.dp),
                contentAlignment = Alignment.Center,
            ) {
                Column(horizontalAlignment = Alignment.CenterHorizontally) {
                    Text(
                        "Henüz anı yok",
                        style = MaterialTheme.typography.titleLarge,
                        color = MaterialTheme.colorScheme.primary,
                    )
                    Spacer(Modifier.height(8.dp))
                    Text(
                        "İlk fotoğrafınızı ekleyin — birlikte biriktirdiğiniz her an burada dursun.",
                        style = MaterialTheme.typography.bodyMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        textAlign = TextAlign.Center,
                    )
                }
            }
            else -> LazyVerticalGrid(
                columns = GridCells.Fixed(3),
                horizontalArrangement = Arrangement.spacedBy(4.dp),
                verticalArrangement = Arrangement.spacedBy(4.dp),
                contentPadding = PaddingValues(bottom = 16.dp),
                modifier = Modifier.weight(1f),
            ) {
                items(state.items, key = { it.id }) { media ->
                    GalleryTile(vm, media, onClick = { vm.openViewer(media) })
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
private fun GalleryTile(vm: GalleryViewModel, media: MediaDto, onClick: () -> Unit) {
    var bitmap by remember(media.id) { mutableStateOf<android.graphics.Bitmap?>(null) }
    androidx.compose.runtime.LaunchedEffect(media.id) {
        bitmap = vm.thumbnail(media)
    }
    Box(
        Modifier
            .aspectRatio(1f)
            .background(MaterialTheme.colorScheme.surfaceVariant)
            .clickable(onClick = onClick),
        contentAlignment = Alignment.Center,
    ) {
        val bmp = bitmap
        if (bmp != null) {
            Image(
                bitmap = bmp.asImageBitmap(),
                contentDescription = media.caption.ifBlank { "Anı" },
                modifier = Modifier.fillMaxSize(),
                contentScale = ContentScale.Crop,
            )
        } else {
            Text(
                if (media.kind == "video") "🎬" else "🖼",
                style = MaterialTheme.typography.headlineMedium,
            )
        }
    }
}

@Composable
private fun FullScreenViewer(vm: GalleryViewModel, media: MediaDto, onClose: () -> Unit) {
    var bitmap by remember(media.id) { mutableStateOf<android.graphics.Bitmap?>(null) }
    var loading by remember(media.id) { mutableStateOf(true) }

    androidx.compose.runtime.LaunchedEffect(media.id) {
        bitmap = vm.fullImage(media)
        loading = false
    }

    Box(Modifier.fillMaxSize().background(Color.Black)) {
        val bmp = bitmap
        if (bmp != null) {
            Image(
                bitmap = bmp.asImageBitmap(),
                contentDescription = media.caption.ifBlank { "Anı" },
                modifier = Modifier.fillMaxSize().padding(8.dp),
                contentScale = ContentScale.Fit,
            )
        } else if (loading) {
            CircularProgressIndicator(
                Modifier.align(Alignment.Center),
                color = MaterialTheme.colorScheme.primary,
            )
        } else {
            Text(
                "Görsel yüklenemedi",
                Modifier.align(Alignment.Center),
                color = Color.White,
            )
        }

        Surface(
            modifier = Modifier.align(Alignment.TopEnd).padding(12.dp),
            shape = MaterialTheme.shapes.small,
            color = Color.Black.copy(alpha = 0.5f),
        ) {
            TextButton(onClick = onClose) { Text("Kapat", color = Color.White) }
        }

        if (media.caption.isNotBlank() || media.uploaderName.isNotBlank()) {
            Surface(
                modifier = Modifier.align(Alignment.BottomCenter).fillMaxWidth(),
                color = Color.Black.copy(alpha = 0.55f),
            ) {
                Column(Modifier.padding(16.dp)) {
                    if (media.caption.isNotBlank()) {
                        Text(media.caption, color = Color.White, style = MaterialTheme.typography.bodyLarge)
                    }
                    Text(
                        "${media.uploaderName} · ${formatTime(media.createdAt)}",
                        color = Color.White.copy(alpha = 0.75f),
                        style = MaterialTheme.typography.bodyMedium,
                    )
                }
            }
        }
    }
}

fun formatBytes(bytes: Long): String = when {
    bytes >= 1_073_741_824 -> "%.1f GB".format(bytes / 1_073_741_824.0)
    bytes >= 1_048_576 -> "%.1f MB".format(bytes / 1_048_576.0)
    bytes >= 1_024 -> "%.0f KB".format(bytes / 1_024.0)
    else -> "$bytes B"
}
