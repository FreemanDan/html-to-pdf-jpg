const { getPuppeteerCacheDir, getPuppeteerLaunchOptions } = require('./lib/puppeteerEnv');
const puppeteer = require('puppeteer');
const path = require('path');
const fs = require('fs');

// Таймауты по умолчанию завышены под тяжёлые SPA (дашборды BI + wait_for_capture_ready).
// Переопределение: PUPPETEER_* в .env на сервисе скриншотов.
const DEFAULT_TIMEOUTS_MS = {
    goto: Number.parseInt(process.env.PUPPETEER_GOTO_TIMEOUT_MS || '120000', 10),
    ready: Number.parseInt(process.env.PUPPETEER_CAPTURE_READY_TIMEOUT_MS || '180000', 10),
    selector: Number.parseInt(process.env.PUPPETEER_SELECTOR_TIMEOUT_MS || '45000', 10),
    /** Пауза после первого `__CAPTURE_READY__ === true` перед clip/screenshot (lazy-визуализации). */
    readyStabilization: Number.parseInt(process.env.PUPPETEER_CAPTURE_READY_STABILIZATION_MS || '5000', 10),
};

class CaptureError extends Error {
    constructor(code, message, meta = {}, statusCode = 500) {
        super(message);
        this.name = 'CaptureError';
        this.code = code;
        this.meta = meta;
        this.statusCode = statusCode;
    }
}

const isPositiveNumber = (value) => typeof value === 'number' && Number.isFinite(value) && value > 0;

const TABLE_CAPTURE_SURFACE_SELECTORS = [
    '[data-capture-surface="city-daily-table-day-results"]',
    '[data-capture-surface="city-daily-table-month-dynamics"]',
];

const TABLE_CAPTURE_SURFACE_SELECTOR = TABLE_CAPTURE_SURFACE_SELECTORS.join(', ');

/**
 * Опциональный колбэк для async-job: обновление технической stage в jobStore.
 * @param {Object} options
 * @param {string} stage — см. JOB_STAGE в src/jobs/constants.js
 */
const notifyStage = (options, stage) => {
    if (options && typeof options.onStage === 'function') {
        options.onStage(stage);
    }
};

/**
 * Запуск Chromium с понятной ошибкой, если бинарник не установлен (удалён `.cache` / `storage/puppeteer-browsers`).
 *
 * @returns {Promise<import('puppeteer').Browser>}
 */
const launchBrowser = async () => {
    try {
        return await puppeteer.launch(getPuppeteerLaunchOptions());
    } catch (error) {
        const message = error && error.message ? error.message : String(error);
        if (/Could not find Chrome|Could not find browser/i.test(message)) {
            const cacheDir = getPuppeteerCacheDir();
            throw new CaptureError(
                'chrome_not_installed',
                'Chrome for Puppeteer is not installed. Run: npm run install:chrome',
                {
                    cache_dir: cacheDir,
                    recovery_command: 'npm run install:chrome',
                },
                503,
            );
        }
        throw error;
    }
};

const getWaitUntil = (waitForCaptureReady) => {
    return waitForCaptureReady ? 'domcontentloaded' : 'networkidle2';
};

/**
 * Фиксирует viewport до `page.goto`, только если клиент явно передал размеры.
 * Без параметров запроса сохраняется стандартный viewport Chromium.
 */
const applyCaptureViewport = async (page, options = {}) => {
    const viewport = options.viewport;
    if (!viewport || !isPositiveNumber(viewport.width) || !isPositiveNumber(viewport.height)) {
        return;
    }

    await page.setViewport({
        width: viewport.width,
        height: viewport.height,
    });
};

const withSafeMetaUrl = (url) => {
    try {
        const parsed = new URL(url);
        return `${parsed.origin}${parsed.pathname}`;
    } catch (error) {
        return '';
    }
};

const buildScopedCaptureSurfaceSelector = (widgetSelector) => {
    return TABLE_CAPTURE_SURFACE_SELECTORS.map((surfaceSelector) => `${widgetSelector} ${surfaceSelector}`).join(', ');
};

const waitForNextLayoutFrame = async (page) => {
    await page.evaluate(() => new Promise((resolve) => {
        requestAnimationFrame(() => {
            requestAnimationFrame(resolve);
        });
    }));
};

/**
 * Для табличных виджетов раскрывает overflow цепочки от capture-surface до оболочки `widget-*`,
 * чтобы `boundingBox()` видел полный размер таблицы, а не только видимую область dashboard grid.
 *
 * @param {import('puppeteer').Page} page
 * @param {string} widgetSelector
 * @returns {Promise<{ captureSurface: string|null, touchedCount: number }|null>}
 */
