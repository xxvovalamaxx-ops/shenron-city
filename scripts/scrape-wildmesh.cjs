const puppeteer = require('puppeteer-core');

async function scrape() {
  const browser = await puppeteer.connect({ browserURL: 'http://localhost:9222', defaultViewport: null });
  const page = await browser.newPage();
  await page.goto('https://sketchfab.com/WildMesh_3D/models', { waitUntil: 'domcontentloaded', timeout: 45000 });
  await new Promise(r => setTimeout(r, 8000));

  // Scroll to load all models
  for (let i = 0; i < 15; i++) {
    await page.evaluate(() => window.scrollBy(0, 2000));
    await new Promise(r => setTimeout(r, 1500));
  }

  const models = await page.evaluate(() => {
    const results = [];
    const links = [...document.querySelectorAll('a[href*="/3d-models/"]')];
    for (const a of links) {
      const href = a.href;
      const title = (a.getAttribute('title') || a.textContent.trim() || '');
      results.push({ href, title: title.substring(0, 80) });
    }
    return results;
  });

  // Deduplicate
  const seen = new Set();
  const unique = [];
  for (const m of models) {
    if (!seen.has(m.href)) {
      seen.add(m.href);
      unique.push(m);
    }
  }

  console.log(`Found ${unique.length} unique model links:`);
  for (const m of unique) {
    console.log(`${m.title} => ${m.href}`);
  }

  await page.close();
  browser.disconnect();
}

scrape().catch(e => console.error('Error:', e.message));
