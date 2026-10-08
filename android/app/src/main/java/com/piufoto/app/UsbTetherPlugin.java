package com.piufoto.app;

import android.app.Activity;
import android.app.PendingIntent;
import android.content.BroadcastReceiver;
import android.content.ContentResolver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.database.Cursor;
import android.hardware.usb.UsbDevice;
import android.hardware.usb.UsbInterface;
import android.hardware.usb.UsbManager;
import android.net.Uri;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.provider.DocumentsContract;
import android.provider.OpenableColumns;
import android.util.Base64;
import android.util.Log;

import androidx.activity.result.ActivityResult;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.util.HashMap;

@CapacitorPlugin(name = "UsbTether")
public class UsbTetherPlugin extends Plugin {
    private static final String TAG = "UsbTetherPlugin";
    private static final String ACTION_USB_PERMISSION = "com.piufoto.app.USB_PERMISSION";

    private UsbManager usbManager;
    private PtpCameraClient ptpClient;
    private PendingIntent permissionIntent;
    private boolean receiverRegistered = false;

    // Background auto-polling handler (ensures plug-and-play detection at any time)
    private Handler pollHandler;
    private Runnable pollRunnable;
    private boolean isPollingActive = false;

    private final BroadcastReceiver usbReceiver = new BroadcastReceiver() {
        @Override
        public void onReceive(Context context, Intent intent) {
            String action = intent.getAction();
            if (ACTION_USB_PERMISSION.equals(action)) {
                synchronized (this) {
                    UsbDevice device = intent.getParcelableExtra(UsbManager.EXTRA_DEVICE);
                    if (intent.getBooleanExtra(UsbManager.EXTRA_PERMISSION_GRANTED, false)) {
                        if (device != null) {
                            Log.i(TAG, "Izin USB diberikan untuk device: " + device.getDeviceName());
                            connectToDevice(device);
                        }
                    } else {
                        Log.w(TAG, "Izin USB ditolak oleh pengguna.");
                        notifyStatus("Izin akses USB ditolak pengguna", false);
                    }
                }
            } else if (UsbManager.ACTION_USB_DEVICE_ATTACHED.equals(action)) {
                Log.i(TAG, "USB Device Attached Broadcast!");
                autoDetectAndConnect();
            } else if (UsbManager.ACTION_USB_DEVICE_DETACHED.equals(action)) {
                Log.i(TAG, "USB Device Detached Broadcast!");
                if (ptpClient != null) {
                    ptpClient.disconnect();
                }
                notifyStatus("Kamera USB terputus", false);
            }
        }
    };

    @Override
    public void load() {
        super.load();
        Context context = getContext();
        usbManager = (UsbManager) context.getSystemService(Context.USB_SERVICE);
        ptpClient = new PtpCameraClient(usbManager);

        ptpClient.setListener(new PtpCameraClient.OnPhotoCapturedListener() {
            @Override
            public void onPhotoCaptured(String filename, String base64Data, int sizeBytes) {
                JSObject ret = new JSObject();
                ret.put("filename", filename);
                ret.put("base64", base64Data);
                ret.put("size", sizeBytes);
                ret.put("timestamp", System.currentTimeMillis());
                notifyListeners("photoCaptured", ret);
            }

            @Override
            public void onStatusChanged(String statusMessage, boolean isConnected) {
                notifyStatus(statusMessage, isConnected);
            }
        });

        int flags = (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) ? PendingIntent.FLAG_IMMUTABLE : 0;
        permissionIntent = PendingIntent.getBroadcast(context, 0, new Intent(ACTION_USB_PERMISSION), flags);

        IntentFilter filter = new IntentFilter(ACTION_USB_PERMISSION);
        filter.addAction(UsbManager.ACTION_USB_DEVICE_ATTACHED);
        filter.addAction(UsbManager.ACTION_USB_DEVICE_DETACHED);

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            context.registerReceiver(usbReceiver, filter, Context.RECEIVER_NOT_EXPORTED);
        } else {
            context.registerReceiver(usbReceiver, filter);
        }
        receiverRegistered = true;

