#!/data/data/com.termux/files/usr/bin/bash
# ==============================================================================
# PIUFOTO - STANDALONE ANDROID TERMUX SERVER + CLOUDFLARE TUNNEL
# Domain: https://foto.berkisahkita.web.id
# 100% Bebas Laptop - Menjalankan server photobooth langsung di dalam tablet Android!
# ==============================================================================

# Pindah ke direktori skrip ini berada
cd "$(dirname "$0")"

echo "=================================================================="
echo "  PIUFOTO STANDALONE ANDROID SERVER (100% BEBAS LAPTOP)"
echo "  Domain Publik: https://foto.berkisahkita.web.id"
echo "=================================================================="
echo ""

# 1. Kunci CPU agar tidak tertidur saat layar redup (Termux Wake Lock)
if command -v termux-wake-lock >/dev/null 2>&1; then
  echo "[1/5] Mengaktifkan Termux Wake-Lock (Mencegah Android tidur)..."
  termux-wake-lock
fi

# 1B. Periksa izin akses penyimpanan folder Documents Android
if [ ! -d "$HOME/storage/shared" ] && [ ! -d "/sdcard/Documents" ]; then
  echo "Mengaktifkan izin akses folder Dokumen Android..."
  if command -v termux-setup-storage >/dev/null 2>&1; then
    termux-setup-storage
    sleep 2
  fi
fi

# 2. Periksa dependensi Node.js, curl & ca-certificates
echo "[2/5] Memeriksa paket Node.js & sertifikat..."
if ! command -v node >/dev/null 2>&1 || ! command -v curl >/dev/null 2>&1; then
  echo "Memasang paket penting (nodejs, curl, ca-certificates)..."
  pkg update -y && pkg install -y nodejs curl ca-certificates
fi

# 3. Periksa & Download Cloudflared untuk arsitektur Android (ARM64)
echo "[3/5] Memeriksa Cloudflared binary..."
CLOUDFLARED_BIN="$HOME/cloudflared"

if [ ! -f "$CLOUDFLARED_BIN" ]; then
  ARCH=$(uname -m)
  echo "Mendeteksi arsitektur CPU: $ARCH"
  
  DOWNLOAD_URL="https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-arm64"
  if [ "$ARCH" = "armv7l" ] || [ "$ARCH" = "arm" ]; then
    DOWNLOAD_URL="https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-arm"
  elif [ "$ARCH" = "x86_64" ]; then
    DOWNLOAD_URL="https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64"
  fi

  echo "Mengunduh Cloudflared untuk Android dari GitHub..."
  curl -L -s "$DOWNLOAD_URL" -o "$CLOUDFLARED_BIN"
  chmod +x "$CLOUDFLARED_BIN"
  echo "✓ Cloudflared berhasil diunduh dan dipasang di $CLOUDFLARED_BIN"
fi

# 4. Hentikan proses lama jika ada yang masih berjalan di latar belakang
echo "[4/5] Membersihkan sesi lama..."
pkill -f "cloudflared" 2>/dev/null || true
pkill -f "local-server.js" 2>/dev/null || true
sleep 1

# 5. Nyalakan server Node.js TERLEBIH DAHULU
echo "[5/5] Menyalakan Server Node.js Piufoto di port 3000..."
node local-server.js > server.log 2>&1 &
NODE_PID=$!

# Tunggu sampai server Node.js benar-benar siap merespons (Healthcheck)
echo "Menunggu kesiapan server internal..."
SERVER_READY=0
for i in {1..15}; do
  if curl -s http://127.0.0.1:3000/api/info >/dev/null 2>&1 || curl -s "http://[::1]:3000/api/info" >/dev/null 2>&1; then
    SERVER_READY=1
    break
  fi
  sleep 1
done

if [ $SERVER_READY -eq 1 ]; then
  echo "✓ Server Node.js siap dan merespons dengan normal di port 3000!"
else
  echo "⚠ Peringatan: Server belum merespons dalam 15 detik. Isi log server:"
  cat server.log
fi

echo ""
echo "=================================================================="
echo "  🚀 MENYAMBUNGKAN KE CLOUDFLARE TUNNEL..."
echo "  • Akses Lokal Tablet:  http://localhost:3000"
echo "  • Link Publik Tamu:    https://foto.berkisahkita.web.id"
echo "  • Web Galeri Tamu:     https://foto.berkisahkita.web.id/gallery.html"
echo "=================================================================="
echo "PENTING: Pastikan jendela tunnel di LAPTOP SUDAH DITUTUP agar"
echo "tidak terjadi bentrok (502 Bad Gateway) antar perangkat."
echo "Tekan Ctrl+C untuk menghentikan server."
echo "------------------------------------------------------------------"
echo ""

# Tangani penutupan bersih dengan Ctrl+C
trap 'echo "Menutup server..."; kill $NODE_PID 2>/dev/null; exit 0' SIGINT SIGTERM

TUNNEL_TOKEN="eyJhIjoiZmM0OTZkNmY4N2EzNWM2MGMzOTJiZjk5ODQ0NDFmZmEiLCJ0IjoiMDM5NmM4YzYtYzRkNy00ZWU0LWE4YzEtYTQ4ODUzODM1ODRlIiwicyI6IllXTTBNMlF5WVRjdE1qSmxOUzAwWkRNekxXRXhZV1l0WXpBMU5UQXdaV1V6WmpWaiJ9"

# Jalankan Cloudflare Tunnel dengan protokol HTTP2 (kompatibel penuh dengan jaringan seluler 4G/5G)
exec "$CLOUDFLARED_BIN" tunnel --protocol http2 --no-autoupdate run --token "$TUNNEL_TOKEN"
