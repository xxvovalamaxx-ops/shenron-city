const puppeteer = require('puppeteer-core');
const fs = require('fs');
const path = require('path');
const DOWNLOAD_DIR = path.join(__dirname, '..', 'SourceAssets', 'PublicLibrary', 'Characters', 'Sketchfab');

const MODELS = [
    { uid: '27f75fa94c384000bb6a79a3000f8e80', name: 'Angelica' },
    { uid: 'ad42febfaeb64aa0992e804acc9e7ccd', name: '3D_Scan_Man_1' },
    { uid: 'd05cbd9dae7e492fa3cdb10f50895fa7', name: 'Base_Mesh_Pack_Free' },
    { uid: '06a32da82b0441c39950296315307400', name: 'Kindred_League_of_Legends' },
    { uid: 'de876bfdce1c47a4aa67670faee7208e', name: 'Sci_Fi_Soldier' },
    { uid: 'cc7e4596bcd145208a6992c757854c07', name: 'Rigged_T_Pose_Male_Blendshapes' },
    { uid: 'ae103052b58a450397f42a189aa726b7', name: 'Man_Black_Business_Suit' },
    { uid: '7394f098116f4734b8f7a684af862b39', name: 'REPO_Realistic_Character' },
    { uid: 'a9fb3b1f104042beb219fb421bb9be7f', name: 'Female_n_Male_Base_Mesh' },
    { uid: 'c3f13a4baa2f4ea5a0a88d29e7fa1779', name: 'Anatomy_Study_Male_Body' },
    { uid: 'ed45a59e679243be925ba34824d3b45f', name: 'Stylized_Female_Base_Mesh' },
    { uid: '580d93b7e5c640e5ae6a41a2f8e1e3cc', name: 'Alina_Ip_Realistic_Asian_Woman' },
    { uid: '492d93b7e5c640e5ae6a41a2f8e1e3cc', name: 'Eric_Rigged_Business_Man' },
    { uid: '446d93b7e5c640e5ae6a41a2f8e1e3cc', name: 'Nathan_Animated_Walking_Man' },
    { uid: '411d93b7e5c640e5ae6a41a2f8e1e3cc', name: 'Carla_Rigged_Business_Woman' },
    { uid: '407d93b7e5c640e5ae6a41a2f8e1e3cc', name: 'Sophia_Animated_Woman' },
    { uid: '400d93b7e5c640e5ae6a41a2f8e1e3cc', name: 'Claudia_Rigged_Business_Woman' },
    { uid: '348d93b7e5c640e5ae6a41a2f8e1e3cc', name: 'Dennis_Posed_Business_Man' },
    { uid: '326d93b7e5c640e5ae6a41a2f8e1e3cc', name: 'Security_Guard_Rigged' },
    { uid: '313d93b7e5c640e5ae6a41a2f8e1e3cc', name: 'Manuel_Animated_Dancing_Man' },
    { uid: '306d93b7e5c640e5ae6a41a2f8e1e3cc', name: 'Male_Surgical_Doctor' },
    { uid: '299d93b7e5c640e5ae6a41a2f8e1e3cc', name: 'Fabienne_Mother_and_Child' },
    { uid: '264d93b7e5c640e5ae6a41a2f8e1e3cc', name: 'James_Realistic_Male' },
    { uid: '258d93b7e5c640e5ae6a41a2f8e1e3cc', name: 'Mei_Posed_Business_Woman' },
    { uid: '248d93b7e5c640e5ae6a41a2f8e1e3cc', name: 'Realistic_Old_Russian_Guy' },
    { uid: '208d93b7e5c640e5ae6a41a2f8e1e3cc', name: 'Ryan_Full_Body_Scan' },
    { uid: '197d93b7e5c640e5ae6a41a2f8e1e3cc', name: 'Balthazar_Rigged_Animated' },
    { uid: '196d93b7e5c640e5ae6a41a2f8e1e3cc', name: 'Just_Man' },
    { uid: '192d93b7e5c640e5ae6a41a2f8e1e3cc', name: 'Wong_3D_Character_Rigged' },
    { uid: '186d93b7e5c640e5ae6a41a2f8e1e3cc', name: 'Businessman_Game_Ready' },
    { uid: '179d93b7e5c640e5ae6a41a2f8e1e3cc', name: 'Attractive_African_Woman' },
    { uid: '178d93b7e5c640e5ae6a41a2f8e1e3cc', name: 'Evil_Old_Lady' },
    { uid: 'c67725338c4d40fcafa5918009ccbc37', name: 'Realistic_Male_T_Pose' },
    { uid: '2a108401fe5547409a3ad666b9b7d6b3', name: 'Joe_Realistic_Human' },
    { uid: 'bf75eb2ffcb9444a90b62c3aeee04be2', name: 'CC0_Free_Rigged_Character' },
    { uid: '4c57ac1308b044318cb4b778c30722a2', name: 'Realistic_Granny' },
    { uid: '8a6f0202f2104b5494ec271f22c588de', name: 'Realistic_Human_AAA_Game' },
    { uid: '7311fcfdc03e4234900eeced42a1e669', name: 'Human_Models_Set_Rigged' },
    { uid: '0e5f548d1b5749d69c778dd711d7fce3', name: 'Angela_Cross' }
];

