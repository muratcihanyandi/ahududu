package com.ahududu.app;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.ServiceInfo;
import android.media.AudioAttributes;
import android.net.ConnectivityManager;
import android.net.Network;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.os.SystemClock;
import android.util.Log;

import androidx.annotation.Nullable;
import androidx.core.app.NotificationCompat;

import org.json.JSONObject;

import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import java.util.concurrent.TimeUnit;

import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.Response;
import okhttp3.WebSocket;
import okhttp3.WebSocketListener;

/**
 * Ahududu — "Uygulama kapalıyken de bildirim" servisi.
 *
 * Neden gerekli?
 * Android WebView uygulama arka plana geçince (özellikle uygulama recents'ten
 * kaydırılınca) WebSocket bağlantısını kapatır. O yüzden gelen mesaj telefona
 * ulaşmaz ve bildirim gösterilemez. Bu servis kendi WebSocket bağlantısını açık
 * tutar; çift kişilik uygulamada iki taraf sürekli çevrimiçi olabilsin diye
 * FOREGROUND (ön plan) olarak çalışır. Mesaj geldiğinde sistem bildirimi gösterir.
 *
 * Bildirim gösterme kuralı: uygulama ekranda (ön planda) ise bildirim
 * gösterilmez; sohbet ekranı zaten mesajı gösterir.
 */
public class AhududuNotifyService extends Service {

    private static final String TAG = "AhududuNotify";

    /* --- Tercih anahtarları (plugin buraya yazar) --- */
    static final String PREFS = "ahududu_native";
    static final String KEY_USER_ID = "user_id";
    static final String KEY_SERVER_URL = "server_url";
    static final String KEY_RUNNING = "service_running";
    static final String KEY_PENDING_CHAT = "pending_open_chat";
    static final String KEY_SEEN_IDS = "seen_ids";

    /* --- Kanallar --- */
    static final String SERVICE_CHANNEL_ID = "ahududu_service";
    static final String MESSAGE_CHANNEL_ID = "ahududu_messages";
    private static final int SERVICE_NOTIFICATION_ID = 9090;

    /* --- Yeniden bağlanma --- */
    private static final long RECONNECT_MIN_MS = 3000L;
    private static final long RECONNECT_MAX_MS = 60000L;
    private static final long PING_INTERVAL_MS = 45000L;

    private OkHttpClient httpClient;
    private WebSocket webSocket;
    private Handler handler;
    private ConnectivityManager.NetworkCallback networkCallback;
    private long reconnectDelay = RECONNECT_MIN_MS;
    private boolean connecting = false;
    private boolean destroyed = false;
    private long pingToken = 0L;

    private final Set<String> seenMessageIds = new HashSet<>();

    /** Uygulama ön planda mı? MainActivity günceller. */
    static volatile boolean appForeground = false;

    @Nullable
    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    @Override
    public void onCreate() {
        super.onCreate();
        handler = new Handler(Looper.getMainLooper());
        createChannels();
        loadSeenIds();
        httpClient = new OkHttpClient.Builder()
                .connectTimeout(20, TimeUnit.SECONDS)
                .readTimeout(0, TimeUnit.MILLISECONDS)
                .pingInterval(30, TimeUnit.SECONDS)
                .retryOnConnectionFailure(true)
                .build();
        registerNetworkCallback();
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        startForegroundSafely();
        getPrefs().edit().putBoolean(KEY_RUNNING, true).apply();
        ensureConnected();
        // Sistem servisi öldürürse yeniden oluştur.
        return START_STICKY;
    }

    @Override
    public void onDestroy() {
        destroyed = true;
        handler.removeCallbacksAndMessages(null);
        unregisterNetworkCallback();
        closeSocket(1000, "service destroyed");
        if (httpClient != null) {
            try {
                httpClient.dispatcher().executorService().shutdown();
            } catch (Exception ignored) {
            }
        }
        getPrefs().edit().putBoolean(KEY_RUNNING, false).apply();
        super.onDestroy();
    }

