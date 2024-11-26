const puppeteer = require('puppeteer');

(async () => {
    const browser = await puppeteer.launch();
    const page = await browser.newPage();
    await page.goto('https://software.samoliot.ru/project/continent/weboffer/output/1732188315_123460.html');
    await page.screenshot({ path: 'example.png' });
    // Генерация PDF файла
    await page.pdf({ path: 'example.pdf', format: 'A4',printBackground: true});
    await browser.close();
})();