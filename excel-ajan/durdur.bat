@echo off
chcp 65001 >nul
cd /d "%~dp0"
title Excel Ajani Durdur
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0ajan.ps1" -Durdur
echo.
echo Excel Ajani durduruldu.
echo Bilgisayar yeniden acilinca yine baslar.
echo Tamamen kaldirmak icin kaldir.bat dosyasina cift tiklayin.
echo.
timeout /t 6 >nul
exit /b 0