    /** Servisi başlatır (izin/OS engellerse sessizce vazgeçer). */
    static void start(Context context) {
        try {
            Intent intent = new Intent(context, AhududuNotifyService.class);
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                context.startForegroundService(intent);
            } else {
                context.startService(intent);
            }
        } catch (Exception e) {
            Log.w(TAG, "Servis başlatılamadı: " + e.getMessage());
        }
    }

    static void stop(Context context) {
        try {
            context.stopService(new Intent(context, AhududuNotifyService.class));
        } catch (Exception ignored) {
        }
        try {
            context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
                    .edit().putBoolean(KEY_RUNNING, false).apply();
        } catch (Exception ignored) {
        }
    }

    /* ------------------------------------------------------------------ */
    /* Ön plan bildirimi                                                   */
    /* ------------------------------------------------------------------ */

    private SharedPreferences getPrefs() {
        return getSharedPreferences(PREFS, MODE_PRIVATE);
    }

    private void startForegroundSafely() {
        try {
            Notification notification = buildServiceNotification();
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
                startForeground(SERVICE_NOTIFICATION_ID, notification,
                        ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC);
            } else {
                startForeground(SERVICE_NOTIFICATION_ID, notification);
            }
        } catch (Exception e) {
            Log.w(TAG, "Ön plan bildirimi gösterilemedi: " + e.getMessage());
        }
    }

    private Notification buildServiceNotification() {
        Intent openIntent = new Intent(this, MainActivity.class);
        openIntent.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        PendingIntent pending = PendingIntent.getActivity(
                this, 0, openIntent,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);

        return new NotificationCompat.Builder(this, SERVICE_CHANNEL_ID)
                .setContentTitle("Ahududu")
                .setContentText("Bağlıyız 💞")
                .setSmallIcon(R.mipmap.ic_launcher)
                .setOngoing(true)
                .setShowWhen(false)
                .setPriority(NotificationCompat.PRIORITY_MIN)
                .setContentIntent(pending)
                .build();
    }

    private void createChannels() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationManager manager =
                (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
        if (manager == null) return;

        NotificationChannel serviceChannel = new NotificationChannel(
                SERVICE_CHANNEL_ID, "Bağlı kal", NotificationManager.IMPORTANCE_MIN);
        serviceChannel.setDescription("Sen uygulamada değilken de seni haberdar eder");
        serviceChannel.setShowBadge(false);
        manager.createNotificationChannel(serviceChannel);

        NotificationChannel messageChannel = new NotificationChannel(
                MESSAGE_CHANNEL_ID, "Mesajlar", NotificationManager.IMPORTANCE_HIGH);
        messageChannel.setDescription("Sohbet ve hatırlatma bildirimleri");
        messageChannel.enableLights(true);
        messageChannel.setLightColor(0xFFE11D6B);
        messageChannel.enableVibration(true);
        messageChannel.setShowBadge(true);
        AudioAttributes audio = new AudioAttributes.Builder()
                .setUsage(AudioAttributes.USAGE_NOTIFICATION)
                .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                .build();
        messageChannel.setSound(
                android.provider.Settings.System.DEFAULT_NOTIFICATION_URI, audio);
        manager.createNotificationChannel(messageChannel);
    }

    /* ------------------------------------------------------------------ */
    /* WebSocket                                                           */
    /* ------------------------------------------------------------------ */

    private String userId() {
        return getPrefs().getString(KEY_USER_ID, null);
    }

    private String serverUrl() {
        String url = getPrefs().getString(KEY_SERVER_URL, null);
        if (url == null || url.isEmpty()) return "https://ahududu.fakeyol.com";
        return url;
    }

    private String websocketUrl() {
        String user = userId();
        if (user == null || user.isEmpty()) return null;
        String base = serverUrl().trim();
        if (base.startsWith("https://")) {
            base = "wss://" + base.substring("https://".length());
        } else if (base.startsWith("http://")) {
            base = "ws://" + base.substring("http://".length());
        } else if (!base.startsWith("ws")) {
            base = "wss://" + base;
        }
        if (base.endsWith("/")) base = base.substring(0, base.length() - 1);
        return base + "/ws/" + user;
    }

    private void ensureConnected() {
        if (destroyed || connecting) return;
        if (webSocket != null) return;
        final String url = websocketUrl();
        if (url == null) {
            Log.w(TAG, "Kullanıcı tanımlı değil, bağlantı kurulmadı");
            return;
        }
        connecting = true;
        Log.i(TAG, "WebSocket bağlanıyor: " + url);

        Request request = new Request.Builder().url(url).build();
        webSocket = httpClient.newWebSocket(request, new WebSocketListener() {
            @Override
            public void onOpen(WebSocket ws, Response response) {
                connecting = false;
                reconnectDelay = RECONNECT_MIN_MS;
                Log.i(TAG, "WebSocket açık");
                schedulePings();
            }

            @Override
            public void onMessage(WebSocket ws, String text) {
                handleServerEvent(text);
            }

            @Override
            public void onFailure(WebSocket ws, Throwable t, @Nullable Response response) {
                connecting = false;
                webSocket = null;
                Log.w(TAG, "WebSocket hatası: " + t.getMessage());
                scheduleReconnect();
            }

            @Override
            public void onClosed(WebSocket ws, int code, String reason) {
                connecting = false;
                webSocket = null;
                Log.i(TAG, "WebSocket kapandı: " + code + " " + reason);
                scheduleReconnect();
            }
        });
    }

    private void closeSocket(int code, String reason) {
        try {
            if (webSocket != null) {
                webSocket.close(code, reason);
                webSocket = null;
            }
        } catch (Exception ignored) {
        }
    }

    private void scheduleReconnect() {
        if (destroyed) return;
        handler.removeCallbacks(reconnectRunnable);
        handler.postDelayed(reconnectRunnable, reconnectDelay);
        reconnectDelay = Math.min(reconnectDelay * 2, RECONNECT_MAX_MS);
    }

    private final Runnable reconnectRunnable = this::ensureConnected;

    private void schedulePings() {
        final long token = ++pingToken;
        handler.postDelayed(() -> {
            if (token != pingToken || destroyed) return;
            sendPing();
            schedulePings();
        }, PING_INTERVAL_MS);
    }

    private void sendPing() {
        try {
            WebSocket ws = webSocket;
            if (ws != null) {
                ws.send("{\"type\":\"ping\"}");
            }
        } catch (Exception ignored) {
        }
    }

    private void registerNetworkCallback() {
        try {
            ConnectivityManager cm =
                    (ConnectivityManager) getSystemService(Context.CONNECTIVITY_SERVICE);
            if (cm == null) return;
            networkCallback = new ConnectivityManager.NetworkCallback() {
                @Override
                public void onAvailable(Network network) {
                    reconnectDelay = RECONNECT_MIN_MS;
                    handler.postDelayed(() -> {
                        if (webSocket == null) ensureConnected();
                    }, 800);
                }
            };
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
                cm.registerDefaultNetworkCallback(networkCallback);
            }
        } catch (Exception e) {
            Log.w(TAG, "Ağ takibi kurulamadı: " + e.getMessage());
        }
    }

    private void unregisterNetworkCallback() {
        try {
            ConnectivityManager cm =
                    (ConnectivityManager) getSystemService(Context.CONNECTIVITY_SERVICE);
            if (cm != null && networkCallback != null) {
                cm.unregisterNetworkCallback(networkCallback);
            }
        } catch (Exception ignored) {
        }
    }

    /* ------------------------------------------------------------------ */
    /* Gelen olaylar → bildirim                                            */
    /* ------------------------------------------------------------------ */

    private void handleServerEvent(String raw) {
        try {
            JSONObject data = new JSONObject(raw);
            String type = data.optString("type", "");
            if ("pong".equals(type) || type.isEmpty()) return;
            if ("partner_status".equals(type)) return;

            String user = userId();

            if ("new_chat_message".equals(type)) {
                JSONObject message = data.optJSONObject("message");
                if (message == null) return;
                if (user != null && user.equals(message.optString("sender"))) return;
                if (!markSeen(message.optString("id"))) return;

                String sender = message.optString("sender", "");
                String senderName = senderName(sender);
                String body = chatPreview(message);
                notify(senderName, body, null);
                return;
            }

            if ("remote_vibrate".equals(type)) {
                // Uygulama ön planda değilse de telefon titresin (bildirim değil).
                if (!appForeground) {
                    try {
                        android.os.Vibrator v =
                                (android.os.Vibrator) getSystemService(Context.VIBRATOR_SERVICE);
                        if (v != null && v.hasVibrator()) {
                            long[] pattern = new long[]{0, 120, 100, 180, 500};
                            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                                v.vibrate(android.os.VibrationEffect.createWaveform(pattern, -1));
                            } else {
                                v.vibrate(pattern, -1);
                            }
                        }
                    } catch (Exception ignored) {
                    }
                }
                return;
            }

            String title = null;
            String body = null;
            boolean openChat = false;

            switch (type) {
                case "nudge": {
                    String who = senderName(data.optString("sender", ""));
                    title = who;
                    body = "Beni Sev! 💖";
                    break;
                }
                case "new_letter":
                    title = "Ahududu 💌";
                    body = "Sana bir mektup geldi";
                    break;
                case "new_snap":
                    title = "Ahududu 📸";
                    body = "Yeni bir an paylaşıldı";
                    break;
                case "new_gallery_item":
                    title = "Ahududu 📷";
                    body = "Galeriye yeni bir kare eklendi";
                    break;
                case "new_pet_photo":
                    title = "Ahududu 🐾";
                    body = "Bir dostumuzun yeni fotoğrafı var";
                    break;
                case "new_note":
                    title = "Ahududu 📝";
                    body = "Notlarımıza yeni bir şey eklendi";
                    break;
                case "letter_opened_by_partner":
                    title = "Ahududu 💌";
                    body = "Mektubun okundu";
                    break;
                case "cinema_partner_joined":
                    title = "Sinema Salonu 🍿";
                    body = senderName(data.optString("user_id", "")) + " salona girdi";
                    break;
                case "cinema_started":
                    title = "Sinema Salonu 🍿";
                    body = "Film başladı" + (data.optString("title", "").isEmpty()
                            ? "" : ": " + data.optString("title"));
                    break;
                case "cinema_ticket_booked":
                    title = "Sinema Salonu 🎟️";
                    body = "Bilet alındı";
                    break;
                case "cinema_room_created":
                    title = "Sinema Salonu 🍿";
                    body = "Salon açıldı";
                    break;
                case "garden_question_answered":
                    title = "Anı Bahçemiz 🌸";
                    body = "Günün sorusu cevaplandı";
                    break;
                case "garden_capsule_sealed":
                    title = "Anı Bahçemiz 🌸";
                    body = "Yeni bir zaman kapsülü mühürlendi";
                    break;
                case "garden_song_added":
                    title = "Anı Bahçemiz 🌸";
                    body = "Bizim şarkılarımıza bir şarkı eklendi";
                    break;
                case "garden_mood_updated":
                    title = "Anı Bahçemiz 🌸";
                    body = "Bugünkü hava paylaşıldı";
                    break;
                case "new_diary_entry":
                    title = "Bizim Defterimiz 📖";
                    body = "Deftere yeni bir sayfa yazıldı";
                    break;
                default:
                    break;
            }

            if (title != null && body != null) {
                notify(title, body, null);
            }
        } catch (Exception e) {
            Log.w(TAG, "Olay işlenemedi: " + e.getMessage());
        }
    }

    private static String senderName(String userId) {
        if ("murat".equals(userId)) return "Murat 🐻";
        if ("selin".equals(userId)) return "Selin 🌸";
        return "Ahududu";
    }

    private static String chatPreview(JSONObject message) {
        String type = message.optString("message_type", "text");
        if ("image".equals(type)) return "📷 Fotoğraf gönderdi";
        if ("video".equals(type)) return "🎬 Video gönderdi";
        if ("voice".equals(type) || "walkie_talkie".equals(type)) {
            return "🎙️ Sesli mesaj gönderdi";
        }
        String text = message.optString("content", "").trim();
        if (text.isEmpty()) return "Sana bir mesaj geldi 💌";
        return text.length() > 120 ? text.substring(0, 120) + "…" : text;
    }

    /** Aynı mesajın iki kez bildirilmesini engeller (son 80 kimlik). */
    private boolean markSeen(String id) {
        if (id == null || id.isEmpty() || "null".equals(id)) return true;
        if (seenMessageIds.contains(id)) return false;
        seenMessageIds.add(id);
        if (seenMessageIds.size() > 80) {
            List<String> list = new ArrayList<>(seenMessageIds);
            seenMessageIds.clear();
            for (int i = Math.max(0, list.size() - 40); i < list.size(); i++) {
                seenMessageIds.add(list.get(i));
            }
        }
        StringBuilder builder = new StringBuilder();
        for (String value : seenMessageIds) {
            if (builder.length() > 0) builder.append(',');
            builder.append(value);
        }
        getPrefs().edit().putString(KEY_SEEN_IDS, builder.toString()).apply();
        return true;
    }

    private void loadSeenIds() {
        try {
            String stored = getPrefs().getString(KEY_SEEN_IDS, "");
            if (stored == null || stored.isEmpty()) return;
            for (String part : stored.split(",")) {
                if (!part.isEmpty()) seenMessageIds.add(part);
            }
        } catch (Exception ignored) {
        }
    }

    /** Bildirimi gösterir (uygulama görünürken göstermez). */
    private void notify(String title, String body, Intent extra) {
        if (appForeground) return;
        try {
            NotificationManager manager =
                    (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
            if (manager == null) return;

            Intent openIntent = new Intent(this, MainActivity.class);
            openIntent.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
            openIntent.putExtra(MainActivity.EXTRA_OPEN_CHAT, true);
            if (extra != null) {
                openIntent.putExtras(extra);
            }
            PendingIntent pending = PendingIntent.getActivity(
                    this,
                    (int) (SystemClock.elapsedRealtime() % 100000),
                    openIntent,
                    PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);

            Notification notification = new NotificationCompat.Builder(this, MESSAGE_CHANNEL_ID)
                    .setContentTitle(title)
                    .setContentText(body)
                    .setStyle(new NotificationCompat.BigTextStyle().bigText(body))
                    .setSmallIcon(R.mipmap.ic_launcher)
                    .setColor(0xFFE11D6B)
                    .setAutoCancel(true)
                    .setPriority(NotificationCompat.PRIORITY_HIGH)
                    .setCategory(NotificationCompat.CATEGORY_MESSAGE)
                    .setContentIntent(pending)
                    .build();

            manager.notify((int) (SystemClock.elapsedRealtime() % 100000), notification);
            Log.i(TAG, "Bildirim gösterildi: " + title + " / " + body);
        } catch (Exception e) {
            Log.w(TAG, "Bildirim gösterilemedi: " + e.getMessage());
        }
    }
}
