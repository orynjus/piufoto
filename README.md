# 📸 Piufoto - Realtime Google Drive OTG Uploader with Automatic Frame Templates

Aplikasi Web / WebView untuk tablet Android yang berfungsi sebagai **Jembatan Auto-Uploader & Auto-Frame Realtime**:
- Mengumpulkan jepretan dari kamera SLR/Mirrorless yang terhubung via kabel data USB OTG.
- **Otomatis memasang bingkai/template foto** (Tersedia template bernuansa romantis dan dukungan upload template PNG kustom dari Admin).
- Otomatis mengunggah setiap foto yang sudah berbingkai ke **folder Google Drive yang ditentukan** secara real-time.
- Menghasilkan **QR Code dinamis per folder/sesi** yang langsung membuka folder Google Drive tersebut di smartphone klien/tamu!

---

## 🎨 Fitur Template Bingkai (Auto-Frame Engine)

Setiap foto yang diambil dari kamera SLR akan diproses secara otomatis sebelum diunggah ke Google Drive:

1. **🌸 Romantis Blossom (Wedding & Couples):**
   - Bingkai lembut bernuansa *blush rose* & *champagne gold*.
   - Kaligrafi romantis ("Together Forever" atau Nama Pasangan, misal: *Sarah & Dimas*).
   - Ornamen hati elegan dan tanggal acara.

2. **✨ Golden Luxury Romance:**
   - Bingkai hitam pekat (*midnight black*) dengan garis ganda emas mewah (*gold foil*).
   - Tipografi romawi serif (*OUR LOVE STORY*).

3. **🎞️ Vintage Polaroid Love:**
   - Bingkai foto instan polaroid retro klasik.
   - Tulisan tangan romantis (*Captured Moments with You ♡*) beserta stempel tanggal.

4. **🖼️ Custom PNG Admin (Upload PNG Kustom):**
   - Admin dapat mengunggah file **PNG transparan** buatan sendiri (desain dari Photoshop / Canva, lengkap dengan ornamen bunga, logo studio, atau tulisan khusus).
   - Setiap jepretan kamera SLR akan otomatis ditimpa (*overlay*) dengan bingkai PNG tersebut secara presisi pada resolusi tinggi.

5. **🚫 Tanpa Frame (Foto Polos):**
   - Opsi untuk mengunggah foto asli tanpa bingkai.

---

## 🌟 Alur Kerja Sistem (Workflow)

```
[Kamera DSLR / SLR] ──(Jepret)──> [Kabel Data USB OTG]
                                          │
                                          ▼
                         ┌────────────────────────────────────────┐
                         │ Tablet Android (Aplikasi WebView)     │
                         │ 1. Memantau folder kamera OTG (Auto)   │
                         │ 2. Otomatis pasang Frame Romantis/PNG │
                         │ 3. Upload foto berbingkai ke Drive    │
                         └──────────────────┬─────────────────────┘
                                            │ (Auto Upload API)
                                            ▼
                         ┌────────────────────────────────────────┐
                         │ Akun Google Drive Anda                 │
                         │ 📁 Piufoto_Galeri_Klien/               │
                         │    └── 📁 Sesi_01/ (Foto berbingkai)   │
                         │    └── 📁 Sesi_02/ (Foto berbingkai)   │
                         └──────────────────┬─────────────────────┘
                                            │ (Scan QR Code Khusus Sesi Ini)
                                            ▼
                         ┌────────────────────────────────────────┐
                         │ Smartphone Klien / Tamu                │
                         │ Langsung membuka folder Google Drive   │
                         │ melihat & download foto berbingkai HD! │
                         └────────────────────────────────────────┘
```

---

## ☁️ 1. Setup Google Drive Webhook (Cukup 2 Menit & GRATIS)

Agar foto otomatis masuk ke Google Drive Anda dan dibuatkan link publik:

