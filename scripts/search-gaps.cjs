const puppeteer = require('puppeteer-core');

const SEARCHES = [
    { label: 'Sneakers (Fashion)', query: 'sneakers Nike' },
    { label: 'Sneakers 2', query: 'sneaker shoes realistic' },
    { label: 'Watch (Fashion)', query: 'luxury watch realistic' },
    { label: 'Sunglasses', query: 'sunglasses realistic' },
    { label: 'Backpack', query: 'backpack realistic' },
    { label: 'Music Guitar', query: 'electric guitar realistic' },
    { label: 'Music Drum', query: 'drum kit realistic' },
    { label: 'DJ Setup', query: 'DJ mixer realistic' },
    { label: 'Football', query: 'soccer ball realistic' },
    { label: 'Basketball', query: 'basketball realistic' },
    { label: 'Tennis', query: 'tennis racket realistic' },
    { label: 'Dumbbell', query: 'dumbbell realistic' },
    { label: 'Pizza', query: 'pizza realistic food' },
    { label: 'Sushi', query: 'sushi realistic food' },
    { label: 'Burger', query: 'burger realistic food' },
    { label: 'Coffee', query: 'coffee cup realistic' },
    { label: 'Beer', query: 'beer bottle realistic' },
    { label: 'Wine', query: 'wine bottle realistic' },
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
                const seen = new Set();
                const uniq = [];
                for (const it of items) {
                    const key = it.href.split('#')[0];
                    if (!seen.has(key)) { seen.add(key); uniq.push(it); }
                }
                return uniq.slice(0, 6);
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
