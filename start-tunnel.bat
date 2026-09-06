@echo off
setlocal
cd /d "%~dp0"
chcp 65001 > nul
title Shaheen AI Platform - Global Terminal SSH Tunnel

echo =======================================================
echo   Shaheen AI Platform - Global Terminal SSH Tunnel
echo =======================================================
echo.
echo [*] Starting terminal TCP tunnel to Port 22 (SSH)...
echo [*] No app or sign-up needed. Pure terminal connection.
echo.
echo When connected, bore will output:
echo   "listening at bore.pub:<PORT>"
echo.
echo Give your agent that <PORT> and connect from ANYWHERE:
echo   ssh -i agent_id_ed25519 -p ^<PORT^> -l "FIX 11" bore.pub
echo.
echo =======================================================
echo.

"%~dp0bore.exe" local 22 --to bore.pub

pause
