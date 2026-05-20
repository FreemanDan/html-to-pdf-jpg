/**
 * @file: src/jobs/jobExecutor.js
 * @description: Выполнение одного job через converter.js с обновлением stage в jobStore
 * @dependencies: src/converter.js, src/jobs/jobStore.js, src/jobs/constants.js, src/jobs/staleRunningReclaim.js
 * @created: 2026-05-15
 */

const { convertToPdf, convertToJpeg, CaptureError } = require('../converter');
const { filesystemPathToPublicUrl } = require('../lib/outputPublicUrl');
const { jobStore } = require('./jobStore');
const { JOB_STATUS, JOB_STAGE } = require('./constants');
const { readPositiveMsFromEnv } = require('./staleRunningReclaim');

/**
 * Жёсткий предел времени на одну конвертацию в async-job (включая launch Chromium и ожидание страницы).
 * После истечения Promise.race завершается — воркер освобождается; фоновый Puppeteer может ещё работать (см. лог «late conversion»).
 */
function getJobExecuteTimeoutMs() {
    return readPositiveMsFromEnv('JOBS_EXECUTE_TIMEOUT_MS', 420000);
}

/**
 * Запускает захват только для job в статусе running (после claimNextQueuedJob во воркере).
 * Вызов для queued или иных статусов — немедленный выход (false).
 *
 * @param {string} jobId
 * @returns {Promise<boolean>} true, если job был обработан
 */
const executeJob = async (jobId) => {
    const job = jobStore.getJob(jobId);
    if (!job || job.status !== JOB_STATUS.RUNNING) {
        return false;
    }

    const payload = job.payload;
    const conversionOptions = {
        waitForCaptureReady: payload.wait_for_capture_ready === true,
        requestId: job.requestId,
        viewport: payload.viewport || null,
        onStage: (stage) => {
            console.log('[jobExecutor] stage', {
                job_id: jobId,
                request_id: job.requestId,
                stage,
            });
            jobStore.updateJob(jobId, {
                status: JOB_STATUS.RUNNING,
                stage,
            });
        },
    };

    const convertFunction = payload.format === 'pdf' ? convertToPdf : convertToJpeg;

    console.log('[jobExecutor] start', {
        job_id: jobId,
        request_id: job.requestId,
        format: payload.format,
        wait_for_capture_ready: payload.wait_for_capture_ready,
        viewport: payload.viewport || null,
    });

    const executeTimeoutMs = getJobExecuteTimeoutMs();
    const conversionPromise = convertFunction(
        payload.url,
        false,
        payload.clip_to_element,
        payload.emulate_media_type,
        conversionOptions
    );

    /** @type {NodeJS.Timeout|undefined} */
    let timeoutHandle;
    const timeoutPromise = new Promise((_, reject) => {
        timeoutHandle = setTimeout(() => {
            reject(new CaptureError(
                'job_execute_timeout',
                `Capture exceeded JOBS_EXECUTE_TIMEOUT_MS (${executeTimeoutMs} ms)`,
                {
                    request_id: job.requestId,
                    timeout_ms: executeTimeoutMs,
                },
                504,
            ));
        }, executeTimeoutMs);
    });

    try {
        /** @type {string} */
        let outputUrl;
        try {
            outputUrl = await Promise.race([conversionPromise, timeoutPromise]);
        } finally {
            if (timeoutHandle) {
                clearTimeout(timeoutHandle);
            }
        }

        conversionPromise.catch((lateErr) => {
            console.warn('[jobExecutor] conversion settled after race (ignored)', {
                job_id: jobId,
                message: lateErr && lateErr.message ? lateErr.message : String(lateErr),
            });
        });

        const publicUrl = filesystemPathToPublicUrl(outputUrl);
        jobStore.updateJob(jobId, {
            status: JOB_STATUS.COMPLETED,
            stage: JOB_STAGE.COMPLETED,
            url: publicUrl,
            error: null,
            message: null,
        });

        console.log('[jobExecutor] completed', {
            job_id: jobId,
            request_id: job.requestId,
            url: publicUrl,
            fs_path: outputUrl,
        });

        return true;
    } catch (err) {
        conversionPromise.catch((lateErr) => {
            console.warn('[jobExecutor] conversion settled after error path (ignored)', {
                job_id: jobId,
                message: lateErr && lateErr.message ? lateErr.message : String(lateErr),
            });
        });

        const failedPatch = {
            status: JOB_STATUS.FAILED,
            stage: JOB_STAGE.FAILED,
            url: null,
        };

        if (err instanceof CaptureError) {
            failedPatch.error = err.code || 'conversion_failed';
            failedPatch.message = err.message || 'Conversion failed';
            failedPatch.meta = {
                request_id: job.requestId,
                ...(err.meta || {}),
            };
            console.error('[jobExecutor] failed (capture)', {
                job_id: jobId,
                request_id: job.requestId,
                error: err.code,
                message: err.message,
            });
        } else {
            failedPatch.error = 'conversion_failed';
            failedPatch.message = err && err.message ? err.message : String(err);
            failedPatch.meta = { request_id: job.requestId };
            console.error('[jobExecutor] failed', {
                job_id: jobId,
                request_id: job.requestId,
                message: failedPatch.message,
            });
        }

        jobStore.updateJob(jobId, failedPatch);
        return true;
    }
};

module.exports = {
    executeJob,
};
