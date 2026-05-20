/**
 * @file: src/jobs/staleRunningReclaim.js
 * @description: Сброс зависших job в статусе running (по давности updatedAt), чтобы getRunningJob не блокировал очередь навсегда.
 * @dependencies: src/jobs/terminalPurge.js (readNonNegativeInt)
 * @created: 2026-05-18
 */

const { readNonNegativeInt } = require('./terminalPurge');

/**
 * Читает положительный период (мс) из env с дефолтом; 0 или невалидное → defaultVal.
 *
 * @param {string} key
 * @param {number} defaultVal
 * @returns {number}
 */
function readPositiveMsFromEnv(key, defaultVal) {
    const raw = process.env[key];
    if (raw === undefined || String(raw).trim() === '') {
        return defaultVal;
    }
    const n = parseInt(String(raw), 10);
    if (!Number.isFinite(n) || n <= 0) {
        return defaultVal;
    }
    return n;
}

/** Время последнего успешного прохода (throttling). */
let lastStaleReclaimAtMs = 0;

/**
 * Вызывается из цикла воркера: job в RUNNING дольше JOBS_STALE_RUNNING_AFTER_MS помечаются failed.
 * Должно быть **больше**, чем JOBS_EXECUTE_TIMEOUT_MS, чтобы сначала срабатывал таймаут одной конвертации.
 *
 * @param {{ reclaimStaleRunningJobs: (maxMs: number) => number }} store
 */
function maybeReclaimStaleRunningJobs(store) {
    const disabled = process.env.JOBS_STALE_RUNNING_ENABLED;
    if (disabled === '0' || disabled === 'false') {
        return;
    }

    const minIntervalMs = readNonNegativeInt('JOBS_STALE_RECLAIM_MIN_INTERVAL_MS', 10000);
    const now = Date.now();
    if (now - lastStaleReclaimAtMs < minIntervalMs) {
        return;
    }

    const maxDurationMs = readPositiveMsFromEnv(
        'JOBS_STALE_RUNNING_AFTER_MS',
        900000,
    );

    let reclaimed;
    try {
        reclaimed = store.reclaimStaleRunningJobs(maxDurationMs);
    } catch (err) {
        console.error('[staleRunningReclaim] failed:', err && err.message ? err.message : err);
        return;
    }

    lastStaleReclaimAtMs = Date.now();

    if (reclaimed > 0) {
        console.warn('[staleRunningReclaim] reclaimed stale running jobs', {
            reclaimed,
            max_duration_ms: maxDurationMs,
        });
    }
}

/**
 * Сброс таймштампа (тесты).
 */
function resetStaleReclaimThrottleForTests() {
    lastStaleReclaimAtMs = 0;
}

module.exports = {
    maybeReclaimStaleRunningJobs,
    readPositiveMsFromEnv,
    resetStaleReclaimThrottleForTests,
};
