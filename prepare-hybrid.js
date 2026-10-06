const fs = require('fs');
const path = require('path');

const ROOT_DIR = __dirname;
const WWW_DIR = path.join(ROOT_DIR, 'www');

console.log('🚀 Menyiapkan folder aset hybrid "www"...');

if (!fs.existsSync(WWW_DIR)) {
  fs.mkdirSync(WWW_DIR, { recursive: true });
}

// 1. Salin file-file pendukung langsung
const directFiles = [
  'style.css',
  'app.js',
  'hybrid-bridge.js',
  'qrcode.min.js'
];

directFiles.forEach(file => {
  const src = path.join(ROOT_DIR, file);
  const dest = path.join(WWW_DIR, file);
  if (fs.existsSync(src)) {
    fs.copyFileSync(src, dest);
    console.log(`✓ Disalin: ${file}`);
  } else {
    console.warn(`! Peringatan: File ${file} tidak ditemukan di root`);
  }
});

// 2. Modifikasi index.html khusus hybrid agar memuat qrcode lokal & hybrid bridge
const indexSrc = path.join(ROOT_DIR, 'index.html');
let indexContent = fs.readFileSync(indexSrc, 'utf8');

// Ganti link CDN qrcodejs dengan file lokal
indexContent = indexContent.replace(
  'https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js',
  'qrcode.min.js'
);

// Pastikan hybrid-bridge.js dimuat sebelum app.js
if (!indexContent.includes('hybrid-bridge.js')) {
  indexContent = indexContent.replace(
    '<script src="app.js"></script>',
    '<script src="hybrid-bridge.js"></script>\n  <script src="app.js"></script>'
  );
}

fs.writeFileSync(path.join(WWW_DIR, 'index.html'), indexContent, 'utf8');
console.log('✓ index.html untuk hybrid berhasil dibuat di www/index.html');

// 3. Modifikasi gallery.html khusus hybrid agar memuat hybrid bridge offline
const gallerySrc = path.join(ROOT_DIR, 'gallery.html');
let galleryContent = fs.readFileSync(gallerySrc, 'utf8');

if (!galleryContent.includes('hybrid-bridge.js')) {
  galleryContent = galleryContent.replace(
    '<script>',
    '<script src="hybrid-bridge.js"></script>\n  <script>'
  );
}

fs.writeFileSync(path.join(WWW_DIR, 'gallery.html'), galleryContent, 'utf8');
console.log('✓ gallery.html untuk hybrid berhasil dibuat di www/gallery.html');

console.log('✨ Folder www/ siap disinkronkan ke Android!');
