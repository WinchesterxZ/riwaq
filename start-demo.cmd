@echo off
setlocal
cd /d "%~dp0"
call "%~dp0start-postgres.cmd"
if errorlevel 1 exit /b 1
for /f "usebackq tokens=1,* delims==" %%A in ("%~dp0apps\api\.env") do if "%%A"=="DATABASE_URL" set "DATABASE_URL=%%B"
if not defined DATABASE_URL (
  echo DATABASE_URL is missing from apps\api\.env
  exit /b 1
)
set "DATABASE_URL=%DATABASE_URL:atlas_erp_dev=atlas_erp_demo%"
echo %DATABASE_URL% | findstr /r /c:"/atlas_erp_demo$" >nul
if errorlevel 1 (
  echo Refusing to start: the configured database is not atlas_erp_demo.
  exit /b 1
)
set "API_PORT=3001"
set "CORS_ORIGIN=http://localhost:5174"
start "Atlas Demo API" cmd /k "cd /d ""%~dp0apps\api"" && node dist\src\main.js"
set "VITE_API_BASE_URL=http://localhost:3001"
start "Atlas Demo Web" cmd /k "cd /d ""%~dp0apps\web"" && corepack pnpm exec vite --host 127.0.0.1 --port 5174 --strictPort"
echo Demo: http://localhost:5174
echo Login: demo@atlas.test / Demo12345!
