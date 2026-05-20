/**
 * @file: src/jobs/jobWorker.js
 * @description: Фоновый воркер очереди job (MVP: concurrency = 1 на процесс Node)
 * @dependencies: src/jobs/jobStore.js, src/jobs/jobExecutor.js, src/jobs/constants.js, src/jobs/terminalPurge.js, src/jobs/staleRunningReclaim.js
 * @created: 2026-05-15
 */

const { jobStore } = require('./jobStore');
const { executeJob } = require('./jobExecutor');
const { JOB_STATUS } = require('./constants');
const { maybePurgeTerminalJobs } = require('./terminalPurge');
const { maybeReclaimStaleRunningJobs } = require('./staleRunningReclaim');

/** Не более одного активного executeJob на инстанс. */
let isProcessing = false;
let isWorkerTickScheduled = false;

/**
 * Планирует один проход воркера (setImmediate).
 * Безопасно вызывать многократно — лишние тики схлопываются.
 */
const scheduleJobWorker = () => {
    if (isWorkerTickScheduled) {
        return;
    }
    isWorkerTickScheduled = true;
    setImmediate(() => {
        isWorkerTickScheduled = false;
        runWorkerCycle().catch((err) => {
            console.error('[jobWorker] cycle error:', err && err.message ? err.message : err);
        });
    });
};

/**
 * Сначала throttled-очистка терминальных job, затем сброс «зависших» running по таймауту, claim и исполнение.
 * Concurrency = 1: при isProcessing повторный тик не заходит (purge в следующем тике).
 */
const runWorkerCycle = async () => {
    if (isProcessing) {
        return;
    }

    maybePurgeTerminalJobs(jobStore);

    if (isProcessing) {
        return;
    }

    maybeReclaimStaleRunningJobs(jobStore);

    if (jobStore.getRunningJob()) {
        return;
    }

    const nextJob = jobStore.claimNextQueuedJob();
    if (!nextJob) {
        return;
    }

    const queuedRemaining = jobStore.countByStatus(JOB_STATUS.QUEUED);

    console.log('[jobWorker] processing', {
        job_id: nextJob.jobId,
        request_id: nextJob.requestId,
        queued_remaining: queuedRemaining,
    });

    isProcessing = true;

    try {
        await executeJob(nextJob.jobId);
    } finally {
        isProcessing = false;
    }

    if (jobStore.countByStatus(JOB_STATUS.QUEUED) > 0) {
        scheduleJobWorker();
    }
};

module.exports = {
    scheduleJobWorker,
    runWorkerCycle,
};
