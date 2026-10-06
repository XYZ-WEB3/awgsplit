# deploy.ps1 - upload awgsplit to the router and run the installer.
# Usage:  powershell -ExecutionPolicy Bypass -File deploy.ps1 [-Router 192.168.1.1] [-NoDeps] [-FilesOnly]
# This file must stay pure ASCII: Windows PowerShell 5.1 reads BOM-less scripts as ANSI.

param(
    [string]$Router = "192.168.1.1",
    [string]$User   = "root",
    [switch]$NoDeps,
    [switch]$FilesOnly
)

$ErrorActionPreference = "Stop"
$here    = Split-Path -Parent $MyInvocation.MyCommand.Path
$remote  = "/tmp/awgsplit-deploy"
$target  = "$User@$Router"
$SshOpts = @("-o", "StrictHostKeyChecking=accept-new", "-o", "ConnectTimeout=10")

function Quote-Arg([string]$a) {
    if ($a -match '[\s"]') { return '"' + ($a -replace '"', '\"') + '"' }
    return $a
}

# Keep remote commands free of double quotes: PS 5.1 does not escape them for native programs.
function Invoke-Ssh([string]$command) {
    & ssh @SshOpts $target $command
    if ($LASTEXITCODE -ne 0) { throw "ssh failed (exit $LASTEXITCODE): $command" }
}

# Binary-safe upload: stream the file into 'cat' on the router (no scp/sftp needed).
function Send-File([string]$localPath, [string]$remotePath) {
    $psi = New-Object System.Diagnostics.ProcessStartInfo
    $psi.FileName = "ssh"
    $psi.Arguments = (($SshOpts + @($target, "cat > '$remotePath'")) | ForEach-Object { Quote-Arg $_ }) -join " "
    $psi.UseShellExecute = $false
    $psi.RedirectStandardInput = $true
    # .NET Framework wraps stdin in a StreamWriter with Console.InputEncoding and writes its
    # preamble on Start: with a UTF-8 console that is a BOM in front of the archive.
    # A BOM-less encoding for the duration of Start() prevents it.
    $prevEnc = $null
    try { $prevEnc = [Console]::InputEncoding } catch {}
    try {
        try { [Console]::InputEncoding = New-Object System.Text.UTF8Encoding($false) } catch {}
        $p = [System.Diagnostics.Process]::Start($psi)
    } finally {
        if ($prevEnc -ne $null) { try { [Console]::InputEncoding = $prevEnc } catch {} }
    }
    $fs = [System.IO.File]::OpenRead($localPath)
    try {
        $fs.CopyTo($p.StandardInput.BaseStream)
        $p.StandardInput.BaseStream.Flush()
    } finally {
        $fs.Close()
        $p.StandardInput.Close()
    }
    $p.WaitForExit()
    if ($p.ExitCode -ne 0) { throw "upload failed (exit $($p.ExitCode))" }
}

try {
    Write-Host "=== awgsplit -> $target ===" -ForegroundColor Cyan

    foreach ($need in @("files\usr\bin\awgsplit", "install.sh", "README.md")) {
        if (-not (Test-Path (Join-Path $here $need))) { throw "missing $need next to deploy.ps1" }
    }

    # 1. Staging copy with CR and UTF-8 BOM stripped (router scripts must be LF-only)
    Write-Host "[1/4] Preparing files..." -ForegroundColor Yellow
    $stage = Join-Path $env:TEMP ("awgsplit-stage-" + [guid]::NewGuid().ToString("N"))
    New-Item -ItemType Directory -Path $stage | Out-Null
    Copy-Item -Recurse (Join-Path $here "files") (Join-Path $stage "files")
    Copy-Item (Join-Path $here "install.sh") $stage
    Copy-Item (Join-Path $here "README.md") $stage
    Get-ChildItem -Recurse -File $stage | ForEach-Object {
        $b = [System.IO.File]::ReadAllBytes($_.FullName)
        $start = 0
        if ($b.Length -ge 3 -and $b[0] -eq 0xEF -and $b[1] -eq 0xBB -and $b[2] -eq 0xBF) { $start = 3 }
        $out = New-Object 'System.Collections.Generic.List[byte]' -ArgumentList $b.Length
        for ($i = $start; $i -lt $b.Length; $i++) { if ($b[$i] -ne 13) { $out.Add($b[$i]) } }
        [System.IO.File]::WriteAllBytes($_.FullName, $out.ToArray())
    }

    $tarPath = Join-Path $env:TEMP "awgsplit.tar.gz"
    if (Test-Path $tarPath) { Remove-Item $tarPath -Force }
    $tarExe = Join-Path $env:SystemRoot "System32\tar.exe"
    if (-not (Test-Path $tarExe)) { throw "tar.exe not found (Windows 10 1803+ required)" }
    & $tarExe --format=ustar -czf $tarPath -C $stage files install.sh README.md
    if ($LASTEXITCODE -ne 0) { throw "tar failed (exit $LASTEXITCODE)" }
    Remove-Item -Recurse -Force $stage
    $sizeKb = [math]::Round((Get-Item $tarPath).Length / 1KB, 1)
    Write-Host "      $tarPath ($sizeKb KB)" -ForegroundColor Green

    # 2. Upload
    Write-Host "[2/4] Uploading..." -ForegroundColor Yellow
    # private directory: nobody but root can touch the files before install.sh copies them
    Invoke-Ssh "rm -rf $remote && mkdir -m 700 $remote"
    Send-File $tarPath "$remote/awgsplit.tar.gz"

    # 3. Verify and unpack
    Write-Host "[3/4] Unpacking..." -ForegroundColor Yellow
    $localSize = (Get-Item $tarPath).Length
    $unpack = "set -e; cd $remote; " +
              "sz=`$(wc -c < awgsplit.tar.gz); [ `$sz -eq $localSize ] || { echo upload corrupted: `$sz bytes, expected $localSize; exit 3; }; " +
              "tar -xzf awgsplit.tar.gz; rm -f awgsplit.tar.gz; chmod -R go-w .; " +
              "chmod 755 install.sh files/usr/bin/awgsplit files/etc/init.d/awgsplit " +
              "files/usr/share/awgsplit/import-awg.sh files/usr/libexec/rpcd/luci.awgsplit; ls -la"
    Invoke-Ssh $unpack

    if ($FilesOnly) {
        Write-Host ""
        Write-Host "Files are in $remote. Installer was NOT run (-FilesOnly)." -ForegroundColor Green
        Write-Host "Run it manually:  ssh $target `"cd $remote && sh ./install.sh`"" -ForegroundColor Gray
        exit 0
    }

    # 4. Install
    Write-Host "[4/4] Running installer..." -ForegroundColor Yellow
    $flag = ""
    if ($NoDeps) { $flag = " --no-deps" }
    Invoke-Ssh "cd $remote && sh ./install.sh$flag"

    Write-Host ""
    Write-Host "Done. Open http://$Router/cgi-bin/luci/admin/services/awgsplit" -ForegroundColor Green
}
catch {
    Write-Host ""
    Write-Host "DEPLOY FAILED: $($_.Exception.Message)" -ForegroundColor Red
    Write-Host "If ssh says 'REMOTE HOST IDENTIFICATION HAS CHANGED' (router was reflashed), run:" -ForegroundColor Gray
    Write-Host "    ssh-keygen -R $Router" -ForegroundColor Gray
    exit 1
}
