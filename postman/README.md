# Postman: тестирование Puppeteer Conversion Service

## Импорт

- **Коллекция:** `Puppeteer-Conversion-Service.postman_collection.json`
- **Окружение:** `Local.postman_environment.json` (или `Production.services.samoliot.ru.postman_environment.json`)

В Postman: **Import** → выберите файлы.

## Настройка

В активном окружении задайте:

- **`bearer_token`** — значение **`ETERNAL_TOKEN`** из `.env` сервиса (без префикса `Bearer `; коллекция сама использует тип Bearer).
- **`base_url`** — уже задан для local / prod; при необходимости поправьте.

## Поведение

- Все запросы к `/api/v1/*` используют авторизацию коллекции (Bearer).
- Заголовок **`X-Request-Id`** на запросах — новый GUID (встроенная переменная Postman `{{$guid}}`).
- После успешного **Async jobs → Create job** (HTTP 201) скрипт **Tests** записывает **`job_id`** в переменные коллекции и окружения; следующий вызов **Get job** подставит его в URL.

## Примечание

Для **Convert (capture-ready)** и **Create job** в теле запроса укажите реальный URL страницы дашборда и при необходимости `clip_to_element`.
