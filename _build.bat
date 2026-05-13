@echo off
call npm.cmd run build > build.log 2>&1
echo === EXIT: %ERRORLEVEL% === >> build.log
