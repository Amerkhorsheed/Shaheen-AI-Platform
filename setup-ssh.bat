@echo off
setlocal
cd /d "%~dp0"
chcp 65001 > nul
title Shaheen AI Platform - OpenSSH Server Setup

echo =======================================================
echo   Shaheen AI Platform - OpenSSH Server Setup
echo =======================================================
echo.

net session >nul 2>&1
if %errorlevel% neq 0 (
    echo [Notice] Administrator privileges required.
    echo Requesting elevation...
    powershell -NoProfile -ExecutionPolicy Bypass -Command "Start-Process cmd -ArgumentList '/c \"\"%~f0\"\"' -Verb RunAs"
    exit /b
)

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0setup-ssh.ps1"

echo.
pause
