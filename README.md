# Puppeteer Conversion Service

## Описание

Этот сервис предоставляет API для конвертации веб-страниц по URL в PDF или JPEG с использованием Puppeteer. API защищено с использованием JWT (JSON Web Token).

## Установка

1. Клонируйте репозиторий и перейдите в директорию проекта:
   ```sh
   git clone https://github.com/your-username/puppeteer-test.git
   cd puppeteer-test
   ```

2. Установите зависимости:
   ```sh
   npm install
   ```

3. Создайте файл .env в корневой директории проекта.
   ```env
    SECRET_KEY=<сгенерированный секретный ключ>
    ETERNAL_TOKEN=<сгенерированный вечный токен>
   ```
   
4.  Сначала необходимо сгенерировать SECRET_KEY и ETERNAL_TOKEN.

5. Запустите скрипт generate_env.js:
   ```sh
   npm run generate-env
   ```

6. Скопируйте сгенерированный ETERNAL_TOKEN в переменную окружения ETERNAL_TOKEN.
7. Скопируйте сгенерированный SECRET_KEY в переменную окружения SECRET_KEY.
8. Запустите сервер:
   ```sh    
   npm start
   ```

## Использование
API
POST /convert
Конвертирует веб-страницу по URL в указанный формат (PDF или JPEG).

Запрос
- Заголовок:
  - Content-Type: application/json
  - Authorization: Bearer <ETERNAL_TOKEN>
- Тело (JSON):
  ```json
  {
    "url": "http://example.com",
    "format": "pdf"
  }
  ```
  // или "jpeg"
  ```json
  {
    "url": "http://example.com",
    "format": "jpeg"
  }
  ```

Ответ
- Успешный ответ (JSON):
- ```json
  {
    "url": "http://example.com/converted.pdf"
  }
  ```
- Неудачный ответ (JSON):
- ```json
  {
    "error": "Conversion failed."
  }
  ```

Ошибки:
- 400: Неподдерживаемый формат.
- 403: Неавторизованный запрос.
- 500: Ошибка сервера.

Тестирование:
CURL
```bash
curl -X POST http://localhost:3000/convert \
     -H "Content-Type: application/json" \
     -H "Authorization: Bearer <ETERNAL_TOKEN>" \
     -d '{"url":"http://example.com", "format":"pdf"}'

```