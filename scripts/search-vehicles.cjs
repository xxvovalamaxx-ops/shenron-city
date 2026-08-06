const puppeteer = require('puppeteer-core');

const SEARCHES = [
    { label: 'Mercedes SLS AMG 2010', query: 'Mercedes SLS AMG 2010' },
    { label: 'Mercedes AMG GT', query: 'Mercedes AMG GT' },
    { label: 'Audi R8', query: 'Audi R8' },
    { label: 'Nissan GTR', query: 'Nissan GT-R R35' },
    { label: 'Toyota Supra', query: 'Toyota Supra' },
    { label: 'BMW M4', query: 'BMW M4' },
    { label: 'Porsche 911', query: 'Porsche 911 GT3' },
    { label: 'Chevrolet Camaro', query: 'Chevrolet Camaro' },
];

async function main() {
    const browser = await puppeteer.connect({ browserURL: 'http://localhost:9222', defaultViewport: null });
    const page = await browser.newPage();
    await page.setViewport({ width: 1400, height: 900 });

    for (const s of SEARCHES) {
        console.log(`\n=== ${s.label} ===`);
        const url = `https://sketchfab.com/search?q=${encodeURIComponent(s.query)}&sort_by=-likeCount&type=models`;
        try {
            await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
            await new Promise(r => setTimeout(r, 5000));
            const results = await page.evaluate(() => {
                const items = [];
                const links = [...document.querySelectorAll('a[href*="/3d-models/"]')];
                for (const a of links) {
                    const href = a.href;
                    const title = (a.getAttribute('title') || a.textContent.trim() || '').substring(0, 70);
                    if (href.includes('/3d-models/') && !href.includes('/popular') && !href.includes('/staffpicks') && !href.includes('/categories/')) {
                        items.push({ title, href });
                    }
                }
                // dedupe
                const seen = new Set();
                const uniq = [];
                for (const it of items) {
                    const key = it.href.split('#')[0];
                    if (!seen.has(key)) { seen.add(key); uniq.push(it); }
                }
                return uniq.slice(0, 8);
            });
            for (const r of results) {
                console.log(`  ${r.title}`);
                console.log(`    ${r.href.split('#')[0]}`);
            }
        } catch (e) {
            console.log(`  ERROR: ${e.message}`);
        }
    }
    await page.close();
    browser.disconnect();
}

main().catch(e => console.error('Fatal:', e.message));
