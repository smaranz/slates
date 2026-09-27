# Sets up the local AI detector on Windows: a Python environment with a GPU
# build of PyTorch, and the MELD weights. The Windows twin of install.sh.
#
# Everything lands under %USERPROFILE%\.slates\meld, like on the Mac. -Gpu picks
# the AMD architecture for AMD's ROCm build of PyTorch (gfx1200 is the RX 9060
# family, gfx1201 the RX 9070s, gfx1100 the RX 7900s); -Gpu cpu installs the
# plain CPU build instead. Re-running is safe: it skips what it already has.
#
#   powershell -ExecutionPolicy Bypass -File detector\install.ps1 [-Gpu gfx1200]

param([string]$Gpu = "gfx1200")
$ErrorActionPreference = "Stop"

$root = Join-Path $env:USERPROFILE ".slates\meld"
$venv = Join-Path $root "venv"
$model = Join-Path $root "model"
$py = Join-Path $venv "Scripts\python.exe"
New-Item -ItemType Directory -Force $model | Out-Null

if (-not (Test-Path $py)) {
  Write-Host "Creating a Python environment in $venv"
  py -3.12 -m venv $venv
}

Write-Host "Installing PyTorch ($Gpu) — the slow part"
& $py -m pip install --quiet --upgrade pip
if ($Gpu -eq "cpu") {
  & $py -m pip install --quiet torch
} else {
  & $py -m pip install --quiet --index-url https://stable.repo.amd.com/rocm/whl-next/ "torch[device-$Gpu]==2.13.0+rocm10.0.0"
}
& $py -m pip install --quiet "transformers==5.17.0" safetensors
& $py -c "import torch, transformers; print(f'torch {torch.__version__} · transformers {transformers.__version__} · GPU: {torch.cuda.get_device_name(0) if torch.cuda.is_available() else None}')"

Write-Host "Fetching MELD"
$base = "https://huggingface.co/anon-review-meld-2026/meld/resolve/main/"
foreach ($name in "config.json", "meld_config.json", "tokenizer.json", "tokenizer_config.json", "special_tokens_map.json", "model.safetensors") {
  $out = Join-Path $model $name
  if ((Test-Path $out) -and (Get-Item $out).Length -gt 0) { Write-Host "  ${name}: already here"; continue }
  Write-Host "  ${name}: downloading…"
  Invoke-WebRequest -UseBasicParsing -Uri ($base + $name) -OutFile $out
}

Write-Host ""
Write-Host "Done. Slates starts the detector on first use and keeps it warm."
