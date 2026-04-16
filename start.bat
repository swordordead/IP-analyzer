@echo off
chcp 65001 > nul
title IP 分析助手

echo.
echo ================================
echo   IP 分析助手 - 启动中
echo ================================
echo.

:: 检查 Node.js
where node > nul 2>&1
if %errorlevel% neq 0 (
  echo [错误] 未找到 Node.js，请先安装 Node.js 18+
  pause
  exit /b 1
)

:: 后端
echo [1/2] 启动后端服务...
cd /d "%~dp0backend"
if not exist node_modules (
  echo 安装后端依赖...
  npm install
)
start "IP分析助手-后端" cmd /k "node src/index.js"

timeout /t 2 /nobreak > nul

:: 前端
echo [2/2] 启动前端服务...
cd /d "%~dp0frontend"
if not exist node_modules (
  echo 安装前端依赖...
  npm install
)
start "IP分析助手-前端" cmd /k "npm run dev"

timeout /t 3 /nobreak > nul

echo.
echo ================================
echo   启动完成！
echo   前端: http://localhost:5173
echo   后端: http://localhost:3001
echo ================================
echo.
echo 关闭此窗口不会停止服务
echo 如需停止，请关闭"IP分析助手-后端"和"IP分析助手-前端"窗口
pause
