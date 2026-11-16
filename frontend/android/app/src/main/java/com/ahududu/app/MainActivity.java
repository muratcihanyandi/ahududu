package com.ahududu.app;

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
    @Override
    public void onCreate(Bundle savedInstanceState) {
        // Sinema Salonu'nun yatay modu ve tam ekran desteği için kendi eklentimiz.
        registerPlugin(OrientationPlugin.class);
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
        if (getBridge() != null && getBridge().getWebView() != null) {
            getBridge().getWebView().getSettings().setCacheMode(WebSettings.LOAD_NO_CACHE);
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
