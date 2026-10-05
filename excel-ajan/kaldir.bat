@echo off
chcp 65001 >nul
cd /d "%~dp0"
title Excel Ajani Kaldir
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0ajan.ps1" -Kaldir
echo.
echo Excel Ajani durduruldu ve acilistan kaldirildi.
echo Yeniden baslatmak icin baslat.bat dosyasina cift tiklayin.
echo.
timeout /t 6 >nul
exit /b 0
