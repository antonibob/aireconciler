<#
    Dump the UI Automation tree of a window — no Python, no installs.
    Uses the UIAutomation assemblies that ship with Windows.

    Read-only: it inspects what is on screen and prints identifiers.
    It clicks nothing, types nothing, and changes nothing.

        .\inspect-window.ps1                        # list open windows
        .\inspect-window.ps1 -Match "Invoice"       # dump a window's controls
        .\inspect-window.ps1 -Match "Invoice" | Out-File invoice-tree.txt

    Open the Seradex screen you want FIRST, then run this against it.
#>
param(
    [string]$Match,
    [int]$MaxDepth = 10
)

Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes

$AE   = [System.Windows.Automation.AutomationElement]
$TS   = [System.Windows.Automation.TreeScope]
$TRUE_COND = [System.Windows.Automation.Condition]::TrueCondition

function Get-TopWindows {
    try   { return $AE::RootElement.FindAll($TS::Children, $TRUE_COND) }
    catch { Write-Error "Could not read the desktop: $_"; return @() }
}

if (-not $Match) {
    Write-Output "Visible top-level windows:"
    Write-Output ""
    foreach ($w in Get-TopWindows) {
        try {
            $name = $w.Current.Name
            if ($name) {
                Write-Output ("  {0}    [class: {1}]" -f $name, $w.Current.ClassName)
            }
        } catch { }
    }
    Write-Output ""
    Write-Output "Re-run with part of a title, e.g.:"
    Write-Output "    .\inspect-window.ps1 -Match 'Invoice' | Out-File invoice-tree.txt"
    return
}

function Write-Element {
    param($Element, [int]$Depth)

    if ($Depth -gt $MaxDepth) { return }

    try {
        $c        = $Element.Current
        $type     = $c.ControlType.ProgrammaticName -replace '^ControlType\.', ''
        $name     = $c.Name
        $autoId   = $c.AutomationId
        $class    = $c.ClassName
        $enabled  = $c.IsEnabled
    } catch {
        return   # element disappeared mid-walk
    }

    $pad = ' ' * ($Depth * 2)
    Write-Output ("{0}{1} | name='{2}' | autoId='{3}' | class='{4}' | enabled={5}" -f `
                  $pad, $type, $name, $autoId, $class, $enabled)

    try   { $children = $Element.FindAll($TS::Children, $TRUE_COND) }
    catch { return }

    foreach ($child in $children) { Write-Element -Element $child -Depth ($Depth + 1) }
}

$found = $false
foreach ($w in Get-TopWindows) {
    try { $title = $w.Current.Name } catch { continue }
    if ($title -and $title -like "*$Match*") {
        $found = $true
        Write-Output "===== $title ====="
        Write-Element -Element $w -Depth 0
        Write-Output ""
    }
}

if (-not $found) {
    Write-Output "No window title contained '$Match'. Run with no arguments to list them."
}
