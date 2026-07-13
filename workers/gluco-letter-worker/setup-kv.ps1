$ErrorActionPreference = "Stop"

Push-Location $PSScriptRoot
try {
  Write-Host "Installing Worker dependencies..." -ForegroundColor Cyan
  npm ci

  $configPath = Join-Path $PSScriptRoot "wrangler.toml"
  $configText = Get-Content $configPath -Raw

  if ($configText -match 'binding\s*=\s*"AI_LETTER_CACHE"') {
    Write-Host "AI_LETTER_CACHE binding is already present in wrangler.toml." -ForegroundColor Green
  }
  else {
    Write-Host "Creating the production Workers KV namespace and updating wrangler.toml..." -ForegroundColor Cyan
    npx wrangler kv namespace create glucoscope-ai-letter-cache `
      --binding AI_LETTER_CACHE `
      --update-config

    if ($LASTEXITCODE -ne 0) {
      throw "Wrangler could not create or bind AI_LETTER_CACHE."
    }
  }

  Write-Host "Checking Worker syntax and deployment bundle..." -ForegroundColor Cyan
  node --check src/index.js
  npx wrangler deploy --dry-run

  if ($LASTEXITCODE -ne 0) {
    throw "Worker dry-run failed."
  }

  Write-Host ""
  Write-Host "KV setup is ready." -ForegroundColor Green
  Write-Host "Review git diff, then deploy with: npx wrangler deploy" -ForegroundColor Yellow
}
finally {
  Pop-Location
}
