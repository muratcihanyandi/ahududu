package com.ahududu.app

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.pm.PackageInstaller
import android.util.Log
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

/**
 * Sessiz kurulum sonucu. Device Owner modunda APK arka planda kurulur;
 * sonuç buraya düşer ve Ayarlar ekranındaki güncelleme kartına yansır.
 */
class InstallResultReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action != ACTION_INSTALL_RESULT) return
        val status = intent.getIntExtra(PackageInstaller.EXTRA_STATUS, PackageInstaller.STATUS_FAILURE)
        val message = intent.getStringExtra(PackageInstaller.EXTRA_STATUS_MESSAGE).orEmpty()
        Log.i(TAG, "Sessiz kurulum sonucu: status=$status message=$message")

        val text = when (status) {
            PackageInstaller.STATUS_PENDING_USER_ACTION -> "Kurulum onayı bekleniyor"
            PackageInstaller.STATUS_SUCCESS -> "Güncelleme kuruldu"
            PackageInstaller.STATUS_FAILURE_ABORTED -> "Kurulum iptal edildi"
            PackageInstaller.STATUS_FAILURE_BLOCKED -> "Kurulum engellendi"
            PackageInstaller.STATUS_FAILURE_CONFLICT -> "Sürüm çakışması (imza farklı olabilir)"
            PackageInstaller.STATUS_FAILURE_INCOMPATIBLE -> "APK bu cihazla uyumsuz"
            PackageInstaller.STATUS_FAILURE_INVALID -> "APK geçersiz"
            PackageInstaller.STATUS_FAILURE_STORAGE -> "Depolama yetersiz"
            else -> "Kurulum başarısız ($status)"
        }
        lastResultValue = text

        // STATUS_PENDING_USER_ACTION: cihaz sahibi değilsek Android onay ekranı ister.
        if (status == PackageInstaller.STATUS_PENDING_USER_ACTION) {
            val confirm = if (android.os.Build.VERSION.SDK_INT >= 33) {
                intent.getParcelableExtra("android.content.pm.extra.INTENT", Intent::class.java)
            } else {
                @Suppress("DEPRECATION")
                intent.getParcelableExtra("android.content.pm.extra.INTENT")
            }
            if (confirm != null) {
                runCatching {
                    confirm.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                    context.startActivity(confirm)
                }
            }
        }
    }

    companion object {
        private const val TAG = "AhududuInstall"
        const val ACTION_INSTALL_RESULT = "com.ahududu.app.INSTALL_RESULT"

        private val lastResult = MutableStateFlow<String?>(null)
        val lastResultFlow: StateFlow<String?> = lastResult.asStateFlow()

        /** Kotlin'den yazmak için ayrı erişim (val yeniden atanamaz). */
        var lastResultValue: String?
            get() = lastResult.value
            set(value) { lastResult.value = value }
    }
}
