package com.ahududu.wear

import android.Manifest
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.compose.setContent
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.scaleIn
import androidx.compose.animation.scaleOut
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.wear.compose.foundation.lazy.ScalingLazyColumn
import androidx.wear.compose.foundation.lazy.items
import androidx.wear.compose.foundation.lazy.rememberScalingLazyListState
import androidx.wear.compose.material.Button
import androidx.wear.compose.material.ButtonDefaults
import androidx.wear.compose.material.Chip
import androidx.wear.compose.material.ChipDefaults
import androidx.wear.compose.material.Colors
import androidx.wear.compose.material.MaterialTheme
import androidx.wear.compose.material.Text
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlin.math.cos
import kotlin.math.sin

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContent {
            AhududuWearTheme {
                WearApp()
            }
        }
    }
}

private val KoyuMurdum = Color(0xFF241A20)
private val Pudra = Color(0xFFE8A0B4)
private val Kiremit = Color(0xFFB3402F)
private val Soluk = Color(0xFF8C737B)
private val Krem = Color(0xFFF5E8EC)

@Composable
fun AhududuWearTheme(content: @Composable () -> Unit) {
    MaterialTheme(
        colors = Colors(
            primary = Pudra,
            background = KoyuMurdum,
            onBackground = Krem,
            onPrimary = KoyuMurdum,
            secondary = Soluk,
            onSecondary = Krem,
        ),
        content = content,
    )
}

@Composable
fun WearApp() {
    val context = LocalContext.current
    val credentials = remember { WearCredentials(context) }
    val health = remember { WearHealth(context) }
    val repository = remember { WearRepository(context, credentials) }
    val scope = rememberCoroutineScope()

    val state by repository.state.collectAsState()
    val myHeart by health.heartRate.collectAsState()
    val mySteps by health.steps.collectAsState()
    val myStress by health.stress.collectAsState()

    var sensorGranted by remember { mutableStateOf(health.hasPermission()) }
    val sensorPermission = rememberLauncherForActivityResult(
        ActivityResultContracts.RequestPermission()
    ) { granted ->
        sensorGranted = granted
        if (granted) {
            health.start()
        }
    }

    // Telefondan gelen kimlik bilgilerini dinle; varsa hemen bağlan.
    LaunchedEffect(Unit) {
        val existing = credentials.pullExisting()
        if (existing != null) repository.start()
        credentials.startListening(
            onCredentials = { _, _ -> repository.start() },
            onSignedOut = { repository.stop() },
        )
    }

    // Sensör izni varsa ölçümleri başlat.
    LaunchedEffect(sensorGranted) {
        if (sensorGranted) {
            health.start()
            repository.loadIdentity()
            repository.refreshPartner()
        }
    }

    // Kendi ölçümlerini repoya yansıt (sunucuya gönderim repoda).
    LaunchedEffect(myHeart, mySteps, myStress) {
        repository.publishOwn(myHeart, mySteps, myStress)
    }

    // Zamanla gönder.
    LaunchedEffect(sensorGranted) {
        if (!sensorGranted) return@LaunchedEffect
        while (true) {
            repository.pushOwnHealth()
            delay(120_000)
        }
    }

    DisposableEffect(Unit) {
        onDispose {
            repository.stop()
            health.stop()
            credentials.stopListening()
        }
    }

    // Kutlama animasyonunu birkaç saniye sonra kapat.
    LaunchedEffect(state.celebration) {
        if (state.celebration != null) {
            delay(3_500)
            repository.clearCelebration()
        }
    }

    Box(Modifier.fillMaxSize().background(KoyuMurdum)) {
        val listState = rememberScalingLazyListState()

        ScalingLazyColumn(
            state = listState,
            modifier = Modifier.fillMaxSize(),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(4.dp),
        ) {
            item {
                Text(
                    "Ahududu",
                    style = MaterialTheme.typography.title3,
                    color = Pudra,
                )
            }

            if (!state.hasCredentials) {
                item {
                    Text(
                        "Telefonundan Ahududu'yu aç; saat otomatik eşleşir.",
                        style = MaterialTheme.typography.body2,
                        color = Soluk,
                        textAlign = TextAlign.Center,
                        modifier = Modifier.padding(horizontal = 12.dp),
                    )
                }
                item {
                    Button(
                        onClick = {
                            credentials.pullExisting()?.let { repository.start() }
                        },
                        colors = ButtonDefaults.primaryButtonColors(),
                    ) { Text("Eşleşmeyi dene", style = MaterialTheme.typography.button) }
                }
            } else {
                // Partner kalp atışı — nabız animasyonu
                item {
                    HeartDisplay(
                        bpm = state.partnerHeart,
                        ageSeconds = state.partnerHeartAgeSec,
                        name = state.partnerName.ifBlank { "Sevgilin" },
                    )
                }

                item {
                    Row(
                        Modifier.fillMaxWidth().padding(horizontal = 4.dp),
                        horizontalArrangement = Arrangement.Center,
                    ) {
                        MetricPill("Adım", state.partnerSteps?.toString() ?: "—", state.partnerStepsAgeSec)
                        Spacer(Modifier.width(4.dp))
                        MetricPill("Stres", state.partnerStress?.let { "%$it" } ?: "—", state.partnerStressAgeSec)
                        Spacer(Modifier.width(4.dp))
                        MetricPill("Benim", myHeart?.toString() ?: "—", null)
                    }
                }

                if (!sensorGranted) {
                    item {
                        Chip(
                            label = { Text("Sensör izni ver", style = MaterialTheme.typography.caption1) },
                            onClick = { sensorPermission.launch(Manifest.permission.BODY_SENSORS) },
                            colors = ChipDefaults.secondaryChipColors(),
                        )
                    }
                }

                item { SectionLabel("Dokun") }
                item {
                    BuzzButton("Kalp atışı", !state.busy, onClick = { repository.sendBuzz("heartbeat") })
                }
                item {
                    BuzzButton("Kısa dokunuş", !state.busy, onClick = { repository.sendBuzz("short") })
                }
                item { SectionLabel("Gönder") }
                item {
                    Row {
                        EmojiButton("❤️") { repository.sendInteraction("heart") }
                        EmojiButton("😘") { repository.sendInteraction("kiss") }
                        EmojiButton("🍓") { repository.sendInteraction("ahududu") }
                    }
                }
                item {
                    Row {
                        EmojiButton("🤗") { repository.sendInteraction("hug") }
                        EmojiButton("💗") { repository.sendInteraction("attention") }
                        EmojiButton("✨") { repository.sendInteraction("star") }
                    }
                }

                item {
                    Text(
                        when {
                            state.error != null -> state.error!!
                            state.info != null -> state.info!!
                            state.connected -> "Canlı bağlı"
                            else -> "Bağlanıyor…"
                        },
                        style = MaterialTheme.typography.caption1,
                        color = when {
                            state.error != null -> Kiremit
                            state.connected -> Pudra
                            else -> Soluk
                        },
                        textAlign = TextAlign.Center,
                        modifier = Modifier.padding(horizontal = 10.dp, vertical = 6.dp),
                    )
                }
            }
        }

        // Kutlama animasyonu — tam ekran, dokununca kapanır
        CelebrationOverlay(
            celebration = state.celebration,
            onDismiss = { repository.clearCelebration() },
        )
    }
}

