#!/data/data/com.termux/files/usr/bin/bash
# ==============================================================================
# PIUFOTO - STANDALONE ANDROID TERMUX SERVER + CLOUDFLARE TUNNEL
# Domain: https://foto.berkisahkita.web.id
# 100% Bebas Laptop - Menjalankan server photobooth langsung di dalam tablet Android!
# ==============================================================================

# Pindah ke direktori skrip ini berada
cd "$(dirname "$0")"

echo "=================================================================="
echo "  PIUFOTO STANDALONE ANDROID SERVER"
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

# 1C. Pastikan konfigurasi DNS & Hosts Termux lengkap
# (Mencegah error 'lookup v2 origin tunnel' / 'lookup localhost: no such host')
mkdir -p "$PREFIX/etc"
cat << 'EOF' > "$PREFIX/etc/resolv.conf"
nameserver 1.1.1.1
nameserver 8.8.8.8
nameserver 1.0.0.1
EOF

cat << 'EOF' > "$PREFIX/etc/hosts"
127.0.0.1 localhost
::1 localhost
EOF

# 2. Periksa dependensi Node.js, curl & ca-certificates
echo "[2/5] Memeriksa paket Termux (nodejs, curl, ca-certificates)..."
if ! command -v node >/dev/null 2>&1 || ! command -v curl >/dev/null 2>&1; then
  echo "Memasang paket penting (nodejs, curl, ca-certificates)..."
  pkg update -y || true
  pkg install -y nodejs curl ca-certificates
fi

# 3. Pastikan Cloudflared yang dipakai adalah versi resmi Termux (didukung penuh Android)
echo "[3/5] Memeriksa Cloudflared binary..."
# Hapus binary GitHub lama jika ada karena menyebabkan error DNS di Android
if [ -f "$HOME/cloudflared" ]; then
  rm -f "$HOME/cloudflared"
fi

if ! command -v cloudflared >/dev/null 2>&1; then
  echo "Memasang cloudflared resmi Termux (kompatibel penuh dengan DNS Android)..."
  pkg update -y || true
  pkg install -y cloudflared || {
    echo "Mencoba memasang dari repo tur-repo..."
    pkg install -y tur-repo && pkg install -y cloudflared
  }
fi

if command -v cloudflared >/dev/null 2>&1; then
  CLOUDFLARED_BIN="cloudflared"
  echo "✓ Menggunakan Cloudflared resmi Termux: $(command -v cloudflared)"
else
  # Fallback darurat jika pkg tidak menemukan package
  CLOUDFLARED_BIN="$HOME/cloudflared"
  if [ ! -f "$CLOUDFLARED_BIN" ]; then
    ARCH=$(uname -m)
    DOWNLOAD_URL="https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-arm64"
    if [ "$ARCH" = "armv7l" ] || [ "$ARCH" = "arm" ]; then
      DOWNLOAD_URL="https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-arm"
    fi
    echo "Mengunduh Cloudflared fallback..."
    curl -L -s "$DOWNLOAD_URL" -o "$CLOUDFLARED_BIN"
    chmod +x "$CLOUDFLARED_BIN"
  fi
  echo "✓ Menggunakan Cloudflared binary fallback: $CLOUDFLARED_BIN"
fi

# 3B. Cek konektivitas internet tablet
echo "Memeriksa koneksi internet tablet..."
if ! curl -s --head --connect-timeout 4 https://1.1.1.1 >/dev/null 2>&1; then
  echo "⚠ PERINGATAN KONEKSI INTERNET:"
  echo "  Tablet belum terhubung ke internet atau DNS tidak merespons!"
  echo "  Pastikan Data Seluler (Kuota) atau Wi-Fi aktif."
  echo "  Jika tablet terhubung ke Wi-Fi kamera, pastikan Data Seluler tetap aktif!"
  echo ""
fi

# 4. Hentikan proses lama jika ada yang masih berjalan di latar belakang
echo "[4/5] Membersihkan sesi lama & file sampel..."
pkill -f "cloudflared" 2>/dev/null || true
pkill -f "local-server.js" 2>/dev/null || true
rm -f gallery-photos/Sesi_01/*.JPG 2>/dev/null || true
rm -f gallery-photos/Sesi_01/*.jpg 2>/dev/null || true
rm -f /sdcard/Documents/Piufoto/Sesi_01/NIKON_*.JPG 2>/dev/null || true
rm -f /sdcard/Documents/Piufoto/Sesi_01/NIKON_*.jpg 2>/dev/null || true
sleep 1

# 5. Nyalakan server Node.js TERLEBIH DAHULU
echo "[5/5] Menyalakan Server Node.js Piufoto di port 3000..."
nohup node local-server.js > server.log 2>&1 &
NODE_PID=$!

# Tunggu sampai server Node.js benar-benar siap merespons (Healthcheck)
echo "Menunggu kesiapan server internal..."
SERVER_READY=0
for i in {1..15}; do
  if curl -s http://127.0.0.1:3000/api/info >/dev/null 2>&1 || curl -s http://localhost:3000/api/info >/dev/null 2>&1; then
    SERVER_READY=1
    break
  fi
  sleep 1
done

if [ $SERVER_READY -eq 1 ]; then
  echo "✓ Server Node.js siap dan merespons normal di port 3000!"
  echo "  Respon server: $(curl -s http://127.0.0.1:3000/api/info)"
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
cleanup() {
  echo ""
  echo "Menutup server Piufoto & Cloudflared..."
  kill $NODE_PID 2>/dev/null || true
  pkill -f "cloudflared" 2>/dev/null || true
  pkill -f "local-server.js" 2>/dev/null || true
  exit 0
}
trap cleanup SIGINT SIGTERM

TUNNEL_TOKEN="eyJhIjoiZmM0OTZkNmY4N2EzNWM2MGMzOTJiZjk5ODQ0NDFmZmEiLCJ0IjoiMDM5NmM4YzYtYzRkNy00ZWU0LWE4YzEtYTQ4ODUzODM1ODRlIiwicyI6IllXTTBNMlF5WVRjdE1qSmxOUzAwWkRNekxXRXhZV1l0WXpBMU5UQXdaV1V6WmpWaiJ9"

# Set konfigurasi DNS & paksa IPv4 edge connection agar tidak crash di Android
export TUNNEL_EDGE_IP_VERSION=4
export GODEBUG=netdns=go

# Jalankan Cloudflare Tunnel dengan auto-reconnect loop agar tidak mati saat sinyal seluler drop
while true; do
  # Pastikan server Node.js tetap aktif
  if ! pgrep -f "local-server.js" >/dev/null 2>&1; then
    echo "Menyalakan kembali server Node.js internal..."
    nohup node local-server.js > server.log 2>&1 &
    sleep 1
  fi

  "$CLOUDFLARED_BIN" tunnel --protocol auto --edge-ip-version 4 --no-autoupdate run --token "$TUNNEL_TOKEN"

  echo ""
  echo "⚠ Koneksi internet / Cloudflare terputus sejenak. Menyambungkan kembali otomatis dalam 2 detik..."
  sleep 2
done
