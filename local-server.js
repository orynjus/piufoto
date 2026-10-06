const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');

const SESSION_SECRET = 'piufoto-secret-salt-2026';
const CIPHER_KEY = crypto.scryptSync(SESSION_SECRET, 'piufoto_salt', 32);

function encryptSessionToken(folder, theme = 'wedding') {
  try {
    const cipher = crypto.createCipheriv('aes-256-cbc', CIPHER_KEY, Buffer.alloc(16, 0));
    const payload = JSON.stringify({ f: folder, t: theme });
    let enc = cipher.update(payload, 'utf8', 'hex');
    enc += cipher.final('hex');
    return enc;
  } catch(e) {
    return Buffer.from(folder).toString('hex');
  }
}

function decryptSessionToken(token) {
  if (!token) return null;
  try {
    const decipher = crypto.createDecipheriv('aes-256-cbc', CIPHER_KEY, Buffer.alloc(16, 0));
    let dec = decipher.update(token, 'hex', 'utf8');
    dec += decipher.final('utf8');
    return JSON.parse(dec);
  } catch(e) {
    try {
      const raw = Buffer.from(token, 'hex').toString('utf8');
      if (raw && !raw.includes('\0')) return { f: raw };
    } catch(err) {}
    return null;
  }
}

let lastPublicBaseUrl = '';

function detectPublicBaseUrl() {
  if (lastPublicBaseUrl) return lastPublicBaseUrl;
  try {
    const customFile = path.join(__dirname, 'tunnel_url.txt');
    if (fs.existsSync(customFile)) {
      const u = fs.readFileSync(customFile, 'utf8').trim();
      if (u.startsWith('http')) {
        lastPublicBaseUrl = u.replace(/\/+$/, '');
        return lastPublicBaseUrl;
      }
    }
    const logFile = path.join(__dirname, 'cloudflared.log');
    if (fs.existsSync(logFile)) {
      const content = fs.readFileSync(logFile, 'utf8');
      const matches = content.match(/https:\/\/[a-zA-Z0-9-]+\.trycloudflare\.com/g);
      if (matches && matches.length > 0) {
        lastPublicBaseUrl = matches[matches.length - 1];
        return lastPublicBaseUrl;
      }
    }
  } catch(e) {}
  return '';
}

const PORT = process.env.PORT || 3000;
const BASE_GALLERY_DIR = process.env.VERCEL
  ? path.join(os.tmpdir(), 'gallery-photos')
  : path.join(__dirname, 'gallery-photos');

// Ensure base gallery directory exists (safely handle read-only environments like Vercel)
const DEFAULT_FOLDER = 'Sesi_01';
const defaultFolderPath = path.join(BASE_GALLERY_DIR, DEFAULT_FOLDER);

try {
  if (!fs.existsSync(BASE_GALLERY_DIR)) {
    fs.mkdirSync(BASE_GALLERY_DIR, { recursive: true });
  }
  if (!fs.existsSync(defaultFolderPath)) {
    fs.mkdirSync(defaultFolderPath, { recursive: true });
  }
} catch (err) {
  console.warn("Could not create local gallery dir:", err.message);
}

const MIME_TYPES = {
  '.html': 'text/html',
  '.css': 'text/css',
  '.js': 'text/javascript',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon'
};

function getLocalIp() {
  try {
    const interfaces = os.networkInterfaces();
    if (!interfaces) return 'localhost';
    for (const name of Object.keys(interfaces)) {
      const ifaces = interfaces[name] || [];
      for (const net of ifaces) {
        if (net && net.family === 'IPv4' && !net.internal) {
          return net.address;
        }
      }
    }
  } catch (err) {}
  return 'localhost';
}

function sanitizeFolderName(name) {
  return (name || 'Sesi_01').replace(/[^a-zA-Z0-9_\-\s]/g, '').trim().replace(/\s+/g, '_') || 'Sesi_01';
}

function getAndroidGalleryDir(folder = '') {
  try {
    const homeDir = os.homedir();
    const candidateBases = [
      path.join(homeDir, 'storage', 'dcim', 'Piufoto'),
      path.join(homeDir, 'storage', 'shared', 'DCIM', 'Piufoto'),
      path.join(homeDir, 'storage', 'pictures', 'Piufoto'),
      '/sdcard/DCIM/Piufoto',
      '/storage/emulated/0/DCIM/Piufoto'
    ];
    for (const base of candidateBases) {
      const parentDir = path.dirname(base);
      if (fs.existsSync(parentDir)) {
        return folder ? path.join(base, folder) : base;
      }
    }
  } catch (err) {}
  return null;
}

