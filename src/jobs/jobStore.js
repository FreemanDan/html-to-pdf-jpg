/**
 * @file: src/jobs/jobStore.js
 * @description: Хранилище async-job — по умолчанию файловый каталог (<job_id>.json + атомарная запись);
 *               опционально in-memory для одного процесса (JOBS_STORE_DRIVER=memory).
 * @dependencies: src/jobs/constants.js, node:crypto, node:fs, node:path
 * @created: 2026-05-15
 * @updated: 2026-05-18
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { JOB_STATUS, JOB_STAGE, TERMINAL_JOB_STATUSES } = require('./constants');

/**
 * Каталог JSON job: JOBS_DIR или <cwd>/storage/jobs.
 *
 * @returns {string}
 */
function resolveJobsDirectory() {
    const raw = process.env.JOBS_DIR;
    if (raw && String(raw).trim() !== '') {
        return path.resolve(String(raw).trim());
    }
    return path.resolve(process.cwd(), 'storage', 'jobs');
}

/**
 * Атомарная запись JSON: временный файл + rename поверх финального имени (Linux/POSIX).
 *
 * @param {string} finalPath — абсолютный путь к `<job_id>.json`
 * @param {Object} data — сериализуемый объект
 */
function atomicWriteJsonFile(finalPath, data) {
    const dir = path.dirname(finalPath);
    const tmpPath = `${finalPath}.${process.pid}.${Date.now()}.tmp`;
    fs.writeFileSync(tmpPath, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
    fs.renameSync(tmpPath, finalPath);
}

/**
 * @typedef {Object} JobCapturePayload
 * @property {string} url
 * @property {'jpeg'|'pdf'} format
 * @property {string|null} [clip_to_element]
 * @property {string|null} [emulate_media_type]
 * @property {boolean} [wait_for_capture_ready]
 * @property {{width: number, height: number}|null} [viewport]
 */

/**
 * @typedef {Object} CaptureJobRecord
 * @property {string} jobId
 * @property {string} status
 * @property {string} stage
 * @property {string|null} requestId
 * @property {JobCapturePayload} payload
 * @property {string|null} url
 * @property {string|null} error
 * @property {string|null} message
 * @property {Object} meta
 * @property {string} createdAt
 * @property {string} updatedAt
 */

/**
 * Глубокая копия записи для отдачи наружу (без мутаций внутреннего состояния на диске).
 *
 * @param {CaptureJobRecord} record
 * @returns {CaptureJobRecord}
 */
function cloneRecord(record) {
    return {
        ...record,
        payload: { ...(record.payload || {}) },
        meta: { ...(record.meta || {}) },
    };
}

/**
 * Публичное представление для GET /api/v1/jobs/:jobId (контракт A4).
 *
 * @param {CaptureJobRecord} job
 * @returns {Object}
 */
function toPublicJob(job) {
    const body = {
        job_id: job.jobId,
        status: job.status,
        stage: job.stage,
        request_id: job.requestId,
        updated_at: job.updatedAt,
    };

    if (job.status === JOB_STATUS.COMPLETED && job.url) {
        body.url = job.url;
    }

    if (job.status === JOB_STATUS.FAILED) {
        body.error = job.error || 'conversion_failed';
        body.message = job.message || 'Conversion failed';
        body.meta = {
            request_id: job.requestId,
            ...job.meta,
        };
    }

    return body;
}

/**
 * Синтетическая запись при нечитаемом JSON (GET не падает 500 всем приложением).
 *
 * @param {string} jobId
 * @param {Error} err
 * @returns {CaptureJobRecord}
 */
function syntheticReadFailedRecord(jobId, err) {
    const now = new Date().toISOString();
    return {
        jobId,
        status: JOB_STATUS.FAILED,
        stage: JOB_STAGE.FAILED,
        requestId: null,
        payload: {},
        url: null,
        error: 'job_read_failed',
        message: err && err.message ? err.message : String(err),
        meta: {},
        createdAt: now,
        updatedAt: now,
    };
}

/**
 * In-memory store: Map<jobId, CaptureJobRecord> — только один процесс Node.
 */
class JobStoreMemory {
    constructor() {
        /** @type {Map<string, CaptureJobRecord>} */
        this._jobs = new Map();
    }

    /**
     * @param {JobCapturePayload} payload
     * @param {string|null} requestId
     * @returns {CaptureJobRecord}
     */
    createJob(payload, requestId = null) {
        const now = new Date().toISOString();
        const jobId = crypto.randomUUID();

        const record = {
            jobId,
            status: JOB_STATUS.QUEUED,
            stage: JOB_STAGE.QUEUED,
            requestId: requestId || null,
            payload: {
                url: payload.url,
                format: payload.format,
                clip_to_element: payload.clip_to_element ?? null,
                emulate_media_type: payload.emulate_media_type ?? null,
                wait_for_capture_ready: payload.wait_for_capture_ready === true,
                viewport: payload.viewport || null,
            },
            url: null,
            error: null,
            message: null,
            meta: {},
            createdAt: now,
            updatedAt: now,
        };

        this._jobs.set(jobId, record);
        return cloneRecord(record);
    }

    /**
     * @param {string} jobId
     * @returns {CaptureJobRecord|null}
     */
    getJob(jobId) {
        const record = this._jobs.get(jobId);
        if (!record) {
            return null;
        }
        return cloneRecord(record);
    }

    /**
     * @param {string} jobId
     * @param {Partial<CaptureJobRecord>} patch
     * @param {{ allowTerminalOverride?: boolean }} [options]
     * @returns {CaptureJobRecord|null}
     */
    updateJob(jobId, patch, options = {}) {
        const record = this._jobs.get(jobId);
        if (!record) {
            return null;
        }

        if (
            TERMINAL_JOB_STATUSES.has(record.status) &&
            !options.allowTerminalOverride
        ) {
            return this.getJob(jobId);
        }

        if (patch.status !== undefined) {
            record.status = patch.status;
        }
        if (patch.stage !== undefined) {
            record.stage = patch.stage;
        }
        if (patch.requestId !== undefined) {
            record.requestId = patch.requestId;
        }
        if (patch.url !== undefined) {
            record.url = patch.url;
        }
        if (patch.error !== undefined) {
            record.error = patch.error;
        }
        if (patch.message !== undefined) {
            record.message = patch.message;
        }
        if (patch.meta !== undefined) {
            record.meta = { ...record.meta, ...patch.meta };
        }
        if (patch.payload !== undefined) {
            record.payload = { ...record.payload, ...patch.payload };
        }

        record.updatedAt = new Date().toISOString();
        return this.getJob(jobId);
    }

    toPublicJob(job) {
        return toPublicJob(job);
    }

    /**
     * @returns {CaptureJobRecord[]}
     */
    listQueuedJobsOrdered() {
        const queued = [];
        for (const record of this._jobs.values()) {
            if (record.status === JOB_STATUS.QUEUED) {
                queued.push(record);
            }
        }
        queued.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
        return queued.map((r) => this.getJob(r.jobId));
    }

    /**
     * @returns {CaptureJobRecord|null}
     */
    getRunningJob() {
        for (const record of this._jobs.values()) {
            if (record.status === JOB_STATUS.RUNNING) {
                return this.getJob(record.jobId);
            }
        }
        return null;
    }

    /**
     * @param {string} status
     * @returns {number}
     */
    countByStatus(status) {
        let count = 0;
        for (const record of this._jobs.values()) {
            if (record.status === status) {
                count += 1;
            }
        }
        return count;
    }

    clear() {
        this._jobs.clear();
    }

    /**
     * @returns {CaptureJobRecord|null}
     */
    claimNextQueuedJob() {
        const ordered = [];
        for (const record of this._jobs.values()) {
            if (record.status === JOB_STATUS.QUEUED) {
                ordered.push(record);
            }
        }
        if (ordered.length === 0) {
            return null;
        }
        ordered.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
        const target = ordered[0];
        const live = this._jobs.get(target.jobId);
        if (!live || live.status !== JOB_STATUS.QUEUED) {
            return null;
        }
        live.status = JOB_STATUS.RUNNING;
        live.stage = JOB_STAGE.LAUNCHING_BROWSER;
        live.updatedAt = new Date().toISOString();
        return this.getJob(live.jobId);
    }

    /**
     * @param {string} cutoffIso
     * @returns {number}
     */
    purgeTerminalJobsBefore(cutoffIso) {
        let deleted = 0;
        for (const [id, record] of this._jobs.entries()) {
            if (!TERMINAL_JOB_STATUSES.has(record.status)) {
                continue;
            }
            if (record.updatedAt < cutoffIso) {
                this._jobs.delete(id);
                deleted += 1;
            }
        }
        return deleted;
    }

    /**
     * Job в RUNNING дольше maxDurationMs (по полю updatedAt) переводит в failed — снимает блокировку очереди при зависании или падении процесса.
     *
     * @param {number} maxDurationMs — максимальное время «жизни» состояния running без обновления (wall-clock от updatedAt).
     * @returns {number} число восстановленных записей
     */
    reclaimStaleRunningJobs(maxDurationMs) {
        const now = Date.now();
        let reclaimed = 0;
        for (const [id, record] of this._jobs.entries()) {
            if (record.status !== JOB_STATUS.RUNNING) {
                continue;
            }
            const t = Date.parse(record.updatedAt);
            if (!Number.isFinite(t)) {
                continue;
            }
            if (now - t <= maxDurationMs) {
                continue;
            }
            this.updateJob(id, {
                status: JOB_STATUS.FAILED,
                stage: JOB_STAGE.FAILED,
                url: null,
                error: 'job_stale_running',
                message: `Job left running longer than ${maxDurationMs} ms (reclaimed to unblock queue)`,
                meta: {
                    ...(record.meta || {}),
                    stale_reclaimed_at: new Date().toISOString(),
                    stale_max_duration_ms: maxDurationMs,
                },
            });
            reclaimed += 1;
            console.warn('[jobStore][memory] reclaimStaleRunningJobs', { job_id: id, maxDurationMs });
        }
        return reclaimed;
    }
}

/**
 * Файловое хранилище: по одному JSON на job, общий каталог между процессами Passenger.
 * Захват следующей queued job: эксклюзивный lock-файл `.claim-<jobId>.lock` (wx), чтобы два процесса не взяли одну задачу.
 */
class JobStoreFile {
    constructor() {
        /** @type {string} */
        this._jobsDir = resolveJobsDirectory();
        this._ensureDir();
    }

    /**
     * Абсолютный путь к файлу job.
     *
     * @param {string} jobId
     * @returns {string}
     */
    _jobFilePath(jobId) {
        return path.join(this._jobsDir, `${jobId}.json`);
    }

    _ensureDir() {
        fs.mkdirSync(this._jobsDir, { recursive: true });
    }

    /**
     * Список имён `*.json` в каталоге (без временных фрагментов).
     *
     * @returns {string[]}
     */
    _listJobJsonFilenames() {
        this._ensureDir();
        let names;
        try {
            names = fs.readdirSync(this._jobsDir);
        } catch (e) {
            console.error('[jobStore][file] readdir failed:', this._jobsDir, e && e.message ? e.message : e);
            return [];
        }
        return names.filter(
            (n) => n.endsWith('.json') && !n.includes('.tmp') && !n.startsWith('.'),
        );
    }

    /**
     * Читает и нормализует запись с диска; при ошибке парсинга возвращает null (для claim/purge), на GET используется отдельная ветка.
     *
     * @param {string} filePath
     * @param {string} jobIdFromName
     * @returns {CaptureJobRecord|null}
     */
    _readRecordOrNull(filePath, jobIdFromName) {
        let raw;
        try {
            raw = fs.readFileSync(filePath, 'utf8');
        } catch (e) {
            console.error('[jobStore][file] read error', { path: filePath, pid: process.pid, err: e.message });
            return null;
        }
        let obj;
        try {
            obj = JSON.parse(raw);
        } catch (e) {
            console.error('[jobStore][file] JSON parse error', { path: filePath, pid: process.pid, err: e.message });
            return null;
        }
        if (!obj || typeof obj !== 'object') {
            return null;
        }
        const jobId = obj.jobId || jobIdFromName;
        if (jobId !== jobIdFromName) {
            console.error('[jobStore][file] jobId mismatch file/name', { filePath, jobIdFromName, jobId });
            return null;
        }
        return this._normalizeRecord(obj, jobId);
    }

    /**
     * @param {Object} obj
     * @param {string} jobId
     * @returns {CaptureJobRecord}
     */
    _normalizeRecord(obj, jobId) {
        /** @type {CaptureJobRecord & { created_by_pid?: number, updated_by_pid?: number }} */
        const record = {
            jobId,
            status: obj.status,
            stage: obj.stage,
            requestId: obj.requestId !== undefined && obj.requestId !== null ? obj.requestId : null,
            payload: obj.payload && typeof obj.payload === 'object' ? { ...obj.payload } : {},
            url: obj.url !== undefined && obj.url !== null ? obj.url : null,
            error: obj.error !== undefined && obj.error !== null ? obj.error : null,
            message: obj.message !== undefined && obj.message !== null ? obj.message : null,
            meta: obj.meta && typeof obj.meta === 'object' ? { ...obj.meta } : {},
            createdAt: obj.createdAt || obj.created_at || new Date().toISOString(),
            updatedAt: obj.updatedAt || obj.updated_at || new Date().toISOString(),
        };
        if (obj.created_by_pid !== undefined) {
            record.created_by_pid = obj.created_by_pid;
        }
        if (obj.updated_by_pid !== undefined) {
            record.updated_by_pid = obj.updated_by_pid;
        }
        return record;
    }

    /**
     * @param {JobCapturePayload} payload
     * @param {string|null} requestId
     * @returns {CaptureJobRecord}
     */
    createJob(payload, requestId = null) {
        this._ensureDir();
        const now = new Date().toISOString();
        const jobId = crypto.randomUUID();

        const record = {
            jobId,
            status: JOB_STATUS.QUEUED,
            stage: JOB_STAGE.QUEUED,
            requestId: requestId || null,
            payload: {
                url: payload.url,
                format: payload.format,
                clip_to_element: payload.clip_to_element ?? null,
                emulate_media_type: payload.emulate_media_type ?? null,
                wait_for_capture_ready: payload.wait_for_capture_ready === true,
                viewport: payload.viewport || null,
            },
            url: null,
            error: null,
            message: null,
            meta: {},
            createdAt: now,
            updatedAt: now,
            created_by_pid: process.pid,
            updated_by_pid: process.pid,
        };

        const fp = this._jobFilePath(jobId);
        try {
            atomicWriteJsonFile(fp, record);
        } catch (e) {
            console.error('[jobStore][file] createJob write failed', { job_id: jobId, pid: process.pid, err: e.message });
            throw e;
        }

        console.log('[jobStore][file] createJob', { job_id: jobId, pid: process.pid });
        return cloneRecord(this._normalizeRecord(record, jobId));
    }

    /**
     * @param {string} jobId
     * @returns {CaptureJobRecord|null}
     */
    getJob(jobId) {
        const fp = this._jobFilePath(jobId);
        if (!fs.existsSync(fp)) {
            console.error('[jobStore][file] getJob miss', { job_id: jobId, pid: process.pid });
            return null;
        }

        let raw;
        try {
            raw = fs.readFileSync(fp, 'utf8');
        } catch (e) {
            console.error('[jobStore][file] getJob read error', { job_id: jobId, pid: process.pid, err: e.message });
            return syntheticReadFailedRecord(jobId, e);
        }

        let obj;
        try {
            obj = JSON.parse(raw);
        } catch (e) {
            console.error('[jobStore][file] getJob parse error', { job_id: jobId, pid: process.pid, err: e.message });
            return syntheticReadFailedRecord(jobId, e);
        }

        if (!obj || typeof obj !== 'object') {
            return syntheticReadFailedRecord(jobId, new Error('invalid job document'));
        }

        const id = obj.jobId || jobId;
        if (id !== jobId) {
            return syntheticReadFailedRecord(jobId, new Error('job_id mismatch in file'));
        }

        return cloneRecord(this._normalizeRecord(obj, jobId));
    }

    /**
     * @param {string} jobId
     * @param {Partial<CaptureJobRecord>} patch
     * @param {{ allowTerminalOverride?: boolean }} [options]
     * @returns {CaptureJobRecord|null}
     */
    updateJob(jobId, patch, options = {}) {
        const fp = this._jobFilePath(jobId);
        if (!fs.existsSync(fp)) {
            return null;
        }

        const current = this._readRecordOrNull(fp, jobId);
        if (!current) {
            console.error('[jobStore][file] updateJob unreadable record', { job_id: jobId, pid: process.pid });
            return null;
        }

        if (
            TERMINAL_JOB_STATUSES.has(current.status) &&
            !options.allowTerminalOverride
        ) {
            return cloneRecord(current);
        }

        const record = { ...current };
        if (patch.status !== undefined) {
            record.status = patch.status;
        }
        if (patch.stage !== undefined) {
            record.stage = patch.stage;
        }
        if (patch.requestId !== undefined) {
            record.requestId = patch.requestId;
        }
        if (patch.url !== undefined) {
            record.url = patch.url;
        }
        if (patch.error !== undefined) {
            record.error = patch.error;
        }
        if (patch.message !== undefined) {
            record.message = patch.message;
        }
        if (patch.meta !== undefined) {
            record.meta = { ...record.meta, ...patch.meta };
        }
        if (patch.payload !== undefined) {
            record.payload = { ...record.payload, ...patch.payload };
        }

        record.updatedAt = new Date().toISOString();
        record.updated_by_pid = process.pid;
        if (record.created_by_pid === undefined) {
            record.created_by_pid = process.pid;
        }

        const out = {
            ...record,
            created_by_pid: record.created_by_pid,
            updated_by_pid: record.updated_by_pid,
        };

        try {
            atomicWriteJsonFile(fp, out);
        } catch (e) {
            console.error('[jobStore][file] updateJob write failed', { job_id: jobId, pid: process.pid, err: e.message });
            throw e;
        }

        if (patch.status !== undefined) {
            console.log('[jobStore][file] updateJob', { job_id: jobId, status: patch.status, pid: process.pid });
        }

        return cloneRecord(this._normalizeRecord(out, jobId));
    }

    toPublicJob(job) {
        return toPublicJob(job);
    }

    /**
     * @returns {CaptureJobRecord[]}
     */
    listQueuedJobsOrdered() {
        const list = [];
        for (const name of this._listJobJsonFilenames()) {
            const jobId = path.basename(name, '.json');
            const rec = this._readRecordOrNull(this._jobFilePath(jobId), jobId);
            if (rec && rec.status === JOB_STATUS.QUEUED) {
                list.push(cloneRecord(rec));
            }
        }
        list.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
        return list;
    }

    /**
     * @returns {CaptureJobRecord|null}
     */
    getRunningJob() {
        for (const name of this._listJobJsonFilenames()) {
            const jobId = path.basename(name, '.json');
            const rec = this._readRecordOrNull(this._jobFilePath(jobId), jobId);
            if (rec && rec.status === JOB_STATUS.RUNNING) {
                return cloneRecord(rec);
            }
        }
        return null;
    }

    /**
     * @param {string} status
     * @returns {number}
     */
    countByStatus(status) {
        let count = 0;
        for (const name of this._listJobJsonFilenames()) {
            const jobId = path.basename(name, '.json');
            const rec = this._readRecordOrNull(this._jobFilePath(jobId), jobId);
            if (rec && rec.status === status) {
                count += 1;
            }
        }
        return count;
    }

    clear() {
        for (const name of this._listJobJsonFilenames()) {
            const jobId = path.basename(name, '.json');
            try {
                fs.unlinkSync(this._jobFilePath(jobId));
            } catch (_) {
                /* игнорируем */
            }
        }
    }

    /**
     * Перевести самую старую queued в running под эксклюзивным lock-файлом.
     *
     * @returns {CaptureJobRecord|null}
     */
    claimNextQueuedJob() {
        const queuedList = this.listQueuedJobsOrdered();
        for (const cand of queuedList) {
            const claimed = this._tryClaimOne(cand.jobId);
            if (claimed) {
                console.log('[jobStore][file] claimNextQueuedJob', { job_id: cand.jobId, pid: process.pid });
                return claimed;
            }
        }
        return null;
    }

    /**
     * @param {string} jobId
     * @returns {CaptureJobRecord|null}
     */
    _tryClaimOne(jobId) {
        const lockPath = path.join(this._jobsDir, `.claim-${jobId}.lock`);
        let fd;
        try {
            fd = fs.openSync(lockPath, 'wx');
        } catch (e) {
            if (e && e.code === 'EEXIST') {
                return null;
            }
            console.error('[jobStore][file] claim lock open failed', { job_id: jobId, pid: process.pid, err: e.message });
            return null;
        }

        try {
            const fp = this._jobFilePath(jobId);
            if (!fs.existsSync(fp)) {
                return null;
            }
            const rec = this._readRecordOrNull(fp, jobId);
            if (!rec || rec.status !== JOB_STATUS.QUEUED) {
                return null;
            }

            const now = new Date().toISOString();
            const out = {
                ...rec,
                status: JOB_STATUS.RUNNING,
                stage: JOB_STAGE.LAUNCHING_BROWSER,
                updatedAt: now,
                updated_by_pid: process.pid,
                created_by_pid: rec.created_by_pid !== undefined ? rec.created_by_pid : process.pid,
            };

            try {
                atomicWriteJsonFile(fp, out);
            } catch (e) {
                console.error('[jobStore][file] claim write failed', { job_id: jobId, pid: process.pid, err: e.message });
                throw e;
            }

            return cloneRecord(this._normalizeRecord(out, jobId));
        } finally {
            try {
                fs.closeSync(fd);
            } catch (_) {
                /* no-op */
            }
            try {
                fs.unlinkSync(lockPath);
            } catch (_) {
                /* no-op */
            }
        }
    }

    /**
     * @param {string} cutoffIso
     * @returns {number}
     */
    purgeTerminalJobsBefore(cutoffIso) {
        let deleted = 0;
        for (const name of this._listJobJsonFilenames()) {
            const jobId = path.basename(name, '.json');
            const fp = this._jobFilePath(jobId);
            const rec = this._readRecordOrNull(fp, jobId);
            if (!rec) {
                continue;
            }
            if (!TERMINAL_JOB_STATUSES.has(rec.status)) {
                continue;
            }
            if (rec.updatedAt < cutoffIso) {
                try {
                    fs.unlinkSync(fp);
                    deleted += 1;
                } catch (e) {
                    console.error('[jobStore][file] purge unlink failed', { job_id: jobId, err: e.message });
                }
            }
        }
        return deleted;
    }

    /**
     * @param {number} maxDurationMs
     * @returns {number}
     */
    reclaimStaleRunningJobs(maxDurationMs) {
        const now = Date.now();
        let reclaimed = 0;
        for (const name of this._listJobJsonFilenames()) {
            const jobId = path.basename(name, '.json');
            const fp = this._jobFilePath(jobId);
            const rec = this._readRecordOrNull(fp, jobId);
            if (!rec || rec.status !== JOB_STATUS.RUNNING) {
                continue;
            }
            const t = Date.parse(rec.updatedAt);
            if (!Number.isFinite(t)) {
                continue;
            }
            if (now - t <= maxDurationMs) {
                continue;
            }
            this.updateJob(jobId, {
                status: JOB_STATUS.FAILED,
                stage: JOB_STAGE.FAILED,
                url: null,
                error: 'job_stale_running',
                message: `Job left running longer than ${maxDurationMs} ms (reclaimed to unblock queue)`,
                meta: {
                    ...(rec.meta || {}),
                    stale_reclaimed_at: new Date().toISOString(),
                    stale_max_duration_ms: maxDurationMs,
                },
            });
            reclaimed += 1;
            console.warn('[jobStore][file] reclaimStaleRunningJobs', { job_id: jobId, maxDurationMs, pid: process.pid });
        }
        return reclaimed;
    }
}

/**
 * @returns {JobStoreMemory|JobStoreFile}
 */
function createJobStore() {
    const raw = process.env.JOBS_STORE_DRIVER;
    const driver = raw && String(raw).trim() !== ''
        ? String(raw).trim().toLowerCase()
        : 'file';

    if (driver === 'memory') {
        console.log('[jobStore] JOBS_STORE_DRIVER=memory (in-process Map, not shared between Passenger workers)');
        return new JobStoreMemory();
    }

    if (driver === 'file') {
        const dir = resolveJobsDirectory();
        console.log('[jobStore] JOBS_STORE_DRIVER=file', { jobs_dir: dir });
        return new JobStoreFile();
    }

    throw new Error(
        `[jobStore] Unsupported JOBS_STORE_DRIVER="${raw}". Use "file" or "memory".`,
    );
}

/** Singleton на процесс Node — маршруты и воркер используют один экземпляр. */
const jobStore = createJobStore();

module.exports = {
    JobStore: JobStoreFile,
    JobStoreMemory,
    JobStoreFile,
    jobStore,
    toPublicJob,
    resolveJobsDirectory,
};
