package com.ahududu.app

import android.app.PendingIntent
import android.app.admin.DevicePolicyManager
import android.content.Context
import android.content.Intent
import android.content.pm.PackageInstaller
import androidx.core.content.FileProvider
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.io.File
import java.net.HttpURLConnection
import java.net.URL
import java.security.MessageDigest

data class UpdateUiState(
    val checking: Boolean = false,
    val release: com.ahududu.common.api.AppRelease? = null,
    val updateAvailable: Boolean = false,
    val downloading: Boolean = false,
    val progress: Int = 0,
    val readyToInstall: File? = null,
    val error: String? = null,
    val status: String? = null,
    val silentInstallPossible: Boolean = false,
    val autoUpdateEnabled: Boolean = true,
    val installing: Boolean = false,
)

/**
 * APK güncelleme akışı: sürüm kontrolü → indirme (sha256 doğrulamalı) → kurulum.
 *
 * İki kurulum yolu var:
 *  1. **Device Owner** (telefon bir kez ADB ile sahiplenildi): `PackageInstaller` ile
 *     arka planda sessiz kurulum — hiçbir onay ekranı çıkmaz, tam otomatik.
 *  2. Normal uygulama: Android zorunlu olarak onay ekranı gösterir (platform sınırı).
 *
 * Otomatik güncelleme açıksa uygulama açılışta ve 3 saatte bir sunucuyu yoklar;
 * yeni sürüm varsa indirir ve sessiz kurulum yapabilen cihazlarda kendini günceller.
 */
