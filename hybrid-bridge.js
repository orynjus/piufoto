/**
 * PIUFOTO HYBRID OFFLINE BRIDGE
 * 
 * Enables Piufoto to run 100% STANDALONE & OFFLINE inside Android (Capacitor)
 * without any 3rd party services (no Google Drive required, no PC Node.js required).
 * 
 * Capabilities:
 * 1. Automatic Fallback: Intercepts /api/* requests to IndexedDB when offline or running as APK.
 * 2. Native Storage: Integrates with @capacitor/filesystem to save photos to device's Pictures/Piufoto.
 * 3. Native Camera Hook: Integrates with @capacitor/camera if available.
 */

(function () {
  const DB_NAME = 'Piufoto_Offline_DB';
  const DB_VERSION = 1;
  let dbInstance = null;

  // Detect environment
  const isCapacitorNative = !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform());

  // Folder Normalization & Flexible Matching Helpers
  function normalizeFolderName(str) {
    if (!str) return '';
    return String(str).trim().toLowerCase().replace(/[\s_-]+/g, '');
  }

  function matchesFolder(folderA, folderB) {
    if (!folderA || !folderB) return true;
    const na = normalizeFolderName(folderA);
    const nb = normalizeFolderName(folderB);
    if (!na || !nb || na === 'all' || nb === 'all') return true;
    return na === nb;
  }

  // 1. Initialize IndexedDB
  function openDatabase() {
    return new Promise((resolve, reject) => {
      if (dbInstance) return resolve(dbInstance);
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = (e) => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains('folders')) {
          db.createObjectStore('folders', { keyPath: 'name' });
        }
        if (!db.objectStoreNames.contains('photos')) {
          const photoStore = db.createObjectStore('photos', { keyPath: 'id' });
          photoStore.createIndex('folder', 'folder', { unique: false });
        }
        if (!db.objectStoreNames.contains('meta')) {
          db.createObjectStore('meta', { keyPath: 'key' });
        }
      };
      req.onsuccess = (e) => {
        dbInstance = e.target.result;
        // Seed default folder if empty
        seedInitialData(dbInstance).then(() => resolve(dbInstance));
      };
      req.onerror = (e) => reject(e);
    });
  }

  async function seedInitialData(db) {
    const tx = db.transaction(['folders'], 'readwrite');
    const store = tx.objectStore('folders');
    return new Promise((resolve) => {
      const getReq = store.get('Sesi_01');
      getReq.onsuccess = () => {
        if (!getReq.result) {
          store.put({
            name: 'Sesi_01',
            displayName: 'Sesi 01',
            createdAt: Date.now(),
            count: 0
          });
        }
        resolve();
      };
      getReq.onerror = () => resolve();
    });
  }

  // Database Helpers
  async function dbGetFolders() {
    const db = await openDatabase();
    return new Promise((resolve) => {
      const tx = db.transaction(['folders', 'photos'], 'readonly');
      const folderStore = tx.objectStore('folders');
      const photoStore = tx.objectStore('photos');
      const req = folderStore.getAll();
      req.onsuccess = () => {
        const folders = req.result || [];
        const photoReq = photoStore.getAll();
        photoReq.onsuccess = () => {
          const allPhotos = photoReq.result || [];
          const counts = {};
          allPhotos.forEach(p => {
            const nf = normalizeFolderName(p.folder) || 'sesi01';
            counts[nf] = (counts[nf] || 0) + 1;
          });

          const knownNorms = new Set();
          const mapped = folders.map(f => {
            const nf = normalizeFolderName(f.name);
            knownNorms.add(nf);
            const cnt = counts[nf] || (allPhotos.length > 0 && (nf === 'sesi01' || folders.length === 1) ? allPhotos.length : 0);
            return {
              name: f.name,
              displayName: f.displayName || f.name.replace(/_/g, ' '),
              photoCount: cnt,
              count: cnt,
              createdAt: f.createdAt || Date.now()
            };
          });

          // Auto-discover folders from photos if any photo has a different folder
          allPhotos.forEach(p => {
            const nf = normalizeFolderName(p.folder);
            if (nf && !knownNorms.has(nf)) {
              knownNorms.add(nf);
              const folderName = p.folder || 'Sesi_01';
              mapped.push({
                name: folderName,
                displayName: folderName.replace(/_/g, ' '),
                photoCount: counts[nf] || 1,
                count: counts[nf] || 1,
                createdAt: p.date || Date.now()
              });
            }
          });

          if (mapped.length === 0) {
            mapped.push({
              name: 'Sesi_01',
              displayName: 'Sesi 01',
              photoCount: allPhotos.length,
              count: allPhotos.length,
              createdAt: Date.now()
            });
          }

          resolve(mapped);
        };
        photoReq.onerror = () => resolve(folders);
      };
      req.onerror = () => resolve([]);
    });
  }

  async function dbAddFolder(name) {
    const db = await openDatabase();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(['folders'], 'readwrite');
      const store = tx.objectStore('folders');
      const safeName = name.replace(/[^a-zA-Z0-9_\-\s]/g, '').trim().replace(/\s+/g, '_');
      const item = {
        name: safeName,
        displayName: safeName.replace(/_/g, ' '),
        createdAt: Date.now(),
        count: 0
      };
      const req = store.put(item);
      req.onsuccess = () => resolve(item);
      req.onerror = (e) => reject(e);
    });
  }

  async function dbRenameFolder(oldName, newName) {
    const db = await openDatabase();
    const safeNew = newName.replace(/[^a-zA-Z0-9_\-\s]/g, '').trim().replace(/\s+/g, '_');
    return new Promise((resolve) => {
      const tx = db.transaction(['folders', 'photos'], 'readwrite');
      const fStore = tx.objectStore('folders');
      const pStore = tx.objectStore('photos');

      fStore.get(oldName).onsuccess = (e) => {
        const oldItem = e.target.result;
        if (oldItem) {
          fStore.delete(oldName);
          fStore.put({
            name: safeNew,
            displayName: safeNew.replace(/_/g, ' '),
            createdAt: oldItem.createdAt || Date.now(),
            count: oldItem.count || 0
          });
        }
        // Update photos
        const pReq = pStore.getAll();
        pReq.onsuccess = () => {
          const photos = pReq.result || [];
          photos.forEach(p => {
            if (matchesFolder(p.folder, oldName)) {
              pStore.delete(p.id);
              p.folder = safeNew;
              p.id = safeNew + '/' + p.name;
              pStore.put(p);
            }
          });
          resolve({ ok: true, status: 'success', oldName, newName: safeNew, folder: safeNew, displayName: safeNew.replace(/_/g, ' ') });
        };
      };
    });
  }

  async function dbDeleteFolder(name) {
    const db = await openDatabase();
    return new Promise((resolve) => {
      const tx = db.transaction(['folders', 'photos'], 'readwrite');
      const fStore = tx.objectStore('folders');
      const pStore = tx.objectStore('photos');
      fStore.delete(name);
      const pReq = pStore.getAll();
      pReq.onsuccess = () => {
        const photos = pReq.result || [];
        photos.forEach(p => {
          if (matchesFolder(p.folder, name)) {
            pStore.delete(p.id);
          }
        });
        resolve({ ok: true });
      };
    });
  }

  async function dbGetPhotos(folder) {
    const db = await openDatabase();
    return new Promise((resolve) => {
      const tx = db.transaction(['photos'], 'readonly');
      const store = tx.objectStore('photos');
      const req = store.getAll();
      req.onsuccess = () => {
        const all = req.result || [];
        const isAllFolder = !folder || folder === 'all' || normalizeFolderName(folder) === 'all';
        let filtered = all.filter(p => isAllFolder || matchesFolder(p.folder, folder));

        // Safety fallback: if no photos matched folder but all has photos,
        // and folder is default session or empty, return all photos so user never sees empty gallery!
        if (filtered.length === 0 && all.length > 0) {
          const normReq = normalizeFolderName(folder);
          if (!normReq || normReq === 'sesi01' || normReq === 'sesi1') {
            filtered = all;
          }
        }

        const mapped = filtered
          .map(p => ({
            id: p.id || ((p.folder || 'Sesi_01') + '/' + p.name),
            name: p.name,
            url: p.dataUrl,
            size: p.size || 0,
            time: p.time || '',
            timestamp: p.date || p.timestamp || Date.now()
          }))
          .sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
        resolve(mapped);
      };
      req.onerror = () => resolve([]);
    });
  }

  async function dbSavePhoto(folder, filename, dataUrl) {
    const db = await openDatabase();
    // Also save to Capacitor Filesystem if available
    trySaveToDeviceStorage(folder, filename, dataUrl);

    return new Promise((resolve, reject) => {
      const tx = db.transaction(['photos'], 'readwrite');
      const store = tx.objectStore('photos');
      const item = {
        id: folder + '/' + filename,
        folder: folder,
        name: filename,
        dataUrl: dataUrl,
        size: Math.round(dataUrl.length * 0.75),
        time: new Date().toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
        date: Date.now()
      };
      const req = store.put(item);
      req.onsuccess = () => {
        // Broadcast instant storage event for other open pages/tabs
        try {
          localStorage.setItem('piufoto_photo_added_event', JSON.stringify({
            action: 'upload',
            folder: folder,
            filename: filename,
            time: Date.now()
          }));
        } catch (e) {}
        resolve(item);
      };
      req.onerror = (e) => reject(e);
    });
  }

  async function dbDeletePhoto(folder, filename) {
    const db = await openDatabase();
    return new Promise((resolve) => {
      const tx = db.transaction(['photos'], 'readwrite');
      const store = tx.objectStore('photos');
      const req = store.getAll();
      req.onsuccess = () => {
        const all = req.result || [];
        all.forEach(p => {
          if (p.name === filename && matchesFolder(p.folder, folder)) {
            store.delete(p.id);
          }
        });
        store.delete(folder + '/' + filename);
        try {
          localStorage.setItem('piufoto_photo_added_event', JSON.stringify({
            action: 'delete',
            folder: folder,
            filename: filename,
            time: Date.now()
          }));
        } catch (e) {}
        resolve({ ok: true });
      };
      req.onerror = () => resolve({ ok: true });
    });
  }

  // 2. Capacitor Native Filesystem Bridge (optional copy to Android Pictures)
  async function trySaveToDeviceStorage(folder, filename, base64Data) {
    try {
      if (window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.Filesystem) {
        const Filesystem = window.Capacitor.Plugins.Filesystem;
        const pureBase64 = base64Data.replace(/^data:image\/\w+;base64,/, '');
        await Filesystem.writeFile({
          path: `Piufoto/${folder}/${filename}`,
          data: pureBase64,
          directory: 'DOCUMENTS',
          recursive: true
        });
        console.log(`[PIUFOTO HYBRID] Saved to Android device storage: Piufoto/${folder}/${filename}`);
      }
    } catch (e) {
      console.warn('[PIUFOTO HYBRID] Filesystem save note:', e);
    }
  }

  // 3. API Interceptor
  let serverCheckDone = false;
  let hasServerRunning = false;

  async function checkServerAvailability() {
    if (serverCheckDone) return hasServerRunning;
    if (isCapacitorNative) {
      hasServerRunning = false;
      serverCheckDone = true;
      return false;
    }
    try {
      const controller = new AbortController();
      const id = setTimeout(() => controller.abort(), 900);
      const res = await originalFetch('/api/info', { signal: controller.signal });
      clearTimeout(id);
      hasServerRunning = res.ok;
    } catch (e) {
      hasServerRunning = false;
    }
    serverCheckDone = true;
    return hasServerRunning;
  }

  async function handleLocalApi(url, init = {}) {
    const method = (init.method || 'GET').toUpperCase();
    const parsedUrl = new URL(url, window.location.origin);
    const pathname = parsedUrl.pathname;
    const params = parsedUrl.searchParams;

    // Helper JSON response
    const jsonResponse = (data, status = 200) => {
      return new Response(JSON.stringify(data), {
        status: status,
        headers: { 'Content-Type': 'application/json' }
      });
    };

    // Routing
    if (pathname === '/api/info') {
      const savedPublicUrl = localStorage.getItem('piufoto_public_base_url');
      const publicBaseUrl = (savedPublicUrl && !savedPublicUrl.includes('localhost')) 
        ? savedPublicUrl 
        : 'https://foto.berkisahkita.web.id';
      return jsonResponse({
        ok: true,
        isHybrid: true,
        isNativePlatform: isCapacitorNative,
        mode: 'standalone_offline',
        publicBaseUrl: publicBaseUrl
      });
    }

    if (pathname === '/api/folders') {
      if (method === 'GET') {
        const folders = await dbGetFolders();
        return jsonResponse({ ok: true, folders: folders });
      }
      if (method === 'POST') {
        let body = {};
        try { body = JSON.parse(init.body); } catch (e) {}
        const name = body.name || `Sesi_${Date.now()}`;
        const created = await dbAddFolder(name);
        return jsonResponse({ ok: true, status: 'success', folder: created.name });
      }
    }

    if (pathname === '/api/folders/rename') {
      if (method === 'POST') {
        let body = {};
        try { body = JSON.parse(init.body); } catch (e) {}
        const res = await dbRenameFolder(body.oldName, body.newName);
        return jsonResponse(res);
      }
    }

    if (pathname.startsWith('/api/folders/')) {
      if (method === 'DELETE') {
        const folderName = decodeURIComponent(pathname.replace('/api/folders/', ''));
        await dbDeleteFolder(folderName);
        return jsonResponse({ ok: true, message: `Folder ${folderName} dihapus` });
      }
    }

    if (pathname === '/api/active-folder') {
      if (method === 'POST') {
        let body = {};
        try { body = JSON.parse(init.body); } catch (e) {}
        if (body.folder) {
          localStorage.setItem('piufoto_active_folder', body.folder);
        }
        return jsonResponse({ ok: true, activeFolder: body.folder });
      }
    }

    if (pathname === '/api/photos') {
      const folderParam = params.get('folder');
      const folder = (folderParam !== null && folderParam !== undefined && folderParam !== '') 
        ? folderParam 
        : (localStorage.getItem('piufoto_active_folder') || 'Sesi_01');
      if (method === 'GET') {
        const photos = await dbGetPhotos(folder);
        const resolvedFolder = folder || (photos.length > 0 && photos[0].folder ? photos[0].folder : 'Sesi_01');
        return jsonResponse({
          ok: true,
          status: 'success',
          folder: resolvedFolder,
          displayName: resolvedFolder.replace(/_/g, ' '),
          photos: photos
        });
      }
      if (method === 'DELETE') {
        const filename = params.get('file');
        await dbDeletePhoto(folder, filename);
        return jsonResponse({ ok: true, status: 'success', deleted: filename });
      }
    }

    if (pathname === '/api/upload') {
      if (method === 'POST') {
        let body = {};
        try { body = JSON.parse(init.body); } catch (e) {}
        const folder = body.folder || 'Sesi_01';
        const filename = body.filename || `foto_${Date.now()}.jpg`;
        const dataUrl = body.image || '';
        await dbSavePhoto(folder, filename, dataUrl);

        // Langsung unggah ke Google Drive dari tablet jika webhook disetel (100% tanpa laptop)
        let gdriveStatus = null;
        if (body.googleDriveWebhook && body.googleDriveWebhook.startsWith('http')) {
          gdriveStatus = { ok: true, status: 'uploading' };
          (async () => {
            try {
              let pureBase64 = dataUrl;
              if (pureBase64.includes(',')) pureBase64 = pureBase64.split(',')[1];
              const gres = await originalFetch(body.googleDriveWebhook, {
                method: 'POST',
                headers: { 'Content-Type': 'text/plain' },
                body: JSON.stringify({
                  action: 'upload',
                  image: pureBase64,
                  fileName: filename,
                  folderName: folder,
                  rootFolderName: body.rootFolderName || '',
                  parentFolderId: body.parentFolderId || ''
                })
              });
              const gdata = await gres.json();
              console.log('[HYBRID GDRIVE] Hasil upload langsung dari tablet:', gdata);
              if (gdata && gdata.folderUrl) {
                localStorage.setItem(`gdrive_url_${folder}`, gdata.folderUrl);
                const actEl = document.getElementById('upload-activity-status');
                if (actEl) actEl.innerText = `✓ ${filename} berhasil terunggah ke Google Drive!`;
              }
            } catch (gerr) {
              console.warn('[HYBRID GDRIVE] Gagal upload langsung dari tablet:', gerr);
            }
          })();
        }

        return jsonResponse({
          ok: true,
          filename: filename,
          url: dataUrl,
          gdrive: gdriveStatus,
          message: 'Foto tersimpan di tablet' + (gdriveStatus ? ' dan disinkronkan ke Google Drive!' : '!')
        });
      }
    }

    if (pathname === '/api/test-webhook') {
      let body = {};
      try { body = JSON.parse(init.body); } catch (e) {}
      if (body.webhookUrl && body.webhookUrl.startsWith('http')) {
        try {
          const testRes = await originalFetch(body.webhookUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'text/plain' },
            body: JSON.stringify({
              action: 'create_folder',
              folderName: body.folderName || 'Sesi 01',
              rootFolderName: body.rootFolderName || '',
              parentFolderId: body.parentFolderId || ''
            })
          });
          const testData = await testRes.json();
          if (testData && testData.status === 'success') {
            return jsonResponse({
              ok: true,
              folderUrl: testData.folderUrl,
              message: 'Sukses terhubung langsung dari tablet ke Google Drive!'
            });
          } else {
            return jsonResponse({
              ok: false,
              message: testData.message || 'Google Apps Script tidak mengembalikan folderUrl'
            });
          }
        } catch (e) {
          return jsonResponse({ ok: false, message: e.message });
        }
      }
      return jsonResponse({
        ok: true,
        message: 'Mode Hybrid Offline Aktif (Foto tersimpan langsung di tablet Android)'
      });
    }

    return jsonResponse({ ok: false, error: 'Endpoint not implemented in offline bridge' }, 404);
  }

  // 4. Monkey patch fetch
  const originalFetch = window.fetch;
  window.fetch = async function (input, init) {
    let url = typeof input === 'string' ? input : (input && input.url ? input.url : '');

    if (url.startsWith('/api/')) {
      const hasServer = await checkServerAvailability();
      if (!hasServer) {
        return handleLocalApi(url, init);
      }
      try {
        const resp = await originalFetch(input, init);
        if (!resp.ok && resp.status >= 500) {
          return handleLocalApi(url, init);
        }
        return resp;
      } catch (err) {
        // Fallback on network fail
        return handleLocalApi(url, init);
      }
    }

    return originalFetch(input, init);
  };

  // 5. USB Tether Camera Realtime Listener (Nikon D7000 & Fujifilm X-T2)
  function initUsbTetherListener() {
    if (!window.Capacitor || !window.Capacitor.Plugins || !window.Capacitor.Plugins.UsbTether) {
      return;
    }
    const UsbTether = window.Capacitor.Plugins.UsbTether;

    // Listen for photo captured from Nikon / Fujifilm
    UsbTether.addListener('photoCaptured', async (data) => {
      console.log('⚡ [USB TETHER] Foto baru masuk otomatis dari kamera:', data.filename, data.size);
      const actEl = document.getElementById('upload-activity-status');
      if (actEl) actEl.innerText = `⚡ [USB TETHER] Foto baru masuk: ${data.filename}... Memasang bingkai!`;

      try {
        // Convert Base64 data URL to Blob
        const fetchRes = await fetch(data.base64);
        const blob = await fetchRes.blob();
        blob.name = data.filename;

        // Auto Frame & Save
        if (typeof window.uploadPhotoWithFrameToGoogleDrive === 'function') {
          await window.uploadPhotoWithFrameToGoogleDrive(blob);
        }
      } catch (err) {
        console.error('[USB TETHER] Gagal proses jepretan:', err);
      }
    });

    function updateUsbUI(status) {
      const topBtn = document.getElementById('top-btn-usb-tether');
      const topText = document.getElementById('top-usb-status-text');
      const mainBtn = document.getElementById('btn-usb-tether');
      const mainLabel = document.getElementById('btn-usb-tether-label');
      const otgStatus = document.getElementById('otg-tether-status');

      if (status.connected) {
        const title = `✅ ${status.cameraName || 'Kamera'} Terhubung`;
        if (topText) topText.innerText = title;
        if (topBtn) {
          topBtn.style.background = 'rgba(16, 185, 129, 0.25)';
          topBtn.style.borderColor = '#10b981';
          topBtn.style.color = '#6ee7b7';
        }
        if (mainLabel) mainLabel.innerText = title;
        if (mainBtn) {
          mainBtn.style.background = 'linear-gradient(135deg, #059669, #10b981)';
          mainBtn.style.borderColor = '#34d399';
        }
        if (otgStatus) {
          otgStatus.classList.add('active');
          otgStatus.innerHTML = `<span>●</span> USB Tether: ${status.cameraName || 'Kamera'} Aktif`;
        }
      } else {
        if (topText) topText.innerText = '📷 Sambung USB Kamera';
        if (topBtn) {
          topBtn.style.background = 'rgba(37, 99, 235, 0.2)';
          topBtn.style.borderColor = 'rgba(59, 130, 246, 0.5)';
          topBtn.style.color = '#93c5fd';
        }
        if (mainLabel) mainLabel.innerText = '⚡ Sambungkan USB Kamera';
        if (mainBtn) {
          mainBtn.style.background = 'linear-gradient(135deg, #1d4ed8, #2563eb)';
          mainBtn.style.borderColor = '#60a5fa';
        }
      }
    }

    // Listen for connection status changes
    UsbTether.addListener('statusChanged', (status) => {
      console.log('📷 [USB TETHER STATUS]', status);
      updateUsbUI(status);
      if (status && status.message) {
        const actEl = document.getElementById('upload-activity-status');
        if (actEl) actEl.innerText = status.message;
      }
    });

    async function triggerUsbScan() {
      const mainLabel = document.getElementById('btn-usb-tether-label');
      const topText = document.getElementById('top-usb-status-text');
      if (mainLabel) mainLabel.innerText = '⏳ Memindai port USB...';
      if (topText) topText.innerText = '⏳ Memindai...';

      try {
        const res = await UsbTether.startListening();
        updateUsbUI(res);
        if (res.connected) {
          alert(`✅ Kamera Terhubung!\nModel: ${res.cameraName}\nSiap memotret! Setiap jepretan kamera fisik akan langsung masuk ke Piufoto dengan bingkai.`);
        } else {
          let msg = `🔍 HASIL SCAN USB OTG (Terdeteksi: ${res.deviceCount || 0} perangkat)\n\n`;
          if (res.deviceList && res.deviceList.length > 0) {
            msg += `Daftar Perangkat Terdeteksi:\n`;
            res.deviceList.forEach(d => {
              msg += `• ${d.productName || 'Perangkat'} (VID: ${d.vendorId}, PID: ${d.productId})\n`;
            });
            msg += `\nJika kamera Anda ada di daftar atas, coba cabut dan tancapkan kembali kabelnya agar izin akses USB muncul di layar.`;
          } else {
            msg += `Sistem Android Belum Mendeteksi Perangkat Apapun pada Port OTG.\n\n` +
                   `Langkah Pemeriksaan Penting:\n` +
                   `1. AKTIFKAN KONEKSI OTG:\n` +
                   `   Buka Pengaturan HP/Tablet ➔ Cari "OTG" ➔ Nyalakan sakelar "Koneksi OTG". (Pada Oppo/Vivo/Realme/dll fitur ini otomatis mati sendiri jika tidak dipakai).\n\n` +
                   `2. PASTIKAN KAMERA ON & BANGUN DARI SLEEP:\n` +
                   `   Sakelar kamera dalam posisi ON. Tekan setengah tombol shutter kamera jika kamera sedang standby/sleep.\n\n` +
                   `3. UNTUK FUJIFILM X-T2:\n` +
                   `   Menu ➔ Connection Setting ➔ PC Connection Mode ➔ Ubah ke "USB TETHERED SHOOTING AUTO".\n\n` +
                   `4. KABEL / ADAPTER OTG:\n` +
                   `   Pastikan adapter OTG Type-C mendukung jalur transfer data, bukan hanya pengisian daya.`;
          }
          alert(msg);
        }
      } catch (e) {
        alert('Gagal scan USB: ' + e.message);
      }
    }

    const mainBtn = document.getElementById('btn-usb-tether');
    if (mainBtn) mainBtn.addEventListener('click', triggerUsbScan);

    const topBtn = document.getElementById('top-btn-usb-tether');
    if (topBtn) topBtn.addEventListener('click', triggerUsbScan);

    // Initial check
    UsbTether.startListening().then(res => {
      updateUsbUI(res);
    }).catch(e => console.warn('UsbTether start error:', e));
  }

  // Auto initialize on DOM ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initUsbTetherListener);
  } else {
    setTimeout(initUsbTetherListener, 400);
  }

  // Fallback click listener for web/browser environment
  function setupWebFallback() {
    if (!window.Capacitor || !window.Capacitor.Plugins || !window.Capacitor.Plugins.UsbTether) {
      const fallbackHandler = () => {
        alert("Fitur USB Tethering langsung via kabel USB OTG aktif saat aplikasi dijalankan di tablet Android (file APK).\n\nPada browser laptop/PC, silakan gunakan fitur Live Viewfinder (HDMI Capture Card) atau 'Pantau Folder Kamera OTG'.");
      };
      const mainBtn = document.getElementById('btn-usb-tether');
      if (mainBtn) mainBtn.addEventListener('click', fallbackHandler);
      const topBtn = document.getElementById('top-btn-usb-tether');
      if (topBtn) topBtn.addEventListener('click', fallbackHandler);
    }
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', setupWebFallback);
  } else {
    setTimeout(setupWebFallback, 600);
  }

  // Global Helper: Batch process native photos from Native Plugin
  window.processBatchNativePhotos = async function(photos) {
    if (!photos || !photos.length) return;
    const actEl = document.getElementById('upload-activity-status');
    for (let i = 0; i < photos.length; i++) {
      const item = photos[i];
      if (actEl) actEl.innerText = `⏳ Memasang bingkai (${i + 1}/${photos.length}): ${item.filename}...`;
      try {
        const res = await fetch(item.base64);
        const blob = await res.blob();
        blob.name = item.filename;
        if (typeof window.uploadPhotoWithFrameToGoogleDrive === 'function') {
          await window.uploadPhotoWithFrameToGoogleDrive(blob);
        }
      } catch (err) {
        console.error('Gagal memasang bingkai foto:', err);
      }
    }
    if (actEl) actEl.innerText = `✓ Selesai memproses ${photos.length} foto!`;
  };

  window.pickNativePhotos = async function() {
    if (window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.UsbTether && window.Capacitor.Plugins.UsbTether.pickPhotosFromStorage) {
      const res = await window.Capacitor.Plugins.UsbTether.pickPhotosFromStorage();
      if (res && res.photos && res.photos.length > 0) {
        await window.processBatchNativePhotos(res.photos);
        return true;
      }
    }
    return false;
  };

  window.pickNativeFolder = async function() {
    if (window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.UsbTether && window.Capacitor.Plugins.UsbTether.pickFolderFromStorage) {
      const res = await window.Capacitor.Plugins.UsbTether.pickFolderFromStorage();
      if (res && res.photos && res.photos.length > 0) {
        await window.processBatchNativePhotos(res.photos);
        return true;
      }
    }
    return false;
  };

  // Provide global status flag
  window.PIUFOTO_HYBRID = {
    isNative: isCapacitorNative,
    version: '2.2.0-hybrid'
  };

  console.log('⚡ [PIUFOTO] Hybrid Offline Storage Bridge Initialized.');
})();
