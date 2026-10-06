package com.piufoto.app;

import android.hardware.usb.UsbConstants;
import android.hardware.usb.UsbDevice;
import android.hardware.usb.UsbDeviceConnection;
import android.hardware.usb.UsbEndpoint;
import android.hardware.usb.UsbInterface;
import android.hardware.usb.UsbManager;
import android.hardware.usb.UsbRequest;
import android.os.Build;
import android.util.Base64;
import android.util.Log;

import java.io.ByteArrayOutputStream;
import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.util.ArrayList;
import java.util.Collections;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import java.util.concurrent.atomic.AtomicBoolean;

/**
 * PtpCameraClient - Handles USB PTP communication for Nikon D7000 and Fujifilm X-T2
 * Using UsbRequest for asynchronous Interrupt Endpoint event listening + synchronized polling
 */
public class PtpCameraClient {
    private static final String TAG = "PiufotoPTP";

    // PTP Container Types
    private static final short TYPE_COMMAND = 1;
    private static final short TYPE_DATA = 2;
    private static final short TYPE_RESPONSE = 3;
    private static final short TYPE_EVENT = 4;

    // PTP Standard OpCodes
    private static final short OP_OPEN_SESSION = 0x1002;
    private static final short OP_CLOSE_SESSION = 0x1003;
    private static final short OP_GET_STORAGE_IDS = 0x1004;
    private static final short OP_GET_STORAGE_INFO = 0x1005;
    private static final short OP_GET_OBJECT_HANDLES = 0x1007;
    private static final short OP_GET_OBJECT_INFO = 0x1008;
    private static final short OP_GET_OBJECT = 0x1009;

    // PTP Response Codes
    private static final short RESP_OK = 0x2001;

    // PTP Event Codes (Standard & Vendor Specific)
    private static final short EVENT_OBJECT_ADDED = 0x4002;
    private static final short EVENT_OBJECT_INFO_CHANGED = 0x4003;
    private static final short EVENT_STORAGE_INFO_CHANGED = 0x4006;
    private static final short EVENT_NIKON_OBJECT_ADDED_IN_SDRAM = (short) 0xC101;
    private static final short EVENT_NIKON_CAPTURE_COMPLETE = (short) 0xC102;
    private static final short EVENT_NIKON_ADVANCED_TRANSFER = (short) 0xC103;

    public interface OnPhotoCapturedListener {
        void onPhotoCaptured(String filename, String base64Data, int sizeBytes);
        void onStatusChanged(String statusMessage, boolean isConnected);
    }

    private final UsbManager usbManager;
    private UsbDevice usbDevice;
    private UsbDeviceConnection connection;
    private UsbInterface usbInterface;
    private UsbEndpoint epIn;
    private UsbEndpoint epOut;
    private UsbEndpoint epInt;

    private int transactionId = 1;
    private final AtomicBoolean isListening = new AtomicBoolean(false);
    private final Object usbLock = new Object();
    private Thread eventThread;
    private Thread pollingThread;
    private final Set<Integer> knownObjectHandles = Collections.synchronizedSet(new HashSet<>());
    private OnPhotoCapturedListener listener;

    public PtpCameraClient(UsbManager usbManager) {
        this.usbManager = usbManager;
    }

    public void setListener(OnPhotoCapturedListener listener) {
        this.listener = listener;
    }

    public boolean isConnected() {
        return connection != null && isListening.get();
    }

    public String getCameraName() {
        if (usbDevice == null) return "Tidak ada kamera";
        String name = usbDevice.getProductName();
        if (name != null && !name.trim().isEmpty()) return name;
        int vid = usbDevice.getVendorId();
        if (vid == 1200) return "Nikon DSLR (D7000)";
        if (vid == 1227) return "Fujifilm (X-T2)";
        return "Kamera USB (VID:" + vid + ")";
    }

