@echo off
echo ===================================================
echo     INITIATING IVORY COMMAND INTELLIGENCE
echo ===================================================
echo.
echo Starting Backend Server...
cd /d "%~dp0backend"
    start "Ivory Command Backend" cmd /k "python -m uvicorn app.main:app --host 0.0.0.0 --port 8000"

echo Starting Frontend Server...
cd /d "%~dp0frontend"
    start "Ivory Command Frontend" cmd /k "npm run dev"

echo.
echo Launching interface...
    timeout /t 4 /nobreak

start http://localhost:5173/

exit
