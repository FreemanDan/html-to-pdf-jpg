const puppeteer = require('puppeteer');
const path = require('path');


// Функция для генерации временного штампа в формате YYYYMMDD_HHMMSS
const generateTimestamp = () => {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    const hours = String(now.getHours()).padStart(2, '0');
    const minutes = String(now.getMinutes()).padStart(2, '0');
    const seconds = String(now.getSeconds()).padStart(2, '0');
    return `${year}${month}${day}_${hours}${minutes}${seconds}`;
};

const convertToPdf = async (url) => {
    const browser = await puppeteer.launch();
    const page = await browser.newPage();
    await page.goto(url, { waitUntil: 'networkidle2' });
    const timestamp = generateTimestamp();
    const outputFilePath = path.join(__dirname, '..', 'output', `converted_${timestamp}.pdf`);
    await page.pdf({ path: outputFilePath, format: 'A4', printBackground: true });
    await browser.close();
    return outputFilePath;
};

const convertToJpeg = async (url) => {
    const browser = await puppeteer.launch();
    const page = await browser.newPage();
    await page.goto(url, { waitUntil: 'networkidle2' });
    const timestamp = generateTimestamp();
    const outputFilePath = path.join(__dirname, '..', 'output', `converted_${timestamp}.jpeg`);
    await page.screenshot({ path: outputFilePath, type: 'jpeg', fullPage: true });
    await browser.close();
    return outputFilePath;
};

module.exports = { convertToPdf, convertToJpeg };