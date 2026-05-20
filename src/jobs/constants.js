/**
 * @file: src/jobs/constants.js
 * @description: Машинные коды status и stage для async-job (контракт 11751 / ASYNC_SCREENSHOT_CAPTURE_TASK_CONTEXT)
 * @dependencies: —
 * @created: 2026-05-15
 */

/** Статусы жизненного цикла job (поле status в store и в API). */
const JOB_STATUS = {
    QUEUED: 'queued',
    RUNNING: 'running',
    COMPLETED: 'completed',
    FAILED: 'failed',
};

/**
 * Технические стадии выполнения (поле stage).
 * Продуктовые подписи для UI маппит dev-reports-api.
 */
const JOB_STAGE = {
    QUEUED: 'queued',
    LAUNCHING_BROWSER: 'launching_browser',
    NAVIGATING: 'navigating',
    WAITING_PAGE_READY: 'waiting_page_ready',
    RESOLVING_WIDGET: 'resolving_widget',
    CAPTURING: 'capturing',
    SAVING_FILE: 'saving_file',
    COMPLETED: 'completed',
    FAILED: 'failed',
};

const TERMINAL_JOB_STATUSES = new Set([JOB_STATUS.COMPLETED, JOB_STATUS.FAILED]);

module.exports = {
    JOB_STATUS,
    JOB_STAGE,
    TERMINAL_JOB_STATUSES,
};
