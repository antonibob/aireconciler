@echo off
rem ============================================================
rem  AI Closer — shared-folder manifest catalog
rem  Makes the add-in appear under Home > Add-ins > My Add-ins
rem  without hunting for a hidden Upload button in the Apps store.
rem ============================================================
setlocal
set "FOLDER=%~dp0..\manifests"

rem Ensure the folder exists so the REG_SZ path is valid.
if not exist "%FOLDER%" mkdir "%FOLDER%"
if not exist "%FOLDER%\manifest.xml" copy /Y "%~dp0..\manifest.xml" "%FOLDER%\manifest.xml" >nul

echo Setting AddInsSharedFolder to: %FOLDER%
reg add "HKCU\Software\Microsoft\Office\16.0\Excel\Options" /v AddInsSharedFolder /t REG_SZ /d "%FOLDER%" /f
reg query "HKCU\Software\Microsoft\Office\16.0\Excel\Options" /v AddInsSharedFolder

echo.
echo Done. Now restart Excel, go to File ^> Options ^> Trust Center ^> Trusted Add-in Catalogs,
echo add %FOLDER% as a trusted catalog with "Show in Menu", then Home ^> Add-ins ^> My Add-ins.
if "%PROCESSOR_ARCHITECTURE%"=="AMD64" (
  echo (Microsoft 365 current-channel builds may also show the add-in straight away.)
)
pause