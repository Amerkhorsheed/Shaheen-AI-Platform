# =====================================================================
# Shaheen AI Platform - OpenSSH Diagnostics & Verification Script
# =====================================================================
[CmdletBinding()]
param()

Write-Host "=====================================================" -ForegroundColor Cyan
Write-Host "   OpenSSH Server Status & Diagnostics" -ForegroundColor Cyan
Write-Host "=====================================================" -ForegroundColor Cyan
Write-Host ""

# 1. Services
Write-Host "1. Service Status:" -ForegroundColor Yellow
$sshd = Get-Service -Name "sshd" -ErrorAction SilentlyContinue
if ($sshd) {
    Write-Host "   sshd service:        $($sshd.Status) (Startup: $($sshd.StartType))" -ForegroundColor $(if ($sshd.Status -eq 'Running') { 'Green' } else { 'Red' })
} else {
    Write-Host "   sshd service:        NOT INSTALLED" -ForegroundColor Red
}

$agent = Get-Service -Name "ssh-agent" -ErrorAction SilentlyContinue
if ($agent) {
    Write-Host "   ssh-agent service:   $($agent.Status) (Startup: $($agent.StartType))" -ForegroundColor $(if ($agent.Status -eq 'Running') { 'Green' } else { 'DarkGray' })
}

# 2. Port 22 Listener
Write-Host "`n2. Network Listening Port 22:" -ForegroundColor Yellow
$listeners = Get-NetTCPConnection -LocalPort 22 -ErrorAction SilentlyContinue
if ($listeners) {
    foreach ($l in $listeners) {
        Write-Host "   Port 22 is LISTENING on $($l.LocalAddress):$($l.LocalPort) (PID: $($l.OwningProcess))" -ForegroundColor Green
    }
} else {
    Write-Host "   Port 22 is NOT currently listening." -ForegroundColor Red
}

# 3. Firewall Rules
Write-Host "`n3. Firewall Rule Status:" -ForegroundColor Yellow
$rules = Get-NetFirewallRule -DisplayName "*OpenSSH*" -ErrorAction SilentlyContinue
if ($rules) {
    foreach ($r in $rules) {
        Write-Host "   Rule: '$($r.DisplayName)' -> Enabled: $($r.Enabled), Direction: $($r.Direction), Action: $($r.Action)" -ForegroundColor Green
    }
} else {
    Write-Host "   No OpenSSH firewall rule found." -ForegroundColor Red
}

# 4. Connection Details
Write-Host "`n4. Connection Endpoints:" -ForegroundColor Yellow
$targetUser = $env:USERNAME
$ipAddresses = (Get-NetIPAddress -AddressFamily IPv4 | Where-Object { $_.InterfaceAlias -notlike "*Loopback*" -and $_.IPAddress -notlike "169.254*" -and $_.IPAddress -notlike "172.*" }).IPAddress

Write-Host "   Local Network Connection:" -ForegroundColor Cyan
foreach ($ip in $ipAddresses) {
    Write-Host "     ssh `"$targetUser`"@$ip" -ForegroundColor White
}

# Check Tailscale if available
$tailscale = Get-Command tailscale -ErrorAction SilentlyContinue
if ($tailscale) {
    $tsIp = tailscale ip -4 2>$null
    if ($tsIp) {
        Write-Host "`n   Global Access (Tailscale - from anywhere):" -ForegroundColor Cyan
        Write-Host "     ssh `"$targetUser`"@$tsIp" -ForegroundColor Green
    }
}

Write-Host "`n5. SSH Keys Location:" -ForegroundColor Yellow
Write-Host "   Authorized keys: $env:USERPROFILE\.ssh\authorized_keys" -ForegroundColor White
Write-Host "=====================================================" -ForegroundColor Cyan
