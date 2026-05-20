/**
 * @file: src/lib/fileLogSetup.js
 * @description: Дублирование console.log / warn / error в файл по переменным LOG_TO_FILE и LOG_FILE_PATH из .env
 * @dependencies: node:fs, node:path, node:util
 * @created: 2026-05-18
 */

const fs = require('fs');
const path = require('path');
const util = require('util');

/**
 * @param {string|undefined} raw
 * @returns {boolean}
 */
function isTruthyEnv(raw) {
    if (raw === undefined || raw === null) {
        return false;
    }
    const v = String(raw).trim().toLowerCase();
    return v === '1' || v === 'true' || v === 'yes' || v === 'on';
}

/**
 * @param {unknown[]} args
 * @returns {string}
 */
function formatArgs(args) {
    return args
        .map((a) => {
            if (typeof a === 'string') {
                return a;
            }
            try {
                return util.inspect(a, { depth: 8, breakLength: Infinity, maxArrayLength: 100 });
            } catch (_) {
                return String(a);
            }
        })
        .join(' ');
}

/** @type {import('fs').WriteStream|null} */
let _logStream = null;

/**
 * Включает запись логов в файл, если LOG_TO_FILE включён в окружении (после dotenv).
 * Консоль по-прежнему выводится (дублирование).
 *
 * Переменные:
 * - **LOG_TO_FILE** — `1` / `true` / `yes` / `on` включает запись
 * - **LOG_FILE_PATH** — необязательно: относительный путь от `process.cwd()` или абсолютный; по умолчанию `logs/puppeteer-service.log`
 */
function installFileLogging() {
    if (!isTruthyEnv(process.env.LOG_TO_FILE)) {
        return;
    }

    const raw = process.env.LOG_FILE_PATH && String(process.env.LOG_FILE_PATH).trim() !== ''
        ? String(process.env.LOG_FILE_PATH).trim()
        : 'logs/puppeteer-service.log';

    const logFilePath = path.isAbsolute(raw)
        ? raw
        : path.join(process.cwd(), raw);

    const dir = path.dirname(logFilePath);
    try {
        fs.mkdirSync(dir, { recursive: true });
    } catch (e) {
        console.error('[fileLogSetup] mkdir failed:', e && e.message ? e.message : e);
        return;
    }

    try {
        _logStream = fs.createWriteStream(logFilePath, { flags: 'a' });
    } catch (e) {
        console.error('[fileLogSetup] createWriteStream failed:', e && e.message ? e.message : e);
        return;
    }

    const writeLine = (level, args) => {
        if (!_logStream) {
            return;
        }
        const line = `${new Date().toISOString()} [${level}] ${formatArgs(args)}\n`;
        try {
            _logStream.write(line);
        } catch (e) {
            /* не ломаем процесс из-за диска */
        }
    };

    const origLog = console.log;
    const origInfo = console.info;
    const origWarn = console.warn;
    const origError = console.error;
    const origDebug = console.debug;

    console.log = (...args) => {
        writeLine('LOG', args);
        origLog.apply(console, args);
    };
    console.info = (...args) => {
        writeLine('INFO', args);
        origInfo.apply(console, args);
    };
    console.warn = (...args) => {
        writeLine('WARN', args);
        origWarn.apply(console, args);
    };
    console.error = (...args) => {
        writeLine('ERROR', args);
        origError.apply(console, args);
    };
    console.debug = (...args) => {
        writeLine('DEBUG', args);
        origDebug.apply(console, args);
    };

    origLog.call(console, `[fileLogSetup] logging to file: ${logFilePath}`);

    const shutdown = () => {
        if (_logStream) {
            try {
                _logStream.end();
            } catch (_) {
                /* no-op */
            }
            _logStream = null;
        }
    };

    process.on('SIGTERM', shutdown);
    process.on('SIGINT', shutdown);
    process.on('exit', shutdown);
}

module.exports = {
    installFileLogging,
};
