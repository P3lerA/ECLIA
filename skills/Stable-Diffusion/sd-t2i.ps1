Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$pyScript = Join-Path $PSScriptRoot "sd-t2i.py"
if (-not (Test-Path -LiteralPath $pyScript)) {
  [Console]::Error.WriteLine("sd-t2i.py not found next to this ps1: " + $pyScript)
  exit 2
}

# Prefer "python", fall back to "py -3"
$pythonCmd = Get-Command python -ErrorAction SilentlyContinue
if ($null -ne $pythonCmd) {
  & python $pyScript @args
  exit $LASTEXITCODE
}

$pyLauncher = Get-Command py -ErrorAction SilentlyContinue
if ($null -ne $pyLauncher) {
  & py -3 $pyScript @args
  exit $LASTEXITCODE
}

[Console]::Error.WriteLine("Python not found (python/py).")
exit 127
