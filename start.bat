@echo off
chcp 65001 > nul
title منظومة OSS للذكاء الاصطناعي - OSS AI Platform
echo =======================================================
echo   منظومة OSS للذكاء الاصطناعي (OSS AI Platform)
echo   الجمهورية العربية السورية
echo =======================================================
echo جاري التحقق من حاوية قاعدة البيانات PostgreSQL على Docker...
docker ps | findstr "shaheen-postgres" > nul
if errorlevel 1 (
  echo جاري تشغيل حاوية PostgreSQL...
  docker start shaheen-postgres > nul 2>&1
  if errorlevel 1 (
    echo [تنبيه] جاري إنشاء وتشغيل حاوية shaheen-postgres...
    docker run -d --name shaheen-postgres -e POSTGRES_USER=shaheen_admin -e POSTGRES_PASSWORD=SecurePassword2026! -e POSTGRES_DB=shaheen_ai -p 5432:5432 -v shaheen_postgres_data:/var/lib/postgresql/data pgvector/pgvector:pg16
  )
)
echo قاعدة البيانات PostgreSQL جاهزة ومتصلة على المنفذ 5432.
echo.
echo الخادم سيعمل على: http://localhost:3001
echo للوصول عبر الشبكة: http://%COMPUTERNAME%:3001
echo.
echo للتشغيل الكامل بالحاويات عبر Docker: docker compose up -d
echo.
node server/index.js
pause
