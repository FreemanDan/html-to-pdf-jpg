const puppeteer = require('puppeteer');
const path = require('path');
const { type } = require('os');

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

const convertToPdf = async (url, returnBuffer = false, clip_to_element = null, emulate_media_type = null) => {
    const browser = await puppeteer.launch({
        args: ['--no-sandbox', '--disable-setuid-sandbox'],
    });
    const page = await browser.newPage();
    await page.goto(url, { waitUntil: 'networkidle2' });
    const timestamp = generateTimestamp();
    const outputFilePath = path.join(__dirname, '..', 'output', `converted_${timestamp}.pdf`);

    if (emulate_media_type) {
        await page.emulateMediaType(emulate_media_type);
    }

    if (returnBuffer) {
        const pdfBuffer = await page.pdf({ format: 'A4', printBackground: true });
        await browser.close();
        //return pdfBuffer;
        return { buffer: Buffer.from(pdfBuffer), filename: `converted_${timestamp}.pdf` };
    } else {
        await page.pdf({ path: outputFilePath, format: 'A4', printBackground: true });
        await browser.close();
        return outputFilePath;
    }
};

const convertToJpeg = async (url, returnBuffer = false, clip_to_element = null, emulate_media_type = null) => {
    const browser = await puppeteer.launch({
        args: ['--no-sandbox', '--disable-setuid-sandbox'],
    });
    const page = await browser.newPage();
    await page.goto(url, { waitUntil: 'networkidle2' });
    if (emulate_media_type) {
        await page.emulateMediaType(emulate_media_type);
    }
    const timestamp = generateTimestamp();
    const outputFilePath = path.join(__dirname, '..', 'output', `converted_${timestamp}.jpeg`);

    const parameters = {
        fullPage: true,
        type: 'jpeg'
    }
    if (clip_to_element) {
        // Ожидание нужного элемента
        const element = await page.$('#' + clip_to_element);
        // Получение размеров элемента
        const boundingBox = await element.boundingBox();
        // Установка размеров скриншота
        parameters.clip = {
            x: boundingBox.x,
            y: boundingBox.y,
            width: boundingBox.width,
            height: boundingBox.height
        };
        parameters.fullPage = false;
    }

    if (returnBuffer) {
        const jpegBuffer = await page.screenshot(parameters);
        await browser.close();
        //return jpegBuffer;
        return { buffer: Buffer.from(jpegBuffer), filename: `converted_${timestamp}.jpeg` };
    } else {
        parameters.path = outputFilePath;
        await page.screenshot(parameters);
        await browser.close();
        return outputFilePath;
    }
};

module.exports = { convertToPdf, convertToJpeg };