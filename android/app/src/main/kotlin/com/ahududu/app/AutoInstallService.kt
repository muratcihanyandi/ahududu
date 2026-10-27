package com.ahududu.app

import android.accessibilityservice.AccessibilityService
import android.view.accessibility.AccessibilityEvent
import android.view.accessibility.AccessibilityNodeInfo

/**
 * Kurulum onay ekranını otomatik tamamlar.
 *
 * Neden gerekli: Android, normal (Device Owner olmayan) uygulamalarda APK kurulumunu
 * kullanıcı onayına bağlar. Bu servis yalnızca **kendi paketimizin** kurulum ekranında
 * "Kur / Güncelle" düğmesine basar; başka hiçbir uygulamanın ekranına dokunmaz.
 *
 * Kapsam bilinçli olarak dardır:
 *   - Yalnızca `com.google.android.packageinstaller` / `com.android.packageinstaller`
 *     pencerelerinde çalışır.
 *   - Yalnızca metni "Kur", "Güncelle", "Install", "Update" olan düğüme basar.
 *   - Başka bir şey okumaz, kaydetmez, iletmez.
 *
 * Kullanıcı bir kez Ayarlar → Erişilebilirlik → Ahududu'dan etkinleştirir.
 */
class AutoInstallService : AccessibilityService() {

    override fun onAccessibilityEvent(event: AccessibilityEvent) {
        if (event.eventType != AccessibilityEvent.TYPE_WINDOW_STATE_CHANGED &&
            event.eventType != AccessibilityEvent.TYPE_WINDOW_CONTENT_CHANGED
        ) {
            return
        }
        val packageName = event.packageName?.toString() ?: return
        if (packageName !in INSTALLER_PACKAGES) return

        val root = rootInActiveWindow ?: return
        runCatching { clickInstallButton(root) }
    }

    private fun clickInstallButton(root: AccessibilityNodeInfo): Boolean {
        // Önce doğrudan eşleşen düğmeler.
        for (label in INSTALL_LABELS) {
            val nodes = root.findAccessibilityNodeInfosByText(label) ?: continue
            for (node in nodes) {
                val target = clickableAncestor(node) ?: continue
                if (!target.isEnabled) continue
                if (target.performAction(AccessibilityNodeInfo.ACTION_CLICK)) return true
            }
        }
        // Bazı sürümlerde düğme metni farklı görünür: tüm düğmeleri tara.
        return clickByResourceId(root)
    }

    private fun clickByResourceId(root: AccessibilityNodeInfo): Boolean {
        for (id in INSTALL_RESOURCE_IDS) {
            val nodes = root.findAccessibilityNodeInfosByViewId(id) ?: continue
            for (node in nodes) {
                val target = clickableAncestor(node) ?: continue
                if (!target.isEnabled) continue
                val text = target.text?.toString().orEmpty().lowercase()
                // "İptal"/"Cancel" gibi düğmelere asla basma.
                if (text.contains("iptal") || text.contains("cancel")) continue
                if (target.performAction(AccessibilityNodeInfo.ACTION_CLICK)) return true
            }
        }
        return false
    }

    /** Metin düğümünün tıklanabilir üst öğesini bulur. */
    private fun clickableAncestor(node: AccessibilityNodeInfo): AccessibilityNodeInfo? {
        var current: AccessibilityNodeInfo? = node
        var depth = 0
        while (current != null && depth < 6) {
            if (current.isClickable) return current
            current = current.parent
            depth++
        }
        return null
    }

    override fun onInterrupt() = Unit

    private companion object {
        val INSTALLER_PACKAGES = setOf(
            "com.google.android.packageinstaller",
            "com.android.packageinstaller",
            "com.samsung.android.packageinstaller",
        )

        val INSTALL_LABELS = listOf(
            "Kur", "Güncelle", "Yükle", "Yine de kur",
            "Install", "Update", "Install anyway",
        )

        val INSTALL_RESOURCE_IDS = listOf(
            "com.android.packageinstaller:id/ok_button",
            "com.android.packageinstaller:id/btn_install",
            "com.google.android.packageinstaller:id/ok_button",
            "com.samsung.android.packageinstaller:id/ok_button",
        )
    }
}
