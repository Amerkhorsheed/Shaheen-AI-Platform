# =====================================================================
# Shaheen AI Platform / Windows OpenSSH Server Full Setup Script
# =====================================================================
[CmdletBinding()]
param()

$ErrorActionPreference = "Stop"

function Test-Admin {
    $currentPrincipal = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
    return $currentPrincipal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

# Auto-elevate if not running as Administrator
if (-not (Test-Admin)) {
    Write-Host "[*] Elevation required. Requesting Administrator permissions..." -ForegroundColor Yellow
    Start-Process powershell.exe -ArgumentList ("-NoProfile -ExecutionPolicy Bypass -File `"$PSCommandPath`"") -Verb RunAs
    exit
}

Write-Host "=====================================================" -ForegroundColor Cyan
Write-Host "   Windows 11 OpenSSH Server Automated Setup" -ForegroundColor Cyan
Write-Host "=====================================================" -ForegroundColor Cyan
Write-Host ""

# 1. Install OpenSSH Server
Write-Host "[1/6] Checking OpenSSH Server installation..." -ForegroundColor Yellow
$capability = Get-WindowsCapability -Online | Where-Object { $_.Name -like "OpenSSH.Server*" }

if ($capability.State -ne "Installed") {
    Write-Host "      Installing OpenSSH.Server capability (this may take a couple minutes)..." -ForegroundColor Cyan
    try {
        Add-WindowsCapability -Online -Name OpenSSH.Server~~~~0.0.1.0 -ErrorAction Stop
        Write-Host "      [OK] OpenSSH Server capability installed successfully." -ForegroundColor Green
    }
    catch {
        Write-Host "      Windows Capability install encountered an issue: $_" -ForegroundColor DarkYellow
        Write-Host "      Attempting fallback install via winget..." -ForegroundColor Cyan
        winget install Microsoft.OpenSSH.Preview --silent --accept-package-agreements --accept-source-agreements
    }
} else {
    Write-Host "      [OK] OpenSSH Server is already installed." -ForegroundColor Green
}

# 2. Configure Windows Services (sshd and ssh-agent)
Write-Host "[2/6] Configuring SSH Services (sshd, ssh-agent)..." -ForegroundColor Yellow

$sshd = Get-Service -Name "sshd" -ErrorAction SilentlyContinue
if ($sshd) {
    Set-Service -Name "sshd" -StartupType 'Automatic'
    if ($sshd.Status -ne 'Running') {
        Start-Service "sshd"
    }
    Write-Host "      [OK] 'sshd' service configured as Automatic and Started." -ForegroundColor Green
} else {
    Write-Error "Could not find 'sshd' service after installation."
}

$sshAgent = Get-Service -Name "ssh-agent" -ErrorAction SilentlyContinue
if ($sshAgent) {
    Set-Service -Name "ssh-agent" -StartupType 'Automatic'
    if ($sshAgent.Status -ne 'Running') {
        Start-Service "ssh-agent"
    }
    Write-Host "      [OK] 'ssh-agent' service configured as Automatic and Started." -ForegroundColor Green
}

# 3. Configure Windows Firewall
Write-Host "[3/6] Configuring Windows Firewall for Port 22..." -ForegroundColor Yellow
$firewallRule = Get-NetFirewallRule -Name "OpenSSH-Server-In-TCP" -ErrorAction SilentlyContinue
if (-not $firewallRule) {
    New-NetFirewallRule -Name 'OpenSSH-Server-In-TCP' `
                        -DisplayName 'OpenSSH SSH Server (sshd)' `
                        -Description 'Inbound rule for OpenSSH Server (port 22)' `
                        -Enabled True `
                        -Direction Inbound `
                        -Protocol TCP `
                        -Action Allow `
                        -LocalPort 22 | Out-Null
    Write-Host "      [OK] Created firewall rule 'OpenSSH-Server-In-TCP' for port 22." -ForegroundColor Green
} else {
    Set-NetFirewallRule -Name "OpenSSH-Server-In-TCP" -Enabled True -Action Allow | Out-Null
    Write-Host "      [OK] Firewall rule 'OpenSSH-Server-In-TCP' verified and enabled." -ForegroundColor Green
}

# 4. Set Default SSH Shell to Windows PowerShell
Write-Host "[4/6] Setting default SSH shell to PowerShell..." -ForegroundColor Yellow
$openSSHRegPath = "HKLM:\SOFTWARE\OpenSSH"
if (-not (Test-Path $openSSHRegPath)) {
    New-Item -Path $openSSHRegPath -Force | Out-Null
}
$powershellPath = "$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe"
New-ItemProperty -Path $openSSHRegPath -Name DefaultShell -Value $powershellPath -PropertyType String -Force | Out-Null
Write-Host "      [OK] Default SSH shell set to: $powershellPath" -ForegroundColor Green

# 5. Optimize sshd_config and Authentication
Write-Host "[5/6] Tuning sshd_config for key and password authentication..." -ForegroundColor Yellow
$sshdConfigPath = "$env:ProgramData\ssh\sshd_config"
if (Test-Path $sshdConfigPath) {
    $configContent = Get-Content $sshdConfigPath -Raw

    # Comment out the default administrator redirect that breaks ~/.ssh/authorized_keys
    if ($configContent -match "Match Group administrators") {
        $configContent = $configContent -replace '(?m)^(\s*Match Group administrators)', '# $1'
        $configContent = $configContent -replace '(?m)^(\s*AuthorizedKeysFile __PROGRAMDATA__/ssh/administrators_authorized_keys)', '# $1'
    }

    # Ensure PubkeyAuthentication is yes
    if ($configContent -match '(?m)^#?\s*PubkeyAuthentication\s+') {
        $configContent = $configContent -replace '(?m)^#?\s*PubkeyAuthentication\s+.*$', 'PubkeyAuthentication yes'
    } else {
        $configContent += "`nPubkeyAuthentication yes`n"
    }

    # Ensure PasswordAuthentication is yes
    if ($configContent -match '(?m)^#?\s*PasswordAuthentication\s+') {
        $configContent = $configContent -replace '(?m)^#?\s*PasswordAuthentication\s+.*$', 'PasswordAuthentication yes'
    } else {
        $configContent += "`nPasswordAuthentication yes`n"
    }

    Set-Content -Path $sshdConfigPath -Value $configContent -Encoding UTF8
    Write-Host "      [OK] Updated sshd_config settings." -ForegroundColor Green
}

# 6. Prepare user .ssh directory and correct ACL permissions
Write-Host "[6/6] Configuring SSH user directory and ACL permissions..." -ForegroundColor Yellow
$targetUser = $env:USERNAME
$userHome = $env:USERPROFILE
$dotSshPath = Join-Path $userHome ".ssh"
$authKeysPath = Join-Path $dotSshPath "authorized_keys"

if (-not (Test-Path $dotSshPath)) {
    New-Item -ItemType Directory -Path $dotSshPath -Force | Out-Null
}

if (-not (Test-Path $authKeysPath)) {
    New-Item -ItemType File -Path $authKeysPath -Force | Out-Null
}

# Fix ACLs on authorized_keys (OpenSSH requires strict permissions)
$acl = Get-Acl -Path $authKeysPath
$acl.SetAccessRuleProtection($true, $false) # Remove inheritance
$adminRule = New-Object Security.AccessControl.FileSystemAccessRule("BUILTIN\Administrators", "FullControl", "Allow")
$systemRule = New-Object Security.AccessControl.FileSystemAccessRule("NT AUTHORITY\SYSTEM", "FullControl", "Allow")
$userRule = New-Object Security.AccessControl.FileSystemAccessRule("$targetUser", "FullControl", "Allow")

$acl.SetAccessRule($adminRule)
$acl.AddAccessRule($systemRule)
$acl.AddAccessRule($userRule)
Set-Acl -Path $authKeysPath -AclObject $acl

# Also ensure C:\ProgramData\ssh\administrators_authorized_keys exists with proper ACL
$adminAuthKeys = "$env:ProgramData\ssh\administrators_authorized_keys"
if (-not (Test-Path $adminAuthKeys)) {
    New-Item -ItemType File -Path $adminAuthKeys -Force | Out-Null
}
$adminAcl = Get-Acl -Path $adminAuthKeys
$adminAcl.SetAccessRuleProtection($true, $false)
$adminAcl.SetAccessRule($adminRule)
$adminAcl.AddAccessRule($systemRule)
Set-Acl -Path $adminAuthKeys -AclObject $adminAcl

# Restart SSH service to apply all configuration changes
Restart-Service -Name "sshd"
Write-Host "      [OK] sshd service restarted with updated configuration." -ForegroundColor Green

Write-Host ""
Write-Host "=====================================================" -ForegroundColor Green
Write-Host "   OpenSSH Server is LIVE and READY!" -ForegroundColor Green
Write-Host "=====================================================" -ForegroundColor Green

# Print connection instructions
$ipAddresses = (Get-NetIPAddress -AddressFamily IPv4 | Where-Object { $_.InterfaceAlias -notlike "*Loopback*" -and $_.IPAddress -notlike "169.254*" }).IPAddress
Write-Host "Local LAN IP Address(es):" -ForegroundColor Cyan
foreach ($ip in $ipAddresses) {
    Write-Host "  -> ssh `"$targetUser`"@$ip" -ForegroundColor White
}
Write-Host ""
Write-Host "Authorized keys file location:" -ForegroundColor Cyan
Write-Host "  $authKeysPath" -ForegroundColor White
Write-Host ""
