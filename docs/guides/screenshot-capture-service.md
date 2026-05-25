# Сервис захвата скриншотов

**Область действия:** Node-сервис `puppeteer-test` (Puppeteer).  
**Оркестратор:** [screenshot-run-orchestration](../../../tvorchestvo/dev-reports-api/docs/guides/screenshot-run-orchestration.md).  
**Frontend готовности:** [page-readiness](../../../analytic_system/dev-analytics-b24/docs/guides/page-readiness.md).

## Назначение

HTTP-сервис захвата страниц и виджетов дашборда. Поддерживает синхронные endpoints (legacy) и асинхронные **job** для оркестратора `dev-reports-api`.

## Endpoints

| Метод | Путь | Назначение |
|-------|------|------------|
| POST | `/api/v1/convert` | Sync: сохранить в `output/`, JSON с `url` |
| POST | `/api/v1/convert-and-send` | Sync: бинарный ответ файла |
| POST | `/api/v1/jobs` | Async: **201**, `job_id`, без ожидания захвата |
| GET | `/api/v1/jobs/:jobId` | Короткий статус для polling |

Авторизация: `Authorization: Bearer <ETERNAL_TOKEN>`.  
Рекомендуется: `X-Request-Id` → эхо `request_id` (корреляция с `run_id` оркестратора).

## Тело запроса (общие поля)

```json
{
  "url": "https://example.com/dashboard/12#token=…",
  "format": "jpeg",
  "clip_to_element": "widget-257",
  "emulate_media_type": "screen",
  "wait_for_capture_ready": true,
  "viewport_width": 1000,
  "viewport_height": 600
}
```

| Поле | Обязательность | Примечание |
|------|----------------|------------|
| `url` | да | URL дашборда с token от оркестратора |
| `format` | да | `jpeg` \| `pdf` |
| `clip_to_element` | нет | id **без** `#`; для `pdf` **игнорируется** |
| `wait_for_capture_ready` | для дашбордов — да | opt-in; см. [ADR](../adr/wait-for-capture-ready-opt-in.md) |
| `viewport_width` / `viewport_height` | нет | оба положительных целых или оба отсутствуют |

## Режимы `wait_for_capture_ready`

**Отсутствует или `false` (legacy):**

- `waitUntil: networkidle2`;
- прежний формат ошибок (`500` текст).

**`true` (интеграция с дашбордом):**

- `waitUntil: domcontentloaded`;
- ожидание `window.__CAPTURE_READY__ === true`;
- структурированные JSON-ошибки с машинными кодами.

## Ответы sync `/convert`

Успех:

```json
{ "url": "https://services.example.com/output/capture_YYYYMMDD_HHMMSS_mmm.jpg" }
```

С `OUTPUT_PUBLIC_BASE_URL` — HTTPS URL для Telegram; без него — локальный путь.

## Async job

### POST `/api/v1/jobs` — 201

```json
{
  "job_id": "550e8400-e29b-41d4-a716-446655440000",
  "status": "queued",
  "request_id": "manual-12-1715779200"
}
```

### GET `/api/v1/jobs/:jobId` — 200

В процессе: `status: running`, `stage: waiting_page_ready`, …

Успех: `status: completed`, `url: "…"`, `stage: completed`

Ошибка: `status: failed`, `error`, `message`, `meta`

Не найден: **404**, `error: job_not_found`

### Технические `status`

| status | Смысл |
|--------|--------|
| `queued` | В очереди (concurrency = 1 на процесс) |
| `running` | Идёт захват |
| `completed` | Файл готов |
| `failed` | Терминальная ошибка |

### Технические `stage`

`queued` → `launching_browser` → `navigating` → `waiting_page_ready` → `resolving_widget` (если clip) → `capturing` → `saving_file` → `completed` / `failed`

## Коды ошибок (`wait_for_capture_ready: true` и job)

