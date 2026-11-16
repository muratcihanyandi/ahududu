package com.ahududu.app;

import android.Manifest;
import android.app.Activity;
import android.content.Context;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.os.Build;

import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;

/**
 * Ahududu — uygulama kapalıyken bildirim köprüsü.
 *
 * Web tarafı bu köprü üzerinden native bildirim servisini başlatır; servis
 * kendi WebSocket bağlantısını açık tutar. Ayrıca kullanıcı bir bildirime
 * dokunarak uygulamayı açtıysa bunu web tarafına bildirir (sohbet açılsın).
 */
@CapacitorPlugin(
        name = "NotificationsBridge",
        permissions = {
                @Permission(alias = "notifications", strings = {Manifest.permission.POST_NOTIFICATIONS})
        }
)
public class NotificationsBridgePlugin extends Plugin {

    static final int REQUEST_NOTIFICATIONS = 4301;

    private SharedPreferences prefs() {
        return getContext().getSharedPreferences(
                AhududuNotifyService.PREFS, Context.MODE_PRIVATE);
    }

    @Override
    public void load() {
        super.load();
        // Uygulama daha önce giriş yaptıysa servis zaten çalışıyor olabilir.
        String userId = prefs().getString(AhududuNotifyService.KEY_USER_ID, null);
        if (userId != null && !userId.isEmpty()) {
            AhududuNotifyService.start(getContext());
        }
    }

    /** Web tarafı: "bu telefonda X oturuyor" bilgisiyle servisi başlat. */
    @PluginMethod
    public void configure(PluginCall call) {
        String userId = call.getString("userId");
        String serverUrl = call.getString("serverUrl");

        if (userId == null || userId.isEmpty()) {
            call.reject("Kullanıcı kimliği gerekli");
            return;
        }

        prefs().edit()
                .putString(AhududuNotifyService.KEY_USER_ID, userId)
                .putString(AhududuNotifyService.KEY_SERVER_URL,
                        serverUrl == null || serverUrl.isEmpty()
                                ? "https://ahududu.fakeyol.com"
                                : serverUrl)
                .apply();

        requestNotificationPermissionIfNeeded();
        AhududuNotifyService.start(getContext());

        JSObject result = new JSObject();
        result.put("running", true);
        result.put("userId", userId);
        call.resolve(result);
    }

    /** Android 13+ için bildirim izni iste (sistem diyaloğu). */
    private void requestNotificationPermissionIfNeeded() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) return;
        Activity activity = getActivity();
        if (activity == null) return;
        int granted = ContextCompat.checkSelfPermission(
                activity, Manifest.permission.POST_NOTIFICATIONS);
        if (granted == PackageManager.PERMISSION_GRANTED) return;
        ActivityCompat.requestPermissions(
                activity,
                new String[]{Manifest.permission.POST_NOTIFICATIONS},
                REQUEST_NOTIFICATIONS);
    }

    @PluginMethod
    public void start(PluginCall call) {
        AhududuNotifyService.start(getContext());
        JSObject result = new JSObject();
        result.put("running", true);
        call.resolve(result);
    }

    @PluginMethod
    public void stop(PluginCall call) {
        AhududuNotifyService.stop(getContext());
        JSObject result = new JSObject();
        result.put("running", false);
        call.resolve(result);
    }

    @PluginMethod
    public void status(PluginCall call) {
        JSObject result = new JSObject();
        result.put("running", prefs().getBoolean(AhududuNotifyService.KEY_RUNNING, false));
        result.put("userId", prefs().getString(AhududuNotifyService.KEY_USER_ID, null));
        result.put("serverUrl", prefs().getString(AhududuNotifyService.KEY_SERVER_URL, null));
        call.resolve(result);
    }

    /**
     * Kullanıcı bildirime dokunarak uygulamayı açtıysa true döner; bayrağı
     * temizler (aynı dokunuş tekrar işlenmesin).
     */
    @PluginMethod
    public void consumeOpenChat(PluginCall call) {
        boolean pending = prefs().getBoolean(AhududuNotifyService.KEY_PENDING_CHAT, false);
        if (pending) {
            prefs().edit().putBoolean(AhududuNotifyService.KEY_PENDING_CHAT, false).apply();
        }
        JSObject result = new JSObject();
        result.put("pending", pending);
        result.put("userId", prefs().getString(AhududuNotifyService.KEY_USER_ID, null));
        call.resolve(result);
    }

    @PluginMethod
    public void clearPendingOpenChat(PluginCall call) {
        prefs().edit().putBoolean(AhududuNotifyService.KEY_PENDING_CHAT, false).apply();
        call.resolve();
    }
}
