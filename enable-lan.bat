@echo off
setlocal
cd /d "%~dp0"
chcp 65001 > nul
title Shaheen AI Platform - LAN Setup

echo =======================================================
echo   Shaheen AI Platform - LAN Firewall Setup
echo =======================================================
echo.

net session >nul 2>&1
if %errorlevel% neq 0 (
    echo [Notice] Administrator privileges required.
    echo Requesting elevation...
    powershell -NoProfile -ExecutionPolicy Bypass -Command "Start-Process cmd -ArgumentList '/c \"\"%~f0\"\"' -Verb RunAs"
    exit /b
)

echo [1/2] Opening Port 3001 in Windows Firewall...
netsh advfirewall firewall delete rule name="Shaheen_Platform_LAN_3001" >nul 2>&1
netsh advfirewall firewall add rule name="Shaheen_Platform_LAN_3001" dir=in action=allow protocol=TCP localport=3001 profile=any >nul

echo [2/2] Opening Port 5173 in Windows Firewall...
netsh advfirewall firewall delete rule name="Shaheen_Platform_Dev_5173" >nul 2>&1
netsh advfirewall firewall add rule name="Shaheen_Platform_Dev_5173" dir=in action=allow protocol=TCP localport=5173 profile=any >nul

echo.
echo =======================================================
echo   Firewall configured successfully!
echo   Ports 3001 and 5173 are now open for all LAN devices.
echo =======================================================
echo.
pause
