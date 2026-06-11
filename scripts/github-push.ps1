# Tek tikla GitHub yukleme
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
Set-Location $root

$configPath = Join-Path $root ".github-push.local"

function Get-PushConfig {
    if (Test-Path $configPath) {
        return Get-Content $configPath -Raw | ConvertFrom-Json
    }
    return $null
}

function Save-PushConfig($url) {
    @{ remoteUrl = $url.Trim() } | ConvertTo-Json | Set-Content $configPath -Encoding UTF8
}

function Ensure-Git {
    git --version *> $null
    if ($LASTEXITCODE -ne 0) {
        throw "Git kurulu degil. https://git-scm.com/download/win adresinden kurun."
    }
    if (-not (Test-Path (Join-Path $root ".git"))) {
        git init | Out-Null
    }
}

function Setup-FirstTime {
    Write-Host ""
    Write-Host "========================================" -ForegroundColor Cyan
    Write-Host "  ILK KURULUM (sadece bir kez)" -ForegroundColor Cyan
    Write-Host "========================================" -ForegroundColor Cyan
    Write-Host ""
    Write-Host "GitHub'da bos bir repo olusturun (README eklemeyin)." -ForegroundColor Yellow
    Write-Host ""

    $choice = Read-Host "Repo adresini biliyor musunuz? (E/H)"
    if ($choice -match '^[Ee]') {
        $url = Read-Host "Tam repo adresi (orn: https://github.com/kullanici/repo.git)"
    } else {
        $user = Read-Host "GitHub kullanici adiniz"
        $repo = Read-Host "Repo adiniz"
        $url = "https://github.com/$user/$repo.git"
    }

    if (-not $url -or $url -notmatch 'github\.com') {
        throw "Gecersiz GitHub adresi."
    }

    Save-PushConfig $url
    Write-Host ""
    Write-Host "Kaydedildi: $url" -ForegroundColor Green
    return @{ remoteUrl = $url }
}

function Ensure-Remote($url) {
    $remotes = git remote 2>$null
    if ($remotes -contains "origin") {
        git remote set-url origin $url | Out-Null
    } else {
        git remote add origin $url
    }
    git branch -M main 2>$null | Out-Null
}

function Show-TokenHelp {
    Write-Host ""
    Write-Host "----------------------------------------" -ForegroundColor Yellow
    Write-Host "  SIFRE SORULURSA:" -ForegroundColor Yellow
    Write-Host "  Kullanici adi = GitHub adiniz" -ForegroundColor Yellow
    Write-Host "  Sifre         = Personal Access Token" -ForegroundColor Yellow
    Write-Host "  (GitHub > Settings > Developer settings > Tokens)" -ForegroundColor Yellow
    Write-Host "----------------------------------------" -ForegroundColor Yellow
    Write-Host ""
}

try {
    Ensure-Git

    $config = Get-PushConfig
    if (-not $config) {
        $config = Setup-FirstTime
    }

    $url = $config.remoteUrl
    Ensure-Remote $url

    Write-Host ""
    Write-Host "Dosyalar hazirlaniyor..." -ForegroundColor Cyan
    git add .

    $changes = git status --porcelain
    if ($changes) {
        $msg = "Guncelleme $(Get-Date -Format 'yyyy-MM-dd HH:mm')"
        git commit -m $msg
        Write-Host "Kayit olusturuldu." -ForegroundColor Green
    } else {
        Write-Host "Yeni degisiklik yok, mevcut kayit gonderiliyor..." -ForegroundColor Gray
    }

    Show-TokenHelp
    Write-Host "GitHub'a gonderiliyor..." -ForegroundColor Cyan
    git push -u origin main

    if ($LASTEXITCODE -eq 0) {
        Write-Host ""
        Write-Host "========================================" -ForegroundColor Green
        Write-Host "  BASARILI! Proje GitHub'a yuklendi." -ForegroundColor Green
        Write-Host "  $url" -ForegroundColor Green
        Write-Host "========================================" -ForegroundColor Green
    } else {
        throw "Push basarisiz oldu."
    }
} catch {
    Write-Host ""
    Write-Host "HATA: $($_.Exception.Message)" -ForegroundColor Red
    exit 1
}

Write-Host ""
Read-Host "Kapatmak icin Enter'a basin"
