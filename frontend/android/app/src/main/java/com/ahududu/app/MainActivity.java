package com.ahududu.app;

import android.content.Intent;
import android.content.SharedPreferences;
import android.os.Build;
import android.os.Bundle;
import android.view.View;
import android.view.Window;
import android.view.WindowManager;
import android.webkit.WebSettings;
import android.webkit.WebView;
import androidx.activity.OnBackPressedCallback;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    /** Bildirime dokunularak açıldıysa web tarafına "sohbeti aç" bilgisini taşır. */
    public static final String EXTRA_OPEN_CHAT = "ahududu_open_chat";

    @Override
    public void onCreate(Bundle savedInstanceState) {
        // Sinema Salonu'nun yatay modu ve tam ekran desteği için kendi eklentimiz.
        registerPlugin(OrientationPlugin.class);
        // Uygulama kapalıyken bildirim: native servis köprüsü.
        registerPlugin(NotificationsBridgePlugin.class);
        super.onCreate(savedInstanceState);

        // Configure WebView to ensure zero-reinstall instant updates
        if (getBridge() != null && getBridge().getWebView() != null) {
            WebView webView = getBridge().getWebView();
            WebSettings settings = webView.getSettings();
            // Bypass Android disk cache to always request the fresh HTML/JS bundle from Pi
            settings.setCacheMode(WebSettings.LOAD_NO_CACHE);
            webView.clearCache(true);

            // Sinema Salonu'nda videonun kendiliğinden oynamasına izin ver
            settings.setMediaPlaybackRequiresUserGesture(false);
        }

        handleNotificationIntent(getIntent());

        // ------------------------------------------------------------------
        // Geri tuşu: uygulamadan çıkmasın.
        // Açık bir pencere (mektup, sinema, sohbet...) varsa önce onu kapat,
        // ana ekran değilse ana ekrana dön; en sonda ise uygulamayı arka plana al.
        // ------------------------------------------------------------------
        getOnBackPressedDispatcher().addCallback(this, new OnBackPressedCallback(true) {
            @Override
            public void handleOnBackPressed() {
                handleBackNavigation();
            }
        });
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        handleNotificationIntent(intent);
    }

    /**
     * Bildirime dokunulduysa "bekleyen sohbet isteği" bayrağını yazar.
     * Web tarafı uygulama görünür olunca bu bayrağı okuyup sohbeti açar.
     */
    private void handleNotificationIntent(Intent intent) {
        if (intent == null) return;
        if (!intent.getBooleanExtra(EXTRA_OPEN_CHAT, false)) return;
        try {
            SharedPreferences prefs = getSharedPreferences(
                    AhududuNotifyService.PREFS, MODE_PRIVATE);
            prefs.edit().putBoolean(AhududuNotifyService.KEY_PENDING_CHAT, true).apply();
        } catch (Exception ignored) {
            // yok say
        }
        intent.removeExtra(EXTRA_OPEN_CHAT);
    }

    /** Web tarafındaki navigasyon köprüsüne geri tuşu bilgisini iletir. */
    private void handleBackNavigation() {
        WebView webView = getBridge() != null ? getBridge().getWebView() : null;
        if (webView == null) {
            moveTaskToBack(true);
            return;
        }

        webView.evaluateJavascript(
                "(function () {"
                        + "  try {"
                        + "    if (window.__ahududuBack && window.__ahududuBack()) return 'handled';"
                        + "  } catch (e) {}"
                        + "  return 'exit';"
                        + "})();",
                value -> {
                    boolean handled = value != null && value.contains("handled");
                    if (!handled) {
                        // Web tarafı "ana ekrandayım" dedi: uygulamayı kapatma, arkaya al.
                        moveTaskToBack(true);
                    }
                });
    }

    @Override
    public void onResume() {
        super.onResume();
        AhududuNotifyService.appForeground = true;
        // Uygulama ekrandayken kalıcı "bağlıyız" bildirimi gizlenir.
        AhududuNotifyService.setAppVisible(this, true);
        if (getBridge() != null && getBridge().getWebView() != null) {
            getBridge().getWebView().getSettings().setCacheMode(WebSettings.LOAD_NO_CACHE);
        }
        // Bildirim servisi ayakta kalsın (kullanıcı daha önce giriş yaptıysa).
        try {
            SharedPreferences prefs = getSharedPreferences(
                    AhududuNotifyService.PREFS, MODE_PRIVATE);
            String userId = prefs.getString(AhududuNotifyService.KEY_USER_ID, null);
            if (userId != null && !userId.isEmpty()) {
                AhududuNotifyService.start(this);
            }
        } catch (Exception ignored) {
            // yok say
        }
        // Bekleyen bildirim dokunuşu varsa web tarafına hatırlat.
        try {
            SharedPreferences prefs = getSharedPreferences(
                    AhududuNotifyService.PREFS, MODE_PRIVATE);
            if (prefs.getBoolean(AhududuNotifyService.KEY_PENDING_CHAT, false)) {
                notifyWebOpenChat();
            }
        } catch (Exception ignored) {
            // yok say
        }
    }

    @Override
    public void onPause() {
        AhududuNotifyService.appForeground = false;
        // Uygulama arkaya geçti: Android arka plandaki ön plan servisine görünür
        // bildirim zorunlu kılar. Sessiz/önemsiz hâliyle geri getirilir.
        AhududuNotifyService.setAppVisible(this, false);
        super.onPause();
    }

    /** Web tarafında bekleyen "sohbeti aç" isteğini işaret eder. */
    private void notifyWebOpenChat() {
        try {
            WebView webView = getBridge() != null ? getBridge().getWebView() : null;
            if (webView == null) return;
            webView.evaluateJavascript(
                    "try{window.dispatchEvent(new Event('ahududu:open-chat'));}catch(e){}",
                    null);
        } catch (Exception ignored) {
            // yok say
        }
    }

    /** Sinema Salonu tam ekrana geçtiğinde sistem çubuklarını gizler. */
    public void setSystemUiImmersive(boolean immersive) {
        Window window = getWindow();
        if (immersive) {
            window.addFlags(WindowManager.LayoutParams.FLAG_FULLSCREEN);
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                WindowCompat.setDecorFitsSystemWindows(window, false);
                WindowInsetsControllerCompat controller =
                        WindowCompat.getInsetsController(window, window.getDecorView());
                controller.hide(WindowInsetsCompat.Type.systemBars());
                controller.setSystemBarsBehavior(
                        WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
            } else {
                window.getDecorView().setSystemUiVisibility(
                        View.SYSTEM_UI_FLAG_FULLSCREEN
                                | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                                | View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
                                | View.SYSTEM_UI_FLAG_LAYOUT_STABLE);
            }
        } else {
            window.clearFlags(WindowManager.LayoutParams.FLAG_FULLSCREEN);
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                WindowCompat.setDecorFitsSystemWindows(window, true);
                WindowInsetsControllerCompat controller =
                        WindowCompat.getInsetsController(window, window.getDecorView());
                controller.show(WindowInsetsCompat.Type.systemBars());
            } else {
                window.getDecorView().setSystemUiVisibility(View.SYSTEM_UI_FLAG_VISIBLE);
            }
        }
    }
}
