@echo off
title MyCMS Development Server
echo ==================================================
echo MyCMS Development Server
echo ==================================================
cd /d "%~dp0" || (
  echo ERROR: No se pudo cambiar al directorio del proyecto.
  pause
  exit /b 1
)
echo Directorio actual: %CD%
echo.
echo Node version:
node -v || echo ERROR: Node no está instalado o no está en PATH.
echo.
echo NPM version:
npm -v || echo ERROR: npm no está instalado o no está en PATH.
echo.
echo Iniciando npm start...
call npm start
set EXITCODE=%ERRORLEVEL%
echo.
echo npm terminó con código %EXITCODE%.
pause
exit /b %EXITCODE%
