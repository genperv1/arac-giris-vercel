@echo off
chcp 65001 >nul
cd /d "%~dp0"
title Excel Ajani

if not exist "ayar.txt" (
  copy /Y "ayar.ornek.txt" "ayar.txt" >nul
  echo.
  echo ayar.txt olusturuldu.
  echo SUNUCU, ANAHTAR ve KLASOR satirlarini doldurup kaydedin.
  echo Sonra bu dosyaya tekrar cift tiklayin.
  echo.
  notepad "ayar.txt"
  pause
  exit /b 1
)

powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0ajan.ps1" -Kontrol
if errorlevel 1 (
  echo.
  echo Ayarlar eksik. ayar.txt duzeltilince bu dosyaya tekrar cift tiklayin.
  echo.
  notepad "ayar.txt"
  pause
  exit /b 1
)

powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0ajan.ps1" -Kur
if errorlevel 1 (
  echo Baslatilamadi. ajan.log dosyasina bakin.
  pause
  exit /b 1
)

echo.
echo Excel Ajani arka planda calisiyor.
echo Excel her kaydedildiginde siteye gider.
echo Bilgisayar acilinca kendisi yine baslar.
echo Durdurmak icin durdur.bat dosyasina cift tiklayin.
echo.
timeout /t 8 >nul
exit /b 0
