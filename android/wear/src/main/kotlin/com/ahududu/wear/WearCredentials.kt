package com.ahududu.wear

import android.content.Context
import android.util.Log
import com.google.android.gms.wearable.DataClient
import com.google.android.gms.wearable.DataEvent
import com.google.android.gms.wearable.DataEventBuffer
import com.google.android.gms.wearable.Wearable
import java.time.Instant

/**
 * Telefondan gelen kimlik bilgileri (Wear OS Data Layer).
 * Telefon uygulaması giriş yaptığında token + sunucu adresini buraya yazar;
 * saat yeniden giriş istemez.
 */
class WearCredentials(private val context: Context) {
    private val prefs = context.getSharedPreferences("ahududu_wear", Context.MODE_PRIVATE)

    var token: String?
        get() = prefs.getString(KEY_TOKEN, null)?.takeIf { it.isNotBlank() }
        private set(value) = prefs.edit().putString(KEY_TOKEN, value).apply()

    var serverUrl: String
        get() = prefs.getString(KEY_SERVER, null)?.takeIf { it.isNotBlank() } ?: DEFAULT_SERVER
        private set(value) = prefs.edit().putString(KEY_SERVER, value).apply()

    val isReady: Boolean get() = !token.isNullOrBlank()

    var lastSyncedAt: String?
        get() = prefs.getString(KEY_SYNCED_AT, null)
        private set(value) = prefs.edit().putString(KEY_SYNCED_AT, value).apply()

    fun save(token: String, serverUrl: String) {
        this.token = token
        this.serverUrl = serverUrl
        lastSyncedAt = Instant.now().toString()
    }

    fun clear() {
        prefs.edit().clear().apply()
    }

    private var listener: DataClient.OnDataChangedListener? = null

    /** Data Layer değişikliklerini dinler ve yerel kopyayı günceller. */
    fun startListening(
        onCredentials: (token: String, serverUrl: String) -> Unit,
        onSignedOut: () -> Unit = {},
    ) {
        if (listener != null) return
        val dataClient = Wearable.getDataClient(context)
        val l = DataClient.OnDataChangedListener { events: DataEventBuffer ->
            for (event in events) {
                if (event.type != DataEvent.TYPE_CHANGED) continue
                val item = event.dataItem
                if (item.uri.path != PATH_CREDENTIALS) continue
                val map = com.google.android.gms.wearable.DataMapItem.fromDataItem(item).dataMap
                val token = map.getString(KEY_TOKEN).orEmpty()
                if (token.isBlank()) {
                    // Telefonda çıkış yapıldı: saatteki oturum da kapanır.
                    clear()
                    onSignedOut()
                    continue
                }
                val server = map.getString(KEY_SERVER)?.takeIf { it.isNotBlank() } ?: DEFAULT_SERVER
                save(token, server)
                onCredentials(token, server)
            }
        }
        runCatching { dataClient.addListener(l) }
            .onFailure { Log.w(TAG, "Data Layer dinlenemedi: ${it.message}") }
        listener = l
    }

    fun stopListening() {
        val l = listener ?: return
        runCatching { Wearable.getDataClient(context).removeListener(l) }
        listener = null
    }

    /** Telefon uygulaması daha önce yazdıysa açılışta oku (DataItem kalıcıdır). */
    fun pullExisting(): Pair<String, String>? {
        return runCatching {
            val items = com.google.android.gms.tasks.Tasks.await(
                Wearable.getDataClient(context).dataItems,
                5,
                java.util.concurrent.TimeUnit.SECONDS,
            )
            for (item in items) {
                if (item.uri.path != PATH_CREDENTIALS) continue
                val map = com.google.android.gms.wearable.DataMapItem.fromDataItem(item).dataMap
                val token = map.getString(KEY_TOKEN)?.takeIf { it.isNotBlank() } ?: continue
                val server = map.getString(KEY_SERVER)?.takeIf { it.isNotBlank() } ?: DEFAULT_SERVER
                save(token, server)
                return@runCatching token to server
            }
            null
        }.getOrNull()
    }

    companion object {
        private const val TAG = "WearCredentials"
        const val PATH_CREDENTIALS = "/ahududu/credentials"
        const val KEY_TOKEN = "token"
        const val KEY_SERVER = "serverUrl"
        const val KEY_SYNCED_AT = "lastSyncedAt"
        const val DEFAULT_SERVER = "http://192.168.2.170:8787"
    }
}
