@echo off
cd /d "%~dp0"
title MyCMS Database Query Tool

echo Consultando base de datos...
echo.

node -e "const { getDb } = require('./config/database'); const db = getDb(); console.log('=== USUARIOS ==='); console.log(JSON.stringify(db.prepare('SELECT id, username, role FROM users').all(), null, 2)); console.log('\n=== POSTS ==='); console.log(JSON.stringify(db.prepare('SELECT id, title, slug FROM posts').all(), null, 2)); console.log('\n=== PAGINAS ==='); console.log(JSON.stringify(db.prepare('SELECT id, title, slug FROM pages').all(), null, 2));"

echo.
pause
