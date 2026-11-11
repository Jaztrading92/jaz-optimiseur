# JAZ Optimiseur - mise a jour automatique depuis GitHub
#   Sans option   : verifie la derniere version sur GitHub et remplace les fichiers si elle est plus recente
#   -Install      : active la verification automatique (toutes les heures, tache Windows de l'utilisateur)
#   -Uninstall    : desactive la verification automatique
param([switch]$Install, [switch]$Uninstall, [string]$Dir = $PSScriptRoot)

$ErrorActionPreference = 'Stop'
$Repo = 'Jaztrading92/jaz-optimiseur'
$Task = 'JAZ Optimiseur - mises a jour'
$Log  = Join-Path $env:LOCALAPPDATA 'JAZ-Optimiseur-update.log'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

function Write-Log($m) { Add-Content -Path $Log -Value ("{0:yyyy-MM-dd HH:mm} {1}" -f (Get-Date), $m) -Encoding UTF8 }

if ($Uninstall) {
    Unregister-ScheduledTask -TaskName $Task -Confirm:$false -ErrorAction SilentlyContinue
    Write-Host 'Mises a jour automatiques desactivees.'
    exit 0
}

if ($Install) {
    $arg = "-NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$PSCommandPath`" -Dir `"$Dir`""
    $action  = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument $arg
    $trigger = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) -RepetitionInterval (New-TimeSpan -Hours 1)
    $set     = New-ScheduledTaskSettingsSet -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit (New-TimeSpan -Minutes 10)
    Register-ScheduledTask -TaskName $Task -Action $action -Trigger $trigger -Settings $set -Description 'Met a jour l extension JAZ Optimiseur depuis GitHub' -Force | Out-Null
    Write-Host "Mises a jour automatiques activees pour : $Dir"
    Write-Host 'Verification toutes les heures. Pour desactiver : jaz-update.ps1 -Uninstall'
    # premiere verification immediate
}

try {
    $manifest = Join-Path $Dir 'manifest.json'
    if (-not (Test-Path $manifest)) { throw "manifest.json introuvable dans $Dir" }
    $local = (Get-Content $manifest -Raw -Encoding UTF8 | ConvertFrom-Json).version
    $rel = Invoke-RestMethod "https://api.github.com/repos/$Repo/releases/latest" -Headers @{ 'User-Agent' = 'jaz-optimiseur-updater' }
    $latest = ($rel.tag_name -replace '^[vV]', '')
    if ([version]$latest -le [version]$local) { Write-Log "a jour ($local)"; exit 0 }

    $asset = $rel.assets | Where-Object { $_.name -eq 'JAZ-Optimiseur.zip' } | Select-Object -First 1
    if (-not $asset) { throw "JAZ-Optimiseur.zip absent de la release $($rel.tag_name)" }

    $tmp = Join-Path $env:TEMP ("jaz-upd-" + [guid]::NewGuid())
    New-Item -ItemType Directory -Path $tmp | Out-Null
    $zip = Join-Path $tmp 'jaz.zip'
    Invoke-WebRequest $asset.browser_download_url -OutFile $zip -UseBasicParsing -Headers @{ 'User-Agent' = 'jaz-optimiseur-updater' }
    Expand-Archive $zip -DestinationPath $tmp -Force
    $src = Join-Path $tmp 'JAZ-Optimiseur'
    $new = Join-Path $src 'manifest.json'
    if (-not (Test-Path $new)) { throw 'paquet invalide (manifest.json manquant)' }
    $newVersion = (Get-Content $new -Raw -Encoding UTF8 | ConvertFrom-Json).version
    if ($newVersion -ne $latest) { throw "version du paquet ($newVersion) differente de la release ($latest)" }

    # manifest.json en dernier : l'extension ne se recharge qu'une fois tous les fichiers en place
    Get-ChildItem $src -Recurse -File | Where-Object { $_.Name -ne 'manifest.json' } | ForEach-Object {
        $rel2 = $_.FullName.Substring($src.Length + 1)
        $dest = Join-Path $Dir $rel2
        New-Item -ItemType Directory -Force -Path (Split-Path $dest) | Out-Null
        Copy-Item $_.FullName $dest -Force
    }
    Copy-Item $new (Join-Path $Dir 'manifest.json') -Force
    Remove-Item $tmp -Recurse -Force -ErrorAction SilentlyContinue
    Write-Log "mis a jour $local -> $latest"
    if ($Install) { Write-Host "Extension mise a jour : $local -> $latest" }
} catch {
    Write-Log ("erreur : " + $_.Exception.Message)
    if ($Install) { Write-Host ("Verification impossible pour l'instant : " + $_.Exception.Message) }
}
