/**
 * @file: src/jobs/terminalPurge.js
 * @description: Throttled вызов purge терминальных job (S5): env JOBS_TERMINAL_TTL_HOURS, интервал между проходами, выключатель
 * @dependencies: —
 * @created: 2026-05-18
 */

/** Время последнего успешного прохода purge (включая проход с 0 удалённых файлов); при ошибке не обновляется. */
let lastSuccessfulPurgeAtMs = 0;

/**
 * Безопасное чтение неотрицательного целого из process.env.
 *
 * @param {string} key
 * @param {number} defaultVal
 * @returns {number}
 */
function readNonNegativeInt(key, defaultVal) {
    const raw = process.env[key];
    if (raw === undefined || String(raw).trim() === '') {
        return defaultVal;
    }
    const n = parseInt(String(raw), 10);
    if (!Number.isFinite(n) || n < 0) {
        return defaultVal;
    }
    return n;
}

/**
 * Выполняет purge через jobStore, если не выключено env и прошёл min-интервал с последнего успешного прохода.
 *
 * @param {{ purgeTerminalJobsBefore: (cutoffIso: string) => number }} store
 */
function maybePurgeTerminalJobs(store) {
    const disabled = process.env.JOBS_TERMINAL_PURGE_ENABLED;
    if (disabled === '0' || disabled === 'false') {
        return;
    }

    const minIntervalMs = readNonNegativeInt(
        'JOBS_TERMINAL_PURGE_MIN_INTERVAL_MS',
        3600000,
    );
    const now = Date.now();
    if (now - lastSuccessfulPurgeAtMs < minIntervalMs) {
        return;
    }

    const ttlHours = readNonNegativeInt('JOBS_TERMINAL_TTL_HOURS', 72);
    const cutoff = new Date(now - ttlHours * 3600 * 1000).toISOString();

    let deleted;
    try {
        deleted = store.purgeTerminalJobsBefore(cutoff);
    } catch (err) {
        console.error('[terminalPurge] purge failed:', err && err.message ? err.message : err);
        return;
    }

    lastSuccessfulPurgeAtMs = Date.now();

    if (deleted > 0) {
        console.log('[terminalPurge] removed terminal jobs', {
            deleted,
            cutoff,
            ttl_hours: ttlHours,
        });
    }
}

/**
 * Сброс таймштампа (для unit-тестов).
 */
function resetTerminalPurgeThrottleForTests() {
    lastSuccessfulPurgeAtMs = 0;
}

module.exports = {
    maybePurgeTerminalJobs,
    readNonNegativeInt,
    resetTerminalPurgeThrottleForTests,
};
