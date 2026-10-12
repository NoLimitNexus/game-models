@echo off
rem Starts the Model Lab on your own PC and opens it in your browser. Close this window to stop it.
rem (The page cannot be opened by double-clicking index.html: browsers block that.)
cd /d "%~dp0"
node tools\serve.mjs 5190
if errorlevel 1 pause
