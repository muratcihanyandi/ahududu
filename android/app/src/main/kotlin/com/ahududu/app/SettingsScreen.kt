package com.ahududu.app

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Switch
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
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.unit.dp

@Composable
fun SettingsScreen(
    container: AppContainer,
    vm: AppViewModel,
    screen: Screen.Main,
    onClose: () -> Unit,
) {
    val me = screen.me
    var serverUrl by remember { mutableStateOf(container.api.serverUrl) }
    var displayName by remember { mutableStateOf(me.user.displayName) }

    Column(
        Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(20.dp),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            TextButton(onClick = onClose) { Text("Geri") }
            Text(
                "Ayarlar",
                style = MaterialTheme.typography.headlineMedium,
                color = MaterialTheme.colorScheme.primary,
                modifier = Modifier.padding(start = 8.dp),
            )
        }
        Spacer(Modifier.height(16.dp))

        // Profil
        Card(
            shape = MaterialTheme.shapes.medium,
            colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
            modifier = Modifier.fillMaxWidth(),
        ) {
            Column(Modifier.padding(16.dp)) {
                Text("Profil", style = MaterialTheme.typography.titleMedium)
                Spacer(Modifier.height(8.dp))
                Text(
                    "@${me.user.username}",
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                Spacer(Modifier.height(8.dp))
                OutlinedTextField(
                    value = displayName,
                    onValueChange = { displayName = it },
                    label = { Text("Görünen ad") },
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth(),
                )
                Spacer(Modifier.height(8.dp))
                Button(onClick = { vm.updateDisplayName(displayName) }) { Text("Kaydet") }
            }
        }

        Spacer(Modifier.height(12.dp))

        // Davet
        Card(
            shape = MaterialTheme.shapes.medium,
            colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
            modifier = Modifier.fillMaxWidth(),
        ) {
            Column(Modifier.padding(16.dp)) {
                Text("Davet", style = MaterialTheme.typography.titleMedium)
                Spacer(Modifier.height(6.dp))
                Text(
                    if (me.members.size < 2) {
                        "Sevgilin henüz katılmadı. Yeni bir davet kodu oluşturup paylaş."
                    } else {
                        "İkiniz de alanınızdasınız 💗"
                    },
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                Spacer(Modifier.height(8.dp))
                Button(onClick = { vm.createInvite() }, enabled = me.members.size < 2) {
                    Text("Yeni davet kodu")
                }
            }
        }

        Spacer(Modifier.height(12.dp))

        // Sunucu
        Card(
            shape = MaterialTheme.shapes.medium,
            colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
            modifier = Modifier.fillMaxWidth(),
        ) {
            Column(Modifier.padding(16.dp)) {
                Text("Sunucu", style = MaterialTheme.typography.titleMedium)
                Spacer(Modifier.height(6.dp))
                OutlinedTextField(
                    value = serverUrl,
                    onValueChange = { serverUrl = it },
                    label = { Text("Sunucu adresi") },
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth(),
                )
                Spacer(Modifier.height(8.dp))
                Row {
                    Button(onClick = { vm.setServer(serverUrl.trim()) }) { Text("Kaydet") }
                    Spacer(Modifier.width(8.dp))
                    TextButton(onClick = { vm.checkServerNow() }) { Text("Bağlantıyı test et") }
                }
            }
        }

        Spacer(Modifier.height(12.dp))

        // Cihazlar
        Card(
            shape = MaterialTheme.shapes.medium,
            colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
            modifier = Modifier.fillMaxWidth(),
        ) {
            Column(Modifier.padding(16.dp)) {
                Text("Cihazlar", style = MaterialTheme.typography.titleMedium)
                Spacer(Modifier.height(6.dp))
                if (me.devices.isEmpty()) {
                    Text(
                        "Bu cihaz henüz kayıtlı değil.",
                        style = MaterialTheme.typography.bodyMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                } else {
                    me.devices.forEachIndexed { i, device ->
                        if (i > 0) HorizontalDivider(color = MaterialTheme.colorScheme.outline)
                        Row(
                            Modifier.fillMaxWidth().padding(vertical = 8.dp),
                            horizontalArrangement = Arrangement.SpaceBetween,
                        ) {
                            Text(device.name, style = MaterialTheme.typography.bodyLarge)
                            Text(
                                device.platform,
                                style = MaterialTheme.typography.bodyMedium,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                        }
                    }
                }
            }
        }

        Spacer(Modifier.height(12.dp))

        // Güncelleme
        UpdateCard(container)

        Spacer(Modifier.height(12.dp))

        // Saat
        Card(
            shape = MaterialTheme.shapes.medium,
            colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
            modifier = Modifier.fillMaxWidth(),
        ) {
            Column(Modifier.padding(16.dp)) {
                Text("Galaxy Watch Entegrasyonu", style = MaterialTheme.typography.titleMedium)
                Spacer(Modifier.height(6.dp))
                Text(
                    "Samsung Galaxy Watch 7 / Ultra ile kalp atışı, stres seviyesi ve adım sayısı " +
                        "anlık olarak senkronize edilir.",
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                Spacer(Modifier.height(10.dp))
                Button(
                    onClick = {
                        container.publishWearCredentials()
                    },
                    shape = MaterialTheme.shapes.small
                ) {
                    Text("Saate Giriş Bilgilerini Aktar ⌚")
                }
                Spacer(Modifier.height(8.dp))
                Text(
                    "Bu düğmeye bastığında telefonundaki oturum ve sunucu bağlantısı saatinle " +
                        "otomatik eşleşir; saatte tekrar kullanıcı adı veya şifre girmen gerekmez.",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                Spacer(Modifier.height(10.dp))
                HorizontalDivider(color = MaterialTheme.colorScheme.outline)
                Spacer(Modifier.height(10.dp))
                Text("Saate Uygulamayı Kur", style = MaterialTheme.typography.titleSmall)
                Spacer(Modifier.height(4.dp))
                Text(
                    "Saatte Geliştirici Seçenekleri → Kablosuz Hata Ayıklama (Wireless Debugging) açarak " +
                        "tek tıkla kurabilirsin (Galaxy Watch 7 / Ultra uyumlu).",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        }

        Spacer(Modifier.height(24.dp))
        TextButton(onClick = { vm.logout() }) {
            Text("Çıkış yap", color = MaterialTheme.colorScheme.error)
        }
        Spacer(Modifier.height(8.dp))
        Text(
            "Ahududu ${container.updates.currentVersionName()} · port 8787",
            style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        Spacer(Modifier.height(24.dp))
    }
}

/** Güncelleme kartı: sürüm kontrolü → indirme → kurulum ekranı. */
@Composable
private fun UpdateCard(container: AppContainer) {
    val controller = container.updates
    val state by controller.state.collectAsState()

    Card(
        shape = MaterialTheme.shapes.medium,
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
        modifier = Modifier.fillMaxWidth(),
    ) {
        Column(Modifier.padding(16.dp)) {
            Text("Güncelleme", style = MaterialTheme.typography.titleMedium)
            Spacer(Modifier.height(6.dp))
            Text(
                "Yüklü sürüm: ${controller.currentVersionName()} (${controller.currentVersionCode()})",
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            state.status?.let {
                Spacer(Modifier.height(6.dp))
                Text(it, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.primary)
            }
            state.release?.let { release ->
                if (state.updateAvailable) {
                    Spacer(Modifier.height(6.dp))
                    Text(
                        "Yeni: ${release.versionName}" +
                            if (release.changelog.isNotBlank()) " — ${release.changelog}" else "",
                        style = MaterialTheme.typography.bodyMedium,
                    )
                    Text(
                        formatBytes(release.sizeBytes),
                        style = MaterialTheme.typography.bodyMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
            }
            state.error?.let {
                Spacer(Modifier.height(6.dp))
                Text(it, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.error)
            }

            Spacer(Modifier.height(10.dp))
            Row(verticalAlignment = Alignment.CenterVertically) {
                Button(
                    onClick = { controller.check() },
                    enabled = !state.checking && !state.downloading,
                    shape = MaterialTheme.shapes.small,
                ) { Text(if (state.checking) "Kontrol ediliyor…" else "Sürümü kontrol et") }

                if (state.updateAvailable) {
                    Spacer(Modifier.width(8.dp))
                    Button(
                        onClick = { controller.download() },
                        enabled = !state.downloading && !state.installing,
                        shape = MaterialTheme.shapes.small,
                    ) {
                        Text(if (state.downloading) "%${state.progress}" else "İndir")
                    }
                }
                if (state.readyToInstall != null && !state.silentInstallPossible && !state.installing) {
                    Spacer(Modifier.width(8.dp))
                    Button(onClick = { controller.install() }, shape = MaterialTheme.shapes.small) {
                        Text("Kur")
                    }
                }
            }
            if (state.downloading) {
                Spacer(Modifier.height(8.dp))
                LinearProgressIndicator(
                    progress = { state.progress / 100f },
                    modifier = Modifier.fillMaxWidth(),
                )
            }

            Spacer(Modifier.height(12.dp))
            HorizontalDivider(color = MaterialTheme.colorScheme.outline)
            Spacer(Modifier.height(10.dp))

            // Otomatik güncelleme anahtarı
            Row(verticalAlignment = Alignment.CenterVertically) {
                Column(Modifier.weight(1f)) {
                    Text("Otomatik güncelle", style = MaterialTheme.typography.titleMedium)
                    Text(
                        if (state.silentInstallPossible) {
                            "Yeni sürüm çıkınca hiçbir şey sormadan kendini günceller."
                        } else {
                            "Yeni sürümü arka planda indirir; kurmak için tek dokunuş yeter."
                        },
                        style = MaterialTheme.typography.bodyMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
                Switch(
                    checked = state.autoUpdateEnabled,
                    onCheckedChange = { controller.setAutoUpdate(it) },
                )
            }

            Spacer(Modifier.height(10.dp))
            Text(
                if (state.silentInstallPossible) {
                    "Bu telefon tam otomatik güncelleme modunda (Device Owner). " +
                        "Kurulum arka planda yapılır, onay ekranı çıkmaz."
                } else {
                    "Not: Android, normal uygulamalarda kurulum onayı ister. Bu telefonu " +
                        "\"Device Owner\" yaparsan güncellemeler tamamen otomatik kurulur " +
                        "(tek seferlik ADB komutu, docs/UPDATE_SYSTEM.md)."
                },
                style = MaterialTheme.typography.bodyMedium,
                color = if (state.silentInstallPossible) {
                    MaterialTheme.colorScheme.primary
                } else {
                    MaterialTheme.colorScheme.onSurfaceVariant
                },
            )
        }
    }
}
