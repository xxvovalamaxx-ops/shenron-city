const { execSync, spawn } = require('child_process');
const { setTimeout: sleep } = require('timers/promises');
const fs = require('fs');
const path = require('path');

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PROFILE = 'C:\\Users\\xxvov\\AppData\\Local\\Google\\Chrome\\User Data';
const PORT = 9222;

function checkChrome() {
    try {
        const res = execSync(`curl.exe -s http://localhost:${PORT}/json/version`, { timeout: 5000, stdio: ['ignore', 'pipe', 'ignore'] });
        return res.toString().includes('Browser');
    } catch (e) {
        return false;
    }
}

async function restartChrome() {
    console.log('Chrome debug not responding - restarting...');
    try { execSync('taskkill /IM chrome.exe /F', { stdio: 'ignore' }); } catch (e) {}
    // Wait for processes to die
    let tries = 0;
    while (tries < 30) {
        try {
            const out = execSync('tasklist /FI "IMAGENAME eq chrome.exe"', { stdio: ['ignore', 'pipe', 'ignore'] }).toString();
            if (!out.includes('chrome.exe')) break;
        } catch (e) { break; }
        await sleep(1000);
        tries++;
    }
    // Launch with debug port
    const child = spawn(CHROME, [
        `--remote-debugging-port=${PORT}`,
        `--user-data-dir=${PROFILE}`,
        '--no-first-run',
        '--no-default-browser-check',
    ], { detached: true, stdio: 'ignore' });
    child.unref();
    // Wait for port
    for (let i = 0; i < 30; i++) {
        await sleep(1000);
        if (checkChrome()) {
            console.log('Chrome debug is UP');
            return true;
        }
    }
    console.log('WARNING: Chrome did not come up in time');
    return false;
}

async function run() {
    if (!checkChrome()) {
        await restartChrome();
    }
    // Run the download script
    const scriptPath = process.argv[2];
    console.log(`Running: node ${scriptPath}`);
    const child = spawn('node', [scriptPath], { stdio: 'inherit', shell: false });
    child.on('exit', (code) => {
        console.log(`Download script exited with code ${code}`);
        process.exit(code || 0);
    });
}

run();
