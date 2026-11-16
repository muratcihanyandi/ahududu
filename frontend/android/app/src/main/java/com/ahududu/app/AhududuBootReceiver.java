package com.ahududu.app;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;

/**
 * Telefon yeniden başladığında bildirim servisini kendiliğinden geri getirir.
 * Kullanıcı daha önce hangi telefonda oturduğunu seçtiyse servis tekrar bağlanır.
 */
public class AhududuBootReceiver extends BroadcastReceiver {

    @Override
    public void onReceive(Context context, Intent intent) {
        if (intent == null) return;
        String action = intent.getAction();
        if (action == null) return;
        if (!Intent.ACTION_BOOT_COMPLETED.equals(action)
                && !"android.intent.action.QUICKBOOT_POWERON".equals(action)
                && !Intent.ACTION_MY_PACKAGE_REPLACED.equals(action)) {
            return;
        }

        SharedPreferences prefs = context.getSharedPreferences(
                AhududuNotifyService.PREFS, Context.MODE_PRIVATE);
        String userId = prefs.getString(AhududuNotifyService.KEY_USER_ID, null);
        if (userId != null && !userId.isEmpty()) {
            AhududuNotifyService.start(context);
        }
    }
}
