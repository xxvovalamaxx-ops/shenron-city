param(
  [string]$SourceCommit = "b50b5b2"
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$sourceAssetsRoot = [IO.Path]::GetFullPath((Join-Path $repoRoot "SourceAssets"))
$targetRoot = [IO.Path]::GetFullPath(
  (Join-Path $sourceAssetsRoot "Animations\Raw\Unverified")
)

if (-not $targetRoot.StartsWith($sourceAssetsRoot, [StringComparison]::OrdinalIgnoreCase)) {
  throw "Refusing to restore outside SourceAssets: $targetRoot"
}

$expected = @(
  git -C $repoRoot ls-tree -r --name-only $SourceCommit -- Animations
).Count
if ($LASTEXITCODE -ne 0 -or $expected -eq 0) {
  throw "Commit $SourceCommit does not contain the expected Animations archive."
}

if (Test-Path -LiteralPath $targetRoot) {
  $existing = @(Get-ChildItem -LiteralPath $targetRoot -File -Filter "*.fbx").Count
  if ($existing -eq $expected) {
    Write-Host "Animation library already restored: $existing files in $targetRoot"
    exit 0
  }
  if ($existing -gt 0) {
    throw "Target contains $existing of $expected files. Resolve the partial restore manually."
  }
}

$tempRoot = Join-Path $repoRoot (".asset-restore-" + [guid]::NewGuid().ToString("N"))
$archivePath = Join-Path $tempRoot "animations.zip"
$extractRoot = Join-Path $tempRoot "extract"

try {
  New-Item -ItemType Directory -Path $tempRoot, $extractRoot -Force | Out-Null
  git -C $repoRoot archive --format=zip --output=$archivePath $SourceCommit Animations
  if ($LASTEXITCODE -ne 0) {
    throw "git archive failed for $SourceCommit."
  }

  Expand-Archive -LiteralPath $archivePath -DestinationPath $extractRoot
  $extractedRoot = Join-Path $extractRoot "Animations"
  $files = @(Get-ChildItem -LiteralPath $extractedRoot -File -Filter "*.fbx")
  if ($files.Count -ne $expected) {
    throw "Archive contains $($files.Count) FBX files; expected $expected."
  }

  New-Item -ItemType Directory -Path $targetRoot -Force | Out-Null
  foreach ($file in $files) {
    Move-Item -LiteralPath $file.FullName -Destination $targetRoot
  }

  $restored = @(Get-ChildItem -LiteralPath $targetRoot -File -Filter "*.fbx")
  $bytes = ($restored | Measure-Object -Property Length -Sum).Sum
  if ($restored.Count -ne $expected) {
    throw "Restore verification failed: found $($restored.Count), expected $expected."
  }

  Write-Host "Restored $($restored.Count) FBX files ($bytes bytes) to $targetRoot"
}
finally {
  $resolvedTemp = [IO.Path]::GetFullPath($tempRoot)
  if (
    (Test-Path -LiteralPath $resolvedTemp) -and
    $resolvedTemp.StartsWith($repoRoot, [StringComparison]::OrdinalIgnoreCase) -and
    ([IO.Path]::GetFileName($resolvedTemp)).StartsWith(".asset-restore-")
  ) {
    Remove-Item -LiteralPath $resolvedTemp -Recurse -Force
  }
}
