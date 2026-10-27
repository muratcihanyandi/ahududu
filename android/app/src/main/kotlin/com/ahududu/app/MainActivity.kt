package com.ahududu.app

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.SystemBarStyle
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.slideInVertically
import androidx.compose.animation.slideOutVertically
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawing
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.NavigationBarItemDefaults
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
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
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.input.VisualTransformation
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.LifecycleEventEffect
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import com.ahududu.common.theme.AhududuTheme
import kotlinx.coroutines.delay

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        // Açık tema: durum çubuğu ikonları koyu olmalı.
        enableEdgeToEdge(
            statusBarStyle = SystemBarStyle.light(
                android.graphics.Color.TRANSPARENT,
                android.graphics.Color.TRANSPARENT,
            ),
            navigationBarStyle = SystemBarStyle.light(
                android.graphics.Color.TRANSPARENT,
                android.graphics.Color.TRANSPARENT,
            ),
        )
        val container = (application as AhududuApplication).container
        setContent {
            AhududuTheme {
                Surface(Modifier.fillMaxSize(), color = MaterialTheme.colorScheme.background) {
                    AppRoot(container)
                }
            }
        }
    }
}

@Composable
fun AppRoot(container: AppContainer) {
    val vm: AppViewModel = viewModel { AppViewModel(container) }
    val state by vm.uiState.collectAsState()

    LifecycleEventEffect(Lifecycle.Event.ON_RESUME) {
        vm.refreshIfLoggedIn()
    }

    Box(
        Modifier
            .fillMaxSize()
            .windowInsetsPadding(WindowInsets.safeDrawing)
            .imePadding()
    ) {
        when (val screen = state.screen) {
            Screen.Loading -> LoadingContent()
            Screen.Welcome -> WelcomeContent(vm, state)
            is Screen.Form -> FormContent(vm, state, screen.mode)
            is Screen.Main -> MainContent(container, vm, state, screen)
        }
        state.error?.let { message ->
            ErrorBar(message, Modifier.align(Alignment.BottomCenter), vm::dismissError)
        }
        state.info?.let { message ->
            InfoBar(message, Modifier.align(Alignment.BottomCenter), vm::dismissInfo)
        }
        Column(Modifier.align(Alignment.TopCenter)) {
            UpdateBannerOverlay(container)
            IncomingBuzzOverlay(container)
        }
    }
}

@Composable
private fun UpdateBannerOverlay(container: AppContainer, modifier: Modifier = Modifier) {
    val updateState by container.updates.state.collectAsState()
    AnimatedVisibility(
        visible = updateState.updateAvailable || updateState.readyToInstall != null,
        enter = fadeIn() + slideInVertically { -it },
        exit = fadeOut() + slideOutVertically { -it },
        modifier = modifier,
    ) {
        Card(
            modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 8.dp),
            shape = MaterialTheme.shapes.medium,
            colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.secondaryContainer),
        ) {
            Row(
                Modifier.padding(horizontal = 14.dp, vertical = 10.dp),
                verticalAlignment = Alignment.CenterVertically
            ) {
                Text("🍓", style = MaterialTheme.typography.titleLarge)
                Spacer(Modifier.width(10.dp))
                Column(Modifier.weight(1f)) {
                    Text(
                        "Ahududu için yenilik var!",
                        style = MaterialTheme.typography.titleSmall,
                        color = MaterialTheme.colorScheme.onSecondaryContainer
                    )
                    Text(
                        if (updateState.readyToInstall != null) "Güncelleme hazır, kurmak için dokun." else "Yeni sürümü hemen yükleyebilirsin.",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSecondaryContainer.copy(alpha = 0.8f)
                    )
                }
                Spacer(Modifier.width(8.dp))
                Button(
                    onClick = {
                        if (updateState.readyToInstall != null) {
                            container.updates.install()
                        } else {
                            container.updates.download()
                        }
                    },
                    shape = MaterialTheme.shapes.small
                ) {
                    Text(if (updateState.downloading) "%${updateState.progress}" else if (updateState.readyToInstall != null) "Kur" else "Güncelle")
                }
            }
        }
    }
}

