@echo off
net share OfficeAddins="C:\Users\AntonioClair\office-ai-closer\manifests" /grant:Everyone,READ
if errorlevel 1 (
  echo Failed to create share.
  pause
  exit /b 1
)
echo Share created: \\localhost\OfficeAddins
pause