    public synchronized boolean connect(UsbDevice device) {
        disconnect();
        this.usbDevice = device;

        // Find PTP Interface & Endpoints
        for (int i = 0; i < device.getInterfaceCount(); i++) {
            UsbInterface iface = device.getInterface(i);
            UsbEndpoint in = null, out = null, intr = null;

            for (int e = 0; e < iface.getEndpointCount(); e++) {
                UsbEndpoint ep = iface.getEndpoint(e);
                if (ep.getType() == UsbConstants.USB_ENDPOINT_XFER_BULK) {
                    if (ep.getDirection() == UsbConstants.USB_DIR_IN) in = ep;
                    else out = ep;
                } else if (ep.getType() == UsbConstants.USB_ENDPOINT_XFER_INT) {
                    if (ep.getDirection() == UsbConstants.USB_DIR_IN) intr = ep;
                }
            }

            if (in != null && out != null) {
                this.usbInterface = iface;
                this.epIn = in;
                this.epOut = out;
                this.epInt = intr;
                break;
            }
        }

        if (usbInterface == null) {
            Log.e(TAG, "Tidak menemukan interface PTP pada kamera.");
            if (listener != null) listener.onStatusChanged("Interface PTP tidak ditemukan", false);
            return false;
        }

        connection = usbManager.openDevice(device);
        if (connection == null) {
            Log.e(TAG, "Gagal membuka koneksi USB (Izin belum diberikan).");
            if (listener != null) listener.onStatusChanged("Izin USB belum diberikan", false);
            return false;
        }

        if (!connection.claimInterface(usbInterface, true)) {
            Log.e(TAG, "Gagal claim USB interface.");
            connection.close();
            connection = null;
            return false;
        }

        // Open PTP Session
        if (!openSession()) {
            Log.w(TAG, "OpenSession gagal atau session sudah aktif, mencoba melanjutkan...");
        }

        // Seed existing handles so we only capture NEW ones
        seedInitialHandles();

        isListening.set(true);
        if (listener != null) {
            listener.onStatusChanged("✅ Terhubung ke " + getCameraName() + " (Siap! Jepretan otomatis masuk)", true);
        }

        // Start dual listener: UsbRequest Interrupt Listener + Polling Fallback
        startEventListening();
        startPolling();

        return true;
    }

    public synchronized void disconnect() {
        isListening.set(false);
        if (eventThread != null) {
            eventThread.interrupt();
            eventThread = null;
        }
        if (pollingThread != null) {
            pollingThread.interrupt();
            pollingThread = null;
        }

        synchronized (usbLock) {
            if (connection != null && usbInterface != null) {
                try {
                    closeSession();
                    connection.releaseInterface(usbInterface);
                    connection.close();
                } catch (Exception ignored) {}
            }
            connection = null;
            usbInterface = null;
            epIn = null;
            epOut = null;
            epInt = null;
            knownObjectHandles.clear();
        }

        if (listener != null) {
            listener.onStatusChanged("Kamera terputus", false);
        }
    }

    private boolean openSession() {
        synchronized (usbLock) {
            if (connection == null || epOut == null || epIn == null) return false;
            transactionId = 1;
            byte[] cmd = createCommandPacket(OP_OPEN_SESSION, transactionId++, 1);
            int transferred = connection.bulkTransfer(epOut, cmd, cmd.length, 2000);
            if (transferred <= 0) return false;

            byte[] resp = new byte[512];
            int read = connection.bulkTransfer(epIn, resp, resp.length, 2000);
            return read >= 12;
        }
    }

    private void closeSession() {
        synchronized (usbLock) {
            if (connection == null || epOut == null) return;
            try {
                byte[] cmd = createCommandPacket(OP_CLOSE_SESSION, transactionId++);
                connection.bulkTransfer(epOut, cmd, cmd.length, 1000);
            } catch (Exception ignored) {}
        }
    }

    private void seedInitialHandles() {
        try {
            List<Integer> handles = getAllObjectHandles();
            if (handles != null) {
                knownObjectHandles.addAll(handles);
                Log.d(TAG, "Seeded " + knownObjectHandles.size() + " existing photos.");
            }
        } catch (Exception e) {
            Log.w(TAG, "Seed handles error: " + e.getMessage());
        }
    }

