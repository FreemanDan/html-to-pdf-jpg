const express = require('express');
const bodyParser = require('body-parser');
const jwt = require('jsonwebtoken');
const { convertToPdf, convertToJpeg } = require('./converter');

const app = express();
const port = 3000;

const secretKey = 'your-secret-key'; // Секретный ключ для JWT

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

app.post('/login', (req, res) => {
    const username = req.body.username;
    const user = { name: username };
    const token = jwt.sign(user, secretKey, { expiresIn: '1h' });
    res.json({ token });
});

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
});