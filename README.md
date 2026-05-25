# Puppeteer Conversion Service

## Описание

Сервис делает скриншоты страниц через Puppeteer.

**Синхронные API (обратная совместимость):**

- `POST /api/v1/convert` — сохраняет результат в `output/` и возвращает JSON с URL файла.
- `POST /api/v1/convert-and-send` — возвращает файл сразу бинарным ответом.

**Асинхронные API (job, задача 11751):**

- `POST /api/v1/jobs` — постановка в очередь, ответ **`201`** с `job_id` (без ожидания захвата).
- `GET /api/v1/jobs/:jobId` — короткий статус для опроса (polling).

Авторизация обязательна: `Authorization: Bearer <ETERNAL_TOKEN>`.

Рекомендуется передавать `X-Request-Id` (или `X-Correlation-Id`) — значение возвращается в ответах и логах как `request_id` (корреляция с `run_id` оркестратора).

## Установка

```bash
npm install
```

`npm install` автоматически вызывает **`postinstall`** → **`npm run install:chrome`**: скачивает Chrome для Puppeteer в каталог **`storage/puppeteer-browsers`** (или в `PUPPETEER_CACHE_DIR`, если задан в `.env`).

**Не удаляйте** каталог `storage/puppeteer-browsers/` — это бинарник Chromium для скриншотов. Старый путь `.cache/puppeteer` больше не используется по умолчанию.

Если Chrome пропал (ошибка `chrome_not_installed` / `Could not find Chrome`), восстановление на сервере:

```bash
cd /home/s/samolivq/services.samoliot.ru
npm run install:chrome
touch tmp/restart.txt
```

Создайте `.env` в корне проекта:

```env
SECRET_KEY=<jwt secret>
ETERNAL_TOKEN=<api token>

# Публичный базовый URL приложения (HTTPS, без завершающего /), например: https://services.samoliot.ru
# Нужен для цепочки «скриншот → Telegram»: API Telegram принимает document только как http(s)-URL.
# В ответах /convert и в поле completed.result.url для job подставляется URL вида <OUTPUT_PUBLIC_BASE_URL>/output/<имя_файла>.
# Раздача файлов: Express монтирует каталог output/ на путь /output (см. src/server.js).
# OUTPUT_PUBLIC_BASE_URL=https://example.com

# Таймауты Puppeteer (мс). Если не заданы — в коде свои дефолты (см. src/converter.js).
PUPPETEER_GOTO_TIMEOUT_MS=120000
PUPPETEER_CAPTURE_READY_TIMEOUT_MS=180000
PUPPETEER_SELECTOR_TIMEOUT_MS=45000
# Пауза (мс) после __CAPTURE_READY__ перед скриншотом; по умолчанию в коде 5000. 0 — без паузы.
PUPPETEER_CAPTURE_READY_STABILIZATION_MS=5000
# Временно: при таймауте __CAPTURE_READY__ (ошибка dashboard_not_ready) пишет HTML + PNG в output/debug_ready_timeout/
# PUPPETEER_DEBUG_SAVE_ON_READY_TIMEOUT=1

# Каталог бинарника Chrome (по умолчанию: storage/puppeteer-browsers от корня приложения)
# PUPPETEER_CACHE_DIR=/home/s/samolivq/services.samoliot.ru/storage/puppeteer-browsers
# Альтернатива: системный Chromium (если установлен на хостинге)
# PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium-browser

# Логи приложения в файл (см. раздел «Логирование в файл»)
# LOG_TO_FILE=1
# LOG_FILE_PATH=logs/puppeteer-service.log

# JOBS_DIR=/home/user/job-storage/puppeteer-test/jobs

# Драйвер хранилища: file (по умолчанию) или memory (только один процесс Node).
# JOBS_STORE_DRIVER=file

# Таймаут выполнения async-job (мс)
# JOBS_EXECUTE_TIMEOUT_MS=420000
# «Зависший» running на диске старше этого интервала (по updatedAt) → failed (см. README)
# JOBS_STALE_RUNNING_AFTER_MS=900000
# JOBS_STALE_RUNNING_ENABLED=1
# JOBS_STALE_RECLAIM_MIN_INTERVAL_MS=10000
# JOBS_TERMINAL_PURGE_MIN_INTERVAL_MS=3600000
# JOBS_TERMINAL_PURGE_ENABLED=1
```

