param(
  [string]$BaseUrl = "https://gluco-letter-worker.afterglow21.workers.dev",
  [string]$AllowedOrigin = "https://afterglow21.github.io",
  [string]$BlockedOrigin = "https://example.invalid"
)

$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Net.Http

$usageUrl = "$BaseUrl/api/gluco-letter/usage"
$letterUrl = "$BaseUrl/api/gluco-letter"
$client = [System.Net.Http.HttpClient]::new()

function Assert-Equal {
  param(
    [string]$Label,
    $Actual,
    $Expected
  )

  if ($Actual -ne $Expected) {
    throw "$Label failed. Expected '$Expected', got '$Actual'."
  }

  Write-Host "[PASS] $Label" -ForegroundColor Green
}

function Get-HeaderValue {
  param(
    [System.Net.Http.HttpResponseMessage]$Response,
    [string]$Name
  )

  $values = $null
  if ($Response.Headers.TryGetValues($Name, [ref]$values)) {
    return ($values -join ", ")
  }
  if ($Response.Content.Headers.TryGetValues($Name, [ref]$values)) {
    return ($values -join ", ")
  }
  return $null
}

function Invoke-HttpCheck {
  param(
    [string]$Uri,
    [string]$Method = "GET",
    [hashtable]$Headers = @{}
  )

  $request = [System.Net.Http.HttpRequestMessage]::new(
    [System.Net.Http.HttpMethod]::new($Method),
    $Uri
  )

  foreach ($entry in $Headers.GetEnumerator()) {
    [void]$request.Headers.TryAddWithoutValidation($entry.Key, [string]$entry.Value)
  }

  try {
    return $client.SendAsync($request).GetAwaiter().GetResult()
  } finally {
    $request.Dispose()
  }
}

try {
  Write-Host "Testing CORS against $BaseUrl" -ForegroundColor Cyan

  $preflight = Invoke-HttpCheck -Uri $letterUrl -Method OPTIONS -Headers @{
    Origin = $AllowedOrigin
    "Access-Control-Request-Method" = "POST"
    "Access-Control-Request-Headers" = "content-type"
  }
  Assert-Equal "Allowed preflight status" ([int]$preflight.StatusCode) 204
  Assert-Equal "Allowed preflight origin" (Get-HeaderValue $preflight "Access-Control-Allow-Origin") $AllowedOrigin
  $preflight.Dispose()

  $allowedGet = Invoke-HttpCheck -Uri $usageUrl -Headers @{ Origin = $AllowedOrigin }
  Assert-Equal "Allowed Origin GET status" ([int]$allowedGet.StatusCode) 200
  Assert-Equal "Allowed Origin response header" (Get-HeaderValue $allowedGet "Access-Control-Allow-Origin") $AllowedOrigin
  $allowedGet.Dispose()

  $blockedGet = Invoke-HttpCheck -Uri $usageUrl -Headers @{ Origin = $BlockedOrigin }
  Assert-Equal "Blocked Origin GET status" ([int]$blockedGet.StatusCode) 403
  if (Get-HeaderValue $blockedGet "Access-Control-Allow-Origin") {
    throw "Blocked Origin unexpectedly received Access-Control-Allow-Origin."
  }
  Write-Host "[PASS] Blocked Origin has no allow-origin header" -ForegroundColor Green
  $blockedGet.Dispose()

  $noOriginGet = Invoke-HttpCheck -Uri $usageUrl
  Assert-Equal "No-Origin operational GET status" ([int]$noOriginGet.StatusCode) 200
  $noOriginGet.Dispose()

  Write-Host "All CORS checks passed." -ForegroundColor Green
} finally {
  $client.Dispose()
}
