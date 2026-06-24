param(
  [int]$MaxAttempts = 3,
  [string]$Message = "Upload full Edge audio",
  [switch]$CleanupLocalAudio
)

$ErrorActionPreference = "Stop"

$repo = Resolve-Path "."
$logDir = Join-Path $repo "logs"
New-Item -ItemType Directory -Force -Path $logDir | Out-Null
$logPath = Join-Path $logDir "full-edge-audio.log"

function Write-Log {
  param([string]$Message)
  $line = "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') $Message"
  Add-Content -LiteralPath $logPath -Value $line -Encoding UTF8
  Write-Output $line
}

function Run-Step {
  param([string[]]$CommandArgs)
  & $python @CommandArgs 2>&1 | Tee-Object -FilePath $logPath -Append
  if ($LASTEXITCODE -ne 0) {
    throw "Command failed: $python $($CommandArgs -join ' ')"
  }
}

function Remove-LocalAudioArtifacts {
  $audioDir = (Resolve-Path "doc-truyen-vip\audio").Path
  $targets = @(
    (Join-Path $audioDir "*.mp3"),
    (Join-Path $audioDir ".chunks")
  )

  foreach ($target in $targets) {
    if ($target.EndsWith("*.mp3")) {
      Get-ChildItem -LiteralPath $audioDir -Filter "*.mp3" -File | ForEach-Object {
        $resolved = [System.IO.Path]::GetFullPath($_.FullName)
        if (-not $resolved.StartsWith($audioDir, [System.StringComparison]::OrdinalIgnoreCase)) {
          throw "Unsafe audio cleanup path: $resolved"
        }
        Remove-Item -LiteralPath $resolved -Force
      }
    } elseif (Test-Path -LiteralPath $target) {
      $resolved = [System.IO.Path]::GetFullPath($target)
      if (-not $resolved.StartsWith($audioDir, [System.StringComparison]::OrdinalIgnoreCase)) {
        throw "Unsafe chunk cleanup path: $resolved"
      }
      Remove-Item -LiteralPath $resolved -Recurse -Force
    }
  }

  Write-Log "Cleaned local MP3 files and chunk cache after successful upload."
}

$python = "python"
$bundledPython = "C:\Users\thanh\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe"
if (Test-Path $bundledPython) {
  $python = $bundledPython
}

$presets = @("nu-cam-xuc", "nam-tram")
$chapters = & $python -c "import json,re; from pathlib import Path; text=Path('doc-truyen-vip/data.js').read_text(encoding='utf-8'); data=json.loads(text[len('window.STORY_DATA = '):].rstrip().rstrip(';')); print('\n'.join(c['id'] for s in data['stories'] for c in s['chapters']))"
if ($LASTEXITCODE -ne 0) { throw "Cannot list chapters." }

Write-Log "Start full Edge audio job. chapters=$($chapters.Count) presets=$($presets -join ',')"

$failed = @()
foreach ($chapter in $chapters) {
  foreach ($preset in $presets) {
    $ok = $false
    for ($attempt = 1; $attempt -le $MaxAttempts; $attempt++) {
      try {
        Write-Log "Generate chapter=$chapter preset=$preset attempt=$attempt/$MaxAttempts"
        Run-Step @("tools\generate_chapter_audio.py", "--chapter", $chapter, "--preset", $preset, "--engine", "video")
        Run-Step @("tools\verify_audio.py", "--chapter", $chapter, "--preset", $preset)
        Run-Step @("tools\build_doc_truyen_data.py")
        $ok = $true
        break
      } catch {
        Write-Log "FAILED chapter=$chapter preset=$preset attempt=$attempt error=$($_.Exception.Message)"
        Start-Sleep -Seconds ([Math]::Min(120, 20 * $attempt))
      }
    }
    if (-not $ok) {
      $failed += "$chapter/$preset"
    }
  }
}

Run-Step @("tools\build_doc_truyen_data.py")

if ($failed.Count -gt 0) {
  Write-Log "Audio job finished with failures: $($failed -join ', ')"
  exit 1
}

Write-Log "All audio generated and verified. Running syntax checks."
& "C:\Users\thanh\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe" --check doc-truyen-vip\app.js 2>&1 | Tee-Object -FilePath $logPath -Append
if ($LASTEXITCODE -ne 0) { throw "app.js syntax check failed." }
& "C:\Users\thanh\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe" --check doc-truyen-vip\data.js 2>&1 | Tee-Object -FilePath $logPath -Append
if ($LASTEXITCODE -ne 0) { throw "data.js syntax check failed." }

git add doc-truyen-vip/audio doc-truyen-vip/data.js tools/generate_chapter_audio.py tools/run_full_edge_audio_job.ps1 doc-truyen-vip/audio/verified-audio.json
git commit -m $Message 2>&1 | Tee-Object -FilePath $logPath -Append
if ($LASTEXITCODE -ne 0) {
  Write-Log "Nothing to commit or git commit failed."
  exit $LASTEXITCODE
}

git push origin main 2>&1 | Tee-Object -FilePath $logPath -Append
if ($LASTEXITCODE -ne 0) { throw "git push failed." }

Write-Log "Full Edge audio uploaded successfully."

if ($CleanupLocalAudio) {
  Remove-LocalAudioArtifacts
}
