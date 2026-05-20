/**
 * @file: src/jobs/validateJobPayload.js
 * @description: Валидация тела POST /api/v1/jobs (те же поля, что у /convert)
 * @dependencies: —
 * @created: 2026-05-15
 */

/**
 * @param {Object} body
 * @returns {{ code: string, message: string, statusCode: number }|null}
 */
const validateJobCreatePayload = (body) => {
    const url = body && body.url;
    const format = body && body.format;

    if (!url || typeof url !== 'string' || url.trim() === '') {
        return {
            code: 'missing_url',
            message: 'Field "url" is required',
            statusCode: 400,
        };
    }

    if (format !== 'pdf' && format !== 'jpeg') {
        return {
            code: 'unsupported_format',
            message: `Unsupported format: ${format}. Allowed values: pdf, jpeg`,
            statusCode: 400,
        };
    }

    if (body.viewport_width != null || body.viewport_height != null) {
        const width = parsePositiveInteger(body.viewport_width);
        const height = parsePositiveInteger(body.viewport_height);
        if (!width || !height) {
            return {
                code: 'invalid_viewport',
                message: 'Fields "viewport_width" and "viewport_height" must be positive integers and must be passed together',
                statusCode: 400,
            };
        }
    }

    return null;
};

const parsePositiveInteger = (value) => {
    const parsed = Number.parseInt(String(value), 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
};

const normalizeViewport = (body) => {
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

/**
 * Нормализует тело запроса в payload для jobStore.
 *
 * @param {Object} body
 * @returns {import('./jobStore').JobCapturePayload}
 */
const normalizeJobPayload = (body) => {
    return {
        url: body.url,
        format: body.format,
        clip_to_element: body.clip_to_element ?? null,
        emulate_media_type: body.emulate_media_type ?? null,
        wait_for_capture_ready: body.wait_for_capture_ready === true,
        viewport: normalizeViewport(body),
    };
};

module.exports = {
    validateJobCreatePayload,
    normalizeJobPayload,
};
