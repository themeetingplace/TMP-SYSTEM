@echo off
echo Starting BMS Server...
cd /d "%~dp0"
python -m http.server 8000
pause