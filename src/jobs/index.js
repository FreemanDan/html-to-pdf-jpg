/**
 * @file: src/jobs/index.js
 * @description: Публичный API модуля async-job (шаг 2: store + константы)
 * @dependencies: src/jobs/jobStore.js, src/jobs/constants.js
 * @created: 2026-05-15
 */

const { JOB_STATUS, JOB_STAGE, TERMINAL_JOB_STATUSES } = require('./constants');
const { JobStore, JobStoreFile, jobStore } = require('./jobStore');
const { scheduleJobWorker, runWorkerCycle } = require('./jobWorker');
const { executeJob } = require('./jobExecutor');

module.exports = {
    JOB_STATUS,
    JOB_STAGE,
    TERMINAL_JOB_STATUSES,
    JobStore,
    JobStoreFile,
    jobStore,
    scheduleJobWorker,
    runWorkerCycle,
    executeJob,
};
