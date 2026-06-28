@echo off
REM Start ScoreSense API + React dev server (run from project root)
set ROOT=%~dp0..\..
cd /d "%ROOT%"
set PYTHONPATH=%ROOT%

echo Starting FastAPI on http://127.0.0.1:8000 ...
start "ScoreSense API" cmd /k ".venv\Scripts\uvicorn app.api:app --reload --port 8000"

timeout /t 2 /nobreak >nul

echo Starting React on http://localhost:5173 ...
cd frontend
call npm run dev
