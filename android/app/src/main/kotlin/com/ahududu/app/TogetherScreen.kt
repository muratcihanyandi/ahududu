package com.ahududu.app

import android.Manifest
import android.content.Intent
import android.net.Uri
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Surface
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.scale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.ahududu.common.api.ApiException
import com.ahududu.common.api.InteractionDefinition
import com.ahududu.common.api.PartnerHealth
import com.ahududu.common.api.PartnerLocation
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import org.json.JSONObject

data class TogetherUiState(
    val definitions: List<InteractionDefinition> = emptyList(),
    val partner: PartnerLocation? = null,
    val partnerHeart: PartnerHealth? = null,
    val partnerSteps: PartnerHealth? = null,
    val partnerStress: PartnerHealth? = null,
    val distanceText: String? = null,
    val sharing: Boolean = false,
    val hasLocationPermission: Boolean = false,
    val busyKind: String? = null,
    val busyBuzz: String? = null,
    val status: String? = null,
    val error: String? = null,
    val loading: Boolean = true,
    val lastIncomingBuzz: IncomingBuzz? = null,
)

class TogetherViewModel(private val container: AppContainer) : ViewModel() {
    private val _state = MutableStateFlow(
        TogetherUiState(
            sharing = container.location.sharingEnabled,
            hasLocationPermission = container.location.hasPermission(),
        )
    )
    val state: StateFlow<TogetherUiState> = _state.asStateFlow()
    private val token get() = container.tokenStore.get()

    init {
        loadStatic()
        refresh()
        observe()
        observeBuzz()
        container.location.start()
    }

    private fun loadStatic() {
        val t = token ?: return
        viewModelScope.launch {
            runCatching { container.api.interactionDefinitions(t) }
                .onSuccess { r -> _state.update { it.copy(definitions = r.definitions) } }
        }
    }

