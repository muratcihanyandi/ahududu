package com.ahududu.app;

import android.os.Bundle;
import android.webkit.WebSettings;
import android.webkit.WebView;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(GalaxyWatchBridgePlugin.class);
        super.onCreate(savedInstanceState);

        // Configure WebView to ensure zero-reinstall instant updates
        if (getBridge() != null && getBridge().getWebView() != null) {
            WebView webView = getBridge().getWebView();
            WebSettings settings = webView.getSettings();
            // Bypass Android disk cache to always request the fresh HTML/JS bundle from Pi
            settings.setCacheMode(WebSettings.LOAD_NO_CACHE);
            webView.clearCache(true);
        }
    }

    @Override
    public void onResume() {
        super.onResume();
        if (getBridge() != null && getBridge().getWebView() != null) {
            getBridge().getWebView().getSettings().setCacheMode(WebSettings.LOAD_NO_CACHE);
        }
    }
}