@Composable
private fun SectionLabel(text: String) {
    Text(
        text,
        style = MaterialTheme.typography.caption1,
        color = Soluk,
        modifier = Modifier.padding(top = 6.dp),
    )
}

@Composable
private fun BuzzButton(label: String, enabled: Boolean, onClick: () -> Unit) {
    Button(
        onClick = onClick,
        enabled = enabled,
        colors = ButtonDefaults.secondaryButtonColors(),
        modifier = Modifier.fillMaxWidth().padding(horizontal = 6.dp),
    ) {
        Text(label, style = MaterialTheme.typography.button)
    }
}

@Composable
private fun EmojiButton(emoji: String, onClick: () -> Unit) {
    Button(
        onClick = onClick,
        colors = ButtonDefaults.primaryButtonColors(),
        modifier = Modifier.size(44.dp),
    ) {
        Text(emoji, style = MaterialTheme.typography.title2)
    }
}

@Composable
private fun MetricPill(label: String, value: String, ageSeconds: Int?) {
    Column(
        Modifier
            .background(Color(0xFF33242C), CircleShape)
            .padding(horizontal = 14.dp, vertical = 8.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Text(label, style = MaterialTheme.typography.caption2, color = Soluk)
        Text(value, style = MaterialTheme.typography.title2, color = Krem)
        if (ageSeconds != null) {
            Text(ageLabel(ageSeconds), style = MaterialTheme.typography.caption2, color = Soluk)
        }
    }
}

/** Partner kalp atışı: nabız gibi atan halka + dairesel ilerleme. */
@Composable
private fun HeartDisplay(bpm: Int?, ageSeconds: Int?, name: String) {
    val transition = rememberInfiniteTransition(label = "heart")
    val beat by transition.animateFloat(
        initialValue = 0.92f,
        targetValue = 1.06f,
        animationSpec = infiniteRepeatable(
            animation = tween(700, easing = LinearEasing),
            repeatMode = RepeatMode.Reverse,
        ),
        label = "beat",
    )
    val hasValue = bpm != null
    val pulseScale = if (hasValue) beat else 1f

    Column(horizontalAlignment = Alignment.CenterHorizontally) {
        Text(
            "$name · kalbi",
            style = MaterialTheme.typography.caption1,
            color = Soluk,
        )
        Spacer(Modifier.height(4.dp))
        Box(contentAlignment = Alignment.Center, modifier = Modifier.size(96.dp)) {
            Canvas(Modifier.fillMaxSize()) {
                val stroke = 8.dp.toPx()
                drawArc(
                    color = Color(0xFF3A2A32),
                    startAngle = 135f,
                    sweepAngle = 270f,
                    useCenter = false,
                    style = Stroke(width = stroke, cap = StrokeCap.Round),
                )
                if (hasValue) {
                    // Nabız değerini 40..160 aralığında yüzdeye çevir.
                    val ratio = ((bpm!!.toFloat() - 40f) / 120f).coerceIn(0f, 1f)
                    drawArc(
                        color = Pudra.copy(alpha = 0.9f),
                        startAngle = 135f,
                        sweepAngle = 270f * ratio,
                        useCenter = false,
                        style = Stroke(width = stroke, cap = StrokeCap.Round),
                    )
                }
                // Küçük kalp işareti — sadece çizim, emoji yok (saatte daha temiz).
                val center = Offset(size.width / 2f, size.height / 2f)
                val r = size.minDimension * 0.08f * pulseScale
                drawCircle(Pudra.copy(alpha = 0.85f), radius = r, center = center)
                drawCircle(Pudra.copy(alpha = 0.35f), radius = r * 1.9f, center = center, style = Stroke(width = 2.dp.toPx()))
            }
            Column(horizontalAlignment = Alignment.CenterHorizontally) {
                Text(
                    bpm?.toString() ?: "—",
                    style = MaterialTheme.typography.display2,
                    color = if (hasValue) Pudra else Soluk,
                )
                Text("bpm", style = MaterialTheme.typography.caption2, color = Soluk)
            }
        }
        if (ageSeconds != null) {
            Text(ageLabel(ageSeconds), style = MaterialTheme.typography.caption2, color = Soluk)
        } else {
            Text("ölçüm yok", style = MaterialTheme.typography.caption2, color = Soluk)
        }
    }
}

/** Gelen dokunuş/işaret için tam ekran animasyon. */
@Composable
private fun CelebrationOverlay(celebration: Celebration?, onDismiss: () -> Unit) {
    AnimatedVisibility(
        visible = celebration != null,
        enter = fadeIn(tween(150)) + scaleIn(tween(200), initialScale = 0.7f),
        exit = fadeOut(tween(250)) + scaleOut(tween(250), targetScale = 1.3f),
    ) {
        val current = celebration ?: return@AnimatedVisibility
        val transition = rememberInfiniteTransition(label = "celebrate")
        val pulse by transition.animateFloat(
            initialValue = 0.9f,
            targetValue = 1.15f,
            animationSpec = infiniteRepeatable(tween(600), RepeatMode.Reverse),
            label = "pulse",
        )
        val rise by transition.animateFloat(
            initialValue = 0f,
            targetValue = 1f,
            animationSpec = infiniteRepeatable(tween(2000, easing = LinearEasing), RepeatMode.Restart),
            label = "rise",
        )

        Box(
            Modifier
                .fillMaxSize()
                .background(KoyuMurdum.copy(alpha = 0.96f))
                .padding(8.dp),
            contentAlignment = Alignment.Center,
        ) {
            Canvas(Modifier.fillMaxSize()) {
                // Yukarı süzülen kalpler — her biri farklı fazda.
                val count = 7
                for (i in 0 until count) {
                    val phase = (rise + i / count.toFloat()) % 1f
                    val x = size.width * (0.15f + 0.7f * ((i * 37) % 100) / 100f)
                    val y = size.height * (1f - phase)
                    val radius = size.minDimension * 0.022f * (0.6f + 0.7f * (1f - phase))
                    drawCircle(
                        color = Pudra.copy(alpha = 0.65f * (1f - phase)),
                        radius = radius,
                        center = Offset(x, y),
                    )
                }
            }
            Column(horizontalAlignment = Alignment.CenterHorizontally) {
                Text(
                    when (current) {
                        Celebration.HEART -> "❤"
                        Celebration.KISS -> "💋"
                        Celebration.HUG -> "🤗"
                        Celebration.BUZZ -> "💗"
                        Celebration.AHUDUDU -> "🍓"
                        Celebration.STARRY -> "✨"
                    },
                    style = MaterialTheme.typography.display1,
                )
                val scale by animateFloatAsState(pulse, label = "scale")
                Text(
                    current.label,
                    style = MaterialTheme.typography.title3,
                    color = Pudra,
                    modifier = Modifier.padding(top = 4.dp),
                )
            }
            Button(
                onClick = onDismiss,
                colors = ButtonDefaults.secondaryButtonColors(),
                modifier = Modifier.align(Alignment.BottomCenter).padding(bottom = 10.dp),
            ) { Text("Tamam", style = MaterialTheme.typography.caption1) }
        }
    }
}

private fun ageLabel(ageSeconds: Int): String = when {
    ageSeconds < 60 -> "az önce"
    ageSeconds < 3600 -> "${ageSeconds / 60} dk önce"
    ageSeconds < 86_400 -> "${ageSeconds / 3600} sa önce"
    else -> "${ageSeconds / 86_400} gün önce"
}
