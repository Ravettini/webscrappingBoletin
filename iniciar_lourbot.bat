@echo off
setlocal

cd /d "%~dp0"

if not exist "app.py" (
    echo.
    echo ERROR: No se encuentra app.py en esta carpeta:
    echo   %CD%
    echo.
    echo Solucion: descomprimi el ZIP/RAR completo y ejecuta este .bat
    echo desde DENTRO de la carpeta que contiene app.py.
    echo Si ves dos carpetas "webscrapping" anidadas, abri la que tiene app.py.
    echo.
    pause
    exit /b 1
)

where python >nul 2>nul
if %errorlevel%==0 (
    set "PY_CMD=python"
) else (
    set "PY_CMD=py"
)

echo Carpeta: %CD%
echo Iniciando LourBot con %PY_CMD% app.py ...
rem /D fuerza el directorio de trabajo en la ventana nueva (evita error "no such file")
start "LourBot Server" /D "%~dp0" cmd /k "%PY_CMD% app.py"

timeout /t 3 /nobreak >nul
start "" "http://localhost:10000/"

endlocal
