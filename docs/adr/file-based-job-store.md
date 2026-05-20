# ADR: file-based job store

**Статус:** принято  
**Дата:** 2026-05-20

## Контекст

Async job API нужен для polling со стороны PHP. Multi-process Passenger не разделяет in-memory Map между воркерами — `GET` после `POST` мог давать ложный `job_not_found`.

## Решение

- По умолчанию **`JOBS_STORE_DRIVER=file`**: JSON `<job_id>.json` в **`JOBS_DIR`**, атомарная запись (temp + rename).
- **`memory`** — только отладка / один процесс.
- **concurrency = 1** на процесс; claim через lock `.claim-<job_id>.lock`.
- Таймауты: `JOBS_EXECUTE_TIMEOUT_MS`, stale reclaim `JOBS_STALE_RUNNING_AFTER_MS`.
- Purge терминальных job по `JOBS_TERMINAL_TTL_HOURS`.

## Последствия

- Несколько процессов Passenger видят одни job при общем `JOBS_DIR`.
- Оркестратор должен забрать финальный `url` до purge.
- Полноэкранный JPEG может упираться в execute/stale таймауты — нужен clip или увеличение лимитов.

## Отклонённые альтернативы

- **In-memory store в production** — job_not_found между процессами.
- **Redis/БД на MVP** — отложено; file store без native deps.

## Связанные документы

- [Runbook: screenshot-job-diagnostics](../runbooks/screenshot-job-diagnostics.md)