    fun refresh() {
        val t = token ?: return
        viewModelScope.launch {
            try {
                val loc = container.api.partnerLocation(t)
                val heart = runCatching { container.api.partnerHealth(t, "heart_rate") }.getOrNull()
                val steps = runCatching { container.api.partnerHealth(t, "steps") }.getOrNull()
                val stress = runCatching { container.api.partnerHealth(t, "stress") }.getOrNull()

                val partnerLoc = loc.partner
                val pLat = partnerLoc?.lat
                val pLng = partnerLoc?.lng
                val myLoc = container.location.myLastLocation
                val distText = if (pLat != null && pLng != null && myLoc != null) {
                    val res = FloatArray(1)
                    android.location.Location.distanceBetween(
                        myLoc.latitude, myLoc.longitude,
                        pLat, pLng,
                        res
                    )
                    val meters = res[0]
                    when {
                        meters < 50 -> "Aynı yerdesiniz, sımsıkı sarılın! 🥰"
                        meters < 1000 -> "Çok yakınsınız: ~${meters.toInt()} metre 💕"
                        else -> String.format(java.util.Locale.US, "Aramızda %.1f km var 🕊️", meters / 1000.0)
                    }
                } else null

                _state.update {
                    it.copy(
                        partner = partnerLoc,
                        partnerHeart = heart?.partner,
                        partnerSteps = steps?.partner,
                        partnerStress = stress?.partner,
                        distanceText = distText,
                        loading = false,
                        error = null,
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
                when (event.type) {
                    "location.updated", "health.updated" -> refresh()
                    "interaction.new" -> {
                        val o = runCatching { JSONObject(event.payloadJson) }.getOrNull() ?: return@collect
                        if (o.optBoolean("mine")) return@collect
                        _state.update {
                            it.copy(status = "${o.optString("senderName")}: ${o.optString("message")}")
                        }
                    }
                }
            }
        }
    }

    private fun observeBuzz() {
        viewModelScope.launch {
            container.buzz.incoming.collect { buzz ->
                if (buzz != null) _state.update { it.copy(lastIncomingBuzz = buzz) }
            }
        }
    }

    fun sendInteraction(kind: String) {
        val t = token ?: return
        if (_state.value.busyKind != null) return
        _state.update { it.copy(busyKind = kind, error = null, status = null) }
        viewModelScope.launch {
            try {
                container.api.sendInteraction(t, kind)
                val def = _state.value.definitions.firstOrNull { it.kind == kind }
                _state.update { it.copy(busyKind = null, status = def?.message ?: "Gönderildi 💗") }
            } catch (e: ApiException) {
                _state.update { it.copy(busyKind = null, error = e.message) }
            }
        }
    }

    fun sendBuzz(pattern: BuzzPattern) {
        val t = token ?: return
        if (_state.value.busyBuzz != null) return
        _state.update { it.copy(busyBuzz = pattern.wire, error = null, status = null) }
        viewModelScope.launch {
            try {
                container.api.sendBuzz(t, pattern.wire)
                container.buzz.play(pattern) // kendi geri bildirimimiz
                _state.update { it.copy(busyBuzz = null, status = "${pattern.label} gönderildi") }
            } catch (e: ApiException) {
                _state.update { it.copy(busyBuzz = null, error = e.message) }
            }
        }
    }

    fun setSharing(enabled: Boolean) {
        container.location.setSharing(enabled)
        _state.update { it.copy(sharing = enabled) }
        if (enabled) {
            container.location.refreshNow()
            _state.update { it.copy(status = "Konumun sevgilinle paylaşılıyor.") }
        } else {
            _state.update { it.copy(status = "Konum paylaşımı kapalı.") }
        }
        refresh()
    }

    /** Paylaşım açıkken gönderim hatası varsa kullanıcıya göster. */
    fun reportLocationError() {
        container.location.lastError?.let { _state.update { s -> s.copy(error = it) } }
    }

    fun onPermissionResult(granted: Boolean) {
        _state.update { it.copy(hasLocationPermission = granted) }
        if (granted) {
            container.location.start()
            container.location.refreshNow()
            _state.update { it.copy(status = "İzin verildi, konum güncelleniyor.") }
        } else {
            _state.update { it.copy(error = "Konum izni verilmedi — konum paylaşılamıyor.") }
        }
    }

    fun dismissStatus() = _state.update { it.copy(status = null, error = null) }
}

@Composable
fun TogetherScreen(container: AppContainer, onClose: () -> Unit) {
    val vm: TogetherViewModel = androidx.lifecycle.viewmodel.compose.viewModel { TogetherViewModel(container) }
    val state by vm.state.collectAsState()
    val context = LocalContext.current

    val permissionLauncher = rememberLauncherForActivityResult(
        ActivityResultContracts.RequestMultiplePermissions()
    ) { result ->
        vm.onPermissionResult(result[Manifest.permission.ACCESS_FINE_LOCATION] == true)
    }

    val audioPermissionLauncher = rememberLauncherForActivityResult(
        ActivityResultContracts.RequestPermission()
    ) { granted ->
        if (granted) {
            container.audioStream.requestListen()
        }
    }

    // Ekran açıkken partner verisi tazelensin.
    LaunchedEffect(Unit) {
        while (true) {
            delay(30_000)
            vm.refresh()
        }
    }

    Column(
        Modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .padding(horizontal = 20.dp),
    ) {
        Row(
            Modifier.fillMaxWidth().padding(top = 12.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            TextButton(onClick = onClose) { Text("Geri") }
            Text(
                "Birbirimize",
                style = MaterialTheme.typography.headlineMedium,
                color = MaterialTheme.colorScheme.primary,
                modifier = Modifier.padding(start = 4.dp),
            )
        }
        Text(
            "Uzaktan küçük dokunuşlar: bir işaret, bir titreşim, bir kalp atışı.",
            style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        Spacer(Modifier.height(14.dp))

        // ---------- BANA İLGİ VER (ÖZEL BUTON) ----------
        Card(
            shape = MaterialTheme.shapes.large,
            colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.primaryContainer),
            modifier = Modifier.fillMaxWidth(),
            onClick = {
                vm.sendInteraction("attention")
                vm.sendBuzz(BuzzPattern.HEARTBEAT)
            }
        ) {
            Row(
                Modifier.padding(16.dp),
                verticalAlignment = Alignment.CenterVertically
            ) {
                Text("🥺", style = MaterialTheme.typography.displaySmall)
                Spacer(Modifier.width(14.dp))
                Column(Modifier.weight(1f)) {
                    Text(
                        "Bana İlgi Ver!",
                        style = MaterialTheme.typography.titleMedium,
                        color = MaterialTheme.colorScheme.onPrimaryContainer
                    )
                    Text(
                        "Tek dokunuşla sevgilinin telefonuna ve saatine sevgi titreşimi gönder.",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onPrimaryContainer.copy(alpha = 0.8f)
                    )
                }
            }
        }

        Spacer(Modifier.height(18.dp))

        // ---------- CANLI SES BAĞLANTISI (FISILTI) ----------
        SectionTitle("Canlı Ses Bağlantısı")
        Spacer(Modifier.height(4.dp))
        Text(
            "Sevgilinin yanındaymış gibi anlık sesini/ortamını dinle (Walkie-Talkie).",
            style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        Spacer(Modifier.height(8.dp))
        AudioStreamCard(
            manager = container.audioStream,
            onPermissionRequest = {
                audioPermissionLauncher.launch(Manifest.permission.RECORD_AUDIO)
            }
        )

        Spacer(Modifier.height(20.dp))

        // ---------- DOKUNUŞLAR ----------
        SectionTitle("Dokunuşlar")
        Spacer(Modifier.height(8.dp))
        if (state.definitions.isEmpty()) {
            Text(
                "Dokunuşlar yükleniyor…",
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        } else {
            state.definitions.chunked(2).forEach { row ->
                Row(
                    Modifier.fillMaxWidth().padding(vertical = 3.dp),
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                ) {
                    row.forEach { def ->
                        InteractionTile(
                            def = def,
                            busy = state.busyKind == def.kind,
                            modifier = Modifier.weight(1f),
                            onClick = { vm.sendInteraction(def.kind) },
                        )
                    }
                    if (row.size == 1) Spacer(Modifier.weight(1f))
                }
            }
        }

        Spacer(Modifier.height(24.dp))

        // ---------- TİTREŞİM ----------
        SectionTitle("Titreşim gönder")
        Spacer(Modifier.height(4.dp))
        Text(
            "Seçtiğin desen onun telefonunda hissedilir.",
            style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        Spacer(Modifier.height(10.dp))
        BuzzPattern.entries.forEach { pattern ->
            BuzzRow(
                pattern = pattern,
                busy = state.busyBuzz == pattern.wire,
                onSend = { vm.sendBuzz(pattern) },
            )
        }

        Spacer(Modifier.height(24.dp))

        // ---------- KONUM ----------
        SectionTitle("Konumumuz")
        Spacer(Modifier.height(8.dp))
        Card(
            shape = MaterialTheme.shapes.medium,
            colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
            modifier = Modifier.fillMaxWidth(),
        ) {
            Column(Modifier.padding(16.dp)) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Column(Modifier.weight(1f)) {
                        Text("Konumumu paylaş", style = MaterialTheme.typography.titleMedium)
                        Text(
                            if (state.sharing) {
                                "Açık — uygulama açıkken dakikada bir güncellenir."
                            } else {
                                "Kapalı — konumun kimseyle paylaşılmıyor."
                            },
                            style = MaterialTheme.typography.bodyMedium,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                    Switch(
                        checked = state.sharing,
                        onCheckedChange = { enabled ->
                            if (enabled && !state.hasLocationPermission) {
                                permissionLauncher.launch(
                                    arrayOf(
                                        Manifest.permission.ACCESS_FINE_LOCATION,
                                        Manifest.permission.ACCESS_COARSE_LOCATION,
                                    )
                                )
                            }
                            vm.setSharing(enabled)
                        },
                    )
                }
                if (state.sharing && !state.hasLocationPermission) {
                    Spacer(Modifier.height(8.dp))
                    OutlinedButton(
                        onClick = {
                            permissionLauncher.launch(
                                arrayOf(
                                    Manifest.permission.ACCESS_FINE_LOCATION,
                                    Manifest.permission.ACCESS_COARSE_LOCATION,
                                )
                            )
                        },
                    ) { Text("Konum iznini ver") }
                }

                Spacer(Modifier.height(12.dp))
                HorizontalDivider(color = MaterialTheme.colorScheme.outline)
                Spacer(Modifier.height(12.dp))

                PartnerLocationBlock(
                    partner = state.partner,
                    distanceText = state.distanceText,
                    loading = state.loading,
                    onOpenMap = { partner ->
                        val lat = partner.lat
                        val lng = partner.lng
                        if (lat != null && lng != null) {
                            val uri = Uri.parse("geo:$lat,$lng?q=$lat,$lng(${Uri.encode(partner.displayName)})")
                            runCatching { context.startActivity(Intent(Intent.ACTION_VIEW, uri)) }
                        }
                    },
                    onRefresh = { vm.refresh() },
                )
            }
        }

        Spacer(Modifier.height(24.dp))

        // ---------- SAĞLIK ----------
        SectionTitle("Saatinden")
        Spacer(Modifier.height(8.dp))
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            HealthTile(
                label = "Kalp atışı",
                value = state.partnerHeart?.sample?.value?.let { "${it.toInt()}" },
                unit = "bpm",
                ageSeconds = state.partnerHeart?.sample?.ageSeconds,
                stale = state.partnerHeart?.sample?.stale ?: true,
                modifier = Modifier.weight(1f),
            )
            HealthTile(
                label = "Stres",
                value = state.partnerStress?.sample?.value?.let {
                    val s = it.toInt()
                    when {
                        s < 30 -> "%$s (Sakin)"
                        s < 70 -> "%$s (Normal)"
                        else -> "%$s (Stresli)"
                    }
                },
                unit = "",
                ageSeconds = state.partnerStress?.sample?.ageSeconds,
                stale = state.partnerStress?.sample?.stale ?: true,
                modifier = Modifier.weight(1f),
            )
            HealthTile(
                label = "Adım",
                value = state.partnerSteps?.sample?.value?.let { "${it.toInt()}" },
                unit = "adım",
                ageSeconds = state.partnerSteps?.sample?.ageSeconds,
                stale = state.partnerSteps?.sample?.stale ?: true,
                modifier = Modifier.weight(1f),
            )
        }
        Text(
            "Değerler saatin ölçtüğü anı gösterir; saat takılı değilse güncellenmez.",
            style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            modifier = Modifier.padding(top = 8.dp),
        )

        state.lastIncomingBuzz?.let { buzz ->
            Spacer(Modifier.height(16.dp))
            Surface(
                color = MaterialTheme.colorScheme.secondaryContainer,
                shape = MaterialTheme.shapes.medium,
                modifier = Modifier.fillMaxWidth(),
            ) {
                Text(
                    "${buzz.senderName} sana ${buzz.pattern.label.lowercase()} gönderdi" +
                        if (buzz.note.isNotBlank()) " — ${buzz.note}" else "",
                    style = MaterialTheme.typography.bodyLarge,
                    modifier = Modifier.padding(14.dp),
                )
            }
        }

        state.status?.let {
            Spacer(Modifier.height(16.dp))
            Text(
                it,
                style = MaterialTheme.typography.bodyLarge,
                color = MaterialTheme.colorScheme.primary,
                modifier = Modifier.fillMaxWidth(),
                textAlign = TextAlign.Center,
            )
        }
        state.error?.let {
            Spacer(Modifier.height(8.dp))
            Text(
                it,
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.error,
                modifier = Modifier.fillMaxWidth(),
                textAlign = TextAlign.Center,
            )
        }
        Spacer(Modifier.height(32.dp))
    }
}

@Composable
private fun SectionTitle(text: String) {
    Text(
        text,
        style = MaterialTheme.typography.titleLarge,
        color = MaterialTheme.colorScheme.secondary,
    )
}

@Composable
private fun InteractionTile(
    def: InteractionDefinition,
    busy: Boolean,
    modifier: Modifier = Modifier,
    onClick: () -> Unit,
) {
    Surface(
        onClick = onClick,
        enabled = !busy,
        shape = MaterialTheme.shapes.medium,
        color = MaterialTheme.colorScheme.surface,
        modifier = modifier.height(92.dp),
    ) {
        Column(
            Modifier.fillMaxSize().padding(horizontal = 14.dp, vertical = 12.dp),
            verticalArrangement = Arrangement.SpaceBetween,
        ) {
            Text(interactionEmoji(def.kind), style = MaterialTheme.typography.headlineMedium)
            Text(
                if (busy) "Gönderiliyor…" else def.label,
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurface,
                maxLines = 2,
            )
        }
    }
}

@Composable
private fun BuzzRow(pattern: BuzzPattern, busy: Boolean, onSend: () -> Unit) {
    val transition = rememberInfiniteTransition(label = "buzz-${pattern.wire}")
    val pulse by transition.animateFloat(
        initialValue = 1f,
        targetValue = 1.08f,
        animationSpec = infiniteRepeatable(tween(700), RepeatMode.Reverse),
        label = "pulse",
    )
    Row(
        Modifier
            .fillMaxWidth()
            .padding(vertical = 5.dp)
            .background(MaterialTheme.colorScheme.surface, MaterialTheme.shapes.medium)
            .padding(horizontal = 14.dp, vertical = 10.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Box(
            Modifier
                .size(10.dp)
                .scale(if (busy) pulse else 1f)
                .background(MaterialTheme.colorScheme.primary, CircleShape),
        )
        Spacer(Modifier.width(12.dp))
        Column(Modifier.weight(1f)) {
            Text(pattern.label, style = MaterialTheme.typography.titleMedium)
            Text(
                description(pattern),
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
        Button(
            onClick = onSend,
            enabled = !busy,
            shape = MaterialTheme.shapes.small,
            contentPadding = PaddingValues(horizontal = 16.dp, vertical = 6.dp),
        ) { Text(if (busy) "…" else "Gönder", style = MaterialTheme.typography.labelLarge) }
    }
}

private fun description(pattern: BuzzPattern): String = when (pattern) {
    BuzzPattern.SHORT -> "Tek kısa dokunuş"
    BuzzPattern.LONG -> "Uzun, sıcak bir titreşim"
    BuzzPattern.HEARTBEAT -> "İki atış: kalbim seninle"
    BuzzPattern.SOS -> "Üç kısa, üç uzun, üç kısa"
    BuzzPattern.KISS -> "Küçük öpücük serisi"
}

@Composable
private fun PartnerLocationBlock(
    partner: PartnerLocation?,
    distanceText: String? = null,
    loading: Boolean,
    onOpenMap: (PartnerLocation) -> Unit,
    onRefresh: () -> Unit,
) {
    when {
        loading -> Row(verticalAlignment = Alignment.CenterVertically) {
            CircularProgressIndicator(Modifier.size(18.dp), strokeWidth = 2.dp)
            Spacer(Modifier.width(10.dp))
            Text("Konum okunuyor…", style = MaterialTheme.typography.bodyMedium)
        }
        partner == null -> Text(
            "Sevgilin henüz konum paylaşmıyor. O da açtığında burada görünecek.",
            style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        partner.sharing == "off" || partner.lat == null || partner.lng == null -> Text(
            "Sevgilinin konum paylaşımı şu an kapalı.",
            style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        else -> Column {
            Text(partner.displayName, style = MaterialTheme.typography.titleMedium)
            Spacer(Modifier.height(4.dp))
            Text(
                buildString {
                    append(if (partner.fresh) "şimdi" else relativeTime(partner.ageSeconds))
                    partner.accuracyM?.let { append(" · ±${it.toInt()} m") }
                },
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            if (distanceText != null) {
                Spacer(Modifier.height(8.dp))
                Surface(
                    color = MaterialTheme.colorScheme.secondaryContainer,
                    shape = MaterialTheme.shapes.small,
                ) {
                    Text(
                        distanceText,
                        style = MaterialTheme.typography.titleSmall,
                        color = MaterialTheme.colorScheme.onSecondaryContainer,
                        modifier = Modifier.padding(horizontal = 10.dp, vertical = 6.dp)
                    )
                }
            }
            Spacer(Modifier.height(10.dp))
            Row {
                Button(onClick = { onOpenMap(partner) }, shape = MaterialTheme.shapes.small) {
                    Text("Haritada aç")
                }
                Spacer(Modifier.width(8.dp))
                TextButton(onClick = onRefresh) { Text("Yenile") }
            }
        }
    }
}

@Composable
private fun HealthTile(
    label: String,
    value: String?,
    unit: String,
    ageSeconds: Int?,
    stale: Boolean,
    modifier: Modifier = Modifier,
) {
    val danger = stale || value == null
    Surface(
        shape = MaterialTheme.shapes.medium,
        color = MaterialTheme.colorScheme.surface,
        modifier = modifier,
    ) {
        Column(Modifier.padding(14.dp)) {
            Text(
                label,
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            Spacer(Modifier.height(6.dp))
            Row(verticalAlignment = Alignment.Bottom) {
                Text(
                    value ?: "—",
                    style = MaterialTheme.typography.headlineMedium,
                    color = if (danger) {
                        MaterialTheme.colorScheme.onSurfaceVariant
                    } else {
                        MaterialTheme.colorScheme.primary
                    },
                    modifier = Modifier.alpha(if (value == null) 0.5f else 1f),
                )
                if (value != null) {
                    Spacer(Modifier.width(4.dp))
                    Text(
                        unit,
                        style = MaterialTheme.typography.bodyMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        modifier = Modifier.padding(bottom = 4.dp),
                    )
                }
            }
            Spacer(Modifier.height(4.dp))
            Text(
                when {
                    value == null -> "Saatten veri yok"
                    stale -> "${relativeTime(ageSeconds)} ölçüldü (eski)"
                    else -> relativeTime(ageSeconds)
                },
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
    }
}

private fun relativeTime(ageSeconds: Int?): String {
    if (ageSeconds == null) return "bilinmiyor"
    return when {
        ageSeconds < 60 -> "az önce"
        ageSeconds < 3600 -> "${ageSeconds / 60} dk önce"
        ageSeconds < 86_400 -> "${ageSeconds / 3600} sa önce"
        else -> "${ageSeconds / 86_400} gün önce"
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

@Composable
private fun AudioStreamCard(
    manager: AudioStreamManager,
    onPermissionRequest: () -> Unit
) {
    val state by manager.sessionState.collectAsState()
    val amplitude by manager.amplitude.collectAsState()
    val statusText by manager.statusText.collectAsState()

    Card(
        shape = MaterialTheme.shapes.medium,
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
        modifier = Modifier.fillMaxWidth(),
    ) {
        Column(Modifier.padding(16.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Column(Modifier.weight(1f)) {
                    Text(
                        when (state) {
                            AudioSessionState.IDLE -> "Fısıltı Bağlantısı"
                            AudioSessionState.REQUESTING -> "Bağlanıyor…"
                            AudioSessionState.LISTENING -> "Canlı Dinleniyor 🎧"
                            AudioSessionState.STREAMING -> "Sesin İletiliyor 🎙️"
                        },
                        style = MaterialTheme.typography.titleMedium
                    )
                    Text(
                        when (state) {
                            AudioSessionState.IDLE -> "Sevgilinin telefonundaki sesi canlı dinle."
                            AudioSessionState.REQUESTING -> "Karşı tarafa canlı bağlantı isteği gönderildi."
                            AudioSessionState.LISTENING -> "Sevgilinin ortamındaki sesleri duyuyorsun."
                            AudioSessionState.STREAMING -> "Mikrofonun sevgiline canlı ses iletiyor."
                        },
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant
                    )
                }
                when (state) {
                    AudioSessionState.IDLE -> {
                        Button(
                            onClick = {
                                if (manager.hasRecordPermission()) {
                                    manager.requestListen()
                                } else {
                                    onPermissionRequest()
                                }
                            },
                            shape = MaterialTheme.shapes.small
                        ) {
                            Text("Dinle")
                        }
                    }
                    AudioSessionState.REQUESTING -> {
                        CircularProgressIndicator(Modifier.size(24.dp), strokeWidth = 2.dp)
                    }
                    AudioSessionState.LISTENING, AudioSessionState.STREAMING -> {
                        Button(
                            onClick = { manager.stop() },
                            colors = androidx.compose.material3.ButtonDefaults.buttonColors(
                                containerColor = MaterialTheme.colorScheme.error
                            ),
                            shape = MaterialTheme.shapes.small
                        ) {
                            Text("Durdur")
                        }
                    }
                }
            }

            if (state == AudioSessionState.LISTENING || state == AudioSessionState.STREAMING) {
                Spacer(Modifier.height(14.dp))
                // Ses genliği dalgası animasyonu
                Row(
                    Modifier.fillMaxWidth().height(28.dp),
                    horizontalArrangement = Arrangement.Center,
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    val barCount = 15
                    for (i in 0 until barCount) {
                        val factor = kotlin.math.sin(i.toDouble() / barCount * Math.PI).toFloat()
                        val h = (8.dp + 20.dp * (amplitude * factor)).coerceIn(4.dp, 28.dp)
                        Box(
                            Modifier
                                .padding(horizontal = 2.dp)
                                .width(4.dp)
                                .height(h)
                                .background(MaterialTheme.colorScheme.primary, CircleShape)
                        )
                    }
                }
            }

            if (statusText != null) {
                Spacer(Modifier.height(8.dp))
                Text(
                    statusText!!,
                    style = MaterialTheme.typography.labelSmall,
                    color = MaterialTheme.colorScheme.primary
                )
            }
        }
    }
}