**Справочник переменных для async-job** — в разделе [«Очередь job, file-based store и диагностика»](#очередь-job-file-based-store-и-диагностика) ниже.

Если нужно сгенерировать `SECRET_KEY` и `ETERNAL_TOKEN`, используйте:

```bash
npm run generate-env
```

Запуск:

```bash
npm start
```

## Отладка: таймаут `__CAPTURE_READY__` (HTML + PNG)

Сохранение **включается только** переменной **`PUPPETEER_DEBUG_SAVE_ON_READY_TIMEOUT=1`** (или **`true`** / **`yes`** / **`on`**). Переменная читается **при старте процесса Node** — после правки `.env` на сервере нужен **рестарт** приложения (Passenger / `tmp/restart.txt`).

Срабатывает **только** если сработал таймаут **`page.waitForFunction(__CAPTURE_READY__)`** — в ответе/API будет код **`dashboard_not_ready`**. Если job завершился по **`job_stale_running`**, **`job_execute_timeout`** или другой причине, эта ветка **не выполняется** — отладочные файлы **не создаются**.

**Куда пишется:** каталог **`output/debug_ready_timeout/`** от **корня приложения** (рядом с `src/`), т.е. на сервере, например:  
`/home/s/samolivq/services.samoliot.ru/output/debug_ready_timeout/ready_timeout_<requestId>_<timestamp>.html` и `.png`.

Имена файлов содержат **`request_id`** (из заголовка `X-Request-Id`, иначе `no_rid`) и метку времени. В логах процесса есть строка **`[converter] debug_capture_ready_timeout artifacts:`** с относительными путями.

**Важно:** в репозитории каталог **`output/`** обычно в **`.gitignore`** — файлы видны на диске сервера; через HTTP они доступны по пути **`/output/...`** (Express `static` к каталогу `output/`). Для внешних интеграций (Telegram `sendDocument`) задайте **`OUTPUT_PUBLIC_BASE_URL`** так, чтобы итоговый URL был **HTTPS и доступен из интернета**.

## Очередь job, file-based store и диагностика

**MVP (задача 11751):** состояние каждого async-job хранится в отдельном JSON-файле **`JOBS_DIR/<job_id>.json`**. Запись на диск **атомарная** (временный файл + `rename`), чтобы процесс polling не прочитал обрезанный JSON.

Так несколько процессов **Passenger** видят одни и те же job по `job_id` (нет общей памяти между процессами).

**Хранилище задаётся `JOBS_STORE_DRIVER`:**

| Значение | Смысл |
|----------|--------|
| **`file`** (по умолчанию, если переменная не задана) | Каталог JSON-файлов; общий для всех процессов Node при **одинаковом `JOBS_DIR`**. |
| **`memory`** | Только для отладки или одного процесса: между воркерами Passenger данных **нет**; после рестарта записи пропадают. |

**`JOBS_DIR`** — абсолютный путь или значение через `path.resolve(process.cwd(), …)` к каталогу для файлов `<job_id>.json`. Если не задан → **`storage/jobs`** относительно текущего рабочего каталога приложения. На проде лучше вынести за пределы web-root, например: `JOBS_DIR=/home/s/samolivq/job-storage/puppeteer-test/jobs`.

**Очередь исполнения (claim)** в каждом процессе остаётся **локальной** (воркер + `scheduleJobWorker`). Для перевода следующей **`queued`** job в **`running`** между процессами используется эксклюзивный lock-файл **`.claim-<job_id>.lock`**, чтобы два воркера не взяли одну задачу. **`GET`** всегда читает актуальный JSON с диска.

**Ограничение MVP:** при рестарте процесса запись могла оставаться в **`queued`/`running`**; теперь задействованы **таймаут выполнения** и **сброс зависших `running`** (см. ниже).

**Таймауты async-job (воркер, `src/jobs/jobExecutor.js` / `staleRunningReclaim.js`):**

| Переменная | По умолчанию | Назначение |
|------------|----------------|------------|
| **`JOBS_EXECUTE_TIMEOUT_MS`** | `420000` (7 мин) | Жёсткий предел на одну конвертацию (`Promise.race`). По истечении job помечается **`failed`**, код **`job_execute_timeout`**; воркер освобождается. Фоновый Chromium может ещё работать до завершения процесса — см. лог `conversion settled after race`. |
| **`JOBS_STALE_RUNNING_AFTER_MS`** | `900000` (15 мин) | Если job всё ещё **`running`**, а с момента **`updatedAt`** прошло больше этого времени — перевод в **`failed`**, код **`job_stale_running`** (освобождает очередь при «осиротевших» записях после падения процесса или зависании без снятия локальной блокировки). Должно быть **больше**, чем **`JOBS_EXECUTE_TIMEOUT_MS`**, иначе сработает сначала таймаут конвертации. |
| **`JOBS_STALE_RUNNING_ENABLED`** | включено | `0` или `false` — сброс зависших `running` отключён (только очистка через `JOBS_EXECUTE_TIMEOUT_MS` в активном процессе). |
| **`JOBS_STALE_RECLAIM_MIN_INTERVAL_MS`** | `10000` | Минимальный интервал между проходами сброса зависших `running` в одном процессе (меньше нагрузки на диск). |

Пока **`isProcessing`** в данном процессе (идёт `executeJob`), проход **stale reclaim** в этом процессе не выполняется, чтобы не конкурировать с активным захватом; другие процессы Passenger при общем **`JOBS_DIR`** всё равно могут пометить запись как протухшую.

**Тяжёлый полноэкранный JPEG (`fullPage: true`, `clip_to_element` пустой):** после готовности дашборда (`waiting_page_ready`) одна операция **`page.screenshot()`** может идти **много минут** без промежуточных обновлений job в store — сработает **`job_stale_running`**, если суммарно прошло больше **`JOBS_STALE_RUNNING_AFTER_MS`**, либо раньше сработает **`job_execute_timeout`**. Снизить риск: указать **`clip_to_element`**, увеличить **`JOBS_STALE_RUNNING_AFTER_MS`** и **`JOBS_EXECUTE_TIMEOUT_MS`**, уменьшить высоту/сложность страницы.

**Терминальные файлы** (`completed`, `failed`) удаляются с диска по TTL:

| Переменная | По умолчанию | Назначение |
|------------|--------------|------------|
| **`JOBS_TERMINAL_TTL_HOURS`** | `72` | Файл удаляется, если job терминальный и время обновления старее окна от «сейчас». |
| **`JOBS_TERMINAL_PURGE_MIN_INTERVAL_MS`** | `3600000` (1 ч) | Минимум между успешными проходами purge в одном процессе. |
| **`JOBS_TERMINAL_PURGE_ENABLED`** | включено | `0` или `false` — очистка отключена. |

Purge вызывается из **цикла воркера**. После удаления файла **`GET /api/v1/jobs/:jobId`** возвращает **`404 job_not_found`** — итог нужно забрать у оркестратора до истечения TTL.

**Типичные причины `job_not_found` сразу после успешного `POST`:**

- **`JOBS_STORE_DRIVER=memory`** при нескольких процессах — нужен **`file`** и общий **`JOBS_DIR`**.
- Разные процессы с разным **`JOBS_DIR`** или разные копии деплоя.
- Файл **уже удалён purge**.
- Неверный **`job_id`**.

**Статика Express:** раздаётся только **`public/`** (`src/server.js`); **`storage/jobs`** по умолчанию **не** публикуется. Если позже добавите static с корня проекта — исключите **`storage/`**.

**Зависимости:** для очереди **нет** native npm-модулей; **`npm install --omit=dev`** проходит без `node-gyp` для хранилища job.

Долгосрочно: вынести store и координацию в **Redis** или БД.

## Контракт API

### Общие поля запроса

```json
{
  "url": "https://example.com/dashboard/12",
  "format": "jpeg",
  "clip_to_element": "widget-257",
  "emulate_media_type": "screen",
  "wait_for_capture_ready": true,
  "viewport_width": 1000,
  "viewport_height": 600
}
```

- `url` — адрес страницы для захвата.
- `format` — `jpeg` или `pdf`.
- `clip_to_element` — id элемента **без `#`** (например, `widget-257`).
- `emulate_media_type` — опционально, передается в `page.emulateMediaType`.
- `wait_for_capture_ready` — opt-in режим ожидания `window.__CAPTURE_READY__ === true`.
- `viewport_width` / `viewport_height` — опциональный viewport Chromium перед `page.goto`; если оба поля не переданы, остаётся стандартный viewport Puppeteer. Если нужен viewport, оба поля должны быть положительными целыми числами.

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
  "url": "/Users/.../output/capture_YYYYMMDD_HHMMSS_mmm.jpg"
}
```

### `POST /api/v1/convert-and-send`

Успех:

- бинарный ответ файла (`application/pdf` или `image/jpeg`);
- заголовок `Content-Disposition` с именем файла.

### Async-job: `POST /api/v1/jobs`

Тело запроса — те же поля, что у `/convert` (см. выше).

Успех — HTTP **`201 Created`**:

```json
{
  "job_id": "550e8400-e29b-41d4-a716-446655440000",
  "status": "queued",
  "request_id": "manual-12-1715779200"
}
```

Исполнение идёт **в фоне** (один активный захват на процесс Node; остальные job ждут в `queued`).

### Async-job: `GET /api/v1/jobs/:jobId`

Успех — HTTP **`200`**, пример в процессе:

```json
{
  "job_id": "550e8400-e29b-41d4-a716-446655440000",
  "status": "running",
  "stage": "waiting_page_ready",
  "request_id": "manual-12-1715779200",
  "updated_at": "2026-05-15T12:00:00.000Z"
}
```

Успех — завершённый job:

```json
{
  "job_id": "...",
  "status": "completed",
  "stage": "completed",
  "url": "/path/to/output/capture_YYYYMMDD_HHMMSS_mmm.jpg",
  "request_id": "...",
  "updated_at": "..."
}
```

Ошибка выполнения job:

```json
{
  "job_id": "...",
  "status": "failed",
  "stage": "failed",
  "error": "dashboard_not_ready",
  "message": "Dashboard did not become capture-ready before timeout",
  "meta": { "request_id": "...", "timeout_ms": 180000 },
  "updated_at": "..."
}
```

Job не найден — HTTP **`404`**:

```json
{
  "error": "job_not_found",
  "message": "Job not found: <job_id>",
  "meta": { "request_id": "..." }
}
```

#### Технические `stage` job (для маппинга на стороне оркестратора)

`queued` → `launching_browser` → `navigating` → `waiting_page_ready` → `resolving_widget` (если `clip_to_element`) → `capturing` → `saving_file` → `completed` / `failed`.

#### Ограничения async-job (MVP)

- По умолчанию состояние job — **файловый каталог** `JOBS_DIR` (см. выше): **multi-process** Passenger читает одни и те же `<job_id>.json`. Режим **`JOBS_STORE_DRIVER=memory`** — один процесс; между воркерами данных нет.
- **concurrency = 1 на процесс** — одновременно один активный захват Puppeteer у воркера; при нескольких процессах возможна параллельная работа нескольких job (компромисс MVP).
- Файлы **`completed`** / **`failed`** удаляются purge после **`JOBS_TERMINAL_TTL_HOURS`**; старый **`GET`** может вернуть **`404 job_not_found`**.

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
- `chrome_not_installed` — бинарник Chrome для Puppeteer отсутствует (удалён `storage/puppeteer-browsers` или не выполнен `npm run install:chrome` после деплоя).
- `job_not_found` — GET `/api/v1/jobs/:jobId` для неизвестного `job_id` или после purge.
- `job_read_failed` — повреждён или непрочитываемый JSON-файл job на диске; ответ **`200`** с телом ошибки (**не** падение приложения).
- `job_execute_timeout` — превышен **`JOBS_EXECUTE_TIMEOUT_MS`** на одну конвертацию.
- `job_stale_running` — запись долго оставалась в **`running`** (см. **`JOBS_STALE_RUNNING_AFTER_MS`**).

## Логирование

### Вывод в консоль

Префиксы в stdout:

| Префикс | События |
|---------|---------|
| `[convert]` / `[convert-and-send]` | Синхронный захват |
| `[jobs]` | Создание и GET job |
| `[jobWorker]` | Старт обработки из очереди |
| `[jobExecutor]` | Старт/стадии/успех/ошибка выполнения job |
| `[terminalPurge]` | Удаление устаревших terminal job (`*.json`) с диска |
| `[fileLogSetup]` | Старт записи в файл (см. ниже) |

В логах: `job_id`, `request_id`, `stage`, машинные коды ошибок. Секреты и полные URL с токенами в `meta` не логируются.

### Запись в файл (.env)

При **`LOG_TO_FILE=1`** (или **`true`** / **`yes`** / **`on`**) все сообщения **`console.log`**, **`info`**, **`warn`**, **`error`**, **`debug`** дублируются в файл. Консольный вывод **сохраняется**.

| Переменная | Значение по умолчанию | Назначение |
|------------|----------------------|------------|
| **`LOG_TO_FILE`** | выключено | Включить запись в файл. |
| **`LOG_FILE_PATH`** | `logs/puppeteer-service.log` | Путь относительно **`process.cwd()`** (корень приложения при запуске) или **абсолютный** путь на сервере. Каталог создаётся автоматически. |

Пример для Beget после **`cd ~/services.samoliot.ru`**: файл будет **`~/services.samoliot.ru/logs/puppeteer-service.log`**, если не задавать абсолютный путь.

Строка в файле: **`ISO-время [LOG|INFO|WARN|ERROR|DEBUG] сообщение`**. Каталог **`logs/`** в **`.gitignore`**.

Подключение: модуль **`src/lib/fileLogSetup.js`** вызывается сразу после **`dotenv`** в **`src/server.js`**.

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
  -d '{"url":"https://example.com/dashboard/12","format":"jpeg","clip_to_element":"widget-257","wait_for_capture_ready":true,"viewport_width":1000,"viewport_height":600}'
```

Async-job: создать и опросить статус:

```bash
# 1. Постановка в очередь
curl -s -X POST "http://localhost:3000/api/v1/jobs" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <ETERNAL_TOKEN>" \
  -H "X-Request-Id: test-11751-job-01" \
  -d '{"url":"https://example.com/dashboard/12","format":"jpeg","wait_for_capture_ready":true,"viewport_width":1000,"viewport_height":600}'

# 2. Опрос (подставить job_id из ответа)
curl -s "http://localhost:3000/api/v1/jobs/<job_id>" \
  -H "Authorization: Bearer <ETERNAL_TOKEN>"
```