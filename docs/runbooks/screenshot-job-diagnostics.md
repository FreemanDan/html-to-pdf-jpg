# Runbook: диагностика screenshot job

**Область:** `puppeteer-test` — async job, Puppeteer, file store.

## Симптомы

| Симптом | Первая проверка |
|---------|-----------------|
| `404 job_not_found` сразу после 201 | `JOBS_STORE_DRIVER`, общий `JOBS_DIR` на всех процессах |
| Job долго в `queued` | Норма при concurrency=1; другой job в `running` |
| `dashboard_not_ready` | Таймаут `__CAPTURE_READY__`; лог `[converter]` |
| `job_stale_running` | Процесс упал или capture дольше `JOBS_STALE_RUNNING_AFTER_MS` |
| `job_execute_timeout` | Превышен `JOBS_EXECUTE_TIMEOUT_MS` |
| `conversion_failed` | Прочая ошибка Puppeteer |
| `chrome_not_installed` | Нет бинарника Chrome — см. раздел «Chrome / кэш браузера» |
| Telegram не скачивает файл | `OUTPUT_PUBLIC_BASE_URL`, доступность `/output/…` по HTTPS |

## Chrome / кэш браузера

Симптом:

```text
(conversion_failed) Could not find Chrome (ver. …)
cache path: …/storage/puppeteer-browsers
```

или код **`chrome_not_installed`**.

Причина: удалён каталог с бинарником (`storage/puppeteer-browsers` или старый `.cache/puppeteer`), либо после деплоя не выполнялся `npm install` / `npm run install:chrome`.

Восстановление на сервере:

```bash
cd ~/services.samoliot.ru   # корень приложения
npm run install:chrome
touch tmp/restart.txt
```

Профилактика:

- **Не удалять** `storage/puppeteer-browsers/` при «очистке» сервера.
- После `git pull` / деплоя выполнять **`npm install`** (postinstall ставит Chrome, если его нет).
- Опционально зафиксировать путь: `PUPPETEER_CACHE_DIR` в `.env`.

## Проверки

```bash
# Статус job
curl -s "https://services…/api/v1/jobs/<job_id>" \
  -H "Authorization: Bearer $ETERNAL_TOKEN"

# Файл job на диске (путь из JOBS_DIR)
ls -la "$JOBS_DIR/<job_id>.json"
cat "$JOBS_DIR/<job_id>.json"
```

Env на всех воркерах Passenger:

- `JOBS_STORE_DRIVER=file`
- одинаковый абсолютный `JOBS_DIR`
- `OUTPUT_PUBLIC_BASE_URL` с HTTPS без trailing `/`

## Типовые причины `job_not_found`

- `JOBS_STORE_DRIVER=memory` при multi-process.
- Разные `JOBS_DIR` у процессов или копий деплоя.
- Файл удалён **purge** после TTL (72 ч по умолчанию).
- Неверный `job_id` в запросе.

## Типовые причины `dashboard_not_ready`

- Страница не выставила `window.__CAPTURE_READY__` — см. frontend [page-readiness](../../../analytic_system/dev-analytics-b24/docs/guides/page-readiness.md).
- Истёк `PUPPETEER_CAPTURE_READY_TIMEOUT_MS`.
- Ошибка авторизации в Chromium (token в URL).

Отладка (только при явном включении):

- `PUPPETEER_DEBUG_SAVE_ON_READY_TIMEOUT=1` → артеfacts в `output/debug_ready_timeout/` при **только** `dashboard_not_ready`.

## Зависший full-page JPEG

После `waiting_page_ready` один `page.screenshot({ fullPage: true })` может идти минутами → `job_stale_running` или `job_execute_timeout`.

Mitigation: `clip_to_element`, уменьшить viewport/высоту страницы, увеличить `JOBS_STALE_RUNNING_AFTER_MS` и `JOBS_EXECUTE_TIMEOUT_MS`.

## Логи

Префиксы: `[jobs]`, `[jobWorker]`, `[jobExecutor]`, `[convert]`.

Опционально `LOG_TO_FILE=1`, `LOG_FILE_PATH=logs/puppeteer-service.log`.

## Безопасные действия

- Повторный `POST /api/v1/jobs` с новым `X-Request-Id`.
- Рестарт приложения после смены `.env` (Passenger `tmp/restart.txt`).
- Проверка раздачи static: Express монтирует `output/` на `/output`.

## Эскалация

- Повторяющиеся повреждённые JSON (`job_read_failed`).
- Параллельные claim одного job (ошибки lock) после проверки `JOBS_DIR`.

## Связанные документы

- [Guide: screenshot-capture-service](../guides/screenshot-capture-service.md)
- [Runbook: screenshot-run-failures](../../../tvorchestvo/dev-reports-api/docs/runbooks/screenshot-run-failures.md)
