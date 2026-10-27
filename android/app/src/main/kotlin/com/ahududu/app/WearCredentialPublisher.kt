package com.ahududu.app

import android.content.Context
import android.util.Log
import com.google.android.gms.wearable.PutDataMapRequest
import com.google.android.gms.wearable.Wearable
import kotlinx.coroutines.tasks.await
import java.time.Instant

/**
 * Telefondan saate kimlik bilgisi köprüsü (Wear OS Data Layer).
 *
 * Saat, sunucuya doğrudan Wi-Fi üzerinden bağlanabilmesi için token ve sunucu adresine
 * ihtiyaç duyar. Bu veriler Data Layer'da kalıcı bir DataItem olarak tutulur; saat
 * uygulaması açıldığında son değeri okur. Böylece kullanıcı saatte tekrar giriş yapmaz.
 */
class WearCredentialPublisher(private val context: Context) {

    suspend fun publish(token: String?, serverUrl: String) {
        try {
            val request = PutDataMapRequest.create(PATH_CREDENTIALS).apply {
                dataMap.putString(KEY_TOKEN, token ?: "")
                dataMap.putString(KEY_SERVER, serverUrl)
                dataMap.putLong(KEY_UPDATED_AT, Instant.now().toEpochMilli())
            }.asPutDataRequest().setUrgent()

            Wearable.getDataClient(context).putDataItem(request).await()
        } catch (e: Exception) {
            // Saat bağlı değilse veya Play Services yoksa sessizce atlanır;
            // bir sonraki oturumda yeniden denenir.
            Log.w(TAG, "Saat köprüsü güncellenemedi: ${e.message}")
        }
    }

    companion object {
        private const val TAG = "WearCredentialBridge"
        const val PATH_CREDENTIALS = "/ahududu/credentials"
        const val KEY_TOKEN = "token"
        const val KEY_SERVER = "serverUrl"
        const val KEY_UPDATED_AT = "updatedAt"
    }
}
