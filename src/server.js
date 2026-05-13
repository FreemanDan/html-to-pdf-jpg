const express = require('express');
const bodyParser = require('body-parser');
const jwt = require('jsonwebtoken');
const { convertToPdf, convertToJpeg } = require('./converter');
const path = require('path');

require('dotenv').config();

const app = express();
const port = 3000;

const secretKey = process.env.SECRET_KEY; // Секретный ключ для JWT
const eternalToken = process.env.ETERNAL_TOKEN; // Вечный токен из переменной окружения

// Middleware для обработки CORS
app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*'); // Замените '*' на домен вашего клиента для большей безопасности
    res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    next();
});

// Обработка предзапросов OPTIONS
app.options('*', (req, res) => {
    res.sendStatus(204);
});

app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, 'public'))); // Настройка для обслуживания статических файлов

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

    let convertFunction;
    if (format === 'pdf') {
        convertFunction = convertToPdf;
    } else if (format === 'jpeg') {
        convertFunction = convertToJpeg;
    } else {
        console.error('Unsupported format:', format);
        return res.status(400).send('Unsupported format: ' + format + '.');
    }

    try {
        const outputUrl = await convertFunction(url, false, clip_to_element, emulate_media_type);
        res.json({ url: outputUrl });
    } catch (err) {
        console.error('Conversion failed:', err);
        res.status(500).send('Conversion failed. error: ' + err);
    }
});

// Метод для конвертации и немедленной отправки файла
apiRouter.post('/convert-and-send', authenticateToken, async (req, res) => {
    const { url, format, clip_to_element = null, emulate_media_type = null } = req.body;

    let convertFunction;
    if (format === 'pdf') {
        convertFunction = convertToPdf;
    } else if (format === 'jpeg') {
        convertFunction = convertToJpeg;
    } else {
        console.error('Unsupported format:', format);
        return res.status(400).send('Unsupported format.');
    }

    try {
        const { buffer, filename } = await convertFunction(url, true, clip_to_element, emulate_media_type); // Передаем true, чтобы получить буфер
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
        console.error('Conversion failed:', err);
        res.status(500).send('Conversion failed. error: ' + err);
    }
});

app.use('/api/v1', apiRouter);

const PORT = process.env.PORT || 3000; // PORT задается Passenger
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
    console.log(`Use this token for API requests: ${eternalToken}`);
});