const revealCaptureSurfaceOverflow = async (page, widgetSelector) => {
    return page.evaluate((selector, surfaceSelector) => {
        const widget = document.querySelector(selector);
        if (!widget) {
            return null;
        }

        const surface = widget.querySelector(surfaceSelector);
        if (!surface) {
            return null;
        }

        let touchedCount = 0;
        let node = surface;
        while (node && node !== document.body && node !== document.documentElement) {
            node.style.setProperty('overflow', 'visible', 'important');
            node.style.setProperty('overflow-x', 'visible', 'important');
            node.style.setProperty('overflow-y', 'visible', 'important');
            node.style.setProperty('max-width', 'none', 'important');
            touchedCount += 1;

            if (node === widget) {
                break;
            }
            node = node.parentElement;
        }

        surface.style.setProperty('display', 'inline-block', 'important');
        surface.style.setProperty('width', 'max-content', 'important');
        surface.style.setProperty('max-width', 'none', 'important');

        surface
            .querySelectorAll('.table-day-results__scroll, .table-month-dynamics__scroll')
            .forEach((scrollNode) => {
                scrollNode.style.setProperty('overflow', 'visible', 'important');
                scrollNode.style.setProperty('overflow-x', 'visible', 'important');
                scrollNode.style.setProperty('overflow-y', 'visible', 'important');
                scrollNode.style.setProperty('width', 'max-content', 'important');
                scrollNode.style.setProperty('max-width', 'none', 'important');
            });

        return {
            captureSurface: surface.getAttribute('data-capture-surface'),
            touchedCount,
        };
    }, widgetSelector, TABLE_CAPTURE_SURFACE_SELECTOR);
};

/**
 * Ждёт стабилизацию размера элемента после раскрытия overflow и финального layout.
 *
 * @param {import('puppeteer').Page} page
 * @param {import('puppeteer').ElementHandle<Element>} elementHandle
 * @returns {Promise<void>}
 */
const waitForStableElementBox = async (page, elementHandle) => {
    let previous = null;

    for (let i = 0; i < 5; i++) {
        const current = await elementHandle.evaluate((element) => {
            const rect = element.getBoundingClientRect();
            return {
                width: rect.width,
                height: rect.height,
            };
        });

        if (
            previous &&
            Math.abs(previous.width - current.width) < 1 &&
            Math.abs(previous.height - current.height) < 1
        ) {
            return;
        }

        previous = current;
        await waitForNextLayoutFrame(page);
    }
};

/**
 * Уникальная метка времени для имени файла в output/ (до миллисекунд).
 * Снижает риск коллизии при двух захватах в одну секунду.
 */
const generateTimestamp = () => {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    const hours = String(now.getHours()).padStart(2, '0');
    const minutes = String(now.getMinutes()).padStart(2, '0');
    const seconds = String(now.getSeconds()).padStart(2, '0');
    const ms = String(now.getMilliseconds()).padStart(3, '0');
    return `${year}${month}${day}_${hours}${minutes}${seconds}_${ms}`;
};

/**
 * Базовое имя файла захвата в output/ (без расширения): capture_YYYYMMDD_HHMMSS_mmm
 */
const generateCaptureBasename = () => `capture_${generateTimestamp()}`;

/**
 * @returns {boolean}
 */
const isDebugSaveOnReadyTimeoutEnabled = () => {
    const raw = process.env.PUPPETEER_DEBUG_SAVE_ON_READY_TIMEOUT;
    if (raw === undefined || raw === null) {
        return false;
    }
    const f = String(raw).trim().toLowerCase();
    return f === '1' || f === 'true' || f === 'yes' || f === 'on';
};

/**
 * Временная отладка: при таймауте ожидания window.__CAPTURE_READY__ сохранить HTML страницы и full-page PNG.
 * Включается PUPPETEER_DEBUG_SAVE_ON_READY_TIMEOUT=1|true|yes|on. Каталог: <корень приложения>/output/debug_ready_timeout/
 * Работает только в ветке ошибки dashboard_not_ready (см. catch в preparePageForCapture); при job_stale_running / других сбоях не вызывается.
 *
 * @param {import('puppeteer').Page} page
 * @param {{ requestId?: string|null }} options
 * @returns {Promise<{ htmlRelative: string|null, pngRelative: string|null }|null>}
 */