function syncToAndroidGallery(sourcePath, folder, filename) {
  try {
    const targetDir = getAndroidGalleryDir(folder);
    if (!targetDir) return false;

    if (!fs.existsSync(targetDir)) {
      fs.mkdirSync(targetDir, { recursive: true });
    }

    const destPath = path.join(targetDir, filename);
    fs.copyFileSync(sourcePath, destPath);
    console.log(`[GALERI HP] ✓ Foto berhasil disinkronkan ke Galeri HP: ${destPath}`);

    // Pindai media agar langsung muncul di aplikasi Galeri Android
    try {
      const { exec } = require('child_process');
      exec(`termux-media-scan "${destPath}"`, () => {});
    } catch (e) {}
    return true;
  } catch (err) {
    console.warn(`[GALERI HP] Gagal sinkron ke galeri HP:`, err.message);
    return false;
  }
}

function deleteFromAndroidGallery(folder, filename) {
  try {
    const targetDir = getAndroidGalleryDir(folder);
    if (!targetDir) return;
    const destPath = path.join(targetDir, filename);
    if (fs.existsSync(destPath)) {
      fs.unlinkSync(destPath);
      try {
        const { exec } = require('child_process');
        exec(`termux-media-scan "${destPath}"`, () => {});
      } catch (e) {}
    }
  } catch (e) {}
}

function deleteFolderFromAndroidGallery(folder) {
  try {
    const targetDir = getAndroidGalleryDir(folder);
    if (!targetDir) return;
    if (fs.existsSync(targetDir)) {
      fs.rmSync(targetDir, { recursive: true, force: true });
    }
  } catch (e) {}
}

let currentActiveFolder = DEFAULT_FOLDER;
let serverSettings = {};
const SETTINGS_FILE = path.join(BASE_GALLERY_DIR, 'server_settings.json');
try {
  if (fs.existsSync(SETTINGS_FILE)) {
    serverSettings = JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8'));
  }
} catch (e) {}

// ==========================================
// HIGH PERFORMANCE IN-MEMORY CACHE & ETags
// ==========================================
let foldersCache = {
  data: null,
  jsonString: '',
  etag: '',
  updatedAt: 0
};

const photosCacheMap = new Map(); // folderKey -> { jsonString, etag, updatedAt }

function invalidateServerCache(folder) {
  foldersCache.updatedAt = 0;
  if (folder) {
    photosCacheMap.delete(folder);
    for (const key of Array.from(photosCacheMap.keys())) {
      if (key === folder || key.startsWith(`${folder}_`)) {
        photosCacheMap.delete(key);
      }
    }
  } else {
    photosCacheMap.clear();
  }
}

// ==========================================
// REALTIME PUSH ENGINE: SERVER-SENT EVENTS (SSE)
// ==========================================
const sseClients = new Set();

function broadcastEvent(eventData) {
  if (sseClients.size === 0) return;
  const payload = `data: ${JSON.stringify(eventData)}\n\n`;
  for (const client of Array.from(sseClients)) {
    try {
      client.res.write(payload);
    } catch (e) {
      sseClients.delete(client);
    }
  }
}

// Keep-Alive Heartbeat every 15s to prevent tunnel / mobile timeout
const heartbeatTimer = setInterval(() => {
  if (sseClients.size === 0) return;
  for (const client of Array.from(sseClients)) {
    try {
      client.res.write(': ping\n\n');
    } catch (e) {
      sseClients.delete(client);
    }
  }
}, 15000);
if (heartbeatTimer && heartbeatTimer.unref) {
  heartbeatTimer.unref();
}

const processedFujiFiles = new Set();
let fujiWatcherStarted = false;

function startFujifilmWatcher() {
  if (fujiWatcherStarted) return;
  fujiWatcherStarted = true;

  const homeDir = os.homedir();
  const getCandidateDirs = () => {
    const list = [
      path.join(homeDir, 'storage', 'dcim', 'Fujifilm'),
      path.join(homeDir, 'storage', 'dcim', '100_FUJI'),
      path.join(homeDir, 'storage', 'dcim', 'Camera'),
      path.join(homeDir, 'storage', 'pictures', 'Fujifilm'),
      path.join(homeDir, 'storage', 'shared', 'DCIM', 'Fujifilm'),
      path.join(homeDir, 'storage', 'shared', 'DCIM', '100_FUJI'),
      '/sdcard/DCIM/Fujifilm',
      '/sdcard/DCIM/100_FUJI',
      '/storage/emulated/0/DCIM/Fujifilm'
    ];
    if (process.env.FUJI_WATCH_DIR) {
      list.unshift(process.env.FUJI_WATCH_DIR);
    }
    if (serverSettings.watchFolder) {
      list.unshift(serverSettings.watchFolder);
    }
    return list;
  };

  // Fast polling watcher (650ms for snappy instant detection)
  setInterval(() => {
    try {
      const candidateDirs = getCandidateDirs();
      for (const dir of candidateDirs) {
        if (!fs.existsSync(dir)) continue;

        let files = [];
        try {
          files = fs.readdirSync(dir).filter(f => /\.(jpe?g|png)$/i.test(f));
        } catch (e) { continue; }

        for (const file of files) {
          const fullSrc = path.join(dir, file);
          let stat;
          try {
            stat = fs.statSync(fullSrc);
          } catch(e) { continue; }

          if (!stat || stat.size === 0) continue;

          const fileKey = `${file}_${stat.size}`;
          if (processedFujiFiles.has(fileKey)) continue;

          // Target folder in Piufoto
          const targetSessionDir = path.join(BASE_GALLERY_DIR, currentActiveFolder);
          if (!fs.existsSync(targetSessionDir)) {
            fs.mkdirSync(targetSessionDir, { recursive: true });
          }

          const targetFile = path.join(targetSessionDir, file);

          if (fs.existsSync(targetFile)) {
            processedFujiFiles.add(fileKey);
            continue;
          }

          // Copy file into active Piufoto session
          try {
            fs.copyFileSync(fullSrc, targetFile);
            processedFujiFiles.add(fileKey);

            console.log(`\n📸 [AUTO-FUJI] Foto baru dari kamera terdeteksi: ${file}`);
            console.log(`   ➡️ Otomatis masuk ke sesi [${currentActiveFolder}]`);

            // Sync to Android Gallery DCIM/Piufoto
            syncToAndroidGallery(targetFile, currentActiveFolder, file);

            // Broadcast Instant Realtime Event to all phones & dashboard
            broadcastEvent({
              type: 'new_photo',
              folder: currentActiveFolder,
              filename: file,
              url: `/gallery-photos/${encodeURIComponent(currentActiveFolder)}/${encodeURIComponent(file)}`,
              timestamp: Date.now()
            });
            invalidateServerCache(currentActiveFolder);
          } catch(copyErr) {
            console.warn("Gagal menyalin file auto-fuji:", copyErr.message);
          }
        }
      }
    } catch (err) {}
  }, 650);
}

