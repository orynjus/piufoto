@echo off
cd /d "%~dp0"
title Piufoto Server + Cloudflare Tunnel (berkisahkita.web.id)
echo =============================================================
echo   PIUFOTO - SERVER ^& TUNNEL PERMANEN BERKISAHKITA
echo   Domain: https://foto.berkisahkita.web.id
echo =============================================================
echo.

echo [1/3] Memeriksa Tunnel Cloudflare...
powershell -NoProfile -Command "$s = Get-Service Cloudflared -ErrorAction SilentlyContinue; if ($s -and $s.Status -ne 'Running') { Start-Service Cloudflared -ErrorAction SilentlyContinue }"
powershell -NoProfile -Command "$p = Get-Process cloudflared -ErrorAction SilentlyContinue; if (-not $p) { Write-Host 'Menjalankan Cloudflared Tunnel di latar belakang...'; Start-Process -NoNewWindow cloudflared -ArgumentList 'tunnel run --token eyJhIjoiZmM0OTZkNmY4N2EzNWM2MGMzOTJiZjk5ODQ0NDFmZmEiLCJ0IjoiMDM5NmM4YzYtYzRkNy00ZWU0LWE4YzEtYTQ4ODUzODM1ODRlIiwicyI6IllXTTBNMlF5WVRjdE1qSmxOUzAwWkRNekxXRXhZV1l0WXpBMU5UQXdaV1V6WmpWaiJ9' -ErrorAction SilentlyContinue }"

echo [2/3] Memastikan Port 3000 siap...
powershell -NoProfile -Command "(Get-NetTCPConnection -LocalPort 3000 -State Listen -ErrorAction SilentlyContinue) | ForEach-Object { Write-Host ('Menutup proses server lama di port 3000 (PID: ' + $_.OwningProcess + ')...'); Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue }"

echo [3/3] Menyalakan Server Piufoto di port 3000...
echo.
echo =============================================================
echo  Domain Publik Aktif: https://foto.berkisahkita.web.id
echo  Akses Lokal:         http://localhost:3000
echo.
echo  Semua QR Code di layar dan Standee otomatis menggunakan:
echo  👉 https://foto.berkisahkita.web.id
echo =============================================================
echo.
node local-server.js
pause
