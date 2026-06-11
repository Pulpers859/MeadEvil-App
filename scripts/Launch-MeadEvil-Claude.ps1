param(
    [switch]$OpenInNewWindow,
    [Parameter(ValueFromRemainingArguments = $true)]
    [string[]]$ClaudeArgs
)

$scriptRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$repoRoot = [System.IO.Path]::GetFullPath((Join-Path $scriptRoot '..'))
$claudeMemoryPath = Join-Path $repoRoot 'CLAUDE.md'
$claudeSkillsPath = Join-Path $repoRoot '.claude\skills'

if ($OpenInNewWindow) {
    $forwardedArgs = @(
        '-NoExit'
        '-ExecutionPolicy', 'Bypass'
        '-File', $MyInvocation.MyCommand.Path
    )

    if ($null -ne $ClaudeArgs) {
        $forwardedArgs += @($ClaudeArgs | Where-Object { $null -ne $_ })
    }

    Start-Process -FilePath 'pwsh.exe' -WorkingDirectory $repoRoot -ArgumentList $forwardedArgs -WindowStyle Normal
    exit 0
}

if (-not (Test-Path -LiteralPath $repoRoot)) {
    Write-Error "Repo root not found: $repoRoot"
    exit 1
}

Set-Location -LiteralPath $repoRoot

$host.UI.RawUI.WindowTitle = 'MeadEvil Claude Code'

if (-not (Test-Path -LiteralPath $claudeMemoryPath)) {
    Write-Warning "Expected Claude memory file was not found: $claudeMemoryPath"
}

if (-not (Test-Path -LiteralPath $claudeSkillsPath)) {
    Write-Warning "Expected Claude skills folder was not found: $claudeSkillsPath"
}

$claudeCommand = Get-Command claude -ErrorAction SilentlyContinue

if (-not $claudeCommand) {
    Write-Error "The 'claude' command was not found on PATH."
    exit 1
}

& $claudeCommand.Source @ClaudeArgs
exit $LASTEXITCODE
