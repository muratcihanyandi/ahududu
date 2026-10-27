package com.ahududu.app

import android.media.MediaPlayer
import android.widget.VideoView
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.PickVisualMediaRequest
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import com.ahududu.common.api.AttachmentDto
import com.ahududu.common.api.MessageDto
import com.ahududu.common.api.QueuedMessage
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.io.File
import java.net.HttpURLConnection
import java.net.URL
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter

@Composable
fun ChatScreen(container: AppContainer) {
    val vm: ChatViewModel = androidx.lifecycle.viewmodel.compose.viewModel { ChatViewModel(container) }
    val state by vm.state.collectAsState()
    val context = LocalContext.current
    var draft by remember { mutableStateOf("") }
    var pendingIds by remember { mutableStateOf<List<String>>(emptyList()) }
    val listState = rememberLazyListState()

    val picker = rememberLauncherForActivityResult(ActivityResultContracts.PickVisualMedia()) { uri ->
        if (uri != null) {
            vm.uploadAttachment(context, uri) { id -> pendingIds = pendingIds + id }
        }
    }
    val recorder = remember { AudioNoteRecorder(context) }
    var recording by remember { mutableStateOf(false) }
    val recordPermission = rememberLauncherForActivityResult(
        ActivityResultContracts.RequestPermission()
    ) { granted ->
        if (granted) {
            recorder.start()
            recording = true
        }
    }

    LaunchedEffect(state.messages.size, state.queued.size) {
        val total = state.messages.size + state.queued.size
        if (total > 0) listState.animateScrollToItem(total - 1)
    }

    Column(Modifier.fillMaxSize()) {
        if (!state.connected) {
            Surface(color = MaterialTheme.colorScheme.secondaryContainer) {
                Text(
                    "Bağlantı yok — mesajlar kuyruğa alınır, bağlantı gelince gönderilir.",
                    Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 8.dp),
                    style = MaterialTheme.typography.bodyMedium,
                )
            }
        }

        if (state.loading) {
            Box(Modifier.weight(1f).fillMaxWidth(), contentAlignment = Alignment.Center) {
                CircularProgressIndicator(color = MaterialTheme.colorScheme.primary)
            }
        } else if (state.messages.isEmpty() && state.queued.isEmpty()) {
            Box(Modifier.weight(1f).fillMaxWidth().padding(32.dp), contentAlignment = Alignment.Center) {
                Column(horizontalAlignment = Alignment.CenterHorizontally) {
                    Text(
                        "Henüz mesaj yok",
                        style = MaterialTheme.typography.titleLarge,
                        color = MaterialTheme.colorScheme.primary,
                    )
                    Spacer(Modifier.height(8.dp))
                    Text(
                        "İlk mesajı sen yaz — günün nasıl geçti?",
                        style = MaterialTheme.typography.bodyMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        textAlign = TextAlign.Center,
                    )
                }
            }
        } else {
            LazyColumn(
                state = listState,
                modifier = Modifier.weight(1f).fillMaxWidth(),
                contentPadding = PaddingValues(16.dp),
                verticalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                items(state.messages, key = { it.id }) { msg ->
                    MessageBubble(container, msg, onReact = { vm.react(msg) }, onDelete = { vm.delete(msg) })
                }
                items(state.queued, key = { "q-" + it.clientMsgId }) { q ->
                    QueuedBubble(q)
                }
            }
        }

        state.replyTo?.let { reply ->
            Surface(color = MaterialTheme.colorScheme.secondaryContainer) {
                Row(
                    Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 8.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Text(
                        "${reply.senderName}: ${reply.body.take(40)}",
                        style = MaterialTheme.typography.bodyMedium,
                        modifier = Modifier.weight(1f),
                    )
                    TextButton(onClick = { vm.setReplyTo(null) }) { Text("İptal") }
                }
            }
        }

        // Yüklenen ama henüz gönderilmemiş ekler
        if (pendingIds.isNotEmpty() || state.uploading) {
            Surface(color = MaterialTheme.colorScheme.surfaceVariant) {
                Row(
                    Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 8.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Text(
                        if (state.uploading) "Ek yükleniyor…" else "${pendingIds.size} ek hazır",
                        style = MaterialTheme.typography.bodyMedium,
                        modifier = Modifier.weight(1f),
                    )
                    if (!state.uploading) {
                        TextButton(onClick = { pendingIds = emptyList() }) { Text("Ekleri kaldır") }
                    }
                }
            }
        }

        if (recording) {
            Surface(color = MaterialTheme.colorScheme.primaryContainer) {
                Row(
                    Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 10.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Text("🎙 Ses kaydediliyor…", style = MaterialTheme.typography.bodyLarge, modifier = Modifier.weight(1f))
                    TextButton(onClick = {
                        recording = false
                        val file = recorder.stop()
                        if (file != null) {
                            vm.uploadFile(file, "audio/mp4") { id -> pendingIds = pendingIds + id }
                        }
                    }) { Text("Bitir ve gönder") }
                    TextButton(onClick = {
                        recording = false
                        recorder.cancel()
                    }) { Text("Vazgeç") }
                }
            }
        }

        Row(
            Modifier.fillMaxWidth().padding(12.dp),
            verticalAlignment = Alignment.Bottom,
        ) {
            IconTextButton(
                text = "📎",
                enabled = !state.uploading,
                onClick = {
                    picker.launch(PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.ImageAndVideo))
                },
            )
            IconTextButton(
                text = if (recording) "⏹" else "🎙",
                enabled = !state.uploading,
                onClick = {
                    if (recording) {
                        recording = false
                        recorder.cancel()
                    } else if (recorder.hasPermission()) {
                        recorder.start()
                        recording = true
                    } else {
                        recordPermission.launch(android.Manifest.permission.RECORD_AUDIO)
                    }
                },
            )
            Spacer(Modifier.width(4.dp))
            OutlinedTextField(
                value = draft,
                onValueChange = { draft = it },
                modifier = Modifier.weight(1f),
                placeholder = { Text("Bir şeyler yaz…") },
                shape = MaterialTheme.shapes.large,
                maxLines = 4,
            )
            Spacer(Modifier.width(8.dp))
            Button(
                onClick = {
                    val text = draft
                    val ids = pendingIds
                    draft = ""
                    pendingIds = emptyList()
                    vm.send(text, ids)
                },
                enabled = (draft.isNotBlank() || pendingIds.isNotEmpty()) && !state.sending && !state.uploading,
                shape = MaterialTheme.shapes.large,
                modifier = Modifier.height(56.dp),
            ) { Text("Gönder") }
        }

        state.error?.let { message ->
            Surface(color = MaterialTheme.colorScheme.error) {
                Row(Modifier.fillMaxWidth().padding(12.dp), verticalAlignment = Alignment.CenterVertically) {
                    Text(
                        message,
                        color = MaterialTheme.colorScheme.onPrimary,
                        style = MaterialTheme.typography.bodyMedium,
                        modifier = Modifier.weight(1f),
                    )
                    TextButton(onClick = { vm.dismissError() }) {
                        Text("Tamam", color = MaterialTheme.colorScheme.onPrimary)
                    }
                }
            }
        }
    }
}