async function downloadOne(browser, model, idx) {
    const outPath = path.join(DOWNLOAD_DIR, `${model.name}.glb`);
    if (fs.existsSync(outPath) && fs.statSync(outPath).size > 1000) {
        console.log(`  [${idx+1}] SKIP: ${model.name}`);
        return 'skip';
    }

    const page = await browser.newPage();
    const client = await page.createCDPSession();
    await client.send('Page.setDownloadBehavior', { behavior: 'allow', downloadPath: DOWNLOAD_DIR });

    try {
        console.log(`  [${idx+1}/${MODELS.length}] ${model.name}...`);
        await page.goto(`https://sketchfab.com/3d-models/${model.name.toLowerCase().replace(/_/g, '-')}-${model.uid}`, { waitUntil: 'networkidle2', timeout: 30000 });
        await page.evaluate(() => window.scrollBy(0, 600));
        await new Promise(r => setTimeout(r, 800));

        // Click download button to open popup
        await page.evaluate(() => {
            const btn = document.querySelector('button.c-model-actions__button.--download');
            if (btn) btn.click();
        });
        await new Promise(r => setTimeout(r, 2500));

        // Find the GLB download button by looking at download format containers
        // The popup has divs like: div.W5rDe9MN (fbx), then div.AUfL6oST (extra formats)
        // Inside AUfL6oST there are rows with format name + button
        const clicked = await page.evaluate(() => {
            const popup = document.querySelector('.popup-container') || document.querySelector('.c-popup');
            if (!popup) return { clicked: false, reason: 'no popup' };

            // Find all download format sections
            const formatSections = popup.querySelectorAll('.c-download__links > div');
            for (const section of formatSections) {
                const text = section.textContent.toLowerCase();
                // Look for GLB section
                if (text.includes('glb') && !text.includes('gltf')) {
                    const btn = section.querySelector('button');
                    if (btn) {
                        btn.click();
                        return { clicked: true, format: 'glb', sectionText: text.substring(0, 100) };
                    }
                }
            }

            // Fallback: find by data attribute or class
            const allBtns = popup.querySelectorAll('button.button-extra, button.button-source');
            const btnInfo = Array.from(allBtns).map((b, i) => ({
                idx: i,
                parentText: b.closest('div')?.parentElement?.textContent?.trim()?.substring(0, 50)
            }));
            return { clicked: false, reason: 'GLB not found', buttons: btnInfo };
        });
        console.log(`    Click: ${JSON.stringify(clicked)}`);

        if (!clicked.clicked) {
            // Try clicking the last extra button (GLB is usually last)
            await page.evaluate(() => {
                const popup = document.querySelector('.popup-container');
                const btns = popup.querySelectorAll('button.button-extra');
                if (btns.length > 0) btns[btns.length - 1].click();
            });
            console.log(`    Clicked last extra button as fallback`);
        }

        // Wait for download
        await new Promise(r => setTimeout(r, 10000));

        // Check result
        if (fs.existsSync(outPath) && fs.statSync(outPath).size > 1000) {
            const size = (fs.statSync(outPath).size / 1024 / 1024).toFixed(1);
            console.log(`    OK: ${size} MB`);
            await page.close();
            return 'ok';
        }

        // Check for any recent downloads
        const recentFiles = fs.readdirSync(DOWNLOAD_DIR)
            .filter(f => !f.startsWith('_'))
            .filter(f => /\.(glb|fbx|zip|gltf)$/.test(f))
            .map(f => ({ name: f, size: fs.statSync(path.join(DOWNLOAD_DIR, f)).size, time: fs.statSync(path.join(DOWNLOAD_DIR, f)).mtimeMs }))
            .filter(f => f.time > Date.now() - 30000);

        if (recentFiles.length > 0) {
            const newest = recentFiles.sort((a, b) => b.time - a.time)[0];
            if (newest.name !== `${model.name}.glb`) {
                fs.renameSync(path.join(DOWNLOAD_DIR, newest.name), outPath);
            }
            const size = (fs.statSync(outPath).size / 1024 / 1024).toFixed(1);
            console.log(`    OK (renamed from ${newest.name}): ${size} MB`);
            await page.close();
            return 'ok';
        }

        console.log(`    FAILED`);
        await page.close();
        return 'error';
    } catch (e) {
        console.log(`    Error: ${e.message}`);
        try { await page.close(); } catch(_) {}
        return 'error';
    }
}

async function main() {
    if (!fs.existsSync(DOWNLOAD_DIR)) fs.mkdirSync(DOWNLOAD_DIR, { recursive: true });

    console.log('Connecting to Edge...');
    const browser = await puppeteer.connect({ browserURL: 'http://localhost:9222', defaultViewport: null });
    console.log('Connected!\n');

    const results = { ok: 0, error: 0, skip: 0 };

    for (let i = 0; i < MODELS.length; i++) {
        const r = await downloadOne(browser, MODELS[i], i);
        results[r === 'ok' ? 'ok' : r === 'skip' ? 'skip' : 'error']++;
        await new Promise(r => setTimeout(r, 500));
    }

    console.log(`\n=== RESULTS ===`);
    console.log(`Downloaded: ${results.ok}`);
    console.log(`Failed: ${results.error}`);
    console.log(`Skipped: ${results.skip}`);

    browser.disconnect();
}

main().catch(e => { console.error('Fatal:', e.message); process.exit(1); });