class UpdateController(
    private val context: Context,
    private val container: AppContainer,
) {
    private val _state = MutableStateFlow(
        UpdateUiState(silentInstallPossible = isDeviceOwner())
    )
    val state: StateFlow<UpdateUiState> = _state.asStateFlow()

    private var autoJob: Job? = null
    private val prefs = context.getSharedPreferences("ahududu_prefs", Context.MODE_PRIVATE)

    /** Bu telefon Device Owner mı? (sessiz kurulum yalnızca o zaman mümkün) */
    fun isDeviceOwner(): Boolean = runCatching {
        val dpm = context.getSystemService(Context.DEVICE_POLICY_SERVICE) as DevicePolicyManager
        dpm.isDeviceOwnerApp(context.packageName)
    }.getOrDefault(false)

    val autoUpdateEnabled: Boolean
        get() = prefs.getBoolean(KEY_AUTO_UPDATE, true)

    fun setAutoUpdate(enabled: Boolean) {
        prefs.edit().putBoolean(KEY_AUTO_UPDATE, enabled).apply()
        _state.update { it.copy(autoUpdateEnabled = enabled) }
        if (enabled) startAutoUpdater() else stopAutoUpdater()
    }

    /** Açılışta bir kez çalışır: yeni sürüm varsa sessizce kurar (Device Owner ise). */
    fun startAutoUpdater() {
        if (autoJob?.isActive == true) return
        _state.update { it.copy(autoUpdateEnabled = autoUpdateEnabled, silentInstallPossible = isDeviceOwner()) }
        autoJob = container.scope.launch {
            // Açılışta ağı beklemek için kısa gecikme.
            delay(2_000)
            while (isActive) {
                if (autoUpdateEnabled) autoCheckAndInstall()
                delay(AUTO_INTERVAL_MS)
            }
        }
    }

    fun stopAutoUpdater() {
        autoJob?.cancel()
        autoJob = null
    }

    fun check() {
        val token = container.tokenStore.get() ?: return
        if (_state.value.checking) return
        _state.update { it.copy(checking = true, error = null, status = null) }
        container.scope.launch {
            try {
                val response = container.api.latestRelease(token, "phone")
                val current = currentVersionCode()
                val release = response.release
                _state.update {
                    it.copy(
                        checking = false,
                        release = release,
                        updateAvailable = release != null && release.versionCode > current,
                        status = when {
                            release == null -> "Sunucuda yayınlanmış APK yok."
                            release.versionCode > current -> "Yeni sürüm hazır: ${release.versionName}"
                            else -> "Uygulaman güncel (${release.versionName})."
                        },
                    )
                }
            } catch (e: Exception) {
                _state.update { it.copy(checking = false, error = "Sürüm kontrolü başarısız: ${e.message}") }
            }
        }
    }

    /**
     * Otomatik tur: yeni sürüm varsa indirir; sessiz kurulum mümkünse kurar,
     * değilse yalnızca "indirildi, kur" durumuna geçer (kullanıcı tek dokunuşla kurar).
     */
    private suspend fun autoCheckAndInstall() {
        val token = container.tokenStore.get() ?: return
        val release = try {
            container.api.latestRelease(token, "phone").release
        } catch (_: Exception) {
            return // ağ yok: sessizce bekle
        } ?: return
        if (release.versionCode <= currentVersionCode()) return

        _state.update { it.copy(release = release, updateAvailable = true, status = "Yeni sürüm indiriliyor…") }
        val file = try {
            withContext(Dispatchers.IO) { downloadApk(token, release) }
        } catch (e: Exception) {
            _state.update { it.copy(error = "Otomatik indirme başarısız: ${e.message}") }
            return
        }

        if (isDeviceOwner()) {
            _state.update {
                it.copy(
                    downloading = false,
                    progress = 100,
                    readyToInstall = file,
                    installing = true,
                    status = "Güncelleme sessizce kuruluyor…",
                )
            }
            installSilently(file)
        } else {
            _state.update {
                it.copy(
                    downloading = false,
                    progress = 100,
                    readyToInstall = file,
                    status = "Yeni sürüm indirildi — kurmak için dokun.",
                )
            }
        }
    }

    fun download() {
        val token = container.tokenStore.get() ?: return
        val release = _state.value.release ?: return
        if (_state.value.downloading) return
        _state.update { it.copy(downloading = true, progress = 0, error = null) }
        container.scope.launch {
            try {
                val file = withContext(Dispatchers.IO) { downloadApk(token, release) }
                _state.update {
                    it.copy(
                        downloading = false,
                        progress = 100,
                        readyToInstall = file,
                        status = "İndirildi, kuruluma hazır.",
                    )
                }
                // Device Owner ise indirme biter bitmez sessizce kur.
                if (isDeviceOwner()) installSilently(file)
            } catch (e: Exception) {
                _state.update { it.copy(downloading = false, error = "İndirme başarısız: ${e.message}") }
            }
        }
    }

    private fun downloadApk(token: String, release: com.ahududu.common.api.AppRelease): File {
        val dir = File(context.filesDir, "updates").apply { mkdirs() }
        // Eski indirmeleri temizle (alan sınırlı).
        dir.listFiles()?.forEach { if (it.name != "ahududu-${release.versionCode}.apk") it.delete() }
        val target = File(dir, "ahududu-${release.versionCode}.apk")
        if (target.exists() && target.length() == release.sizeBytes && release.sizeBytes > 0) {
            verifySha(target, release.sha256)
            return target
        }

        val url = container.api.releaseDownloadUrl(release.downloadPath)
        val conn = URL(url).openConnection() as HttpURLConnection
        conn.setRequestProperty("Authorization", "Bearer $token")
        conn.connectTimeout = 15_000
        conn.readTimeout = 120_000
        conn.inputStream.use { input ->
            target.outputStream().use { out ->
                val buffer = ByteArray(64 * 1024)
                var total = 0L
                var read: Int
                while (input.read(buffer).also { read = it } > 0) {
                    out.write(buffer, 0, read)
                    total += read
                    if (release.sizeBytes > 0) {
                        val pct = ((total * 100) / release.sizeBytes).toInt().coerceIn(0, 99)
                        _state.update { it.copy(progress = pct) }
                    }
                }
            }
        }
        verifySha(target, release.sha256)
        return target
    }

    private fun verifySha(file: File, expected: String) {
        if (expected.isBlank()) return
        val digest = MessageDigest.getInstance("SHA-256")
        file.inputStream().use { input ->
            val buffer = ByteArray(64 * 1024)
            var read: Int
            while (input.read(buffer).also { read = it } > 0) digest.update(buffer, 0, read)
        }
        val actual = digest.digest().joinToString("") { "%02x".format(it) }
        if (!actual.equals(expected, ignoreCase = true)) {
            file.delete()
            throw IllegalStateException("Dosya bütünlüğü doğrulanamadı (sha256 uyuşmuyor).")
        }
    }

    /**
     * Device Owner modunda sessiz kurulum. Kullanıcı onayı istemez; uygulama
     * kurulum bitince Android tarafından yeniden başlatılır.
     */
    fun installSilently(file: File) {
        if (!isDeviceOwner()) return
        container.scope.launch(Dispatchers.IO) {
            try {
                val installer = context.packageManager.packageInstaller
                val params = PackageInstaller.SessionParams(
                    PackageInstaller.SessionParams.MODE_FULL_INSTALL
                ).apply {
                    setRequireUserAction(PackageInstaller.SessionParams.USER_ACTION_NOT_REQUIRED)
                }
                val sessionId = installer.createSession(params)
                installer.openSession(sessionId).use { session ->
                    file.inputStream().use { input ->
                        session.openWrite("base.apk", 0, file.length()).use { out ->
                            input.copyTo(out)
                            session.fsync(out)
                        }
                    }
                    val resultIntent = Intent(context, InstallResultReceiver::class.java).apply {
                        action = InstallResultReceiver.ACTION_INSTALL_RESULT
                        setPackage(context.packageName)
                    }
                    val flags = PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_MUTABLE
                    val pending = PendingIntent.getBroadcast(context, sessionId, resultIntent, flags)
                    session.commit(pending.intentSender)
                }
                _state.update { it.copy(installing = true, status = "Kurulum başlatıldı…") }
            } catch (e: Exception) {
                _state.update {
                    it.copy(
                        installing = false,
                        error = "Sessiz kurulum başarısız: ${e.message}. Onay ekranıyla deneyin.",
                    )
                }
            }
        }
    }

    /** Android kurulum ekranını açar (Device Owner değilken tek yol). Kullanıcı onayı gerekir. */
    fun install() {
        val file = _state.value.readyToInstall ?: return
        runCatching {
            val uri = FileProvider.getUriForFile(context, "${context.packageName}.fileprovider", file)
            val intent = Intent(Intent.ACTION_VIEW).apply {
                setDataAndType(uri, "application/vnd.android.package-archive")
                addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
                addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            }
            context.startActivity(intent)
            _state.update { it.copy(status = "Kurulum ekranı açıldı.") }
        }.onFailure {
            _state.update {
                it.copy(error = "Kurulum ekranı açılamadı. Bilinmeyen kaynaklardan kurulum iznini ver.")
            }
        }
    }

    fun currentVersionCode(): Int = runCatching {
        context.packageManager.getPackageInfo(context.packageName, 0).longVersionCode.toInt()
    }.getOrDefault(0)

    fun currentVersionName(): String = runCatching {
        context.packageManager.getPackageInfo(context.packageName, 0).versionName ?: "?"
    }.getOrDefault("?")

    fun dismissError() = _state.update { it.copy(error = null) }

    companion object {
        private const val KEY_AUTO_UPDATE = "auto_update_enabled"
        private const val AUTO_INTERVAL_MS = 3 * 60 * 60 * 1000L // 3 saat
    }
}
