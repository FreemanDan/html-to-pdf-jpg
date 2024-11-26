const puppeteer = require('puppeteer');
const path = require('path');

const convertToPdf = async (url) => {
    const browser = await puppeteer.launch();
    const page = await browser.newPage();
    await page.goto(url, { waitUntil: 'networkidle2' });
    const outputFilePath = path.join(__dirname, '..', 'output', 'converted.pdf');
    await page.pdf({ path: outputFilePath, format: 'A4' });
    await browser.close();
    return outputFilePath;
};

const convertToJpeg = async (url) => {
    const browser = await puppeteer.launch();
    const page = await browser.newPage();
    await page.goto(url, { waitUntil: 'networkidle2' });
    const outputFilePath = path.join(__dirname, '..', 'output', 'converted.jpeg');
    await page.screenshot({ path: outputFilePath, type: 'jpeg', fullPage: true });
    await browser.close();
    return outputFilePath;
};

module.exports = { convertToPdf, convertToJpeg };