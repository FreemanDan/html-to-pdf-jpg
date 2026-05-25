require('dotenv').config();
require('./lib/puppeteerEnv');
require('./lib/fileLogSetup').installFileLogging();

const express = require('express');
const bodyParser = require('body-parser');
const jwt = require('jsonwebtoken');
const { convertToPdf, convertToJpeg, CaptureError } = require('./converter');
const { jobsRouter } = require('./routes/jobs');
const { scheduleJobWorker } = require('./jobs');
const path = require('path');
const { filesystemPathToPublicUrl } = require('./lib/outputPublicUrl');

const app = express();
const port = 3000;

const secretKey = process.env.SECRET_KEY; // Секретный ключ для JWT
const eternalToken = process.env.ETERNAL_TOKEN; // Вечный токен из переменной окружения

// Middleware для обработки CORS
app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*'); // Замените '*' на домен вашего клиента для большей безопасности
    res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Request-Id, X-Correlation-Id');
    next();
});

// Обработка предзапросов OPTIONS
app.options('*', (req, res) => {
    res.sendStatus(204);
});

app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, 'public'))); // Настройка для обслуживания статических файлов
// Снимки и PDF для Telegram (sendDocument URL) — публичный путь /output/... при наличии OUTPUT_PUBLIC_BASE_URL
app.use(
    '/output',
    express.static(path.join(__dirname, '..', 'output'), {
        fallthrough: false,
        index: false,
    })
);

// Настройка маршрутов для API под /api/v1
const apiRouter = express.Router();

const authenticateToken = (req, res, next) => {
    const token = req.headers['authorization']?.split(' ')[1];
    if (!token) return res.sendStatus(403);

    jwt.verify(token, secretKey, (err, user) => {
        if (err) return res.sendStatus(403);
        req.user = user;
        next();
    });
};

app.get('/', (req, res) => {

    //res.send('Html to PDF and JPEG converter');
    // выведем test.html
    try {
        //res.send('Html to PDF and JPEG converter');
        res.sendFile(path.join(__dirname, '../public', 'test.html'));
    } catch (error) {
        console.error('Error sending file:', error);
        res.status(500).send('Error sending file.');
    }



});

// Метод для сохранения сгенерированных файлов и возврата URL
apiRouter.post('/convert', authenticateToken, async (req, res) => {
    const { url, format, clip_to_element = null, emulate_media_type = null } = req.body;
    const captureReadyMode = isCaptureReadyMode(req);
    const conversionOptions = buildConversionOptions(req);
    const viewportError = validateViewportRequest(req.body);
    if (viewportError) {
        return res.status(viewportError.statusCode).json({
            error: viewportError.code,
            message: viewportError.message,
            meta: { request_id: conversionOptions.requestId },
        });
    }
    if (captureReadyMode) {
        const validationError = validateCaptureReadyRequest({ url, format });
        if (validationError) {
            console.error('Convert validation failed:', validationError.code);
            return res.status(validationError.statusCode).json({
                error: validationError.code,
                message: validationError.message,
                meta: { request_id: conversionOptions.requestId },
            });
        }
    } else {
        if (format !== 'pdf' && format !== 'jpeg') {
            console.error('Unsupported format:', format);
            return res.status(400).send('Unsupported format: ' + format + '.');
        }
    }

    const convertFunction = format === 'pdf' ? convertToPdf : convertToJpeg;

    console.log('[convert] start', {
        request_id: conversionOptions.requestId,
        mode: captureReadyMode ? 'capture_ready' : 'legacy',
        format,
        has_clip_to_element: Boolean(clip_to_element),
        viewport: conversionOptions.viewport,
    });

    try {
        const outputUrl = await convertFunction(
            url,
            false,
            clip_to_element,
            emulate_media_type,
            conversionOptions
        );
        console.log('[convert] success', {
            request_id: conversionOptions.requestId,
            mode: captureReadyMode ? 'capture_ready' : 'legacy',
        });
        res.json({ url: filesystemPathToPublicUrl(outputUrl) });
    } catch (err) {
        console.error('[convert] failed:', {
            request_id: conversionOptions.requestId,
            mode: captureReadyMode ? 'capture_ready' : 'legacy',
            error_code: err && err.code ? err.code : null,
            message: err && err.message ? err.message : String(err),
        });

        if (captureReadyMode) {
            const structuredError = toStructuredError(err, req, 'Conversion failed');
            return res.status(structuredError.statusCode).json(structuredError.body);
        }

        res.status(500).send('Conversion failed. error: ' + err);
    }
});

