import { chromium } from 'playwright';

// Uses the locally installed Google Chrome browser, not Playwright's bundled Chromium.
const browser = await chromium.launch({
  channel: 'chrome',
  headless: false,
  chromiumSandbox: true
});

const page = await browser.newPage();
await page.goto('about:blank');

console.log('Chrome is open. Close the browser window to end this program.');
await new Promise((resolve) => browser.on('disconnected', resolve));
