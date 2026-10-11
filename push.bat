@echo off
setlocal enabledelayedexpansion

REM ============================================================
REM  push.bat — stage everything, commit, and push, while never
REM  letting README.md or LICENSE be touched by this commit.
REM
REM  Usage:
REM     push.bat "your commit message here"
REM
REM  Run this from inside your repo folder (F:\hoardkeeper-repo).
REM ============================================================

if "%~1"=="" (
    echo Usage: push.bat "commit message"
    exit /b 1
)

echo.
echo === Staging all changes ===
git add -A

echo.
echo === Excluding README.md and LICENSE from this commit ===
REM Unstage them if "git add -A" picked them up...
git restore --staged README.md 2>nul
git restore --staged LICENSE 2>nul
REM ...and revert any local edits so they exactly match what's on GitHub.
REM (Comment out either line below if you WANT that file included this time.)
git checkout -- README.md 2>nul
git checkout -- LICENSE 2>nul

echo.
echo === Status (review before continuing) ===
git status

echo.
set /p CONFIRM=Commit and push these changes? (y/n): 
if /i not "%CONFIRM%"=="y" (
    echo.
    echo Aborted — nothing was committed.
    exit /b 0
)

echo.
echo === Committing ===
git commit -m "%~1"
if errorlevel 1 (
    echo.
    echo Nothing to commit, or the commit failed. Stopping before push.
    exit /b 1
)

echo.
echo === Pushing ===
git push

echo.
echo Done.
endlocal
