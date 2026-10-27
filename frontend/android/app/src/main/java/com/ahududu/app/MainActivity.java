package com.ahududu.app;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(GalaxyWatchBridgePlugin.class);
        super.onCreate(savedInstanceState);
    }
}
