/**
 * @file: src/lib/outputPublicUrl.js
 * @description: Преобразование локального пути файла в output/ в публичный HTTPS URL для Telegram sendDocument и др.
 * @dependencies: node:path
 * @created: 2026-05-19
 */

const path = require('path');

/** Каталог output относительно корня приложения (рядом с package.json). */
const OUTPUT_DIR = path.join(__dirname, '..', '..', 'output');

/**
 * Если задан OUTPUT_PUBLIC_BASE_URL (например https://services.samoliot.ru), возвращает URL вида
 * {base}/output/{относительный путь внутри output/}. Иначе — исходный fs-путь (как у legacy /convert).
 *
 * @param {string} fsPath абсолютный путь от converter/jobExecutor
 * @returns {string}
 */
function filesystemPathToPublicUrl(fsPath) {
    const base = process.env.OUTPUT_PUBLIC_BASE_URL;
    if (!base || typeof fsPath !== 'string' || fsPath.trim() === '') {
        return fsPath;
    }
    const normalized = path.normalize(fsPath);
    const rel = path.relative(OUTPUT_DIR, normalized);
    if (rel === '' || rel.startsWith('..')) {
        return fsPath;
    }
    const urlPath = rel.split(path.sep).join('/');

    return `${String(base).replace(/\/$/, '')}/output/${urlPath}`;
}

module.exports = {
    OUTPUT_DIR,
    filesystemPathToPublicUrl,
};
