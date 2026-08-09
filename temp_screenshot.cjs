const puppeteer = require('C:\\Users\\xxvov\\AppData\\Roaming\\npm\\node_modules\\itchio-downloader\\node_modules\\puppeteer');
(async () => {
  const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
  const page = await browser.newPage();
  await page.setViewport({ width: 1920, height: 1080 });
  await page.goto('http://localhost:5173', { waitUntil: 'networkidle2', timeout: 30000 });
  await new Promise(r => setTimeout(r, 2000));
  await page.click('button');
  await new Promise(r => setTimeout(r, 6000));
  await page.screenshot({ path: 'temp_verify.png', fullPage: false });
  await browser.close();
  console.log('done');
})();
