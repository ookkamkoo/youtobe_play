import { chromium } from 'playwright';
import dotenv from 'dotenv';
import { existsSync } from 'node:fs';

dotenv.config({ override: true });

// Raspberry Pi ใช้ Chromium ของระบบ; หากไม่พบจึงใช้ Google Chrome channel
const browserPath = process.env.BROWSER_PATH
  || (process.platform === 'linux' && existsSync('/usr/bin/chromium') ? '/usr/bin/chromium' : undefined);
const browser = await chromium.launch({
  ...(browserPath ? { executablePath: browserPath } : { channel: 'chrome' }),
  headless: false,
  chromiumSandbox: true
});

const page = await browser.newPage();
await page.goto('about:blank');

console.log('Chrome is open. Close the browser window to end this program.');
await new Promise((resolve) => browser.on('disconnected', resolve));
