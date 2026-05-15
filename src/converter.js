const puppeteer = require('puppeteer');
const path = require('path');

// Таймауты по умолчанию завышены под тяжёлые SPA (дашборды BI + wait_for_capture_ready).
// Переопределение: PUPPETEER_* в .env на сервисе скриншотов.
const DEFAULT_TIMEOUTS_MS = {
    goto: Number.parseInt(process.env.PUPPETEER_GOTO_TIMEOUT_MS || '120000', 10),
    ready: Number.parseInt(process.env.PUPPETEER_CAPTURE_READY_TIMEOUT_MS || '180000', 10),
    selector: Number.parseInt(process.env.PUPPETEER_SELECTOR_TIMEOUT_MS || '45000', 10),
    readyStabilization: Number.parseInt(process.env.PUPPETEER_CAPTURE_READY_STABILIZATION_MS || '0', 10),
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

const getWaitUntil = (waitForCaptureReady) => {
    return waitForCaptureReady ? 'domcontentloaded' : 'networkidle2';
};

const withSafeMetaUrl = (url) => {
    try {
        const parsed = new URL(url);
        return `${parsed.origin}${parsed.pathname}`;
    } catch (error) {
        return '';
    }
};

const resolveClipParameters = async (page, clipToElement, waitForCaptureReady, requestMeta) => {
    if (!clipToElement) {
        return null;
    }

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

    const element = await page.$(selector);
    if (!element) {
        throw new CaptureError(
            'widget_not_found',
            `Widget element was not found by selector: ${selector}`,
            { ...requestMeta, selector },
            422
        );
    }

    const boundingBox = await element.boundingBox();
    if (
        !boundingBox ||
        !isPositiveNumber(boundingBox.width) ||
        !isPositiveNumber(boundingBox.height)
    ) {
        throw new CaptureError(
            'widget_not_rendered',
            `Widget element is not rendered and has invalid bounding box: ${selector}`,
            { ...requestMeta, selector },
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
            await page.waitForFunction(() => window.__CAPTURE_READY__ === true, {
                timeout: DEFAULT_TIMEOUTS_MS.ready,
            });
        } catch (error) {
            throw new CaptureError(
                'dashboard_not_ready',
                'Dashboard did not become capture-ready before timeout',
                { ...requestMeta, timeout_ms: DEFAULT_TIMEOUTS_MS.ready },
                422
            );
        }

        if (DEFAULT_TIMEOUTS_MS.readyStabilization > 0) {
            await new Promise((resolve) => setTimeout(resolve, DEFAULT_TIMEOUTS_MS.readyStabilization));
        }
    }

    return resolveClipParameters(page, clipToElement, waitForCaptureReady, requestMeta);
};

const generateTimestamp = () => {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    const hours = String(now.getHours()).padStart(2, '0');
    const minutes = String(now.getMinutes()).padStart(2, '0');
    const seconds = String(now.getSeconds()).padStart(2, '0');
    return `${year}${month}${day}_${hours}${minutes}${seconds}`;
};

const convertToPdf = async (
    url,
    returnBuffer = false,
    clip_to_element = null,
    emulate_media_type = null,
    options = {}
) => {
    const browser = await puppeteer.launch({
        args: ['--no-sandbox', '--disable-setuid-sandbox'],
    });
    const page = await browser.newPage();

    try {
        await preparePageForCapture(page, url, null, options);
        const timestamp = generateTimestamp();
        const outputFilePath = path.join(__dirname, '..', 'output', `converted_${timestamp}.pdf`);

        if (emulate_media_type) {
            await page.emulateMediaType(emulate_media_type);
        }

        if (clip_to_element) {
            console.warn('[converter] clip_to_element is ignored for pdf format', {
                clip_to_element,
                request_id: options.requestId || null,
            });
        }

        if (returnBuffer) {
            const pdfBuffer = await page.pdf({ format: 'A4', printBackground: true });
            return { buffer: Buffer.from(pdfBuffer), filename: `converted_${timestamp}.pdf` };
        }

        await page.pdf({ path: outputFilePath, format: 'A4', printBackground: true });
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
    const browser = await puppeteer.launch({
        args: ['--no-sandbox', '--disable-setuid-sandbox'],
    });
    const page = await browser.newPage();

    try {
        const clip = await preparePageForCapture(page, url, clip_to_element, options);

        if (emulate_media_type) {
            await page.emulateMediaType(emulate_media_type);
        }

        const timestamp = generateTimestamp();
        const outputFilePath = path.join(__dirname, '..', 'output', `converted_${timestamp}.jpeg`);

        const parameters = {
            fullPage: true,
            type: 'jpeg',
        };

        if (clip) {
            parameters.clip = clip;
            parameters.fullPage = false;
        }

        if (returnBuffer) {
            const jpegBuffer = await page.screenshot(parameters);
            return { buffer: Buffer.from(jpegBuffer), filename: `converted_${timestamp}.jpeg` };
        }

        parameters.path = outputFilePath;
        await page.screenshot(parameters);
        return outputFilePath;
    } finally {
        await browser.close();
    }
};

module.exports = { convertToPdf, convertToJpeg, CaptureError };