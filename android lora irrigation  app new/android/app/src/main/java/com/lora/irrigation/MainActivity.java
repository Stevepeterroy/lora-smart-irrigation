package com.lora.irrigation;

import android.os.Bundle;
import android.content.SharedPreferences;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        // Expire WebView file caches after an app update, preserving user settings.
        SharedPreferences prefs = getSharedPreferences("web_asset_version", MODE_PRIVATE);
        if (bridge != null && prefs.getInt("version", 0) != 4) {
            bridge.getWebView().clearCache(true);
            prefs.edit().putInt("version", 4).apply();
        }
    }
}