const requestHandler = (req, res) => {
  try {
    const parsedUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    const pathname = parsedUrl.pathname;
    const searchParams = parsedUrl.searchParams;

  // CORS Headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  // API SSE: Realtime Push Notifications
  if (pathname === '/api/events' && req.method === 'GET') {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      'Access-Control-Allow-Origin': '*',
      'X-Accel-Buffering': 'no'
    });
    res.write(': connected\n\n');

    const client = { res, req };
    sseClients.add(client);

    req.on('close', () => {
      sseClients.delete(client);
    });
    return;
  }

  const localIp = getLocalIp();
  const host = req.headers.host || `${localIp}:${PORT}`;
  const proto = (req.headers['x-forwarded-proto'] || 'http');
  const baseUrl = `${proto}://${host}`;

  const isCloudflare = !!req.headers['cf-connecting-ip'];
  const hostName = host.split(':')[0].toLowerCase();
  const isLocalHost = (hostName === 'localhost' || hostName === '127.0.0.1' || hostName === localIp || hostName === '::1');
  const isGuestFromTunnel = isCloudflare || !isLocalHost;

  if (isGuestFromTunnel && !hostName.includes('localhost') && !hostName.includes('127.0.0.1')) {
    lastPublicBaseUrl = `${proto}://${host}`;
  }

  // 1. BLOKIR TAMU AGAR TIDAK BISA MASUK DASHBOARD UTAMA:
  // Tamu dari internet yang mencoba membuka / atau /index.html otomatis dilempar ke /gallery.html
  if (isGuestFromTunnel && (pathname === '/' || pathname === '/index.html')) {
    if (!searchParams.has('admin')) {
      res.writeHead(302, { 'Location': '/gallery.html' });
      res.end();
      return;
    }
  }

  // 2. AKSES KHUSUS ADMIN VIA TUNNEL: /admin
  if (pathname === '/admin') {
    let filePath = path.join(process.cwd(), 'index.html');
    if (!fs.existsSync(filePath)) filePath = path.join(__dirname, 'index.html');
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    fs.createReadStream(filePath).pipe(res);
    return;
  }

  // 3. BLOKIR AKSI HAPUS DARI LUAR LAPTOP PHOTOBOOTH:
  if (isGuestFromTunnel && req.method === 'DELETE' && (pathname.startsWith('/api/folders') || pathname === '/api/photos')) {
    res.writeHead(403, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Akses Ditolak: Fitur hapus hanya dapat diakses langsung dari laptop photobooth.' }));
    return;
  }

  // API 1: Get Server Info
  if (pathname === '/api/info' && req.method === 'GET') {
    const publicUrl = lastPublicBaseUrl || detectPublicBaseUrl() || baseUrl;
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      localIp,
      port: PORT,
      baseUrl,
      publicBaseUrl: publicUrl,
      activeFolder: currentActiveFolder
    }));
    return;
  }

  // API 1D: Encrypt Session
  if (pathname === '/api/encrypt-session' && req.method === 'GET') {
    const f = searchParams.get('folder') || '';
    const t = searchParams.get('theme') || 'wedding';
    const token = encryptSessionToken(f, t);
    const publicUrl = lastPublicBaseUrl || detectPublicBaseUrl() || baseUrl;
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      folder: f,
      theme: t,
      access: token,
      clientUrl: `${publicUrl}/gallery.html?access=${token}`
    }));
    return;
  }

  // API 1B: Set Active Folder
  if (pathname === '/api/active-folder' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        const payload = JSON.parse(body || '{}');
        if (payload.folder) {
          currentActiveFolder = sanitizeFolderName(payload.folder);
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'success', activeFolder: currentActiveFolder }));
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
      }
    });
    return;
  }

  // API 1C: Get / Save Server Settings
  if (pathname === '/api/settings') {
    if (req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(serverSettings));
      return;
    }
    if (req.method === 'POST') {
      let body = '';
      req.on('data', chunk => body += chunk);
      req.on('end', () => {
        try {
          const payload = JSON.parse(body || '{}');
          serverSettings = { ...serverSettings, ...payload };
          fs.writeFileSync(SETTINGS_FILE, JSON.stringify(serverSettings, null, 2));
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ status: 'success', settings: serverSettings }));
        } catch (e) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: e.message }));
        }
      });
      return;
    }
  }

  // API 2: List All Folders / Sessions
  if (pathname === '/api/folders' && req.method === 'GET') {
    try {
      const now = Date.now();
      const activePublicBase = lastPublicBaseUrl || detectPublicBaseUrl() || baseUrl;

      // In-Memory Cache (Respons dalam hitungan mikrodetik)
      if (foldersCache.jsonString && (now - foldersCache.updatedAt < 2500)) {
        if (req.headers['if-none-match'] === foldersCache.etag) {
          res.writeHead(304);
          res.end();
          return;
        }
        res.writeHead(200, {
          'Content-Type': 'application/json',
          'ETag': foldersCache.etag,
          'Cache-Control': 'no-cache'
        });
        res.end(foldersCache.jsonString);
        return;
      }

      const items = fs.readdirSync(BASE_GALLERY_DIR, { withFileTypes: true });
      let folders = items
        .filter(item => item.isDirectory())
        .map(dir => {
          const folderPath = path.join(BASE_GALLERY_DIR, dir.name);
          const files = fs.readdirSync(folderPath).filter(f => /\.(jpe?g|png|webp)$/i.test(f));
          const stats = fs.statSync(folderPath);
          const accessToken = encryptSessionToken(dir.name);
          return {
            name: dir.name,
            displayName: dir.name.replace(/_/g, ' '),
            photoCount: files.length,
            accessToken: accessToken,
            clientUrl: `${activePublicBase}/gallery.html?access=${accessToken}`,
            createdAt: stats.birthtimeMs || stats.mtimeMs,
            updatedAt: stats.mtimeMs
          };
        })
        .sort((a, b) => a.createdAt - b.createdAt);

      // If all folders were deleted, recreate Sesi_01
      if (folders.length === 0) {
        fs.mkdirSync(defaultFolderPath, { recursive: true });
        const accessToken = encryptSessionToken(DEFAULT_FOLDER);
        folders = [{
          name: DEFAULT_FOLDER,
          displayName: 'Sesi 01',
          photoCount: 0,
          accessToken: accessToken,
          clientUrl: `${activePublicBase}/gallery.html?access=${accessToken}`,
          createdAt: Date.now(),
          updatedAt: Date.now()
        }];
      }

      const jsonStr = JSON.stringify({ folders });
      const latestModified = folders.reduce((max, f) => Math.max(max, f.updatedAt || 0), 0);
      const etag = `W/"folders-${folders.length}-${latestModified}"`;

      foldersCache = {
        data: folders,
        jsonString: jsonStr,
        etag: etag,
        updatedAt: now
      };

      if (req.headers['if-none-match'] === etag) {
        res.writeHead(304);
        res.end();
        return;
      }

      res.writeHead(200, {
        'Content-Type': 'application/json',
        'ETag': etag,
        'Cache-Control': 'no-cache'
      });
      res.end(jsonStr);
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  // API 3: Create New Folder / Session
  if (pathname === '/api/folders' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        const payload = JSON.parse(body || '{}');
        const folderName = sanitizeFolderName(payload.name || `Sesi_${Date.now()}`);
        const targetPath = path.join(BASE_GALLERY_DIR, folderName);

        if (!fs.existsSync(targetPath)) {
          fs.mkdirSync(targetPath, { recursive: true });
        }

        broadcastEvent({ type: 'folders_updated', folder: folderName });
        invalidateServerCache();

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          status: 'success',
          folder: folderName,
          clientUrl: `${baseUrl}/gallery.html?folder=${encodeURIComponent(folderName)}`
        }));
      } catch (err) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Gagal membuat folder' }));
      }
    });
    return;
  }

  // API 3B: Rename Folder / Session
  if (pathname === '/api/folders/rename' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        const payload = JSON.parse(body || '{}');
        const oldName = sanitizeFolderName(payload.oldName);
        const newName = sanitizeFolderName(payload.newName);

        if (!oldName || !newName) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Nama sesi lama dan baru wajib diisi' }));
          return;
        }

        const oldPath = path.join(BASE_GALLERY_DIR, oldName);
        const newPath = path.join(BASE_GALLERY_DIR, newName);

        if (!fs.existsSync(oldPath)) {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Folder sesi lama tidak ditemukan' }));
          return;
        }

        if (oldName !== newName && fs.existsSync(newPath)) {
          res.writeHead(409, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: `Sesi "${newName.replace(/_/g, ' ')}" sudah ada. Silakan gunakan nama lain.` }));
          return;
        }

        if (oldName !== newName) {
          fs.renameSync(oldPath, newPath);
          console.log(`[RENAME SESI] Folder [${oldName}] berhasil diubah menjadi [${newName}]`);
        }

        broadcastEvent({ type: 'folders_updated', oldFolder: oldName, folder: newName });
        invalidateServerCache();

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          status: 'success',
          oldFolder: oldName,
          folder: newName,
          displayName: newName.replace(/_/g, ' '),
          clientUrl: `${baseUrl}/gallery.html?folder=${encodeURIComponent(newName)}`
        }));
      } catch (err) {
        console.warn("Gagal rename folder:", err);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Gagal mengubah nama sesi: ' + err.message }));
      }
    });
    return;
  }

  // API 4: Delete Folder / Session
  if (pathname.startsWith('/api/folders/') && req.method === 'DELETE') {
    const rawFolderName = decodeURIComponent(pathname.replace('/api/folders/', ''));
    const folderName = sanitizeFolderName(rawFolderName);
    const targetPath = path.join(BASE_GALLERY_DIR, folderName);

    try {
      if (fs.existsSync(targetPath)) {
        fs.rmSync(targetPath, { recursive: true, force: true });
        console.log(`[HAPUS SESI] Folder [${folderName}] berhasil dihapus`);
        deleteFolderFromAndroidGallery(folderName);
      }
      broadcastEvent({ type: 'folders_updated', deleted: folderName });
      invalidateServerCache(folderName);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'success', deleted: folderName }));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Gagal menghapus folder: ' + err.message }));
    }
    return;
  }

  // API 5: Delete Single Photo
  if (pathname === '/api/photos' && req.method === 'DELETE') {
    const folder = sanitizeFolderName(searchParams.get('folder'));
    const filename = path.basename(searchParams.get('file') || '');
    const filePath = path.join(BASE_GALLERY_DIR, folder, filename);

    try {
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
        console.log(`[HAPUS FOTO] File [${filename}] di folder [${folder}] dihapus`);
        deleteFromAndroidGallery(folder, filename);
      }
      broadcastEvent({ type: 'photo_deleted', folder, filename });
      invalidateServerCache(folder);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'success', deleted: filename }));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Gagal menghapus foto' }));
    }
    return;
  }

  // API 5B: Upload Custom PNG Frame Template
  if (pathname === '/api/upload-frame' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        const payload = JSON.parse(body || '{}');
        let base64Data = payload.image || '';
        if (base64Data.includes(',')) base64Data = base64Data.split(',')[1];

        const framePath = path.join(BASE_GALLERY_DIR, 'custom_frame_template.png');
        fs.writeFileSync(framePath, Buffer.from(base64Data, 'base64'));

        console.log(`[CUSTOM FRAME] Template PNG Kustom berhasil disimpan!`);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          status: 'success',
          frameUrl: `/gallery-photos/custom_frame_template.png?v=${Date.now()}`
        }));
      } catch (err) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Gagal menyimpan template PNG: ' + err.message }));
      }
    });
    return;
  }

  // API 5C: Get Custom Frame Status
  if (pathname === '/api/frame' && req.method === 'GET') {
    const framePath = path.join(BASE_GALLERY_DIR, 'custom_frame_template.png');
    const exists = fs.existsSync(framePath);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      hasCustomFrame: exists,
      frameUrl: exists ? `/gallery-photos/custom_frame_template.png?v=${Date.now()}` : null
    }));
    return;
  }

  // API 6: Get Photos inside a specific folder (?folder=Sesi_01 or ?access=...)
  if (pathname === '/api/photos' && req.method === 'GET') {
    let folder = searchParams.get('folder');
    const access = searchParams.get('access');
    let themeFromToken = '';

    if (access) {
      const dec = decryptSessionToken(access);
      if (dec && dec.f) {
        folder = dec.f;
        themeFromToken = dec.t || '';
      } else {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Akses galeri tidak valid atau kadaluarsa', photos: [] }));
        return;
      }
    }

    if (!folder) {
      folder = DEFAULT_FOLDER;
    }

    const safeFolder = sanitizeFolderName(folder);
    const targetFolder = path.join(BASE_GALLERY_DIR, safeFolder);

    if (!fs.existsSync(targetFolder)) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Folder tidak ditemukan', photos: [] }));
      return;
    }

    const now = Date.now();
    const cacheKey = `${safeFolder}_${themeFromToken}`;
    const cached = photosCacheMap.get(cacheKey);

    // In-Memory Cache: Jika request berulang dalam 2.5 detik, sajikan dari memori tanpa baca disk
    if (cached && (now - cached.updatedAt < 2500)) {
      if (req.headers['if-none-match'] === cached.etag) {
        res.writeHead(304);
        res.end();
        return;
      }
      res.writeHead(200, {
        'Content-Type': 'application/json',
        'ETag': cached.etag,
        'Cache-Control': 'no-cache'
      });
      res.end(cached.jsonString);
      return;
    }

    try {
      const files = fs.readdirSync(targetFolder);
      const photoFiles = files
        .filter(f => /\.(jpe?g|png|webp)$/i.test(f))
        .map(file => {
          const stats = fs.statSync(path.join(targetFolder, file));
          return {
            id: file,
            name: file,
            folder: safeFolder,
            url: `/gallery-photos/${encodeURIComponent(safeFolder)}/${encodeURIComponent(file)}`,
            timestamp: stats.mtimeMs,
            size: stats.size
          };
        })
        .sort((a, b) => {
          return (a.name || '').localeCompare(b.name || '', undefined, { numeric: true, sensitivity: 'base' })
            || ((a.timestamp || 0) - (b.timestamp || 0));
        });

      const accessToken = encryptSessionToken(safeFolder, themeFromToken);
      const activePublicBase = lastPublicBaseUrl || detectPublicBaseUrl() || baseUrl;

      const payload = {
        folder: safeFolder,
        displayName: safeFolder.replace(/_/g, ' '),
        theme: themeFromToken,
        accessToken: accessToken,
        clientUrl: `${activePublicBase}/gallery.html?access=${accessToken}`,
        photos: photoFiles
      };

      const jsonStr = JSON.stringify(payload);
      const latestTimestamp = photoFiles.length > 0 ? photoFiles[photoFiles.length - 1].timestamp : 0;
      const etag = `W/"p-${safeFolder}-${photoFiles.length}-${latestTimestamp}"`;

      photosCacheMap.set(cacheKey, {
        jsonString: jsonStr,
        etag: etag,
        updatedAt: now
      });

      if (req.headers['if-none-match'] === etag) {
        res.writeHead(304);
        res.end();
        return;
      }

      res.writeHead(200, {
        'Content-Type': 'application/json',
        'ETag': etag,
        'Cache-Control': 'no-cache'
      });
      res.end(jsonStr);
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message, photos: [] }));
    }
    return;
  }

  // API 7: Upload Photo into a specific folder and forward to Google Drive
  if (pathname === '/api/upload' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => {
      body += chunk;
      if (body.length > 50 * 1024 * 1024) {
        res.writeHead(413, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'File terlalu besar (maks 50MB)' }));
        req.destroy();
      }
    });

    req.on('end', () => {
      try {
        const payload = JSON.parse(body);
        let base64Data = payload.image;
        if (!base64Data) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Data gambar tidak ditemukan' }));
          return;
        }

        if (base64Data.includes(',')) {
          base64Data = base64Data.split(',')[1];
        }

        const folder = sanitizeFolderName(payload.folder || DEFAULT_FOLDER);
        const targetFolder = path.join(BASE_GALLERY_DIR, folder);
        if (!fs.existsSync(targetFolder)) {
          fs.mkdirSync(targetFolder, { recursive: true });
        }

        const ext = payload.ext || 'jpg';
        const filename = payload.filename || `SLR_${Date.now()}_${Math.floor(Math.random()*1000)}.${ext}`;
        const savePath = path.join(targetFolder, filename);

        fs.writeFile(savePath, Buffer.from(base64Data, 'base64'), (err) => {
          if (err) {
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Gagal menyimpan foto' }));
            return;
          }

          console.log(`[SLR OTG] Foto baru masuk ke folder [${folder}]: ${filename}`);

          // Otomatis sinkronkan foto ke folder DCIM/Piufoto di Galeri HP Android
          syncToAndroidGallery(savePath, folder, filename);

          const photoUrl = `/gallery-photos/${encodeURIComponent(folder)}/${encodeURIComponent(filename)}`;

          // 1. INSTANT REALTIME BROADCAST VIA SSE (Kirim ke seluruh HP tamu & dashboard seketika < 1ms)
          broadcastEvent({
            type: 'new_photo',
            folder,
            filename,
            url: photoUrl,
            timestamp: Date.now()
          });
          invalidateServerCache(folder);

          // 2. RESPON KILAT KE PENGIRIM (Tidak ditahan oleh proses upload Google Drive yang lama)
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            status: 'success',
            folder,
            filename,
            url: photoUrl,
            timestamp: Date.now(),
            gdrive: { status: 'uploading', message: 'Mengunggah ke Google Drive di latar belakang...' }
          }));

          // 3. UPLOAD GOOGLE DRIVE DI LATAR BELAKANG (Asynchronous Non-blocking)
          const webhookUrl = payload.googleDriveWebhook;
          if (webhookUrl && webhookUrl.startsWith('http')) {
            (async () => {
              try {
                console.log(`[GOOGLE DRIVE BG] Mengunggah [${filename}] ke Google Drive...`);
                const driveRes = await fetch(webhookUrl, {
                  method: 'POST',
                  headers: { 'Content-Type': 'text/plain' },
                  body: JSON.stringify({
                    action: 'upload',
                    image: base64Data,
                    fileName: filename,
                    folderName: folder,
                    rootFolderName: payload.rootFolderName || '',
                    parentFolderId: payload.parentFolderId || ''
                  }),
                  redirect: 'follow'
                });

                const status = driveRes.status;
                const responseText = await driveRes.text();
                try {
                  const parsed = JSON.parse(responseText);
                  if (status === 200 && parsed.status === 'success') {
                    console.log(`[GOOGLE DRIVE BG] ✓ Berhasil tersimpan di Google Drive! Folder: ${parsed.folderName}, URL: ${parsed.folderUrl}`);
                    broadcastEvent({
                      type: 'gdrive_synced',
                      folder,
                      filename,
                      ok: true,
                      status: 200,
                      folderName: parsed.folderName,
                      folderUrl: parsed.folderUrl
                    });
                  } else {
                    console.warn(`[GOOGLE DRIVE BG] ⚠ Respons Google:`, responseText.slice(0, 200));
                    broadcastEvent({
                      type: 'gdrive_synced',
                      folder,
                      filename,
                      ok: false,
                      status,
                      message: parsed.message || responseText.slice(0, 150)
                    });
                  }
                } catch(e) {
                  console.warn(`[GOOGLE DRIVE BG] ⚠ Google status ${status}:`, responseText.slice(0, 200));
                  broadcastEvent({
                    type: 'gdrive_synced',
                    folder,
                    filename,
                    ok: false,
                    status,
                    message: `Status ${status}: ${responseText.slice(0, 100)}`
                  });
                }
              } catch (driveErr) {
                console.warn(`[GOOGLE DRIVE BG] ⚠ Gagal koneksi ke Google Drive:`, driveErr.message);
                broadcastEvent({
                  type: 'gdrive_synced',
                  folder,
                  filename,
                  ok: false,
                  status: 'network_error',
                  message: driveErr.message
                });
              }
            })();
          }
        });
      } catch (err) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Format payload tidak valid' }));
      }
    });
    return;
  }

  // API 7B: Test Google Drive Webhook Connection
  if (pathname === '/api/test-webhook' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', async () => {
      try {
        const { webhookUrl, rootFolderName, parentFolderId, folderName } = JSON.parse(body || '{}');
        if (!webhookUrl || !webhookUrl.startsWith('http')) {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            ok: false,
            status: 'empty',
            message: 'URL Webhook belum diisi atau tidak valid (harus diawali https://)'
          }));
          return;
        }

        console.log(`[TEST WEBHOOK] Menguji koneksi ke: ${webhookUrl}`);
        
        const testRes = await fetch(webhookUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'text/plain' },
          body: JSON.stringify({
            action: 'create_folder',
            folderName: folderName || 'Sesi 01',
            rootFolderName: rootFolderName || '',
            parentFolderId: parentFolderId || ''
          }),
          redirect: 'follow'
        });

        const status = testRes.status;
        const responseText = await testRes.text();
        let parsedJson = null;
        try { parsedJson = JSON.parse(responseText); } catch(e){}

        if (status === 200 && parsedJson && parsedJson.status === 'success') {
          console.log(`[TEST WEBHOOK] Sukses terhubung! Folder URL: ${parsedJson.folderUrl}`);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            ok: true,
            status: 200,
            folderUrl: parsedJson.folderUrl,
            message: 'Berhasil terhubung ke Google Drive! Webhook aktif dan siap menerima foto.'
          }));
        } else if (status === 404) {
          console.warn(`[TEST WEBHOOK] Gagal 404 Not Found`);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            ok: false,
            status: 404,
            message: 'Google mengembalikan 404 (Halaman Tidak Ditemukan). Penyebab umum: Di script.google.com -> Deploy -> Manage deployments -> Pastikan opsi "Who has access" diset ke "Anyone", bukan "Only myself".'
          }));
        } else {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            ok: false,
            status: status,
            message: `Google merespons status ${status}: ${responseText.slice(0, 150)}`
          }));
        }
      } catch (err) {
        console.error(`[TEST WEBHOOK] Error koneksi:`, err.message);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          ok: false,
          status: 'network_error',
          message: `Gagal menghubungi Google Apps Script: ${err.message}`
        }));
      }
    });
    return;
  }

  // Serve Static Photos from gallery-photos/<folder>/<filename>
  if (pathname.startsWith('/gallery-photos/')) {
    const relativePart = decodeURIComponent(pathname.replace('/gallery-photos/', ''));
    const safePath = path.normalize(path.join(BASE_GALLERY_DIR, relativePart));
    
    if (!safePath.startsWith(BASE_GALLERY_DIR)) {
      res.writeHead(403);
      res.end('Akses ditolak');
      return;
    }

    fs.stat(safePath, (err, stats) => {
      if (err || !stats.isFile()) {
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('Foto tidak ditemukan');
        return;
      }

      const etag = `"${stats.size.toString(16)}-${stats.mtimeMs.toString(16)}"`;
      const clientEtag = req.headers['if-none-match'];
      const clientModified = req.headers['if-modified-since'];

      // 304 Not Modified jika foto sudah ada di browser / edge cache
      if (clientEtag === etag || (clientModified && new Date(clientModified) >= stats.mtime)) {
        res.writeHead(304);
        res.end();
        return;
      }

      const ext = path.extname(safePath).toLowerCase();
      const contentType = MIME_TYPES[ext] || 'image/jpeg';

      // Cloudflare CDN Edge Cache:
      // Cache 7 hari di edge Cloudflare (public, max-age=604800).
      // Cloudflare akan menyajikan foto ke tamu ke-2, ke-3, dst dari CDN-nya, tanpa membebani laptop!
      res.writeHead(200, {
        'Content-Type': contentType,
        'Content-Length': stats.size,
        'Last-Modified': stats.mtime.toUTCString(),
        'ETag': etag,
        'Cache-Control': 'public, max-age=604800, stale-while-revalidate=86400',
        'Accept-Ranges': 'bytes'
      });

      fs.createReadStream(safePath).pipe(res);
    });
    return;
  }

  // Serve Frontend HTML / CSS / JS
  let reqFile = pathname === '/' ? '/index.html' : pathname;
  // Prevent directory traversal
  reqFile = path.normalize(reqFile).replace(/^(\.\.[\/\\])+/, '');
  
  let filePath = path.join(process.cwd(), reqFile);
  if (!fs.existsSync(filePath)) {
    filePath = path.join(__dirname, reqFile);
  }

  fs.stat(filePath, (err, stats) => {
    if (err || !stats.isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('404 Not Found');
      return;
    }

    const etag = `"${stats.size.toString(16)}-${stats.mtimeMs.toString(16)}"`;
    const clientEtag = req.headers['if-none-match'];
    if (clientEtag === etag) {
      res.writeHead(304);
      res.end();
      return;
    }

    const ext = path.extname(filePath).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';
    const isHtml = ext === '.html';

    // HTML: no-cache agar update segera tampil. Aset statis (CSS/JS/gambar): cache 1 hari
    const cacheControl = isHtml ? 'no-cache' : 'public, max-age=86400';

    res.writeHead(200, {
      'Content-Type': isHtml ? `${contentType}; charset=utf-8` : contentType,
      'Content-Length': stats.size,
      'Last-Modified': stats.mtime.toUTCString(),
      'ETag': etag,
      'Cache-Control': cacheControl
    });

    fs.createReadStream(filePath).pipe(res);
  });
  return;
  } catch (fatalErr) {
    console.error("FATAL_REQUEST_ERROR:", fatalErr);
    if (!res.headersSent) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
    }
    res.end(JSON.stringify({
      error: "FATAL_REQUEST_ERROR",
      message: fatalErr.message,
      stack: fatalErr.stack
    }));
  }
};

