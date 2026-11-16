package com.ahududu.app;

import android.content.pm.ActivityInfo;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Ahududu — Sinema Salonu yatay mod eklentisi.
 *
 * Sinema Salonu açıldığında telefonun kendiliğinden yatay moda geçmesini,
 * çıkıldığında ise cihaz ayarına geri dönmesini sağlar. Bu, web tarafındaki
 * Screen Orientation API'sinin Android WebView'da desteklenmediği durumlar için
 * gereklidir. Eklenti web tarafından `registerPlugin('Orientation')` ile çağrılır.
 */
@CapacitorPlugin(name = "Orientation")
public class OrientationPlugin extends Plugin {

    @PluginMethod
    public void lockLandscape(PluginCall call) {
        try {
            getActivity().runOnUiThread(() -> {
                getActivity().setRequestedOrientation(
                        ActivityInfo.SCREEN_ORIENTATION_SENSOR_LANDSCAPE);
                if (getActivity() instanceof MainActivity) {
                    ((MainActivity) getActivity()).setSystemUiImmersive(true);
                }
            });
            JSObject result = new JSObject();
            result.put("orientation", "landscape");
            call.resolve(result);
        } catch (Exception e) {
            call.reject("Yatay mod açılamadı", e);
        }
    }

    @PluginMethod
    public void lockPortrait(PluginCall call) {
        try {
            getActivity().runOnUiThread(() -> {
                getActivity().setRequestedOrientation(
                        ActivityInfo.SCREEN_ORIENTATION_SENSOR_PORTRAIT);
            });
            JSObject result = new JSObject();
            result.put("orientation", "portrait");
            call.resolve(result);
        } catch (Exception e) {
            call.reject("Dikey mod açılamadı", e);
        }
    }

    @PluginMethod
    public void unlock(PluginCall call) {
        try {
            getActivity().runOnUiThread(() -> {
                getActivity().setRequestedOrientation(
                        ActivityInfo.SCREEN_ORIENTATION_UNSPECIFIED);
                if (getActivity() instanceof MainActivity) {
                    ((MainActivity) getActivity()).setSystemUiImmersive(false);
                }
            });
            JSObject result = new JSObject();
            result.put("orientation", "auto");
            call.resolve(result);
        } catch (Exception e) {
            call.reject("Yön kilidi kaldırılamadı", e);
        }
    }

    @PluginMethod
    public void getOrientation(PluginCall call) {
        int orientation = getActivity().getResources().getConfiguration().orientation;
        JSObject result = new JSObject();
        result.put("orientation", orientation == android.content.res.Configuration.ORIENTATION_LANDSCAPE
                ? "landscape" : "portrait");
        call.resolve(result);
    }
}
