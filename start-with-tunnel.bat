@echo off
cd /d "%~dp0"
title Piufoto Server + Cloudflare Tunnel (berkisahkita.web.id)
echo =============================================================
echo   PIUFOTO - SERVER ^& TUNNEL PERMANEN BERKISAHKITA
echo   Domain: https://foto.berkisahkita.web.id
echo =============================================================
echo.

echo [1/3] Memeriksa Tunnel Cloudflare...
powershell -NoProfile -Command "Stop-Process -Name cloudflared -Force -ErrorAction SilentlyContinue; $cf = (Get-Command cloudflared -ErrorAction SilentlyContinue).Source; if (-not $cf) { $cf = 'C:\Program Files (x86)\cloudflared\cloudflared.exe' }; Write-Host 'Menjalankan Cloudflared Tunnel dengan token baru di latar belakang...'; Start-Process -NoNewWindow -FilePath $cf -ArgumentList 'tunnel run --token eyJhIjoiZmM0OTZkNmY4N2EzNWM2MGMzOTJiZjk5ODQ0NDFmZmEiLCJ0IjoiMDM5NmM4YzYtYzRkNy00ZWU0LWE4YzEtYTQ4ODUzODM1ODRlIiwicyI6Ik1HSXlPV05qWVRBdFl6Z3paUzAwWVdJMUxUbGhORFF0TlRKaU5UbGhNbVF3Tm1Nd1kyUTFNVGhsTkdRdE5ESTVNUzAwWkRFMkxUZzVZekl0TWpVMlpqWmlOVE5tTVRRMSJ9' -ErrorAction SilentlyContinue"

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