    private void startEventListening() {
        if (epInt == null || connection == null) {
            Log.w(TAG, "Endpoint Interrupt tidak tersedia, mengandalkan polling.");
            return;
        }

        eventThread = new Thread(() -> {
            UsbRequest request = new UsbRequest();
            if (!request.initialize(connection, epInt)) {
                Log.e(TAG, "Gagal menginisialisasi UsbRequest pada interrupt endpoint!");
                return;
            }

            int packetSize = Math.max(epInt.getMaxPacketSize(), 64);
            ByteBuffer buffer = ByteBuffer.allocate(packetSize).order(ByteOrder.LITTLE_ENDIAN);
            Log.i(TAG, "⚡ UsbRequest Interrupt Listener aktif pada endpoint: " + epInt.getAddress());

            while (isListening.get()) {
                try {
                    buffer.clear();
                    boolean queued;
                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                        queued = request.queue(buffer);
                    } else {
                        queued = request.queue(buffer, buffer.capacity());
                    }

                    if (!queued) {
                        Thread.sleep(500);
                        continue;
                    }

                    UsbRequest responseReq = connection.requestWait();
                    if (responseReq == null || !isListening.get()) {
                        break;
                    }

                    if (responseReq == request) {
                        buffer.flip();
                        int read = buffer.remaining();
                        if (read >= 12) {
                            int length = buffer.getInt();
                            short type = buffer.getShort();
                            short code = buffer.getShort();
                            int txId = buffer.getInt();

                            Log.i(TAG, String.format("⚡ [PTP EVENT DITERIMA] Type: %d, Code: 0x%04X, Read: %d bytes", type, (code & 0xFFFF), read));

                            if (type == TYPE_EVENT) {
                                boolean isCaptureEvent = (code == EVENT_OBJECT_ADDED ||
                                                          code == EVENT_NIKON_OBJECT_ADDED_IN_SDRAM ||
                                                          code == EVENT_NIKON_CAPTURE_COMPLETE ||
                                                          code == EVENT_NIKON_ADVANCED_TRANSFER ||
                                                          code == EVENT_OBJECT_INFO_CHANGED ||
                                                          code == EVENT_STORAGE_INFO_CHANGED);

                                if (isCaptureEvent) {
                                    int handle = (read >= 16) ? buffer.getInt() : -1;
                                    Log.i(TAG, "📸 [KAMERA MENJEPRET!] Code: 0x" + Integer.toHexString(code & 0xFFFF) + ", Handle: " + handle);
                                    if (listener != null) {
                                        listener.onStatusChanged("📸 Jepretan terdeteksi! Mengunduh foto...", true);
                                    }

                                    if (handle > 0 && !knownObjectHandles.contains(handle)) {
                                        fetchAndDeliverPhoto(handle);
                                    } else {
                                        // Cari handle terbaru dari storage kamera
                                        checkForNewHandles();
                                    }
                                }
                            }
                        }
                    }
                } catch (Exception e) {
                    if (!isListening.get()) break;
                    try { Thread.sleep(200); } catch (InterruptedException ignored) {}
                }
            }

            try {
                request.close();
            } catch (Exception ignored) {}
        });
        eventThread.start();
    }

    private void startPolling() {
        pollingThread = new Thread(() -> {
            while (isListening.get()) {
                try {
                    Thread.sleep(1200);
                    if (!isListening.get()) break;
                    checkForNewHandles();
                } catch (InterruptedException e) {
                    break;
                } catch (Exception e) {
                    Log.w(TAG, "Polling tick error: " + e.getMessage());
                }
            }
        });
        pollingThread.start();
    }

    private synchronized void checkForNewHandles() {
        try {
            List<Integer> currentHandles = getAllObjectHandles();
            if (currentHandles != null && !currentHandles.isEmpty()) {
                for (int h : currentHandles) {
                    if (!knownObjectHandles.contains(h)) {
                        Log.i(TAG, "📸 [FOTO BARU DITEMUKAN DARI STORAGE] Handle: " + h);
                        fetchAndDeliverPhoto(h);
                        break;
                    }
                }
            }
        } catch (Exception e) {
            Log.w(TAG, "Check new handles error: " + e.getMessage());
        }
    }

    private int[] getStorageIDs() {
        synchronized (usbLock) {
            if (connection == null || epOut == null || epIn == null) return null;
            byte[] cmd = createCommandPacket(OP_GET_STORAGE_IDS, transactionId++);
            int sent = connection.bulkTransfer(epOut, cmd, cmd.length, 2000);
            if (sent <= 0) return null;

            byte[] buffer = new byte[2048];
            int read = connection.bulkTransfer(epIn, buffer, buffer.length, 3000);
            if (read < 12) return null;

            ByteBuffer bb = ByteBuffer.wrap(buffer, 0, read).order(ByteOrder.LITTLE_ENDIAN);
            int length = bb.getInt();
            short type = bb.getShort();
            if (type == TYPE_DATA && read >= 16) {
                int count = bb.getInt(12);
                int[] storages = new int[count];
                for (int i = 0; i < count && (16 + (i + 1) * 4) <= read; i++) {
                    storages[i] = bb.getInt(16 + (i * 4));
                }
                // Read response container
                byte[] resp = new byte[64];
                connection.bulkTransfer(epIn, resp, resp.length, 1000);
                return storages;
            }
            return null;
        }
    }

    private List<Integer> getObjectHandlesForStorage(int storageId) {
        List<Integer> list = new ArrayList<>();
        synchronized (usbLock) {
            if (connection == null || epOut == null || epIn == null) return list;
            byte[] cmd = createCommandPacket(OP_GET_OBJECT_HANDLES, transactionId++, storageId, 0, 0);
            int sent = connection.bulkTransfer(epOut, cmd, cmd.length, 2000);
            if (sent <= 0) return list;

            ByteArrayOutputStream baos = new ByteArrayOutputStream();
            byte[] buffer = new byte[16384];

            int read = connection.bulkTransfer(epIn, buffer, buffer.length, 3000);
            if (read < 12) return list;

            ByteBuffer bb = ByteBuffer.wrap(buffer, 0, read).order(ByteOrder.LITTLE_ENDIAN);
            int length = bb.getInt();
            short type = bb.getShort();

            if (type == TYPE_DATA) {
                baos.write(buffer, 12, read - 12);
                int remaining = length - read;
                while (remaining > 0) {
                    int r = connection.bulkTransfer(epIn, buffer, Math.min(buffer.length, remaining), 3000);
                    if (r <= 0) break;
                    baos.write(buffer, 0, r);
                    remaining -= r;
                }
                // Read response
                byte[] resp = new byte[64];
                connection.bulkTransfer(epIn, resp, resp.length, 1500);
            }

            byte[] fullData = baos.toByteArray();
            if (fullData.length >= 4) {
                ByteBuffer dbb = ByteBuffer.wrap(fullData).order(ByteOrder.LITTLE_ENDIAN);
                int count = dbb.getInt();
                for (int i = 0; i < count && dbb.remaining() >= 4; i++) {
                    list.add(dbb.getInt());
                }
            }
        }
        return list;
    }

    private List<Integer> getAllObjectHandles() {
        List<Integer> allHandles = new ArrayList<>();
        int[] storages = getStorageIDs();
        if (storages != null && storages.length > 0) {
            for (int s : storages) {
                List<Integer> hList = getObjectHandlesForStorage(s);
                if (hList != null && !hList.isEmpty()) {
                    allHandles.addAll(hList);
                }
            }
        }
        if (allHandles.isEmpty()) {
            // Wildcard fallback
            allHandles.addAll(getObjectHandlesForStorage(0xFFFFFFFF));
        }
        return allHandles;
    }

    private void fetchAndDeliverPhoto(int handle) {
        knownObjectHandles.add(handle);
        Log.i(TAG, "📥 Memulai download foto handle: " + handle);
        if (listener != null) {
            listener.onStatusChanged("📥 Menarik foto jepretan dari " + getCameraName() + "...", true);
        }

        try {
            String prefix = "DSC_";
            if (usbDevice != null) {
                int vid = usbDevice.getVendorId();
                if (vid == 1200) prefix = "NIKON_";
                else if (vid == 1227) prefix = "FUJI_";
            }
            String filename = prefix + String.format("%04X", (handle & 0xFFFF)) + "_" + System.currentTimeMillis() + ".JPG";

            byte[] photoBytes = downloadObject(handle);
            if (photoBytes != null && photoBytes.length > 2000) {
                Log.i(TAG, "✓ Sukses download foto: " + filename + " (" + (photoBytes.length / 1024) + " KB)");

                if (listener != null) {
                    listener.onStatusChanged("⚡ Memproses bingkai " + filename + " (" + (photoBytes.length / 1024) + " KB)...", true);
                }

                String base64 = "data:image/jpeg;base64," + Base64.encodeToString(photoBytes, Base64.NO_WRAP);

                if (listener != null) {
                    listener.onPhotoCaptured(filename, base64, photoBytes.length);
                    listener.onStatusChanged("✅ Foto " + filename + " berhasil masuk! Siap untuk jepretan berikutnya.", true);
                }
            } else {
                Log.w(TAG, "Data foto kosong untuk handle: " + handle);
                if (listener != null) {
                    listener.onStatusChanged("⚠ Kamera belum siap atau foto gagal ditarik (handle " + handle + ").", true);
                }
            }
        } catch (Exception e) {
            Log.e(TAG, "Error download foto: " + e.getMessage(), e);
            if (listener != null) {
                listener.onStatusChanged("⚠ Error unduh foto: " + e.getMessage(), true);
            }
        }
    }

    private void clearPendingInPipe() {
        if (connection == null || epIn == null) return;
        byte[] junk = new byte[2048];
        int count = 0;
        while (connection.bulkTransfer(epIn, junk, junk.length, 50) > 0) {
            count++;
            if (count > 20) break;
        }
    }

    private byte[] downloadObject(int handle) {
        for (int attempt = 1; attempt <= 3; attempt++) {
            byte[] data = downloadObjectOnce(handle);
            if (data != null && data.length > 2000) {
                return data;
            }
            Log.w(TAG, "Percobaan " + attempt + " unduh handle " + handle + " gagal, mencoba lagi...");
            try {
                Thread.sleep(350);
            } catch (InterruptedException ignored) {}
        }
        return null;
    }

    private byte[] downloadObjectOnce(int handle) {
        synchronized (usbLock) {
            if (connection == null || epOut == null || epIn == null) return null;
            clearPendingInPipe();

            byte[] cmd = createCommandPacket(OP_GET_OBJECT, transactionId++, handle);
            int sent = connection.bulkTransfer(epOut, cmd, cmd.length, 3000);
            if (sent <= 0) {
                Log.w(TAG, "Gagal mengirim OP_GET_OBJECT untuk handle: " + handle);
                return null;
            }

            ByteArrayOutputStream baos = new ByteArrayOutputStream();
            byte[] buffer = new byte[65536];

            int firstRead = connection.bulkTransfer(epIn, buffer, buffer.length, 6000);
            if (firstRead < 12) {
                Log.w(TAG, "First read terlalu pendek: " + firstRead);
                return null;
            }

            ByteBuffer bb = ByteBuffer.wrap(buffer, 0, firstRead).order(ByteOrder.LITTLE_ENDIAN);
            int totalLength = bb.getInt();
            short type = bb.getShort();
            short code = bb.getShort();

            Log.i(TAG, String.format("PTP GET_OBJECT info: totalLength=%d, type=%d, code=0x%04X, firstRead=%d", totalLength, type, (code & 0xFFFF), firstRead));

            if (type == TYPE_DATA) {
                baos.write(buffer, 12, firstRead - 12);
                int bytesToRead = totalLength - firstRead;

                while (bytesToRead > 0) {
                    int r = connection.bulkTransfer(epIn, buffer, Math.min(buffer.length, bytesToRead), 6000);
                    if (r <= 0) {
                        Log.w(TAG, "Stream bulkTransfer r=" + r + ", sisa=" + bytesToRead);
                        break;
                    }
                    baos.write(buffer, 0, r);
                    bytesToRead -= r;
                }

                // Consume final response container (RESP_OK)
                byte[] resp = new byte[64];
                connection.bulkTransfer(epIn, resp, resp.length, 2000);

                return baos.toByteArray();
            } else if (type == TYPE_RESPONSE) {
                Log.w(TAG, String.format("Kamera mengembalikan response container 0x%04X alih-alih data (Kemungkinan busy)", (code & 0xFFFF)));
            }

            return null;
        }
    }

    private byte[] createCommandPacket(short opCode, int txId, int... params) {
        int length = 12 + (params.length * 4);
        ByteBuffer bb = ByteBuffer.allocate(length).order(ByteOrder.LITTLE_ENDIAN);
        bb.putInt(length);
        bb.putShort(TYPE_COMMAND);
        bb.putShort(opCode);
        bb.putInt(txId);
        for (int p : params) {
            bb.putInt(p);
        }
        return bb.array();
    }
}
