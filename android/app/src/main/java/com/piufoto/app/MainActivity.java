package com.piufoto.app;

import android.content.Intent;
import android.os.Bundle;
import android.webkit.WebView;
import android.widget.Toast;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    private long lastBackPressTime = 0;

    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(UsbTetherPlugin.class);
        super.onCreate(savedInstanceState);
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
    }

    @Override
    public void onBackPressed() {
        if (getBridge() != null && getBridge().getWebView() != null) {
            WebView webView = getBridge().getWebView();
            if (webView.canGoBack()) {
                webView.goBack();
                return;
            }
        }

        long currentTime = System.currentTimeMillis();
        if (currentTime - lastBackPressTime < 2000) {
            moveTaskToBack(true);
        } else {
            lastBackPressTime = currentTime;
            Toast.makeText(this, "Usap / tekan sekali lagi untuk menutup", Toast.LENGTH_SHORT).show();
        }
    }
}
