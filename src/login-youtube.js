import dotenv from 'dotenv';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { Builder } from 'selenium-webdriver';
import chrome from 'selenium-webdriver/chrome.js';

dotenv.config({ override: true });

// ใช้ profile แยกสำหรับ automation; Chromium รุ่นใหม่ไม่รองรับการ automate profile ปกติของระบบ
const profileDir = process.env.BROWSER_PROFILE_DIR
  ? path.resolve(process.env.BROWSER_PROFILE_DIR)
  : path.join(process.cwd(), '.youtube-profile');
const browserProfileName = process.env.BROWSER_PROFILE_NAME;
// Pi ใช้ Chromium ของระบบ; Windows ให้ Selenium Manager หา ChromeDriver ที่ตรงกับ Chrome
const browserPath = process.env.BROWSER_PATH
  || (process.platform === 'linux' && existsSync('/usr/bin/chromium') ? '/usr/bin/chromium' : undefined);

console.log('Opening Chromium. Sign in to YouTube, then close every browser window using this profile.');
const options = new chrome.Options().addArguments(`--user-data-dir=${profileDir}`, '--lang=en-US');
if (browserPath) options.setChromeBinaryPath(browserPath);
if (browserProfileName) options.addArguments(`--profile-directory=${browserProfileName}`);
const driver = await new Builder().forBrowser('chrome').setChromeOptions(options).build();
await driver.get('https://www.youtube.com');

console.log('Close every Chromium window after you finish signing in.');
try {
  while (true) {
    await driver.getWindowHandle();
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
} catch {
  // The user closed the final Chrome window.
} finally {
  await driver.quit().catch(() => {});
}
