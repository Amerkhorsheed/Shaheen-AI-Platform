@echo off
setlocal
cd /d "%~dp0"
chcp 65001 > nul
title Shaheen AI Platform - Global Remote Access Setup

echo =======================================================
echo   Shaheen AI Platform - Remote Access (From Anywhere)
echo =======================================================
echo.

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0setup-remote-access.ps1"

echo.
pause