1. Buka [https://script.google.com](https://script.google.com) di browser (gunakan akun Google yang ingin dipakai menyimpan foto).
2. Klik tombol **"+ Project Baru"** (*New Project*).
3. Salin (*copy-paste*) seluruh kode yang ada di file **`google-drive-script.gs`** ke dalamnya.
4. Klik tombol **"Deploy" (Terapkan)** di kanan atas -> Pilih **"New deployment" (Penerapan baru)**.
5. Klik ikon gerigi (*Select type*) -> Pilih **"Web app" (Aplikasi Web)**.
6. Konfigurasi:
   - **Description:** `Piufoto Google Drive Uploader`
   - **Execute as:** `Me` (*Saya*)
   - **Who has access:** `Anyone` (*Siapa saja*)
7. Klik **"Deploy"** -> Berikan izin (*Authorize access*) saat Google meminta konfirmasi.
8. Salin **Web app URL** yang muncul (berakhiran `/exec`).
9. Di aplikasi Piufoto, klik ikon **Pengaturan (Gerigi)** -> Tempel URL ke kolom **"URL Webhook Google Apps Script"** -> Klik **Simpan Pengaturan**.

---

## 🔌 2. Menghubungkan Kamera SLR via OTG di Tablet Android

1. Colokkan kabel data USB kamera ke adapter **USB Type-C OTG** pada tablet Android.
2. Nyalakan kamera. Kamera akan terbaca sebagai media penyimpanan / folder di Android (misal di folder `/DCIM/100CANON` atau folder aplikasi tethering).
3. Di bilah atas aplikasi:
   - Pilih tema bingkai (misal: **🌸 Romantis Blossom** atau **🖼️ Custom PNG Admin**).
   - Pilih folder sesi yang aktif (misal `Sesi 01` atau klik `+ Sesi Drive Baru`).
4. Klik tombol **"Pantau Folder Kamera OTG"** -> Pilih folder kamera tersebut.
5. **Selesai!** Setiap kali Anda memotret dengan kamera SLR, foto otomatis dibingkai dengan template pilihan dan langsung terunggah ke Google Drive pada folder sesi tersebut!

---

## 🎥 2B. Penggunaan Khusus Kamera (Live Viewfinder & Auto-Shutter Detection)

Khusus kamera **Kamera** (di mana port USB mematikan layar karena masuk mode card reader):

1. **Peralatan:**
   - Kabel **Micro HDMI (Type D) to HDMI (Type A)**.
   - **USB Video Capture Card (HDMI to USB)** (dicolokkan ke laptop / tablet).
2. **Setting di Kamera Kamera:**
   - Masuk ke **Menu** ➔ **Movie Setting** ➔ **HDMI Output Info Display** ➔ Pilih **OFF** (Clean HDMI tanpa tulisan parameter).
3. **Di Aplikasi Piufoto:**
   - Klik tombol **"🔴 Live Viewfinder (HDMI / Capture Card)"** di bilah atas.
   - Pilih perangkat capture card di dropdown kamera.
   - Layar monitor akan langsung menampilkan video Live View lensa Kamera secara realtime lengkap dengan bingkai template pilihan!
   - Fitur **"⚡ Deteksi Tombol Kamera Fisik"** sudah otomatis aktif.
4. **Cara Memotret:**
   - Cukup **tekan tombol jepret fisik di bodi kamera Kamera**!
   - Piufoto mendeteksi kedipan tirai shutter mekanik kamera (*blackout*), seketika menangkap gambar, memasang template bingkai, menyimpannya di folder sesi aktif, dan mengunggahnya ke Google Drive!
   - Klien juga dapat melihat QR Code di layar untuk langsung mengunduh hasil foto.

---

## 📱 3. Berbagi ke Klien Menggunakan QR Code (Statis & Dinamis)

Aplikasi menyediakan 3 mode QR Code yang sangat fleksibel:

1. **🌐 Mode Semua Sesi (QR Code Statis / Tetap - Sangat Direkomendasikan untuk Standee Cetak):**
   - Gambar QR Code **tidak akan pernah berubah** meskipun Anda berganti sesi atau membuat sesi-sesi baru!
   - Anda cukup **mencetak kartu Standee Meja satu kali saja** untuk seluruh acara.
   - Tamu yang menscan QR ini di smartphone akan langsung membuka portal Galeri Tamu dan **bebas memilih sesi mana** yang ingin dilihat dan diunduh fotonya melalui bilah navigasi sesi yang elegan dan mudah digunakan.

2. **📁 Mode Sesi Ini Saja:**
   - QR Code khusus yang langsung mengunci dan membuka sesi aktif tertentu (misal hanya `Sesi 01`).

3. **☁️ Mode Google Drive:**
   - QR Code yang langsung membuka tautan folder Google Drive sesi tersebut di cloud.

- Tekan tombol **"🖨️ Cetak Standee"** untuk mencetak kartu meja estetik ber-QR Code untuk ditaruh di meja photobooth / resepsi klien.