        // Pastikan KeepAliveService berjalan untuk mempertahankan WakeLock & polling saat layar mati
        KeepAliveService.startKeepAliveService(context);

        // Start continuous background auto-scan (every 1.5 seconds)
        startContinuousPolling();
    }

    private void startContinuousPolling() {
        if (isPollingActive) return;
        isPollingActive = true;
        pollHandler = new Handler(Looper.getMainLooper());
        pollRunnable = new Runnable() {
            @Override
            public void run() {
                if (isPollingActive) {
                    if (ptpClient == null || !ptpClient.isConnected()) {
                        autoDetectAndConnect();
                    }
                    pollHandler.postDelayed(this, 1500);
                }
            }
        };
        pollHandler.postDelayed(pollRunnable, 500);
    }

    private void stopContinuousPolling() {
        isPollingActive = false;
        if (pollHandler != null && pollRunnable != null) {
            pollHandler.removeCallbacks(pollRunnable);
        }
    }

    @Override
    protected void handleOnDestroy() {
        stopContinuousPolling();
        if (receiverRegistered) {
            try {
                getContext().unregisterReceiver(usbReceiver);
                receiverRegistered = false;
            } catch (Exception ignored) {}
        }
        if (ptpClient != null) {
            ptpClient.disconnect();
        }
        super.handleOnDestroy();
    }

    @PluginMethod
    public void startListening(PluginCall call) {
        boolean started = autoDetectAndConnect();
        JSObject ret = new JSObject();
        ret.put("success", started);
        ret.put("connected", ptpClient != null && ptpClient.isConnected());
        ret.put("cameraName", ptpClient != null ? ptpClient.getCameraName() : "Tidak ada");
        ret.put("deviceCount", getDeviceCount());
        ret.put("deviceList", getDetailedDeviceList());
        call.resolve(ret);
    }

    @PluginMethod
    public void stopListening(PluginCall call) {
        if (ptpClient != null) {
            ptpClient.disconnect();
        }
        JSObject ret = new JSObject();
        ret.put("success", true);
        ret.put("connected", false);
        call.resolve(ret);
    }

    @PluginMethod
    public void getStatus(PluginCall call) {
        JSObject ret = new JSObject();
        boolean connected = ptpClient != null && ptpClient.isConnected();
        ret.put("connected", connected);
        ret.put("cameraName", ptpClient != null ? ptpClient.getCameraName() : "Tidak ada");
        ret.put("deviceCount", getDeviceCount());
        ret.put("deviceList", getDetailedDeviceList());
        call.resolve(ret);
    }

    private int getDeviceCount() {
        if (usbManager == null) return 0;
        HashMap<String, UsbDevice> list = usbManager.getDeviceList();
        return (list != null) ? list.size() : 0;
    }

    private JSArray getDetailedDeviceList() {
        JSArray arr = new JSArray();
        if (usbManager == null) return arr;
        HashMap<String, UsbDevice> list = usbManager.getDeviceList();
        if (list == null) return arr;
        for (UsbDevice d : list.values()) {
            JSObject obj = new JSObject();
            obj.put("name", d.getDeviceName());
            obj.put("productName", d.getProductName() != null ? d.getProductName() : "Unknown");
            obj.put("vendorId", d.getVendorId());
            obj.put("productId", d.getProductId());
            obj.put("deviceClass", d.getDeviceClass());
            arr.put(obj);
        }
        return arr;
    }

    public synchronized boolean autoDetectAndConnect() {
        if (usbManager == null) return false;
        HashMap<String, UsbDevice> deviceList = usbManager.getDeviceList();
        if (deviceList == null || deviceList.isEmpty()) {
            return false;
        }

        for (UsbDevice device : deviceList.values()) {
            int vid = device.getVendorId();
            // Nikon = 1200 (0x04B0), Fujifilm = 1227 (0x04CB), Canon = 1193, Sony = 1356, or Class 6 Still Image
            boolean isTargetCamera = (vid == 1200 || vid == 1227 || vid == 1193 || vid == 1356 || isStillCamera(device));

            if (isTargetCamera) {
                if (usbManager.hasPermission(device)) {
                    if (ptpClient != null && !ptpClient.isConnected()) {
                        Log.i(TAG, "Connecting to camera: " + device.getProductName() + " VID=" + vid);
                        return connectToDevice(device);
                    }
                    return true;
                } else {
                    Log.i(TAG, "Requesting USB permission for: " + device.getProductName() + " VID=" + vid);
                    notifyStatus("Meminta izin akses kamera " + (device.getProductName() != null ? device.getProductName() : "USB") + "...", false);
                    usbManager.requestPermission(device, permissionIntent);
                    return true;
                }
            }
        }

        return false;
    }

    private boolean isStillCamera(UsbDevice device) {
        if (device.getDeviceClass() == 6) return true; // USB_CLASS_STILL_IMAGE
        for (int i = 0; i < device.getInterfaceCount(); i++) {
            UsbInterface iface = device.getInterface(i);
            int ifaceClass = iface.getInterfaceClass();
            if (ifaceClass == 6) { // USB_CLASS_STILL_IMAGE (PTP / MTP)
                return true;
            }
        }
        return false;
    }

    private boolean connectToDevice(UsbDevice device) {
        if (ptpClient == null) return false;
        return ptpClient.connect(device);
    }

    private void notifyStatus(String message, boolean connected) {
        JSObject ret = new JSObject();
        ret.put("message", message);
        ret.put("connected", connected);
        ret.put("cameraName", ptpClient != null ? ptpClient.getCameraName() : "");
        ret.put("deviceCount", getDeviceCount());
        notifyListeners("statusChanged", ret);
    }

    @PluginMethod
    public void pickPhotosFromStorage(PluginCall call) {
        try {
            Intent intent = new Intent(Intent.ACTION_GET_CONTENT);
            intent.setType("image/*");
            intent.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true);
            intent.addCategory(Intent.CATEGORY_OPENABLE);
            startActivityForResult(call, Intent.createChooser(intent, "Pilih Foto Kamera / Galeri"), "pickPhotosCallback");
        } catch (Exception e) {
            Log.e(TAG, "Gagal membuka photo picker", e);
            call.reject("Gagal membuka galeri: " + e.getMessage());
        }
    }

    @ActivityCallback
    private void pickPhotosCallback(PluginCall call, ActivityResult result) {
        if (call == null) return;
        if (result.getResultCode() == Activity.RESULT_OK && result.getData() != null) {
            Intent data = result.getData();
            JSArray photos = new JSArray();
            try {
                if (data.getClipData() != null) {
                    int count = data.getClipData().getItemCount();
                    for (int i = 0; i < count; i++) {
                        Uri uri = data.getClipData().getItemAt(i).getUri();
                        JSObject obj = processImageUri(uri);
                        if (obj != null) photos.put(obj);
                    }
                } else if (data.getData() != null) {
                    Uri uri = data.getData();
                    JSObject obj = processImageUri(uri);
                    if (obj != null) photos.put(obj);
                }
                JSObject ret = new JSObject();
                ret.put("photos", photos);
                ret.put("count", photos.length());
                call.resolve(ret);
            } catch (Exception e) {
                Log.e(TAG, "Gagal memproses hasil photo picker", e);
                call.reject("Gagal membaca foto: " + e.getMessage());
            }
        } else {
            JSObject ret = new JSObject();
            ret.put("photos", new JSArray());
            ret.put("count", 0);
            ret.put("cancelled", true);
            call.resolve(ret);
        }
    }

    @PluginMethod
    public void pickFolderFromStorage(PluginCall call) {
        try {
            Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT_TREE);
            intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION);
            startActivityForResult(call, Intent.createChooser(intent, "Pilih Folder Kamera OTG"), "pickFolderCallback");
        } catch (Exception e) {
            Log.e(TAG, "Gagal membuka folder picker", e);
            call.reject("Gagal membuka folder picker: " + e.getMessage());
        }
    }

    @ActivityCallback
    private void pickFolderCallback(PluginCall call, ActivityResult result) {
        if (call == null) return;
        if (result.getResultCode() == Activity.RESULT_OK && result.getData() != null) {
            Uri treeUri = result.getData().getData();
            if (treeUri != null) {
                try {
                    getContext().getContentResolver().takePersistableUriPermission(
                        treeUri, Intent.FLAG_GRANT_READ_URI_PERMISSION
                    );
                } catch (Exception ignored) {}

                JSArray photos = scanTreeUriForImages(treeUri);
                JSObject ret = new JSObject();
                ret.put("treeUri", treeUri.toString());
                ret.put("photos", photos);
                ret.put("count", photos.length());
                call.resolve(ret);
                return;
            }
        }
        JSObject ret = new JSObject();
        ret.put("photos", new JSArray());
        ret.put("count", 0);
        ret.put("cancelled", true);
        call.resolve(ret);
    }

    private JSArray scanTreeUriForImages(Uri treeUri) {
        JSArray photos = new JSArray();
        try {
            ContentResolver cr = getContext().getContentResolver();
            String docId = DocumentsContract.getTreeDocumentId(treeUri);
            Uri childrenUri = DocumentsContract.buildChildDocumentsUriUsingTree(treeUri, docId);
            String[] projection = new String[] {
                DocumentsContract.Document.COLUMN_DOCUMENT_ID,
                DocumentsContract.Document.COLUMN_DISPLAY_NAME,
                DocumentsContract.Document.COLUMN_MIME_TYPE
            };

            Cursor cursor = cr.query(childrenUri, projection, null, null, null);
            if (cursor != null) {
                while (cursor.moveToNext()) {
                    String mime = cursor.getString(2);
                    String name = cursor.getString(1);
                    String childDocId = cursor.getString(0);
                    boolean isImg = (mime != null && mime.startsWith("image/")) ||
                                   (name != null && (name.toLowerCase().endsWith(".jpg") || name.toLowerCase().endsWith(".jpeg") || name.toLowerCase().endsWith(".png")));
                    if (isImg) {
                        Uri docUri = DocumentsContract.buildDocumentUriUsingTree(treeUri, childDocId);
                        JSObject obj = processImageUri(docUri);
                        if (obj != null) {
                            photos.put(obj);
                        }
                    }
                }
                cursor.close();
            }
        } catch (Exception e) {
            Log.e(TAG, "Gagal memindai folder OTG", e);
        }
        return photos;
    }

    private JSObject processImageUri(Uri uri) {
        try {
            ContentResolver cr = getContext().getContentResolver();
            String displayName = "photo_" + System.currentTimeMillis() + ".jpg";
            Cursor cursor = cr.query(uri, null, null, null, null);
            if (cursor != null) {
                int nameIndex = cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME);
                if (nameIndex != -1 && cursor.moveToFirst()) {
                    String name = cursor.getString(nameIndex);
                    if (name != null && !name.trim().isEmpty()) {
                        displayName = name;
                    }
                }
                cursor.close();
            }

            InputStream is = cr.openInputStream(uri);
            if (is == null) return null;
            ByteArrayOutputStream buffer = new ByteArrayOutputStream();
            byte[] temp = new byte[8192];
            int read;
            while ((read = is.read(temp)) != -1) {
                buffer.write(temp, 0, read);
            }
            is.close();
            byte[] bytes = buffer.toByteArray();

            String base64 = "data:image/jpeg;base64," + Base64.encodeToString(bytes, Base64.NO_WRAP);
            JSObject item = new JSObject();
            item.put("filename", displayName);
            item.put("base64", base64);
            item.put("size", bytes.length);
            return item;
        } catch (Exception e) {
            Log.e(TAG, "Gagal memproses gambar URI: " + uri, e);
            return null;
        }
    }
}