let server;
if (require.main === module) {
  server = http.createServer(requestHandler);
  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      console.error(`\n❌ PERINGATAN: Port ${PORT} sedang digunakan oleh proses lain!`);
      console.error(`👉 Ada server Node.js lain yang masih berjalan di latar belakang.`);
      console.error(`   Jalankan file 'start-with-tunnel.bat' untuk menutup proses lama dan memulai ulang secara otomatis.\n`);
      process.exit(1);
    } else {
      console.error('Server error:', err);
    }
  });
  server.listen(PORT, '0.0.0.0', () => {
    const localIp = getLocalIp();
    console.log(`\n=============================================================`);
    console.log(`📸 PIUFOTO MULTI-SESSION GALLERY SERVER (ACTIVE)`);
    console.log(`-------------------------------------------------------------`);
    console.log(`- Dashboard: http://localhost:${PORT}`);
    console.log(`- Akses Lokal: http://${localIp}:${PORT}`);

    // Cek integrasi penyimpanan Android / Termux
    const androidGal = getAndroidGalleryDir();
    if (androidGal) {
      console.log(`- 📱 Galeri HP: Terhubung! (Foto otomatis muncul di DCIM/Piufoto)`);
    } else if (process.platform === 'android' || process.env.TERMUX_VERSION || process.env.PREFIX) {
      console.log(`- 📱 Perhatian Termux: Jalankan 'termux-setup-storage' agar`);
      console.log(`  foto otomatis disinkronkan ke aplikasi Galeri HP Anda.`);
    }

    // Aktifkan Auto-Watcher Kamera Fujifilm
    startFujifilmWatcher();
    console.log(`- 📡 Auto-Watcher Kamera: AKTIF! (Memantau DCIM/Fujifilm)`);
    console.log(`=============================================================\n`);
  });
}

module.exports = requestHandler;