const saveDebugArtifactsOnReadyTimeout = async (page, options = {}) => {
    if (!isDebugSaveOnReadyTimeoutEnabled()) {
        return null;
    }

    const debugDir = path.join(__dirname, '..', 'output', 'debug_ready_timeout');
    try {
        fs.mkdirSync(debugDir, { recursive: true });
    } catch (mkdirErr) {
        console.error(
            '[converter] debug_ready_timeout mkdir failed:',
            mkdirErr && mkdirErr.message ? mkdirErr.message : mkdirErr,
        );
        return null;
    }

    const ts = generateTimestamp();
    const ridRaw = options.requestId ? String(options.requestId) : 'no_rid';
    const rid = ridRaw.replace(/[^\w\-]+/g, '_').slice(0, 120);
    const base = `ready_timeout_${rid}_${ts}`;
    const htmlPath = path.join(debugDir, `${base}.html`);
    const pngPath = path.join(debugDir, `${base}.png`);

    const result = {
        htmlRelative: `output/debug_ready_timeout/${base}.html`,
        pngRelative: `output/debug_ready_timeout/${base}.png`,
    };

    try {
        const html = await page.content();
        fs.writeFileSync(htmlPath, html, 'utf8');
    } catch (htmlErr) {
        console.error(
            '[converter] debug_ready_timeout html save failed:',
            htmlErr && htmlErr.message ? htmlErr.message : htmlErr,
        );
        result.htmlRelative = null;
    }

    try {
        await page.screenshot({ path: pngPath, fullPage: true, type: 'png' });
    } catch (pngErr) {
        console.error(
            '[converter] debug_ready_timeout screenshot failed:',
            pngErr && pngErr.message ? pngErr.message : pngErr,
        );
        result.pngRelative = null;
    }

    console.warn('[converter] debug_capture_ready_timeout artifacts:', result);

    return result;
};

const resolveClipParameters = async (page, clipToElement, waitForCaptureReady, requestMeta, options = {}) => {
    if (!clipToElement) {
        return null;
    }

    notifyStage(options, 'resolving_widget');

    const selector = `#${clipToElement}`;

    if (waitForCaptureReady) {
        try {
            await page.waitForSelector(selector, {
                visible: true,
                timeout: DEFAULT_TIMEOUTS_MS.selector,
            });
        } catch (error) {
            throw new CaptureError(
                'widget_not_found',
                `Widget element was not found by selector: ${selector}`,
                { ...requestMeta, selector, timeout_ms: DEFAULT_TIMEOUTS_MS.selector },
                422
            );
        }
    }

    let element = await page.$(selector);
    if (!element) {
        throw new CaptureError(
            'widget_not_found',
            `Widget element was not found by selector: ${selector}`,
            { ...requestMeta, selector },
            422
        );
    }

    let effectiveSelector = selector;
    let captureSurfaceMeta = null;
    if (String(clipToElement).startsWith('widget-')) {
        captureSurfaceMeta = await revealCaptureSurfaceOverflow(page, selector);
        if (captureSurfaceMeta) {
            const scopedCaptureSurfaceSelector = buildScopedCaptureSurfaceSelector(selector);
            const captureSurfaceElement = await page.$(scopedCaptureSurfaceSelector);
            if (captureSurfaceElement) {
                element = captureSurfaceElement;
                effectiveSelector = scopedCaptureSurfaceSelector;
                await waitForStableElementBox(page, element);
                console.log('[converter] using inner capture surface for widget clip', {
                    selector,
                    capture_surface: captureSurfaceMeta.captureSurface,
                    touched_count: captureSurfaceMeta.touchedCount,
                    request_id: requestMeta.request_id,
                });
            }
        }
    }

    const boundingBox = await element.boundingBox();
    if (
        !boundingBox ||
        !isPositiveNumber(boundingBox.width) ||
        !isPositiveNumber(boundingBox.height)
    ) {
        throw new CaptureError(
            'widget_not_rendered',
            `Widget element is not rendered and has invalid bounding box: ${effectiveSelector}`,
            { ...requestMeta, selector: effectiveSelector },
            422
        );
    }

    return {
        x: boundingBox.x,
        y: boundingBox.y,
        width: boundingBox.width,
        height: boundingBox.height,
    };
};

