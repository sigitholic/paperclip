@echo off
title Starnet Office
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0start-dev.ps1" %*
echo.
pause
