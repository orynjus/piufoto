package com.piufoto.app;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.net.wifi.WifiManager;
import android.os.Build;
import android.os.IBinder;
import android.os.PowerManager;
import android.util.Log;

import androidx.core.app.NotificationCompat;

public class KeepAliveService extends Service {
    private static final String TAG = "KeepAliveService";
    public static final String CHANNEL_ID = "piufoto_keepalive_channel";
    public static final int NOTIFICATION_ID = 1001;

    private PowerManager.WakeLock wakeLock;
    private WifiManager.WifiLock wifiLock;

    public static void startKeepAliveService(Context context) {
        if (context == null) return;
        Intent intent = new Intent(context, KeepAliveService.class);
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                context.startForegroundService(intent);
            } else {
                context.startService(intent);
            }
        } catch (Throwable e) {
            Log.e(TAG, "Gagal menjalankan KeepAliveService: " + e.getMessage(), e);
        }
    }

    public static void stopKeepAliveService(Context context) {
        if (context == null) return;
        Intent intent = new Intent(context, KeepAliveService.class);
        try {
            context.stopService(intent);
        } catch (Throwable e) {
            Log.e(TAG, "Gagal menghentikan KeepAliveService: " + e.getMessage(), e);
        }
    }

    @Override
    public void onCreate() {
        super.onCreate();
        Log.i(TAG, "KeepAliveService diciptakan.");
        createNotificationChannel();
        startForegroundWithNotification();
        acquireWakeLock();
        acquireWifiLock();
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        Log.i(TAG, "KeepAliveService dimulai.");
        startForegroundWithNotification();
        acquireWakeLock();
        acquireWifiLock();
        return START_STICKY;
    }

    private void createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            try {
                NotificationChannel channel = new NotificationChannel(
                        CHANNEL_ID,
                        "Layanan PiuFoto Latar Belakang",
                        NotificationManager.IMPORTANCE_LOW
                );
                channel.setDescription("Menjaga koneksi kamera USB tetap aktif saat layar mati");
                NotificationManager manager = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
                if (manager != null) {
                    manager.createNotificationChannel(channel);
                }
            } catch (Throwable e) {
                Log.e(TAG, "Gagal membuat NotificationChannel: " + e.getMessage(), e);
            }
        }
    }

    private void startForegroundWithNotification() {
        try {
            Intent notificationIntent = new Intent(this, MainActivity.class);
            int flags = PendingIntent.FLAG_UPDATE_CURRENT;
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                flags |= PendingIntent.FLAG_IMMUTABLE;
            }
            PendingIntent pendingIntent = PendingIntent.getActivity(this, 0, notificationIntent, flags);

            int iconRes = getApplicationInfo().icon != 0 ? getApplicationInfo().icon : android.R.drawable.ic_dialog_info;

            NotificationCompat.Builder builder = new NotificationCompat.Builder(this, CHANNEL_ID)
                    .setContentTitle("PiuFoto Aktif")
                    .setContentText("Aplikasi tetap berjalan memantau kamera di latar belakang")
                    .setSmallIcon(iconRes)
                    .setOngoing(true)
                    .setContentIntent(pendingIntent)
                    .setPriority(NotificationCompat.PRIORITY_LOW);

            Notification notification = builder.build();

            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                try {
                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
                        int type = ServiceInfo.FOREGROUND_SERVICE_TYPE_CONNECTED_DEVICE | ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC;
                        startForeground(NOTIFICATION_ID, notification, type);
                    } else {
                        startForeground(NOTIFICATION_ID, notification);
                    }
                } catch (Throwable e) {
                    Log.w(TAG, "Fallback startForeground tanpa type: " + e.getMessage());
                    try {
                        startForeground(NOTIFICATION_ID, notification);
                    } catch (Throwable ex) {
                        Log.e(TAG, "Gagal startForeground: " + ex.getMessage(), ex);
                    }
                }
            } else {
                startForeground(NOTIFICATION_ID, notification);
            }
        } catch (Throwable e) {
            Log.e(TAG, "Error pada startForegroundWithNotification: " + e.getMessage(), e);
        }
    }

    private void acquireWakeLock() {
        try {
            if (wakeLock == null) {
                PowerManager powerManager = (PowerManager) getSystemService(Context.POWER_SERVICE);
                if (powerManager != null) {
                    wakeLock = powerManager.newWakeLock(
                            PowerManager.PARTIAL_WAKE_LOCK,
                            "PiuFoto::KeepAliveWakeLock"
                    );
                    wakeLock.setReferenceCounted(false);
                }
            }
            if (wakeLock != null && !wakeLock.isHeld()) {
                wakeLock.acquire();
                Log.i(TAG, "Partial WakeLock berhasil diaktifkan.");
            }
        } catch (Throwable e) {
            Log.e(TAG, "Gagal mengaktifkan WakeLock: " + e.getMessage(), e);
        }
    }

    private void acquireWifiLock() {
        try {
            if (wifiLock == null) {
                WifiManager wifiManager = (WifiManager) getApplicationContext().getSystemService(Context.WIFI_SERVICE);
                if (wifiManager != null) {
                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                        wifiLock = wifiManager.createWifiLock(
                                WifiManager.WIFI_MODE_FULL_LOW_LATENCY,
                                "PiuFoto::KeepAliveWifiLock"
                        );
                    } else {
                        wifiLock = wifiManager.createWifiLock(
                                WifiManager.WIFI_MODE_FULL_HIGH_PERF,
                                "PiuFoto::KeepAliveWifiLock"
                        );
                    }
                    wifiLock.setReferenceCounted(false);
                }
            }
            if (wifiLock != null && !wifiLock.isHeld()) {
                wifiLock.acquire();
                Log.i(TAG, "WifiLock berhasil diaktifkan.");
            }
        } catch (Throwable e) {
            Log.e(TAG, "Gagal mengaktifkan WifiLock: " + e.getMessage(), e);
        }
    }

    private void releaseWifiLock() {
        try {
            if (wifiLock != null && wifiLock.isHeld()) {
                wifiLock.release();
                Log.i(TAG, "WifiLock dilepaskan.");
            }
        } catch (Throwable e) {
            Log.e(TAG, "Gagal melepaskan WifiLock: " + e.getMessage(), e);
        }
    }

    private void releaseWakeLock() {
        try {
            if (wakeLock != null && wakeLock.isHeld()) {
                wakeLock.release();
                Log.i(TAG, "Partial WakeLock dilepaskan.");
            }
        } catch (Throwable e) {
            Log.e(TAG, "Gagal melepaskan WakeLock: " + e.getMessage(), e);
        }
    }

    @Override
    public void onDestroy() {
        Log.i(TAG, "KeepAliveService dihancurkan.");
        releaseWakeLock();
        releaseWifiLock();
        try {
            stopForeground(true);
        } catch (Throwable ignored) {}
        super.onDestroy();
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }
}
