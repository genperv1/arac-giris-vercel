@echo off
chcp 65001 >nul
cd /d "%~dp0"
title GitHub Yukle
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\github-push.ps1"
if errorlevel 1 pause
