/**
 * @file: scripts/install-chrome.js
 * @description: Установка Chrome для Puppeteer в каталог из `PUPPETEER_CACHE_DIR` (см. src/lib/puppeteerEnv.js).
 * @dependencies: child_process, dotenv, src/lib/puppeteerEnv.js
 * @created: 2026-05-22
 */

const path = require('path');
const { execSync } = require('child_process');

require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const { getPuppeteerCacheDir } = require('../src/lib/puppeteerEnv');

const projectRoot = path.join(__dirname, '..');
const cacheDir = getPuppeteerCacheDir();

console.log('[install-chrome] PUPPETEER_CACHE_DIR =', cacheDir);

try {
    execSync('npx puppeteer browsers install chrome', {
        stdio: 'inherit',
        env: { ...process.env, PUPPETEER_CACHE_DIR: cacheDir },
        cwd: projectRoot,
    });
    console.log('[install-chrome] Chrome установлен в', cacheDir);
} catch (error) {
    console.error(
        '[install-chrome] Ошибка установки Chrome:',
        error && error.message ? error.message : error,
    );
    process.exit(1);
}