@Composable
private fun IconTextButton(text: String, enabled: Boolean, onClick: () -> Unit) {
    TextButton(onClick = onClick, enabled = enabled) {
        Text(text, style = MaterialTheme.typography.headlineMedium)
    }
}

@Composable
private fun MessageBubble(
    container: AppContainer,
    msg: MessageDto,
    onReact: () -> Unit,
    onDelete: () -> Unit,
) {
    val mine = msg.mine
    val bubbleColor = if (mine) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.surface
    val textColor = if (mine) MaterialTheme.colorScheme.onPrimary else MaterialTheme.colorScheme.onSurface

    Column(
        Modifier.fillMaxWidth(),
        horizontalAlignment = if (mine) Alignment.End else Alignment.Start,
    ) {
        Surface(
            color = bubbleColor,
            shape = RoundedCornerShape(
                topStart = 18.dp,
                topEnd = 18.dp,
                bottomStart = if (mine) 18.dp else 4.dp,
                bottomEnd = if (mine) 4.dp else 18.dp,
            ),
            tonalElevation = if (mine) 0.dp else 1.dp,
            modifier = Modifier.fillMaxWidth(0.86f),
        ) {
            Column(Modifier.padding(horizontal = 12.dp, vertical = 10.dp)) {
                if (!mine) {
                    Text(
                        msg.senderName,
                        style = MaterialTheme.typography.labelLarge,
                        color = MaterialTheme.colorScheme.primary,
                    )
                    Spacer(Modifier.height(2.dp))
                }
                if (msg.deleted) {
                    Text(
                        "Bu mesaj silindi",
                        style = MaterialTheme.typography.bodyMedium,
                        color = if (mine) textColor.copy(alpha = 0.7f) else MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                } else {
                    msg.attachments.forEach { attachment ->
                        AttachmentView(container, attachment, mine = mine)
                        Spacer(Modifier.height(6.dp))
                    }
                    if (msg.body.isNotBlank()) {
                        Text(msg.body, style = MaterialTheme.typography.bodyLarge, color = textColor)
                    }
                }
                Spacer(Modifier.height(4.dp))
                Text(
                    buildString {
                        append(formatTime(msg.createdAt))
                        if (msg.editedAt != null) append(" · düzenlendi")
                        if (mine && msg.readAt != null) append(" · okundu")
                    },
                    style = MaterialTheme.typography.bodyMedium,
                    color = if (mine) textColor.copy(alpha = 0.75f) else MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        }
        Row {
            if (msg.reactions.isNotEmpty()) {
                Text(
                    msg.reactions.joinToString(" ") { it.reaction },
                    style = MaterialTheme.typography.bodyMedium,
                    modifier = Modifier.padding(start = 6.dp, top = 2.dp),
                )
            }
            TextButton(onClick = onReact) { Text("❤", style = MaterialTheme.typography.bodyMedium) }
            if (mine && !msg.deleted) {
                TextButton(onClick = onDelete) { Text("Sil", style = MaterialTheme.typography.bodyMedium) }
            }
        }
    }
}

/**
 * Ek görünümü: görsel doğrudan, video/ses cihaza indirilip oynatılır.
 * Sunucu dosyaları kimlik doğrulamalı olduğu için basit URL oynatıcı kullanılamaz.
 */
@Composable
private fun AttachmentView(container: AppContainer, attachment: AttachmentDto, mine: Boolean) {
    val context = LocalContext.current
    val token = container.tokenStore.get()
    var error by remember(attachment.id) { mutableStateOf<String?>(null) }
    val url = container.api.mediaFileUrl(attachment.id, thumb = false)

    when (attachment.kind) {
        "image" -> {
            var bitmap by remember(attachment.id) { mutableStateOf<android.graphics.Bitmap?>(null) }
            LaunchedEffect(attachment.id) {
                bitmap = withContext(Dispatchers.IO) { loadBitmap(url, token, thumb = true) }
            }
            Box(
                Modifier
                    .fillMaxWidth()
                    .heightIn(min = 120.dp, max = 260.dp)
                    .background(if (mine) Color.White.copy(alpha = 0.15f) else MaterialTheme.colorScheme.surfaceVariant, RoundedCornerShape(10.dp)),
                contentAlignment = Alignment.Center,
            ) {
                val bmp = bitmap
                if (bmp != null) {
                    Image(
                        bitmap = bmp.asImageBitmap(),
                        contentDescription = attachment.caption.ifBlank { "Fotoğraf" },
                        modifier = Modifier.fillMaxWidth(),
                        contentScale = ContentScale.Fit,
                    )
                } else {
                    CircularProgressIndicator(Modifier.size(22.dp), strokeWidth = 2.dp)
                }
            }
        }
        "video" -> {
            var file by remember(attachment.id) { mutableStateOf<File?>(null) }
            var playing by remember(attachment.id) { mutableStateOf(false) }
            LaunchedEffect(attachment.id) {
                if (playing) {
                    file = withContext(Dispatchers.IO) {
                        downloadToCache(context, url, token, "video-${attachment.id}.mp4")
                    }
                }
            }
            if (playing && file != null) {
                AndroidView(
                    factory = { ctx ->
                        VideoView(ctx).apply {
                            setVideoPath(file!!.absolutePath)
                            setOnPreparedListener { it.isLooping = false; start() }
                        }
                    },
                    modifier = Modifier.fillMaxWidth().height(220.dp),
                )
            } else {
                VideoPlaceholder(
                    label = "Videoyu oynat" + (attachment.durationMs?.let { " · ${it / 1000}s" } ?: ""),
                    mine = mine,
                    onClick = { playing = true },
                )
            }
        }
        else -> {
            var playing by remember(attachment.id) { mutableStateOf(false) }
            var prepared by remember(attachment.id) { mutableStateOf<File?>(null) }
            val player = remember { MediaPlayer() }

            DisposableEffect(attachment.id) {
                onDispose {
                    runCatching { player.release() }
                }
            }

            // İndirme yalnızca ilk oynatmada yapılır; sonrası yerelden çalar.
            LaunchedEffect(playing) {
                if (!playing) return@LaunchedEffect
                val file = prepared ?: withContext(Dispatchers.IO) {
                    downloadToCache(context, url, token, "audio-${attachment.id}.m4a")
                }
                if (file == null) {
                    error = "Ses indirilemedi"
                    playing = false
                    return@LaunchedEffect
                }
                prepared = file
                runCatching {
                    player.reset()
                    player.setDataSource(file.absolutePath)
                    player.prepare()
                    player.start()
                    player.setOnCompletionListener { playing = false }
                }.onFailure {
                    error = "Ses oynatılamadı"
                    playing = false
                }
            }

            Surface(
                onClick = { playing = !playing },
                shape = RoundedCornerShape(10.dp),
                color = if (mine) Color.White.copy(alpha = 0.18f) else MaterialTheme.colorScheme.surfaceVariant,
                modifier = Modifier.fillMaxWidth(),
            ) {
                Row(Modifier.padding(12.dp), verticalAlignment = Alignment.CenterVertically) {
                    Text(if (playing) "⏸" else "▶", style = MaterialTheme.typography.titleLarge)
                    Spacer(Modifier.width(10.dp))
                    Text(
                        "Sesli not",
                        style = MaterialTheme.typography.bodyLarge,
                        color = if (mine) MaterialTheme.colorScheme.onPrimary else MaterialTheme.colorScheme.onSurface,
                    )
                }
            }
        }
    }
    error?.let {
        Text(
            it,
            style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.error,
        )
    }
}

@Composable
private fun VideoPlaceholder(label: String, mine: Boolean, onClick: () -> Unit) {
    Surface(
        onClick = onClick,
        shape = RoundedCornerShape(10.dp),
        color = if (mine) Color.White.copy(alpha = 0.18f) else MaterialTheme.colorScheme.surfaceVariant,
        modifier = Modifier.fillMaxWidth().height(120.dp),
    ) {
        Row(Modifier.padding(16.dp), verticalAlignment = Alignment.CenterVertically) {
            Text("🎬", style = MaterialTheme.typography.headlineMedium)
            Spacer(Modifier.width(12.dp))
            Text(
                label,
                style = MaterialTheme.typography.bodyLarge,
                color = if (mine) MaterialTheme.colorScheme.onPrimary else MaterialTheme.colorScheme.onSurface,
            )
        }
    }
}

private fun loadBitmap(url: String, token: String?, thumb: Boolean): android.graphics.Bitmap? = runCatching {
    val fullUrl = if (thumb) "$url?thumb=1" else url
    val conn = URL(fullUrl).openConnection() as HttpURLConnection
    if (token != null) conn.setRequestProperty("Authorization", "Bearer $token")
    conn.connectTimeout = 10_000
    conn.readTimeout = 20_000
    val bytes = conn.inputStream.use { it.readBytes() }
    android.graphics.BitmapFactory.decodeByteArray(bytes, 0, bytes.size)
}.getOrNull()

private fun downloadToCache(
    context: android.content.Context,
    url: String,
    token: String?,
    name: String,
): File? = runCatching {
    val dir = File(context.cacheDir, "attachments").apply { mkdirs() }
    val target = File(dir, name)
    if (target.exists() && target.length() > 0) return@runCatching target
    val conn = URL(url).openConnection() as HttpURLConnection
    if (token != null) conn.setRequestProperty("Authorization", "Bearer $token")
    conn.connectTimeout = 15_000
    conn.readTimeout = 60_000
    conn.inputStream.use { input -> target.outputStream().use { input.copyTo(it) } }
    target
}.getOrNull()

@Composable
private fun QueuedBubble(q: QueuedMessage) {
    Surface(
        color = MaterialTheme.colorScheme.surfaceVariant,
        shape = RoundedCornerShape(18.dp),
        modifier = Modifier.fillMaxWidth(0.8f),
    ) {
        Column(Modifier.padding(horizontal = 14.dp, vertical = 10.dp)) {
            if (q.body.isNotBlank()) Text(q.body, style = MaterialTheme.typography.bodyLarge)
            if (q.mediaIds.isNotEmpty()) {
                Text(
                    "${q.mediaIds.size} ek",
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
            Spacer(Modifier.height(4.dp))
            Text(
                "gönderiliyor…",
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
    }
}

private val timeFormatter = DateTimeFormatter.ofPattern("HH:mm").withZone(ZoneId.systemDefault())

fun formatTime(iso: String): String = runCatching {
    timeFormatter.format(Instant.parse(iso))
}.getOrElse { "" }
