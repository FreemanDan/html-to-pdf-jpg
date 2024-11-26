const express = require('express');
const bodyParser = require('body-parser');
const jwt = require('jsonwebtoken');
const { convertToPdf, convertToJpeg } = require('./converter');
require('dotenv').config();

const app = express();
const port = 3000;

const secretKey = process.env.SECRET_KEY; // Секретный ключ для JWT
const eternalToken = process.env.ETERNAL_TOKEN; // Вечный токен из переменной окружения

app.use(bodyParser.json());

const authenticateToken = (req, res, next) => {
    const token = req.headers['authorization']?.split(' ')[1];
    if (!token) return res.sendStatus(403);

    jwt.verify(token, secretKey, (err, user) => {
        if (err) return res.sendStatus(403);
        req.user = user;
        next();
    });
};

app.post('/convert', authenticateToken, (req, res) => {
    const { url, format } = req.body;

    let convertFunction;
    if (format === 'pdf') {
        convertFunction = convertToPdf;
    } else if (format === 'jpeg') {
        convertFunction = convertToJpeg;
    } else {
        return res.status(400).send('Unsupported format.');
    }

    convertFunction(url).then(outputUrl => {
        res.json({ url: outputUrl });
    }).catch(err => {
        res.status(500).send('Conversion failed.');
    });
});

app.listen(port, () => {
    console.log(`Server running at http://localhost:${port}`);
    console.log(`Use this token for API requests: ${eternalToken}`);
});