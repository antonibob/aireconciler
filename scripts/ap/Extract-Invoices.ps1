<#
    Pull the PO number and pre-tax net out of a folder of invoice PDFs,
    using Word to read them. No Python, no pip, nothing to install.

        powershell -ExecutionPolicy Bypass -File Extract-Invoices.ps1 -Folder "C:\Users\AntonioClair\ap-invoices"

    Writes invoices.csv into that folder: file, po, net, gross, invoice_no.

    Word opens each PDF invisibly, converts it in memory and closes it without
    saving. Nothing is modified. Expect a few seconds per file — 48 invoices
    takes a couple of minutes.

    Fields it cannot find are left blank rather than guessed: a blank prompts a
    look, a wrong number posts a wrong invoice.
#>
param(
    [string]$Folder = "."
)

$pdfs = Get-ChildItem -Path $Folder -Filter *.pdf -ErrorAction SilentlyContinue
if (-not $pdfs) { Write-Error "No PDFs found in $Folder"; exit 1 }

Write-Host "Reading $($pdfs.Count) PDFs with Word..." -ForegroundColor Cyan

# Talius POs are PO26xxxx / 26xxxx. Vendors write them many ways.
$poPatterns = @(
    'PO[\s#:\-]*(\d{6})',
    'purchase\s+order\s*(?:no\.?|number|#)?[\s:]*(\d{6})',
    'cust(?:omer)?\s*(?:order)?\s*(?:ref|po)?[\s#:]*(\d{6})',
    '\b(26\d{4})\b'
)
# Pre-tax figure only — Seradex computes its own tax, so the net must agree.
$netPatterns = @(
    '(?:total\s+)?net\s+amount[\s:]*\$?([\d,]+\.\d{2})',
    'sub[\s\-]?total[\s:]*\$?([\d,]+\.\d{2})',
    'net\s+value[\s:]*\$?([\d,]+\.\d{2})'
)
$grossPatterns = @(
    'total\s+amount[\s:]*\$?([\d,]+\.\d{2})',
    '(?:please\s+remit\s+this\s+amount|amount\s+due|grand\s+total)[\s:]*\$?([\d,]+\.\d{2})'
)
$invPatterns = @(
    'invoice\s*(?:no\.?|number|#)[\s:]*([A-Z0-9][A-Z0-9\-/]{3,})',
    'document\s+number[\s:]*([A-Z0-9][A-Z0-9\-/]{3,})'
)

function First-Match([string[]]$Patterns, [string]$Text) {
    foreach ($p in $Patterns) {
        $m = [regex]::Match($Text, $p, 'IgnoreCase')
        if ($m.Success) { return $m.Groups[1].Value.Trim() }
    }
    return ""
}

try {
    $word = New-Object -ComObject Word.Application
} catch {
    Write-Error "Could not start Word. Is Microsoft Word installed?"
    exit 1
}
$word.Visible = $false
$word.DisplayAlerts = 0

$rows = @()
foreach ($pdf in $pdfs) {
    $text = ""
    try {
        # ConfirmConversions=$false, ReadOnly=$true — opens the PDF silently
        $doc = $word.Documents.Open($pdf.FullName, $false, $true)
        $text = $doc.Content.Text
        $doc.Close($false)
    } catch {
        Write-Host ("  !! could not read {0}: {1}" -f $pdf.Name, $_.Exception.Message) -ForegroundColor Red
    }

    $po    = First-Match $poPatterns    $text
    $net   = (First-Match $netPatterns   $text) -replace ',', ''
    $gross = (First-Match $grossPatterns $text) -replace ',', ''
    $inv   = First-Match $invPatterns    $text

    $rows += [pscustomobject]@{
        file       = $pdf.Name
        po         = $po
        net        = $net
        gross      = $gross
        invoice_no = $inv
    }

    $flag = if ($po -and $net) { "" } else { "   <-- check by hand" }
    Write-Host ("  {0,-45} PO {1,-8} net {2,12}{3}" -f `
                $pdf.Name, $(if($po){$po}else{"?"}), $(if($net){$net}else{"?"}), $flag)
}

try { $word.Quit() } catch { }
[System.Runtime.InteropServices.Marshal]::ReleaseComObject($word) | Out-Null

$out = Join-Path $Folder "invoices.csv"
$rows | Export-Csv -Path $out -NoTypeInformation -Encoding UTF8

$missing = ($rows | Where-Object { -not $_.po -or -not $_.net }).Count
Write-Host ""
Write-Host "$($rows.Count) invoices -> $out" -ForegroundColor Green
if ($missing) { Write-Host "$missing need a manual look (PO or net not found)." -ForegroundColor Yellow }
