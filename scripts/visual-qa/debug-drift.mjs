import { existsSync, writeFileSync } from 'node:fs'
import puppeteer from 'puppeteer-core'
import { lumaGrid } from './frame-analysis.mjs'
import { decodePngToRgba } from './png-decode.mjs'

const exe = [
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
].find((p) => existsSync(p))

const url =
  'http://127.0.0.1:9122/?visionCapture=1&visionX=6.4&visionY=1.71&visionZ=-4&visionTX=-6.5&visionTY=1.35&visionTZ=-13.8&visionFov=60&visionTime=15.5&visionRain=0&visionSeed=vision-bridge-v1'

const browser = await puppeteer.launch({ executablePath: exe, headless: true, args: ['--enable-unsafe-swiftshader'] })
const page = await browser.newPage()
await page.setViewport({ width: 1920, height: 1080 })
await page.goto(url, { waitUntil: 'domcontentloaded' })
await page.waitForFunction(() => document.documentElement.dataset.visionReady === '1', { timeout: 30000 })

const drifts = []
let prev = null
for (let i = 0; i < 16; i++) {
  const buf = await page.screenshot({ encoding: 'binary' })
  const f = decodePngToRgba(buf)
  if (prev) {
    const gA = lumaGrid(prev.data, prev.width, prev.height, 8, 8)
    const gB = lumaGrid(f.data, f.width, f.height, 8, 8)
    let drift = 0
    for (let j = 0; j < gA.length; j++) drift += Math.abs(gA[j] - gB[j])
    drift /= gA.length
    drifts.push(drift)
    console.log(`sample ${i}: drift ${drift.toFixed(3)}`)
  }
  prev = f
  await new Promise((r) => setTimeout(r, 750))
}
console.log('min drift:', Math.min(...drifts).toFixed(3))
console.log('max drift:', Math.max(...drifts).toFixed(3))
console.log('below 1.5:', drifts.filter((d) => d < 1.5).length, 'of', drifts.length)
console.log('below 2.0:', drifts.filter((d) => d < 2.0).length, 'of', drifts.length)
await browser.close()