// Метод для конвертации и немедленной отправки файла
apiRouter.post('/convert-and-send', authenticateToken, async (req, res) => {
    const { url, format, clip_to_element = null, emulate_media_type = null } = req.body;
    const captureReadyMode = isCaptureReadyMode(req);
    const conversionOptions = buildConversionOptions(req);
    const viewportError = validateViewportRequest(req.body);
    if (viewportError) {
        return res.status(viewportError.statusCode).json({
            error: viewportError.code,
            message: viewportError.message,
            meta: { request_id: conversionOptions.requestId },
        });
    }
    if (captureReadyMode) {
        const validationError = validateCaptureReadyRequest({ url, format });
        if (validationError) {
            console.error('Convert-and-send validation failed:', validationError.code);
            return res.status(validationError.statusCode).json({
                error: validationError.code,
                message: validationError.message,
                meta: { request_id: conversionOptions.requestId },
            });
        }
    } else {
        if (format !== 'pdf' && format !== 'jpeg') {
            console.error('Unsupported format:', format);
            return res.status(400).send('Unsupported format.');
        }
    }

    const convertFunction = format === 'pdf' ? convertToPdf : convertToJpeg;

    console.log('[convert-and-send] start', {
        request_id: conversionOptions.requestId,
        mode: captureReadyMode ? 'capture_ready' : 'legacy',
        format,
        has_clip_to_element: Boolean(clip_to_element),
        viewport: conversionOptions.viewport,
    });

    try {
        const { buffer, filename } = await convertFunction(
            url,
            true,
            clip_to_element,
            emulate_media_type,
            conversionOptions
        );
        const contentType = format === 'pdf' ? 'application/pdf' : 'image/jpeg';
        res.setHeader('Content-Type', contentType);
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"; filename*=UTF-8''${encodeURIComponent(filename)}`);
        res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
        // Access-Control-Allow-Origin: *
        //res.setHeader('Access-Control-Allow-Origin', '*');
        //res.setHeader("Access-Control-Allow-Methods: POST, GET, OPTIONS");
        //res.setHeader("Access-Control-Allow-Headers: Content-Type, Authorization");
        res.setHeader('Content-Length', buffer.length);

        res.send(buffer);
    } catch (err) {
        console.error('[convert-and-send] failed:', {
            request_id: conversionOptions.requestId,
            mode: captureReadyMode ? 'capture_ready' : 'legacy',
            error_code: err && err.code ? err.code : null,
            message: err && err.message ? err.message : String(err),
        });

        if (captureReadyMode) {
            const structuredError = toStructuredError(err, req, 'Conversion and send failed');
            return res.status(structuredError.statusCode).json(structuredError.body);
        }

        res.status(500).send('Conversion failed. error: ' + err);
    }
});

// Async-job: постановка в очередь (шаг 3 — без запуска Puppeteer; воркер — шаг 4)
apiRouter.use('/jobs', authenticateToken, jobsRouter);

app.use('/api/v1', apiRouter);

const getRequestId = (req) => {
    return req.headers['x-request-id'] || req.headers['x-correlation-id'] || null;
};

const parsePositiveInteger = (value) => {
    const parsed = Number.parseInt(String(value), 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
};

const buildViewportOptions = (body) => {
    if (!body || (body.viewport_width == null && body.viewport_height == null)) {
        return null;
    }

    const width = parsePositiveInteger(body.viewport_width);
    const height = parsePositiveInteger(body.viewport_height);
    if (!width || !height) {
        return null;
    }

    return { width, height };
};

const validateViewportRequest = (body) => {
    if (!body || (body.viewport_width == null && body.viewport_height == null)) {
        return null;
    }

    const width = parsePositiveInteger(body.viewport_width);
    const height = parsePositiveInteger(body.viewport_height);
    if (!width || !height) {
        return {
            code: 'invalid_viewport',
            message: 'Fields "viewport_width" and "viewport_height" must be positive integers and must be passed together',
            statusCode: 400,
        };
    }

    return null;
};

const isCaptureReadyMode = (req) => {
    return req.body && req.body.wait_for_capture_ready === true;
};

const buildConversionOptions = (req) => {
    return {
        waitForCaptureReady: isCaptureReadyMode(req),
        requestId: getRequestId(req),
        viewport: buildViewportOptions(req.body),
    };
};

const validateCaptureReadyRequest = ({ url, format }) => {
    if (!url) {
        return { code: 'missing_url', message: 'Field "url" is required', statusCode: 400 };
    }

    if (format !== 'pdf' && format !== 'jpeg') {
        return {
            code: 'unsupported_format',
            message: `Unsupported format: ${format}. Allowed values: pdf, jpeg`,
            statusCode: 400,
        };
    }

    return null;
};

const toStructuredError = (error, req, fallbackMessage) => {
    const requestId = getRequestId(req);
    const defaultMeta = { request_id: requestId };

    if (error instanceof CaptureError) {
        return {
            statusCode: error.statusCode || 500,
            body: {
                error: error.code || 'conversion_failed',
                message: error.message || fallbackMessage,
                meta: { ...defaultMeta, ...(error.meta || {}) },
            },
        };
    }

    return {
        statusCode: 500,
        body: {
            error: 'conversion_failed',
            message: fallbackMessage,
            meta: defaultMeta,
        },
    };
};

const PORT = process.env.PORT || 3000; // PORT задается Passenger
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
    console.log(`Use this token for API requests: ${eternalToken}`);
    // Подхватить queued job после старта (файлы на диске переживают рестарт процесса; in-memory store — нет)
    scheduleJobWorker();
});