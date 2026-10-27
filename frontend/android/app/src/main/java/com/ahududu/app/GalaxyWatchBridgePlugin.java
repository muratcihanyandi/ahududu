package com.ahududu.app;

import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.util.Log;

import androidx.wear.remote.interactions.RemoteActivityHelper;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.google.android.gms.tasks.Tasks;
import com.google.android.gms.wearable.Node;
import com.google.android.gms.wearable.Wearable;

import java.util.List;
import java.util.concurrent.Executors;

@CapacitorPlugin(name = "GalaxyWatchBridge")
public class GalaxyWatchBridgePlugin extends Plugin {
    private static final String TAG = "GalaxyWatchBridge";

    @PluginMethod
    public void getConnectedWatchInfo(PluginCall call) {
        Context context = getContext();
        Executors.newSingleThreadExecutor().execute(() -> {
            try {
                List<Node> nodes = Tasks.await(Wearable.getNodeClient(context).getConnectedNodes());
                JSObject ret = new JSObject();
                JSArray nodeArray = new JSArray();

                boolean isConnected = (nodes != null && !nodes.isEmpty());
                if (nodes != null) {
                    for (Node node : nodes) {
                        JSObject nodeObj = new JSObject();
                        nodeObj.put("id", node.getId());
                        nodeObj.put("name", node.getDisplayName());
                        nodeObj.put("isNearby", node.isNearby());
                        nodeArray.put(nodeObj);
                    }
                }

                ret.put("connected", isConnected);
                ret.put("watches", nodeArray);
                ret.put("count", nodes != null ? nodes.size() : 0);
                call.resolve(ret);
            } catch (Exception e) {
                Log.w(TAG, "Failed to get connected nodes: " + e.getMessage());
                JSObject fallback = new JSObject();
                fallback.put("connected", false);
                fallback.put("error", e.getMessage());
                call.resolve(fallback);
            }
        });
    }

    @PluginMethod
    public void openUrlOnWatch(PluginCall call) {
        String url = call.getString("url");
        if (url == null || url.isEmpty()) {
            call.reject("URL parametresi gereklidir");
            return;
        }

        Context context = getContext();
        Executors.newSingleThreadExecutor().execute(() -> {
            try {
                List<Node> nodes = Tasks.await(Wearable.getNodeClient(context).getConnectedNodes());
                if (nodes == null || nodes.isEmpty()) {
                    // Try fallback broadcast
                    RemoteActivityHelper helper = new RemoteActivityHelper(context, Executors.newSingleThreadExecutor());
                    Intent intent = new Intent(Intent.ACTION_VIEW)
                            .setData(Uri.parse(url))
                            .addCategory(Intent.CATEGORY_BROWSABLE);
                    helper.startRemoteActivity(intent, null);

                    JSObject ret = new JSObject();
                    ret.put("success", true);
                    ret.put("message", "Bağlı saat arandı ve istek gönderildi");
                    call.resolve(ret);
                    return;
                }

                RemoteActivityHelper helper = new RemoteActivityHelper(context, Executors.newSingleThreadExecutor());
                Intent intent = new Intent(Intent.ACTION_VIEW)
                        .setData(Uri.parse(url))
                        .addCategory(Intent.CATEGORY_BROWSABLE);

                for (Node node : nodes) {
                    helper.startRemoteActivity(intent, node.getId());
                }

                JSObject ret = new JSObject();
                ret.put("success", true);
                ret.put("sentToCount", nodes.size());
                ret.put("targetWatch", nodes.get(0).getDisplayName());
                call.resolve(ret);
            } catch (Exception e) {
                Log.e(TAG, "Error opening URL on watch: " + e.getMessage(), e);
                call.reject("Saate açılamadı: " + e.getMessage());
            }
        });
    }

    @PluginMethod
    public void openGalaxyWearable(PluginCall call) {
        Context context = getContext();
        try {
            Intent launchIntent = context.getPackageManager().getLaunchIntentForPackage("com.samsung.android.app.watchmanager");
            if (launchIntent != null) {
                launchIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                context.startActivity(launchIntent);
                JSObject ret = new JSObject();
                ret.put("success", true);
                call.resolve(ret);
            } else {
                // Try opening Wear OS or play store
                Intent webIntent = new Intent(Intent.ACTION_VIEW, Uri.parse("market://details?id=com.samsung.android.app.watchmanager"));
                webIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                context.startActivity(webIntent);
                JSObject ret = new JSObject();
                ret.put("success", true);
                call.resolve(ret);
            }
        } catch (Exception e) {
            call.reject("Galaxy Wearable açılamadı: " + e.getMessage());
        }
    }
}
