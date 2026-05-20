/**
 * @file: src/routes/jobs.js
 * @description: HTTP-маршруты async-job (создание job + планирование воркера)
 * @dependencies: src/jobs/index.js, src/jobs/validateJobPayload.js
 * @created: 2026-05-15
 */

const express = require('express');
const { jobStore, JOB_STATUS, scheduleJobWorker } = require('../jobs');
const { validateJobCreatePayload, normalizeJobPayload } = require('../jobs/validateJobPayload');

const getRequestId = (req) => {
    return req.headers['x-request-id'] || req.headers['x-correlation-id'] || null;
};

const jobsRouter = express.Router();

/**
 * POST /api/v1/jobs — постановка в очередь, ответ 201 без запуска захвата.
 * Исполнение — воркер (шаг 4).
 */
const createJobHandler = (req, res) => {
    const requestId = getRequestId(req);
    const validationError = validateJobCreatePayload(req.body);

    if (validationError) {
        console.error('[jobs] create validation failed:', validationError.code, {
            request_id: requestId,
        });
        return res.status(validationError.statusCode).json({
            error: validationError.code,
            message: validationError.message,
            meta: { request_id: requestId },
        });
    }

    const payload = normalizeJobPayload(req.body);
    const job = jobStore.createJob(payload, requestId);

    console.log('[jobs] created', {
        job_id: job.jobId,
        status: job.status,
        request_id: requestId,
        wait_for_capture_ready: payload.wait_for_capture_ready,
        format: payload.format,
    });

    scheduleJobWorker();

    return res.status(201).json({
        job_id: job.jobId,
        status: JOB_STATUS.QUEUED,
        request_id: job.requestId,
    });
};

/**
 * GET /api/v1/jobs/:jobId — короткий статус для опроса (A4).
 */
const getJobHandler = (req, res) => {
    const requestId = getRequestId(req);
    const jobId = req.params.jobId;

    const job = jobStore.getJob(jobId);
    if (!job) {
        console.error('[jobs] get not found:', { job_id: jobId, request_id: requestId });
        return res.status(404).json({
            error: 'job_not_found',
            message: `Job not found: ${jobId}`,
            meta: { request_id: requestId },
        });
    }

    return res.status(200).json(jobStore.toPublicJob(job));
};

jobsRouter.post('/', createJobHandler);
jobsRouter.get('/:jobId', getJobHandler);

module.exports = {
    jobsRouter,
    createJobHandler,
    getJobHandler,
};
