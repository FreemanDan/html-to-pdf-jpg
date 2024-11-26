const crypto = require('crypto');
const jwt = require('jsonwebtoken');

// Генерация случайного секретного ключа
const secretKey = crypto.randomBytes(32).toString('hex');

// Данные, которые вы хотите включить в токен
const user = { name: 'user' };

// Создание токена с использованием случайного секретного ключа
const eternalToken = jwt.sign(user, secretKey);

console.log(`SECRET_KEY=${secretKey}`);
console.log(`ETERNAL_TOKEN=${eternalToken}`);