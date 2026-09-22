<#
    Can synthetic keystrokes reach a RemoteApp window at all?

    Run this, then click into the Vendor Invoice No field in Seradex and wait.
    After the countdown it tries three input methods in turn, pausing between
    each so you can see which ones land.

    Nothing is saved. Type into a scratch field, or clear it afterwards.

        powershell -ExecutionPolicy Bypass -File scripts\seradex\test-typing.ps1

    If NOTHING lands: RemoteApp is rejecting synthetic input from this process
      -> retry in an elevated PowerShell (UIPI blocks un-elevated input into an
         elevated RDP client)
    If SLOW typing lands but FAST does not: pace the keystrokes.
    If CLIPBOARD lands and typing does not: drive entry by clipboard paste,
      which is the most robust option over RDP anyway.
#>

Add-Type -AssemblyName System.Windows.Forms

function Wait-WithPrompt([string]$Message, [int]$Seconds = 5) {
    Write-Host ""
    Write-Host $Message -ForegroundColor Cyan
    for ($i = $Seconds; $i -gt 0; $i--) {
        Write-Host "  $i..." -NoNewline
        Start-Sleep -Seconds 1
    }
    Write-Host ""
}

Write-Host "=== RemoteApp synthetic input test ===" -ForegroundColor Yellow
Write-Host "Click into a text field in Seradex now. Do not click back here."

Wait-WithPrompt "TEST 1 of 3 - fast typing (SendKeys, all at once)" 6
[System.Windows.Forms.SendKeys]::SendWait("FAST123")

Wait-WithPrompt "TEST 2 of 3 - slow typing (one character every 120ms)" 6
foreach ($ch in "SLOW456".ToCharArray()) {
    [System.Windows.Forms.SendKeys]::SendWait($ch)
    Start-Sleep -Milliseconds 120
}

Wait-WithPrompt "TEST 3 of 3 - clipboard paste (Ctrl+V)" 6
Set-Clipboard -Value "PASTE789"
Start-Sleep -Milliseconds 400          # let the clipboard cross the RDP channel
[System.Windows.Forms.SendKeys]::SendWait("^v")

Write-Host ""
Write-Host "Done. Which of FAST123 / SLOW456 / PASTE789 appeared in the field?" -ForegroundColor Yellow
Write-Host "That answers whether machine-driven entry is possible here."
