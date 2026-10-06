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

# 2. Periksa dependensi Node.js & curl
echo "[2/5] Memeriksa paket Node.js..."
if ! command -v node >/dev/null 2>&1; then
  echo "Node.js belum terpasang. Menginstall Node.js secara otomatis..."
  pkg update -y && pkg install -y nodejs curl
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

# 5. Jalankan Cloudflare Tunnel di latar belakang
echo "[5/5] Menjalankan Cloudflare Tunnel ke foto.berkisahkita.web.id..."
TUNNEL_TOKEN="eyJhIjoiZmM0OTZkNmY4N2EzNWM2MGMzOTJiZjk5ODQ0NDFmZmEiLCJ0IjoiMDM5NmM4YzYtYzRkNy00ZWU0LWE4YzEtYTQ4ODUzODM1ODRlIiwicyI6IllXTTBNMlF5WVRjdE1qSmxOUzAwWkRNekxXRXhZV1l0WXpBMU5UQXdaV1V6WmpWaiJ9"

"$CLOUDFLARED_BIN" tunnel run --token "$TUNNEL_TOKEN" > cloudflared.log 2>&1 &
TUNNEL_PID=$!

sleep 2
echo "✓ Cloudflare Tunnel aktif di latar belakang (PID: $TUNNEL_PID)"
echo ""
echo "=================================================================="
echo "  🚀 SERVER PIUFOTO SIAP!"
echo "  • Akses Lokal Tablet:  http://localhost:3000"
echo "  • Link Publik Tamu:    https://foto.berkisahkita.web.id"
echo "  • Web Galeri Tamu:     https://foto.berkisahkita.web.id/gallery.html"
echo ""
echo "  Sekarang Anda bisa:"
echo "  1. Biarkan jendela Termux ini tetap terbuka di latar belakang."
echo "  2. Buka aplikasi Piufoto di tablet Anda untuk memotret."
echo "  3. Tamu dapat langsung scan QR Code dengan kuota internet ponsel!"
echo "=================================================================="
echo ""

# Tangani penutupan bersih dengan Ctrl+C
trap 'echo "Menutup server dan tunnel..."; kill $TUNNEL_PID 2>/dev/null; exit 0' SIGINT SIGTERM

# Jalankan server utama Node.js
node local-server.js
