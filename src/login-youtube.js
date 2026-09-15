import dotenv from 'dotenv';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';

dotenv.config({ override: true });

// ใช้ profile แยกสำหรับ automation; Chromium รุ่นใหม่ไม่รองรับการ automate profile ปกติของระบบ
const profileDir = process.env.BROWSER_PROFILE_DIR
  ? path.resolve(process.env.BROWSER_PROFILE_DIR)
  : path.join(process.cwd(), '.youtube-profile');
const browserProfileName = process.env.BROWSER_PROFILE_NAME;
// Pi ใช้ Chromium ของระบบ; Windows ใช้ Chromium ที่ Playwright ติดตั้งไว้
const browserPath = process.env.BROWSER_PATH
  || (process.platform === 'linux' && existsSync('/usr/bin/chromium') ? '/usr/bin/chromium' : undefined);

console.log('Opening Chromium. Sign in to YouTube, then close every browser window using this profile.');
const context = await chromium.launchPersistentContext(profileDir, {
  ...(browserPath ? { executablePath: browserPath } : {}),
  ...(browserProfileName ? { args: [`--profile-directory=${browserProfileName}`] } : {}),
  headless: false,
  chromiumSandbox: true,
  locale: 'en-US'
});
const page = context.pages()[0] ?? await context.newPage();
await page.goto('https://www.youtube.com', { waitUntil: 'domcontentloaded' });

console.log('Close every Chromium window after you finish signing in.');
await new Promise((resolve) => context.on('close', resolve));
