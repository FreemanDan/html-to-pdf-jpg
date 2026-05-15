# Puppeteer Conversion Service

## Описание

Сервис делает скриншоты страниц через Puppeteer и предоставляет два API:

- `POST /api/v1/convert` — сохраняет результат в `output/` и возвращает JSON с URL файла.
- `POST /api/v1/convert-and-send` — возвращает файл сразу бинарным ответом.

Авторизация для обоих endpoints обязательна: `Authorization: Bearer <ETERNAL_TOKEN>`.

## Установка

```bash
npm install
```

Создайте `.env` в корне проекта:

```env
SECRET_KEY=<jwt secret>
ETERNAL_TOKEN=<api token>

# Таймауты Puppeteer (мс). Если не заданы — в коде свои дефолты (см. src/converter.js).
PUPPETEER_GOTO_TIMEOUT_MS=120000
PUPPETEER_CAPTURE_READY_TIMEOUT_MS=180000
PUPPETEER_SELECTOR_TIMEOUT_MS=45000
PUPPETEER_CAPTURE_READY_STABILIZATION_MS=0
```

Если нужно сгенерировать `SECRET_KEY` и `ETERNAL_TOKEN`, используйте:

```bash
npm run generate-env
```

Запуск:

```bash
npm start
```

## Контракт API

### Общие поля запроса

```json
{
  "url": "https://example.com/dashboard/12",
  "format": "jpeg",
  "clip_to_element": "widget-257",
  "emulate_media_type": "screen",
  "wait_for_capture_ready": true
}
```

- `url` — адрес страницы для захвата.
- `format` — `jpeg` или `pdf`.
- `clip_to_element` — id элемента **без `#`** (например, `widget-257`).
- `emulate_media_type` — опционально, передается в `page.emulateMediaType`.
- `wait_for_capture_ready` — opt-in режим ожидания `window.__CAPTURE_READY__ === true`.

### Режимы работы

- `wait_for_capture_ready` отсутствует или `false`:
  - legacy-режим (обратная совместимость);
  - навигация через `waitUntil: "networkidle2"`;
  - старый формат ошибок (`500` с текстом) сохранен.

- `wait_for_capture_ready: true`:
  - режим интеграции с дашбордами;
  - навигация через `waitUntil: "domcontentloaded"`;
  - ожидание `window.__CAPTURE_READY__ === true`;
  - структурированные JSON-ошибки с машинными кодами.

### `POST /api/v1/convert`

Успех:

```json
{
  "url": "/Users/.../output/converted_YYYYMMDD_HHMMSS.jpeg"
}
```

### `POST /api/v1/convert-and-send`

Успех:

- бинарный ответ файла (`application/pdf` или `image/jpeg`);
- заголовок `Content-Disposition` с именем файла.

## Ошибки

### Legacy-режим

- `400` — неподдерживаемый формат.
- `403` — невалидный/отсутствующий токен.
- `500` — текстовая ошибка конвертации.

### Режим `wait_for_capture_ready: true`

Структура:

```json
{
  "error": "dashboard_not_ready",
  "message": "Dashboard did not become capture-ready before timeout",
  "meta": {
    "request_id": "optional-request-id",
    "timeout_ms": 30000
  }
}
```

Поддерживаемые коды:

- `missing_url` — в запросе не передан `url`.
- `unsupported_format` — формат не `jpeg`/`pdf`.
- `navigation_failed` — ошибка/таймаут навигации.
- `dashboard_not_ready` — таймаут ожидания `window.__CAPTURE_READY__`.
- `widget_not_found` — элемент по `clip_to_element` не найден.
- `widget_not_rendered` — элемент найден, но без валидного `boundingBox`.
- `conversion_failed` — прочая нераспознанная ошибка.

## Важные ограничения

- `clip_to_element` применяется только к `jpeg`.
- Для `pdf` параметр `clip_to_element` логируется и игнорируется.

## Примеры

Legacy-запрос:

```bash
curl -X POST "http://localhost:3000/api/v1/convert" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <ETERNAL_TOKEN>" \
  -d '{"url":"https://example.com","format":"jpeg"}'
```

Capture-ready запрос:

```bash
curl -X POST "http://localhost:3000/api/v1/convert" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <ETERNAL_TOKEN>" \
  -H "x-request-id: test-11751-01" \
  -d '{"url":"https://example.com/dashboard/12","format":"jpeg","clip_to_element":"widget-257","wait_for_capture_ready":true}'
```