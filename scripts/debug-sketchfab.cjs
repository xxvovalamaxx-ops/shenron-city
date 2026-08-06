const puppeteer = require('puppeteer-core');

async function debug() {
  const browser = await puppeteer.connect({ browserURL: 'http://localhost:9222' });
  const page = await browser.newPage();
  await page.setViewport({ width: 1400, height: 900 });

  const url = 'https://sketchfab.com/3d-models/2022-mercedes-benz-sl-63-amg-45b5d5fb971140ffaeba4302629975d5';
  console.log('Navigating to:', url);
  await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });
  await new Promise(r => setTimeout(r, 5000));

  // Check page content
  const title = await page.title();
  console.log('Title:', title);

  // Look for download button
  const downloadBtn = await page.$('button[title="Download 3D Model"]');
  console.log('Download button found:', !!downloadBtn);

  // Look for any download-related elements
  const allButtons = await page.$$('button');
  console.log('Total buttons:', allButtons.length);
  for (const btn of allButtons) {
    const text = await page.evaluate(el => el.textContent.trim(), btn);
    if (text.includes('Download') || text.includes('download')) {
      console.log('Button with download text:', text);
    }
  }

  // Check if logged in
  const loginLink = await page.$('a[href*="login"]');
  console.log('Login link found:', !!loginLink);

  // Take screenshot
  await page.screenshot({ path: 'C:\\Users\\xxvov\\AppData\\Local\\Temp\\sketchfab-debug.png' });
  console.log('Screenshot saved');

  // Check page HTML for download button
  const html = await page.content();
  if (html.includes('Download 3D Model')) {
    console.log('Download 3D Model text found in HTML');
  } else {
    console.log('Download 3D Model text NOT found in HTML');
  }

  // Look for data-download attribute
  const downloadElements = await page.$$('[data-download]');
  console.log('Elements with data-download:', downloadElements.length);

  // Check for auth status
  const bodyText = await page.evaluate(() => document.body.innerText.substring(0, 500));
  console.log('Body text preview:', bodyText.substring(0, 300));

  await page.close();
}

debug().catch(console.error);