const preparePageForCapture = async (page, url, clipToElement, options = {}) => {
    const waitForCaptureReady = options.waitForCaptureReady === true;
    const requestMeta = {
        request_id: options.requestId || null,
        url: withSafeMetaUrl(url),
    };

    try {
        notifyStage(options, 'navigating');
        await page.goto(url, {
            waitUntil: getWaitUntil(waitForCaptureReady),
            timeout: DEFAULT_TIMEOUTS_MS.goto,
        });
    } catch (error) {
        throw new CaptureError(
            'navigation_failed',
            'Failed to navigate to target url',
            { ...requestMeta, timeout_ms: DEFAULT_TIMEOUTS_MS.goto },
            502
        );
    }

    if (waitForCaptureReady) {
        try {
            notifyStage(options, 'waiting_page_ready');
            await page.waitForFunction(() => window.__CAPTURE_READY__ === true, {
                timeout: DEFAULT_TIMEOUTS_MS.ready,
            });
        } catch (error) {
            if (!isDebugSaveOnReadyTimeoutEnabled()) {
                const hintDir = path.join(__dirname, '..', 'output', 'debug_ready_timeout');
                console.warn(
                    '[converter] dashboard_not_ready: debug HTML/PNG отключены. Задайте PUPPETEER_DEBUG_SAVE_ON_READY_TIMEOUT=1 в .env и перезапустите процесс. Каталог сохранения:',
                    hintDir,
                );
            }
            const debugArtifacts = await saveDebugArtifactsOnReadyTimeout(page, options);
            throw new CaptureError(
                'dashboard_not_ready',
                'Dashboard did not become capture-ready before timeout',
                {
                    ...requestMeta,
                    timeout_ms: DEFAULT_TIMEOUTS_MS.ready,
                    ...(debugArtifacts && (debugArtifacts.htmlRelative || debugArtifacts.pngRelative)
                        ? { debug_capture_ready_timeout: debugArtifacts }
                        : {}),
                },
                422
            );
        }

        const stabilizationMs = DEFAULT_TIMEOUTS_MS.readyStabilization;
        if (stabilizationMs > 0) {
            console.log('[converter] capture_ready stabilization wait', {
                ms: stabilizationMs,
                request_id: options.requestId || null,
            });
            await new Promise((resolve) => setTimeout(resolve, stabilizationMs));
        }
    }

    return resolveClipParameters(page, clipToElement, waitForCaptureReady, requestMeta, options);
};

const convertToPdf = async (
    url,
    returnBuffer = false,
    clip_to_element = null,
    emulate_media_type = null,
    options = {}
) => {
    notifyStage(options, 'launching_browser');
    const browser = await launchBrowser();
    const page = await browser.newPage();
    await applyCaptureViewport(page, options);

    try {
        await preparePageForCapture(page, url, null, options);
        const captureBasename = generateCaptureBasename();
        const outputFilePath = path.join(__dirname, '..', 'output', `${captureBasename}.pdf`);

        if (emulate_media_type) {
            await page.emulateMediaType(emulate_media_type);
        }

        if (clip_to_element) {
            console.warn('[converter] clip_to_element is ignored for pdf format', {
                clip_to_element,
                request_id: options.requestId || null,
            });
        }

        notifyStage(options, 'capturing');
        if (returnBuffer) {
            const pdfBuffer = await page.pdf({ format: 'A4', printBackground: true });
            notifyStage(options, 'saving_file');
            return { buffer: Buffer.from(pdfBuffer), filename: `${captureBasename}.pdf` };
        }

        await page.pdf({ path: outputFilePath, format: 'A4', printBackground: true });
        notifyStage(options, 'saving_file');
        return outputFilePath;
    } finally {
        await browser.close();
    }
};

const convertToJpeg = async (
    url,
    returnBuffer = false,
    clip_to_element = null,
    emulate_media_type = null,
    options = {}
) => {
    notifyStage(options, 'launching_browser');
    const browser = await launchBrowser();
    const page = await browser.newPage();
    await applyCaptureViewport(page, options);

    try {
        const clip = await preparePageForCapture(page, url, clip_to_element, options);

        if (emulate_media_type) {
            await page.emulateMediaType(emulate_media_type);
        }

        const captureBasename = generateCaptureBasename();
        const outputFilePath = path.join(__dirname, '..', 'output', `${captureBasename}.jpg`);

        const parameters = {
            fullPage: true,
            type: 'jpeg',
        };

        if (clip) {
            parameters.clip = clip;
            parameters.fullPage = false;
        }

        // Долгий шаг: fullPage / большой DOM — между notifyStage нет обновлений; при JOBS_STALE_RUNNING_AFTER_MS
        // очередь может сбросить job, если скриншот длится дольше порога (см. README).
        notifyStage(options, 'capturing');
        if (returnBuffer) {
            const jpegBuffer = await page.screenshot(parameters);
            notifyStage(options, 'saving_file');
            return { buffer: Buffer.from(jpegBuffer), filename: `${captureBasename}.jpg` };
        }

        parameters.path = outputFilePath;
        await page.screenshot(parameters);
        notifyStage(options, 'saving_file');
        return outputFilePath;
    } finally {
        await browser.close();
    }
};

module.exports = { convertToPdf, convertToJpeg, CaptureError };