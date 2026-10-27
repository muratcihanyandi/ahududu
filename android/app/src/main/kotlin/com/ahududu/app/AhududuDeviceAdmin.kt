package com.ahududu.app

import android.app.admin.DeviceAdminReceiver
import android.content.ComponentName
import android.content.Context
import android.content.Intent

/**
 * Cihaz yöneticisi — yalnızca "Device Owner" modunda sessiz APK kurulumu için var.
 *
 * Bu uygulama yayınlanmıyor; iki kişinin kendi telefonlarında kullanılıyor.
 * Telefon bir kez `adb shell dpm set-device-owner ...` ile sahiplenilirse,
 * güncellemeler kullanıcı onayı olmadan kurulabilir (Android'in izin verdiği tek yol).
 *
 * `testOnly="true"` sayesinde aynı komutla geri alınabilir:
 *   adb shell dpm remove-active-admin com.ahududu.app/.AhududuDeviceAdmin
 */
class AhududuDeviceAdmin : DeviceAdminReceiver() {
    override fun onEnabled(context: Context, intent: Intent) = Unit
    override fun onDisabled(context: Context, intent: Intent) = Unit

    companion object {
        fun component(context: Context): ComponentName =
            ComponentName(context, AhududuDeviceAdmin::class.java)
    }
}
