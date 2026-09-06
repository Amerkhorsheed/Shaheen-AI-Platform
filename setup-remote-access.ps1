# =====================================================================
# Shaheen AI Platform - Global Remote Access Setup ("Access from Anywhere")
# =====================================================================
[CmdletBinding()]
param(
    [switch]$InstallTailscale,
    [switch]$InstallCloudflared
)

Write-Host "=====================================================" -ForegroundColor Cyan
Write-Host "   Global Remote Access Setup - Access From Anywhere" -ForegroundColor Cyan
Write-Host "=====================================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "To access your SSH server from outside your home Wi-Fi," -ForegroundColor Yellow
Write-Host "the recommended and easiest solution is Tailscale." -ForegroundColor Yellow
Write-Host "Tailscale gives this PC a secure, private global IP that" -ForegroundColor Yellow
Write-Host "you can reach from your phone, laptop, or any PC worldwide" -ForegroundColor Yellow
Write-Host "without touching router settings or exposing open ports to hackers." -ForegroundColor Yellow
Write-Host ""

# Check if Tailscale is installed
$tsInstalled = Get-Command tailscale -ErrorAction SilentlyContinue
if (-not $tsInstalled) {
    Write-Host "[*] Tailscale is not currently installed." -ForegroundColor DarkYellow
    Write-Host "    Installing Tailscale via winget..." -ForegroundColor Cyan
    try {
        winget install Tailscale.Tailscale --silent --accept-package-agreements --accept-source-agreements
        Write-Host "    [OK] Tailscale installed successfully!" -ForegroundColor Green
        Write-Host "    Please launch Tailscale from the Windows Start menu or system tray and log in." -ForegroundColor Cyan
    } catch {
        Write-Host "    Could not auto-install Tailscale via winget: $_" -ForegroundColor Red
        Write-Host "    You can manually download it from: https://tailscale.com/download" -ForegroundColor White
    }
} else {
    Write-Host "[OK] Tailscale is already installed!" -ForegroundColor Green
    $tsIp = tailscale ip -4 2>$null
    if ($tsIp) {
        Write-Host ""
        Write-Host "Your Global Tailscale SSH command is:" -ForegroundColor Green
        Write-Host "  ssh `"$env:USERNAME`"@$tsIp" -ForegroundColor White -BackgroundColor DarkBlue
    } else {
        Write-Host "Tailscale is installed but not currently connected. Please log in to Tailscale." -ForegroundColor DarkYellow
    }
}

Write-Host ""
Write-Host "=====================================================" -ForegroundColor Cyan
Write-Host "Alternative Remote Access Options:" -ForegroundColor Cyan
Write-Host "-----------------------------------------------------" -ForegroundColor Cyan
Write-Host "Option 2: Router Port Forwarding" -ForegroundColor White
Write-Host "  1. Log into your home router admin page: http://192.168.1.1" -ForegroundColor Gray
Write-Host "  2. Go to 'Port Forwarding' or 'Virtual Server'." -ForegroundColor Gray
Write-Host "  3. Forward External Port (e.g. 2222) -> Internal IP 192.168.1.161 Port 22." -ForegroundColor Gray
Write-Host "  4. Connect using: ssh `"$env:USERNAME`"@<YOUR_PUBLIC_IP> -p 2222" -ForegroundColor Gray
Write-Host ""
Write-Host "Option 3: Ngrok / Pinggy Quick TCP Tunnel" -ForegroundColor White
Write-Host "  Run: ssh -p 443 -R0:localhost:22 a.pinggy.io" -ForegroundColor Gray
Write-Host "=====================================================" -ForegroundColor Cyan
