@echo off
rem Double-cliquez sur ce fichier une seule fois : l'extension JAZ se mettra ensuite a jour toute seule.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0jaz-update.ps1" -Install
echo.
pause