/** Gelen titreşim uygulama açıkken ekranda da görünür (yalnızca titreşim hissi yeterli değil). */
@Composable
private fun IncomingBuzzOverlay(container: AppContainer, modifier: Modifier = Modifier) {
    val buzz by container.buzz.incoming.collectAsState()
    AnimatedVisibility(
        visible = buzz != null,
        enter = fadeIn() + slideInVertically { -it },
        exit = fadeOut() + slideOutVertically { -it },
        modifier = modifier,
    ) {
        val current = buzz ?: return@AnimatedVisibility
        LaunchedEffect(current.at) {
            delay(4_000)
            container.buzz.clearIncoming()
        }
        Card(
            modifier = Modifier.fillMaxWidth().padding(16.dp),
            shape = MaterialTheme.shapes.medium,
            colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.primary),
        ) {
            Row(
                Modifier.padding(horizontal = 16.dp, vertical = 12.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text("💗", style = MaterialTheme.typography.headlineMedium)
                Spacer(Modifier.width(12.dp))
                Column(Modifier.weight(1f)) {
                    Text(
                        "${current.senderName} sana dokundu",
                        style = MaterialTheme.typography.titleMedium,
                        color = MaterialTheme.colorScheme.onPrimary,
                    )
                    Text(
                        current.pattern.label + if (current.note.isNotBlank()) " · ${current.note}" else "",
                        style = MaterialTheme.typography.bodyMedium,
                        color = MaterialTheme.colorScheme.onPrimary.copy(alpha = 0.85f),
                    )
                }
            }
        }
    }
}

@Composable
private fun LoadingContent() {
    Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
        Column(horizontalAlignment = Alignment.CenterHorizontally) {
            CircularProgressIndicator(color = MaterialTheme.colorScheme.primary)
            Spacer(Modifier.height(12.dp))
            Text("Ahududu açılıyor…", style = MaterialTheme.typography.bodyMedium)
        }
    }
}

