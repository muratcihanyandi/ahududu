package com.ahududu.app

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.location.Location
import android.location.LocationListener
import android.location.LocationManager
import android.os.Bundle
import android.os.Looper
import androidx.core.content.ContextCompat
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import java.time.Instant

/**
 * Konum paylaşımı — yalnızca kullanıcı açıkça etkinleştirdiğinde çalışır.
 * Uygulama açıkken 60 saniyede bir son konumu sunucuya bildirir.
 * Arka planda çalışmaz (foreground service gerekir; bilinçli sınır).
 */
class LocationReporter(
    private val context: Context,
    private val scope: CoroutineScope,
    private val apiProvider: () -> com.ahududu.common.api.AhududuApi,
    private val tokenProvider: () -> String?,
    private val prefs: android.content.SharedPreferences,
) {
    private var job: Job? = null
    private var last: Location? = null

    private val listener = object : LocationListener {
        override fun onLocationChanged(location: Location) {
            last = location
        }
        override fun onProviderEnabled(provider: String) {}
        override fun onProviderDisabled(provider: String) {}
        @Deprecated("Uyumluluk")
        override fun onStatusChanged(provider: String?, status: Int, extras: Bundle?) {}
    }

    val sharingEnabled: Boolean get() = prefs.getBoolean(KEY_SHARING, false)
    val myLastLocation: Location? get() = last

    fun hasPermission(): Boolean =
        ContextCompat.checkSelfPermission(context, Manifest.permission.ACCESS_FINE_LOCATION) ==
            PackageManager.PERMISSION_GRANTED

    /** Paylaşımı açar/kapatır; kapatınca sunucudaki koordinatlar da silinir. */
    fun setSharing(enabled: Boolean) {
        prefs.edit().putBoolean(KEY_SHARING, enabled).apply()
        if (enabled) start() else stop(clearOnServer = true)
    }

    fun start() {
        if (!sharingEnabled) return
        if (!hasPermission()) {
            // İzin yoksa sessizce sahte konum göndermeyiz; ekran izin ister.
            requestLocationUpdates()
            return
        }
        requestLocationUpdates()
        if (job?.isActive == true) return
        job = scope.launch {
            // İlk gönderim hemen, sonra dakikada bir.
            while (isActive) {
                pushOnce()
                delay(60_000)
            }
        }
    }

    private fun requestLocationUpdates() {
        val manager = context.getSystemService(Context.LOCATION_SERVICE) as LocationManager
        val fine = hasPermission()
        val providers = buildList {
            if (fine && manager.isProviderEnabled(LocationManager.GPS_PROVIDER)) add(LocationManager.GPS_PROVIDER)
            if (manager.isProviderEnabled(LocationManager.NETWORK_PROVIDER)) add(LocationManager.NETWORK_PROVIDER)
            if (manager.isProviderEnabled(LocationManager.PASSIVE_PROVIDER)) add(LocationManager.PASSIVE_PROVIDER)
        }
        // Birden fazla sağlayıcı dinlenir: GPS kapalıyken de ağ konumu işe yarar.
        for (provider in providers) {
            runCatching {
                manager.requestLocationUpdates(provider, 60_000L, 50f, listener, Looper.getMainLooper())
            }
        }
        // Son bilinen konum: en yeni zaman damgasına sahip olanı seç.
        val candidates = providers.mapNotNull { provider ->
            runCatching { manager.getLastKnownLocation(provider) }.getOrNull()
        }
        candidates.maxByOrNull { it.time }?.let { newest ->
            val current = last
            if (current == null || newest.time > current.time) last = newest
        }
    }

    private suspend fun pushOnce() {
        val token = tokenProvider() ?: return
        val loc = last
        try {
            apiProvider().updateLocation(
                token = token,
                sharing = if (sharingEnabled) "on" else "off",
                // Sabitleme yoksa yine de paylaşım durumu bildirilir; partner
                // "konum paylaşımı açık ama koordinat yok" durumunu doğru görür.
                lat = loc?.latitude,
                lng = loc?.longitude,
                accuracyM = loc?.let { if (it.hasAccuracy()) it.accuracy.toDouble() else null },
                recordedAt = loc?.let { Instant.ofEpochMilli(it.time).toString() },
            )
            lastError = null
        } catch (e: Exception) {
            // Sessiz yutma yok: hata durumu ekranda gösterilir.
            lastError = e.message ?: "Konum gönderilemedi"
        }
    }

    /** Son gönderim hatası — UI bunu gösterebilir. */
    @Volatile
    var lastError: String? = null
        private set

    /** Tek seferlik güncel konum gönderimi (ekrandaki "şimdi güncelle"). */
    fun refreshNow() {
        scope.launch { pushOnce() }
    }

    fun stop(clearOnServer: Boolean) {
        job?.cancel()
        job = null
        val manager = context.getSystemService(Context.LOCATION_SERVICE) as LocationManager
        runCatching { manager.removeUpdates(listener) }
        if (clearOnServer) {
            val token = tokenProvider()
            if (token != null) {
                scope.launch {
                    runCatching { apiProvider().updateLocation(token, "off") }
                }
            }
        }
    }

    /** Çıkışta tamamen durdur. */
    fun shutdown() {
        job?.cancel()
        job = null
        val manager = context.getSystemService(Context.LOCATION_SERVICE) as LocationManager
        runCatching { manager.removeUpdates(listener) }
    }

    companion object {
        const val KEY_SHARING = "share_location"
    }
}
