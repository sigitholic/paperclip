@echo off
title Starnet Office - Installer
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0install-dev.ps1" %*
echo.
pause
