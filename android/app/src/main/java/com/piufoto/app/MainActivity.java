package com.piufoto.app;

import android.Manifest;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.PowerManager;
import android.provider.Settings;
import android.webkit.WebView;
import android.widget.Toast;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    private static final int REQUEST_NOTIFICATION_PERMISSION = 101;
    private long lastBackPressTime = 0;

    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(UsbTetherPlugin.class);
        super.onCreate(savedInstanceState);
        // Cegah layar tablet mati / tidur saat aplikasi Piufoto sedang aktif di photobooth
        try {
            getWindow().addFlags(android.view.WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        } catch (Throwable ignored) {}

        // Jalankan Foreground Service & WakeLock agar aplikasi tetap aktif saat layar mati
        try {
            KeepAliveService.startKeepAliveService(this);
        } catch (Throwable ignored) {}

        // Minta izin Notifikasi untuk Android 13+ (API 33+) agar notifikasi Foreground Service tampil
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            try {
                if (checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
                    requestPermissions(new String[]{Manifest.permission.POST_NOTIFICATIONS}, REQUEST_NOTIFICATION_PERMISSION);
                }
            } catch (Throwable ignored) {}
        }

        // Minta perizinan pengabaian optimasi baterai secara aman tanpa membuat app crash
        requestIgnoreBatteryOptimizations();
    }

    private void requestIgnoreBatteryOptimizations() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            try {
                PowerManager pm = (PowerManager) getSystemService(Context.POWER_SERVICE);
                if (pm != null && !pm.isIgnoringBatteryOptimizations(getPackageName())) {
                    Intent intent = new Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS);
                    intent.setData(Uri.parse("package:" + getPackageName()));
                    startActivity(intent);
                }
            } catch (Throwable ignored) {
                // Di beberapa ROM (Xiaomi/Samsung/Custom ROM) intent ini mungkin diblokir atau tidak tersedia
            }
        }
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
            String currentUrl = webView.getUrl();

            // Cegah aplikasi tertutup saat gerakan usap / tombol back dilakukan di halaman galeri
            if (currentUrl != null && currentUrl.contains("gallery.html")) {
                webView.evaluateJavascript(
                    "(function() {" +
                    "  if (typeof window.handleAppBackGesture === 'function') {" +
                    "    return window.handleAppBackGesture();" +
                    "  }" +
                    "  return false;" +
                    "})()",
                    result -> {
                        if ("true".equals(result) || "\"true\"".equals(result)) {
                            return;
                        }
                        if (webView.canGoBack()) {
                            webView.goBack();
                        } else {
                            webView.loadUrl("javascript:window.location.href='index.html'");
                        }
                    }
                );
                return;
            }

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
