@echo off
rem BOM (Boite a Outils de Manifestation) : cree le depot GitHub, pousse le code et lance le GitHub Action.
rem A placer a la racine du dossier de l'app (a cote de package.json).
setlocal
cd /d "%~dp0"

set "REPO=manifestation-toolkit"
set /p "REPO=Nom du depot [manifestation-toolkit] : "
set "VERSION=v1.0.0"
set /p "VERSION=Version a publier [v1.0.0] : "
rem Le GitHub Action ne se declenche que sur les tags "v*" : on ajoute le "v" s'il manque.
if /i not "%VERSION:~0,1%"=="v" set "VERSION=v%VERSION%"

if not exist ".git" git init -q -b main
git add -A
git commit -q -m "BOM %VERSION%"

git remote get-url origin >nul 2>&1 || gh repo create "%REPO%" --public --source . --remote origin || goto :fail
git push -u origin HEAD || goto :fail

rem Le tag declenche le GitHub Action (build APK + IPA, puis Release)
git tag -a "%VERSION%" -m "Release %VERSION%" || goto :fail
git push origin "%VERSION%" || goto :fail

for /f "delims=" %%U in ('gh repo view --json url -q .url') do set "URL=%%U"
echo.
echo Build lance : %URL%/actions
start "" "%URL%/actions"
pause
exit /b 0

:fail
echo.
echo ERREUR : voir le message ci-dessus.
pause
exit /b 1
