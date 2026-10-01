const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');

const PORT = process.env.PORT || 3000;
const BASE_GALLERY_DIR = path.join(__dirname, 'gallery-photos');

// Ensure base gallery directory exists
if (!fs.existsSync(BASE_GALLERY_DIR)) {
  fs.mkdirSync(BASE_GALLERY_DIR, { recursive: true });
}

// Ensure at least a default folder exists
const DEFAULT_FOLDER = 'Sesi_01';
const defaultFolderPath = path.join(BASE_GALLERY_DIR, DEFAULT_FOLDER);
if (!fs.existsSync(defaultFolderPath)) {
  fs.mkdirSync(defaultFolderPath, { recursive: true });
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
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const net of interfaces[name]) {
      if (net.family === 'IPv4' && !net.internal) {
        return net.address;
      }
    }
  }
  return 'localhost';
}

function sanitizeFolderName(name) {
  return (name || 'Sesi_01').replace(/[^a-zA-Z0-9_\-\s]/g, '').trim().replace(/\s+/g, '_') || 'Sesi_01';
}

const server = http.createServer((req, res) => {
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

  const localIp = getLocalIp();

  // API 1: Get Server Info
  if (pathname === '/api/info' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      localIp,
      port: PORT,
      baseUrl: `http://${localIp}:${PORT}`
    }));
    return;
  }

  // API 2: List All Folders / Sessions
  if (pathname === '/api/folders' && req.method === 'GET') {
    try {
      const items = fs.readdirSync(BASE_GALLERY_DIR, { withFileTypes: true });
      let folders = items
        .filter(item => item.isDirectory())
        .map(dir => {
          const folderPath = path.join(BASE_GALLERY_DIR, dir.name);
          const files = fs.readdirSync(folderPath).filter(f => /\.(jpe?g|png|webp)$/i.test(f));
          const stats = fs.statSync(folderPath);
          return {
            name: dir.name,
            displayName: dir.name.replace(/_/g, ' '),
            photoCount: files.length,
            clientUrl: `http://${localIp}:${PORT}/gallery.html?folder=${encodeURIComponent(dir.name)}`,
            createdAt: stats.birthtimeMs || stats.mtimeMs,
            updatedAt: stats.mtimeMs
          };
        })
        .sort((a, b) => a.createdAt - b.createdAt);

      // If all folders were deleted, recreate Sesi_01
      if (folders.length === 0) {
        fs.mkdirSync(defaultFolderPath, { recursive: true });
        folders = [{
          name: DEFAULT_FOLDER,
          displayName: 'Sesi 01',
          photoCount: 0,
          clientUrl: `http://${localIp}:${PORT}/gallery.html?folder=${encodeURIComponent(DEFAULT_FOLDER)}`,
          createdAt: Date.now(),
          updatedAt: Date.now()
        }];
      }

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ folders }));
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

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          status: 'success',
          folder: folderName,
          clientUrl: `http://${localIp}:${PORT}/gallery.html?folder=${encodeURIComponent(folderName)}`
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

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          status: 'success',
          oldFolder: oldName,
          folder: newName,
          displayName: newName.replace(/_/g, ' '),
          clientUrl: `http://${localIp}:${PORT}/gallery.html?folder=${encodeURIComponent(newName)}`
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
      }
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
      }
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

  // API 6: Get Photos inside a specific folder (?folder=Sesi_01)
  if (pathname === '/api/photos' && req.method === 'GET') {
    const folder = sanitizeFolderName(searchParams.get('folder') || DEFAULT_FOLDER);
    const targetFolder = path.join(BASE_GALLERY_DIR, folder);

    if (!fs.existsSync(targetFolder)) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Folder tidak ditemukan', photos: [] }));
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
            folder: folder,
            url: `/gallery-photos/${encodeURIComponent(folder)}/${encodeURIComponent(file)}`,
            timestamp: stats.mtimeMs,
            size: stats.size
          };
        })
        .sort((a, b) => b.timestamp - a.timestamp); // Newest first

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        folder,
        displayName: folder.replace(/_/g, ' '),
        clientUrl: `http://${localIp}:${PORT}/gallery.html?folder=${encodeURIComponent(folder)}`,
        photos: photoFiles
      }));
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

        fs.writeFile(savePath, Buffer.from(base64Data, 'base64'), async (err) => {
          if (err) {
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Gagal menyimpan foto' }));
            return;
          }

          console.log(`[SLR OTG] Foto baru masuk ke folder [${folder}]: ${filename}`);

          // Forward to Google Drive via server-side fetch (bypass CORS & follow redirects)
          let gdriveResult = null;
          const webhookUrl = payload.googleDriveWebhook;
          if (webhookUrl && webhookUrl.startsWith('http')) {
            try {
              console.log(`[GOOGLE DRIVE] Mengunggah [${filename}] ke Google Drive...`);
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
                  console.log(`[GOOGLE DRIVE] ✓ Berhasil tersimpan di Google Drive! Folder: ${parsed.folderName}, URL: ${parsed.folderUrl}`);
                  gdriveResult = { ok: true, status: 200, ...parsed };
                } else {
                  console.warn(`[GOOGLE DRIVE] ⚠ Respons Google:`, responseText.slice(0, 200));
                  gdriveResult = { ok: false, status, message: parsed.message || responseText.slice(0, 150) };
                }
              } catch(e) {
                console.warn(`[GOOGLE DRIVE] ⚠ Google status ${status}:`, responseText.slice(0, 200));
                gdriveResult = { ok: false, status, message: `Status ${status}: ${responseText.slice(0, 100)}` };
              }
            } catch (driveErr) {
              console.warn(`[GOOGLE DRIVE] ⚠ Gagal koneksi ke Google Drive:`, driveErr.message);
              gdriveResult = { ok: false, status: 'network_error', message: driveErr.message };
            }
          }

          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            status: 'success',
            folder,
            filename,
            url: `/gallery-photos/${encodeURIComponent(folder)}/${encodeURIComponent(filename)}`,
            timestamp: Date.now(),
            gdrive: gdriveResult
          }));
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

    fs.readFile(safePath, (err, content) => {
      if (err) {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('Foto tidak ditemukan');
        return;
      }
      const ext = path.extname(safePath).toLowerCase();
      res.writeHead(200, { 'Content-Type': MIME_TYPES[ext] || 'image/jpeg' });
      res.end(content);
    });
    return;
  }

  // Serve Frontend HTML / CSS / JS
  let reqFile = pathname === '/' ? '/index.html' : pathname;
  const filePath = path.join(__dirname, reqFile);
  const ext = path.extname(filePath).toLowerCase();

  fs.readFile(filePath, (err, content) => {
    if (err) {
      if (err.code === 'ENOENT') {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('404 Not Found');
      } else {
        res.writeHead(500);
        res.end(`Server Error: ${err.code}`);
      }
    } else {
      res.writeHead(200, { 'Content-Type': MIME_TYPES[ext] || 'application/octet-stream' });
      res.end(content, 'utf-8');
    }
  });
});

server.listen(PORT, '0.0.0.0', () => {
  const localIp = getLocalIp();
  console.log(`\n=============================================================`);
  console.log(`📸 PIUFOTO MULTI-SESSION GALLERY SERVER (ACTIVE)`);
  console.log(`-------------------------------------------------------------`);
  console.log(`- Dashboard: http://localhost:${PORT}`);
  console.log(`- Akses Lokal: http://${localIp}:${PORT}`);
  console.log(`=============================================================\n`);
});
