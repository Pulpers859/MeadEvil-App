param(
    [Parameter(ValueFromRemainingArguments = $true)]
    [string[]]$ClaudeArgs
)

$repoRoot = 'C:\Dev\MeadEvilApp'

Set-Location -LiteralPath $repoRoot

$host.UI.RawUI.WindowTitle = 'MeadEvil Claude Code'

if (Get-Command claude -ErrorAction SilentlyContinue) {
    & claude @ClaudeArgs
    exit $LASTEXITCODE
}

Write-Error "The 'claude' command was not found on PATH."
exit 1