@Composable
private fun WelcomeContent(vm: AppViewModel, state: UiState) {
    Column(
        Modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .padding(horizontal = 28.dp, vertical = 48.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Text(
            "Ahududu",
            style = MaterialTheme.typography.displaySmall,
            color = MaterialTheme.colorScheme.primary,
        )
        Spacer(Modifier.height(8.dp))
        Text(
            "İkinizin özel alanı",
            style = MaterialTheme.typography.bodyLarge,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        Spacer(Modifier.height(36.dp))
        ServerStatusPill(state.serverOnline)
        Spacer(Modifier.height(36.dp))
        Button(
            onClick = { vm.openForm(FormMode.SETUP) },
            modifier = Modifier.fillMaxWidth().height(52.dp),
            shape = MaterialTheme.shapes.medium,
        ) { Text("Alanımızı Oluştur", style = MaterialTheme.typography.labelLarge) }
        Spacer(Modifier.height(12.dp))
        OutlinedButton(
            onClick = { vm.openForm(FormMode.JOIN) },
            modifier = Modifier.fillMaxWidth().height(52.dp),
            shape = MaterialTheme.shapes.medium,
        ) { Text("Davetle Katıl", style = MaterialTheme.typography.labelLarge) }
        Spacer(Modifier.height(12.dp))
        TextButton(onClick = { vm.openForm(FormMode.LOGIN) }) {
            Text("Zaten hesabım var, giriş yapayım")
        }
        Spacer(Modifier.height(24.dp))
        Text(
            "Sunucu: ${vm.let { state.let { _ -> "" } }}".let { "" },
            style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        ServerAddressEditor(vm)
    }
}

@Composable
private fun ServerAddressEditor(vm: AppViewModel) {
    var editing by remember { mutableStateOf(false) }
    var url by remember { mutableStateOf("") }
    if (!editing) {
        TextButton(onClick = { editing = true }) {
            Text("Sunucu adresini değiştir", style = MaterialTheme.typography.bodyMedium)
        }
        return
    }
    Column(Modifier.fillMaxWidth().padding(top = 8.dp)) {
        OutlinedTextField(
            value = url,
            onValueChange = { url = it },
            label = { Text("Sunucu adresi") },
            placeholder = { Text("http://192.168.2.170:8787") },
            singleLine = true,
            modifier = Modifier.fillMaxWidth(),
        )
        Row(Modifier.padding(top = 8.dp)) {
            Button(onClick = {
                if (url.isNotBlank()) {
                    vm.setServer(url)
                    editing = false
                }
            }) { Text("Kaydet") }
            Spacer(Modifier.width(8.dp))
            TextButton(onClick = { editing = false }) { Text("İptal") }
        }
    }
}

@Composable
private fun ServerStatusPill(online: Boolean?) {
    val (renk, metin) = when (online) {
        true -> MaterialTheme.colorScheme.primary to "Sunucu ile bağlantı kuruldu"
        false -> MaterialTheme.colorScheme.error to "Sunucuya ulaşılamadı — ev ağında mısın?"
        null -> MaterialTheme.colorScheme.onSurfaceVariant to "Sunucu kontrol ediliyor…"
    }
    Row(
        Modifier
            .background(MaterialTheme.colorScheme.surface, MaterialTheme.shapes.medium)
            .padding(horizontal = 16.dp, vertical = 8.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Box(Modifier.width(8.dp).height(8.dp).background(renk, RoundedCornerShape(4.dp)))
        Spacer(Modifier.width(8.dp))
        Text(metin, style = MaterialTheme.typography.bodyMedium, color = renk)
    }
}

@Composable
private fun FormContent(vm: AppViewModel, state: UiState, mode: FormMode) {
    val baslik = when (mode) {
        FormMode.SETUP -> "Alanımızı Oluştur"
        FormMode.JOIN -> "Davetle Katıl"
        FormMode.LOGIN -> "Giriş Yap"
    }
    Column(
        Modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .padding(horizontal = 28.dp, vertical = 40.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Text(baslik, style = MaterialTheme.typography.headlineMedium, color = MaterialTheme.colorScheme.primary)
        Spacer(Modifier.height(28.dp))

        var spaceName by remember { mutableStateOf("") }
        var inviteCode by remember { mutableStateOf("") }
        var username by remember { mutableStateOf("") }
        var displayName by remember { mutableStateOf("") }
        var password by remember { mutableStateOf("") }

        if (mode == FormMode.SETUP) {
            FormField("Alanımızın adı", spaceName, { spaceName = it }, "ör. Bizim Bahçemiz")
        }
        if (mode == FormMode.JOIN) {
            FormField("Davet kodu", inviteCode, { v -> inviteCode = v.uppercase() }, "AH7K2M9P")
        }
        if (mode != FormMode.LOGIN) {
            FormField("Kullanıcı adı", username, { v -> username = v.lowercase() }, "kucuk_harflerle")
            FormField("Görünen adın", displayName, { displayName = it }, "Sevgiliniz sizi nasıl çağırır?")
        } else {
            FormField("Kullanıcı adı", username, { v -> username = v.lowercase() }, "")
        }
        FormField("Parola", password, { password = it }, if (mode == FormMode.LOGIN) "" else "En az 6 karakter", gizli = true)

        Spacer(Modifier.height(24.dp))
        Button(
            onClick = {
                when (mode) {
                    FormMode.SETUP -> vm.setup(spaceName, username, displayName, password)
                    FormMode.JOIN -> vm.join(inviteCode, username, displayName, password)
                    FormMode.LOGIN -> vm.login(username, password)
                }
            },
            enabled = !state.busy,
            modifier = Modifier.fillMaxWidth().height(52.dp),
            shape = MaterialTheme.shapes.medium,
        ) {
            if (state.busy) {
                CircularProgressIndicator(
                    Modifier.width(20.dp).height(20.dp),
                    strokeWidth = 2.dp,
                    color = MaterialTheme.colorScheme.onPrimary,
                )
            } else {
                Text(baslik, style = MaterialTheme.typography.labelLarge)
            }
        }
        Spacer(Modifier.height(12.dp))
        TextButton(onClick = vm::backToWelcome) { Text("Geri") }
    }
}

@Composable
private fun FormField(
    etiket: String,
    deger: String,
    degistir: (String) -> Unit,
    ornek: String,
    gizli: Boolean = false,
) {
    Column(Modifier.fillMaxWidth().padding(vertical = 6.dp)) {
        Text(etiket, style = MaterialTheme.typography.titleMedium)
        Spacer(Modifier.height(6.dp))
        OutlinedTextField(
            value = deger,
            onValueChange = degistir,
            modifier = Modifier.fillMaxWidth(),
            placeholder = if (ornek.isNotEmpty()) ({ Text(ornek) }) else null,
            singleLine = true,
            shape = MaterialTheme.shapes.small,
            visualTransformation = if (gizli) PasswordVisualTransformation() else VisualTransformation.None,
            keyboardOptions = if (gizli) KeyboardOptions(keyboardType = KeyboardType.Password) else KeyboardOptions.Default,
        )
    }
}

@Composable
private fun MainContent(container: AppContainer, vm: AppViewModel, state: UiState, screen: Screen.Main) {
    var showSettings by remember { mutableStateOf(false) }
    var showTogether by remember { mutableStateOf(false) }

    // Gelen titreşimde kendi kimliğimizi bilmeliyiz (kendi gönderdiğimizde titrememek için).
    LaunchedEffect(screen.me.user.id) {
        container.buzz.setMyUserId(screen.me.user.id)
    }

    if (showSettings) {
        SettingsScreen(container, vm, screen, onClose = { showSettings = false })
        return
    }
    if (showTogether) {
        TogetherScreen(container, onClose = { showTogether = false })
        return
    }

    Column(Modifier.fillMaxSize()) {
        Box(Modifier.weight(1f)) {
            when (state.tab) {
                Tab.HOME -> HomeTab(
                    vm, state, screen,
                    onOpenSettings = { showSettings = true },
                    onOpenTogether = { showTogether = true },
                )
                Tab.MESSAGES -> ChatScreen(container)
                Tab.LETTERS -> LettersScreen(container)
                Tab.MEMORIES -> GalleryScreen(container)
                Tab.NOTES -> NotesScreen(container)
            }
        }

        NavigationBar(
            containerColor = MaterialTheme.colorScheme.surface,
            tonalElevation = 2.dp,
        ) {
            BottomItem("Ana", "🏠", state.tab == Tab.HOME, state.unreadMessages) { vm.selectTab(Tab.HOME) }
            BottomItem("Mesaj", "💬", state.tab == Tab.MESSAGES, state.unreadMessages) { vm.selectTab(Tab.MESSAGES) }
            BottomItem("Mektup", "✉️", state.tab == Tab.LETTERS, 0) { vm.selectTab(Tab.LETTERS) }
            BottomItem("Anı", "🖼", state.tab == Tab.MEMORIES, 0) { vm.selectTab(Tab.MEMORIES) }
            BottomItem("Not", "📝", state.tab == Tab.NOTES, 0) { vm.selectTab(Tab.NOTES) }
        }
    }
}

@Composable
private fun androidx.compose.foundation.layout.RowScope.BottomItem(
    label: String,
    icon: String,
    selected: Boolean,
    badge: Int,
    onClick: () -> Unit,
) {
    NavigationBarItem(
        selected = selected,
        onClick = onClick,
        icon = {
            Box {
                Text(icon, style = MaterialTheme.typography.titleMedium)
                if (badge > 0) {
                    Box(
                        Modifier
                            .align(Alignment.TopEnd)
                            .background(MaterialTheme.colorScheme.primary, RoundedCornerShape(8.dp))
                            .padding(horizontal = 4.dp, vertical = 1.dp),
                    ) {
                        Text(
                            if (badge > 9) "9+" else "$badge",
                            style = MaterialTheme.typography.bodyMedium,
                            color = MaterialTheme.colorScheme.onPrimary,
                        )
                    }
                }
            }
        },
        label = { Text(label) },
        colors = NavigationBarItemDefaults.colors(
            selectedIconColor = MaterialTheme.colorScheme.primary,
            selectedTextColor = MaterialTheme.colorScheme.primary,
            indicatorColor = MaterialTheme.colorScheme.primaryContainer.copy(alpha = 0.5f),
        ),
    )
}

@Composable
private fun HomeTab(
    vm: AppViewModel,
    state: UiState,
    screen: Screen.Main,
    onOpenSettings: () -> Unit,
    onOpenTogether: () -> Unit,
) {
    val me = screen.me
    Column(
        Modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .padding(horizontal = 20.dp),
    ) {
        Row(
            Modifier.fillMaxWidth().padding(top = 16.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Column(Modifier.weight(1f)) {
                Text(
                    "Merhaba, ${me.user.displayName}",
                    style = MaterialTheme.typography.headlineMedium,
                    color = MaterialTheme.colorScheme.primary,
                )
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text(
                        me.space.name,
                        style = MaterialTheme.typography.bodyLarge,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                    Spacer(Modifier.width(8.dp))
                    ConnectionDot(state.socketConnected)
                }
            }
            TextButton(onClick = onOpenSettings) {
                Text("Ayarlar", style = MaterialTheme.typography.bodyMedium)
            }
        }

        Spacer(Modifier.height(16.dp))

        // Birbirimize — titreşim, konum, saat verileri tek yerde.
        Surface(
            onClick = onOpenTogether,
            shape = MaterialTheme.shapes.medium,
            color = MaterialTheme.colorScheme.primary,
            modifier = Modifier.fillMaxWidth(),
        ) {
            Row(
                Modifier.padding(horizontal = 18.dp, vertical = 16.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Column(Modifier.weight(1f)) {
                    Text(
                        "Birbirimize",
                        style = MaterialTheme.typography.titleLarge,
                        color = MaterialTheme.colorScheme.onPrimary,
                    )
                    Spacer(Modifier.height(2.dp))
                    Text(
                        "Dokunuş gönder, titreşim yolla, konumunu paylaş.",
                        style = MaterialTheme.typography.bodyMedium,
                        color = MaterialTheme.colorScheme.onPrimary.copy(alpha = 0.85f),
                    )
                }
                Text(
                    "💗",
                    style = MaterialTheme.typography.headlineMedium,
                    modifier = Modifier.padding(start = 8.dp),
                )
            }
        }

        Spacer(Modifier.height(12.dp))

        // Hızlı etkileşimler — ana ekrandan tek dokunuş
        Card(
            shape = MaterialTheme.shapes.medium,
            colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
            modifier = Modifier.fillMaxWidth(),
        ) {
            Column(Modifier.padding(16.dp)) {
                Text("Bir işaret gönder", style = MaterialTheme.typography.titleMedium)
                Spacer(Modifier.height(10.dp))
                QuickInteractionRow(vm)
            }
        }

        Spacer(Modifier.height(12.dp))

        Card(
            shape = MaterialTheme.shapes.medium,
            colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
            modifier = Modifier.fillMaxWidth(),
        ) {
            Column(Modifier.padding(20.dp)) {
                Text("Bizim Alan", style = MaterialTheme.typography.titleMedium)
                Spacer(Modifier.height(10.dp))
                me.members.forEachIndexed { i, member ->
                    if (i > 0) HorizontalDivider(color = MaterialTheme.colorScheme.outline)
                    Row(
                        Modifier.fillMaxWidth().padding(vertical = 10.dp),
                        horizontalArrangement = Arrangement.SpaceBetween,
                    ) {
                        Text(member.displayName, style = MaterialTheme.typography.bodyLarge)
                        Text(
                            if (member.id == me.user.id) "sen" else "hayat arkadaşın",
                            style = MaterialTheme.typography.bodyMedium,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                }
                if (me.members.size < 2) {
                    Spacer(Modifier.height(8.dp))
                    Text(
                        "Sevgilin henüz katılmadı. Ayarlar'dan davet kodunu paylaş.",
                        style = MaterialTheme.typography.bodyMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
            }
        }

        screen.inviteCode?.let { code ->
            Spacer(Modifier.height(12.dp))
            Card(
                colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.secondaryContainer),
                shape = MaterialTheme.shapes.medium,
                modifier = Modifier.fillMaxWidth(),
            ) {
                Column(Modifier.padding(20.dp), horizontalAlignment = Alignment.CenterHorizontally) {
                    Text("Davet Kodun", style = MaterialTheme.typography.titleMedium)
                    Spacer(Modifier.height(8.dp))
                    Text(
                        code,
                        style = MaterialTheme.typography.displaySmall.copy(fontFamily = FontFamily.Monospace),
                        color = MaterialTheme.colorScheme.primary,
                        textAlign = TextAlign.Center,
                    )
                    Spacer(Modifier.height(8.dp))
                    Text(
                        "Bu kodu sevgiline gönder; \"Davetle Katıl\" ile alanınıza katılsın.",
                        style = MaterialTheme.typography.bodyMedium,
                        textAlign = TextAlign.Center,
                    )
                }
            }
        }

        Spacer(Modifier.height(16.dp))
        Text(
            "Ahududu büyüyor — mektuplar, mesajlar, anılar ve notlar artık seninle.",
            style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        Spacer(Modifier.height(24.dp))
    }
}

@Composable
private fun ConnectionDot(connected: Boolean) {
    Box(
        Modifier
            .width(8.dp)
            .height(8.dp)
            .background(
                if (connected) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.error,
                RoundedCornerShape(4.dp),
            )
    )
}

@Composable
private fun QuickInteractionRow(vm: AppViewModel) {
    // Mevcut Home ekranında hızlı erişim; detaylı liste "Birbirimize" bölümünde.
    val kinds = listOf("heart" to "❤️", "kiss" to "😘", "hug" to "🤗", "attention" to "💗")
    Row(
        Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.SpaceEvenly,
    ) {
        kinds.forEach { (kind, emoji) ->
            TextButton(onClick = { vm.sendQuickInteraction(kind) }) {
                Text(emoji, style = MaterialTheme.typography.headlineMedium)
            }
        }
    }
}

@Composable
private fun InfoBar(message: String, modifier: Modifier, onDismiss: () -> Unit) {
    Card(
        modifier = modifier.fillMaxWidth().padding(16.dp),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.secondaryContainer),
        shape = MaterialTheme.shapes.medium,
    ) {
        Row(Modifier.padding(horizontal = 16.dp, vertical = 12.dp), verticalAlignment = Alignment.CenterVertically) {
            Text(message, style = MaterialTheme.typography.bodyMedium, modifier = Modifier.weight(1f))
            TextButton(onClick = onDismiss) { Text("Tamam") }
        }
    }
}

@Composable
private fun ErrorBar(message: String, modifier: Modifier, onDismiss: () -> Unit) {
    Card(
        modifier = modifier.fillMaxWidth().padding(16.dp),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.error),
        shape = MaterialTheme.shapes.medium,
    ) {
        Row(Modifier.padding(horizontal = 16.dp, vertical = 12.dp), verticalAlignment = Alignment.CenterVertically) {
            Text(
                message,
                color = MaterialTheme.colorScheme.onPrimary,
                style = MaterialTheme.typography.bodyMedium,
                modifier = Modifier.weight(1f),
            )
            TextButton(onClick = onDismiss) { Text("Tamam", color = MaterialTheme.colorScheme.onPrimary) }
        }
    }
}