| Код | Причина |
|-----|---------|
| `missing_url` | Нет `url` |
| `unsupported_format` | Не jpeg/pdf |
| `invalid_viewport` | Некорректная пара viewport |
| `navigation_failed` | Ошибка/таймаут goto |
| `dashboard_not_ready` | Таймаут `__CAPTURE_READY__` |
| `widget_not_found` | Селектор не найден |
| `widget_not_rendered` | Нулевой boundingBox |
| `job_not_found` | Нет файла job / purge TTL |
| `job_execute_timeout` | Превышен `JOBS_EXECUTE_TIMEOUT_MS` |
| `job_stale_running` | Зависший `running` (stale reclaim) |

## Переменные окружения

### Базовые

```env
SECRET_KEY=
ETERNAL_TOKEN=
OUTPUT_PUBLIC_BASE_URL=https://services.samoliot.ru
```

### Puppeteer

| Переменная | По умолчанию | Назначение |
|------------|--------------|------------|
| `PUPPETEER_GOTO_TIMEOUT_MS` | 120000 | Таймаут goto |
| `PUPPETEER_CAPTURE_READY_TIMEOUT_MS` | 180000 | Ожидание `__CAPTURE_READY__` |
| `PUPPETEER_SELECTOR_TIMEOUT_MS` | 45000 | waitForSelector виджета |
| `PUPPETEER_CAPTURE_READY_STABILIZATION_MS` | 5000 | Пауза после ready перед снимком |
| `PUPPETEER_CACHE_DIR` | `storage/puppeteer-browsers` | Каталог бинарника Chrome; не удалять на сервере |
| `PUPPETEER_EXECUTABLE_PATH` | — | Системный Chromium вместо bundled (опционально) |

После деплоя или удаления каталога кэша: `npm run install:chrome` (также вызывается из `postinstall` при `npm install`).

### Job store

| Переменная | По умолчанию | Назначение |
|------------|--------------|------------|
| `JOBS_STORE_DRIVER` | `file` | `file` или `memory` |
| `JOBS_DIR` | `storage/jobs` | Каталог `<job_id>.json` |
| `JOBS_EXECUTE_TIMEOUT_MS` | 420000 | Лимит одного job |
| `JOBS_STALE_RUNNING_AFTER_MS` | 900000 | Сброс зависшего running |
| `JOBS_TERMINAL_TTL_HOURS` | 72 | Purge completed/failed |

Подробнее: [ADR file-based job store](../adr/file-based-job-store.md), [runbook диагностики](../runbooks/screenshot-job-diagnostics.md).

## Ограничения

- `clip_to_element` только для **jpeg**; для pdf — предупреждение в лог, обрезка не выполняется.
- **concurrency = 1** на процесс Node; второй job ждёт в `queued`.
- Имена файлов: `capture_YYYYMMDD_HHMMSS_mmm.jpg` / `.pdf`.
- Telegram `sendPhoto` по URL — лимит **5 MB**; `sendDocument` — **10 MB** при multipart.

## Ключевые файлы

| Роль | Путь |
|------|------|
| Сервер | `src/server.js` |
| Конвертер | `src/converter.js` |
| Job routes | `src/routes/jobs.js` |
| Store | `src/jobs/jobStore.js` |
| Worker | `src/jobs/jobWorker.js`, `jobExecutor.js` |

## Примеры

```bash
# Legacy
curl -X POST "http://localhost:3000/api/v1/convert" \
  -H "Authorization: Bearer $ETERNAL_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"url":"https://example.com","format":"jpeg"}'

# Capture-ready
curl -X POST "http://localhost:3000/api/v1/jobs" \
  -H "Authorization: Bearer $ETERNAL_TOKEN" \
  -H "X-Request-Id: test-run-01" \
  -H "Content-Type: application/json" \
  -d '{"url":"https://…/dashboard/12#token=…","format":"jpeg","clip_to_element":"widget-257","wait_for_capture_ready":true}'
```
