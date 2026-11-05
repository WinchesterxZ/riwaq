@echo off
cd /d "%~dp0"
".local\postgresql\bin\pg_ctl.exe" -D ".local\pgdata" status >nul 2>&1
if not errorlevel 1 (
  echo PostgreSQL is already running.
  exit /b 0
)
".local\postgresql\bin\pg_ctl.exe" -D ".local\pgdata" -l ".local\postgres.log" -o "-h 127.0.0.1 -p 5432" start
