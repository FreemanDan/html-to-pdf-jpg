/**
 * @file: src/lib/puppeteerEnv.js
 * @description: Каталог кэша браузеров Puppeteer и опции launch — до первого `require('puppeteer')`.
 * @dependencies: path, fs
 * @created: 2026-05-22
 */

const fs = require('fs');
const path = require('path');

const projectRoot = path.join(__dirname, '..', '..');

/**
 * Каталог загрузки Chrome для Puppeteer.
 * По умолчанию — `storage/puppeteer-browsers` (не `.cache/` в корне: его часто удаляют при «очистке»).
 * Переопределение: `PUPPETEER_CACHE_DIR` в .env или панели хостинга.
 *
 * @returns {string}
 */
const resolvePuppeteerCacheDir = () => {
    const fromEnv = process.env.PUPPETEER_CACHE_DIR;
    if (fromEnv && String(fromEnv).trim()) {
        return path.resolve(String(fromEnv).trim());
    }
    return path.join(projectRoot, 'storage', 'puppeteer-browsers');
};

const cacheDir = resolvePuppeteerCacheDir();
process.env.PUPPETEER_CACHE_DIR = cacheDir;

try {
    fs.mkdirSync(cacheDir, { recursive: true });
} catch (mkdirErr) {
    console.error(
        '[puppeteerEnv] не удалось создать PUPPETEER_CACHE_DIR:',
        cacheDir,
        mkdirErr && mkdirErr.message ? mkdirErr.message : mkdirErr,
    );
}

/**
 * @returns {string}
 */
const getPuppeteerCacheDir = () => cacheDir;

/**
 * Опции для `puppeteer.launch`.
 *
 * @returns {import('puppeteer').LaunchOptions}
 */
const getPuppeteerLaunchOptions = () => {
    const launchOptions = {
        args: ['--no-sandbox', '--disable-setuid-sandbox'],
    };

    const executablePath = process.env.PUPPETEER_EXECUTABLE_PATH;
    if (executablePath && String(executablePath).trim()) {
        launchOptions.executablePath = String(executablePath).trim();
    }

    return launchOptions;
};

module.exports = {
    getPuppeteerCacheDir,
    getPuppeteerLaunchOptions,
};
