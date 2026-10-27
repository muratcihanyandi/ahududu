package com.ahududu.app

import android.content.Context
import com.ahududu.common.api.AhududuApi
import com.ahududu.common.api.AhududuSocket
import com.ahududu.common.api.OutboxQueue
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch

class TokenStore(context: Context) {
    private val prefs = context.getSharedPreferences("ahududu_session", Context.MODE_PRIVATE)

    fun save(token: String) = prefs.edit().putString("token", token).apply()
    fun get(): String? = prefs.getString("token", null)
    fun clear() = prefs.edit().remove("token").apply()
}

class ServerStore(context: Context) {
    private val prefs = context.getSharedPreferences("ahududu_server", Context.MODE_PRIVATE)

    fun get(): String = prefs.getString("baseUrl", null) ?: DEFAULT_SERVER
    fun set(url: String) {
        val normalized = url.trim().trimEnd('/').let {
            if (it.startsWith("http://") || it.startsWith("https://")) it else "http://$it"
        }
        prefs.edit().putString("baseUrl", normalized).apply()
    }

    companion object {
        /** Ev ağındaki sunucu — ilk açılışta varsayılan. */
        const val DEFAULT_SERVER = "http://192.168.2.170:8787"
    }
}

class AppContainer(context: Context) {
    val appContext: Context = context.applicationContext
    val tokenStore = TokenStore(context)
    val serverStore = ServerStore(context)
    val outbox = OutboxQueue(context)
    val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)

    private val prefs = context.getSharedPreferences("ahududu_prefs", Context.MODE_PRIVATE)

    @Volatile
    private var apiInstance: AhududuApi = AhududuApi.create(serverStore.get())

    val api: AhududuApi get() = apiInstance

    val socket = AhududuSocket(
        scope = scope,
        apiProvider = { apiInstance },
        tokenProvider = { tokenStore.get() },
    )

    /** Gelen titreşimleri dinler; uygulama açıkken cihazı gerçekten titreştirir. */
    val buzz = BuzzController(context, scope, socket)

    /** Konum paylaşımı — yalnızca kullanıcı açtığında çalışır. */
    val location = LocationReporter(
        context = context,
        scope = scope,
        apiProvider = { apiInstance },
        tokenProvider = { tokenStore.get() },
        prefs = prefs,
    )

    /** Canlı ses bağlantısı / ortam dinleme */
    val audioStream by lazy { AudioStreamManager(appContext, scope, socket) }

    /** Saate token/sunucu köprüsü — init'ten ÖNCE tanımlı olmalı (Kotlin başlatma sırası). */
    private val wearBridge = WearCredentialPublisher(context.applicationContext)

    /** APK güncelleme akışı (sürüm kontrolü, indirme, kurulum ekranı). */
    val updates by lazy { UpdateController(appContext, this) }

    init {
        buzz.start()
        if (tokenStore.get() != null) location.start()
        publishWearCredentials()
        // Otomatik güncelleme: açılışta + 3 saatte bir (Device Owner ise sessiz kurulum).
        updates.startAutoUpdater()
    }

    /** Saate token + sunucu adresini yaz: saatte tekrar giriş gerekmesin. */
    fun publishWearCredentials() {
        val token = tokenStore.get()
        val server = serverStore.get()
        scope.launch {
            wearBridge.publish(token, server)
        }
    }

    /** Sunucu adresi değişince istemcileri yeniden kur. */
    fun setServer(url: String) {
        serverStore.set(url)
        apiInstance = AhududuApi.create(serverStore.get())
        socket.disconnect()
        if (tokenStore.get() != null) socket.connect()
        publishWearCredentials()
    }

    /** Oturum açıldığında canlı bağlantıyı başlat. */
    fun startRealtime() {
        socket.connect()
        location.start()
        publishWearCredentials()
    }

    fun stopRealtime() {
        socket.disconnect()
        location.shutdown()
    }

    /** Kuyrukta bekleyen mesajları göndermeyi dene (bağlantı gelince). */
    fun flushOutbox(onSent: (String) -> Unit = {}) {
        scope.launch {
            val token = tokenStore.get() ?: return@launch
            for (item in outbox.pending()) {
                try {
                    api.sendMessage(
                        token,
                        com.ahududu.common.api.SendMessageRequest(
                            clientMsgId = item.clientMsgId,
                            body = item.body,
                            replyToId = item.replyToId,
                            mediaIds = item.mediaIds,
                        ),
                    )
                    outbox.remove(item.clientMsgId)
                    onSent(item.clientMsgId)
                } catch (e: Exception) {
                    // Ağ yoksa kuyrukta kalır; bir sonraki bağlantıda tekrar denenir.
                    break
                }
            }
        }
    }
}
