import { Builder } from 'selenium-webdriver';
import chrome from 'selenium-webdriver/chrome.js';
import dotenv from 'dotenv';
import { existsSync } from 'node:fs';

dotenv.config({ override: true });

// Pi ใช้ Chromium ของระบบ; Windows ให้ Selenium Manager หา ChromeDriver ที่ตรงกับ Chrome
const browserPath = process.env.BROWSER_PATH
  || (process.platform === 'linux' && existsSync('/usr/bin/chromium') ? '/usr/bin/chromium' : undefined);
const options = new chrome.Options();
if (browserPath) options.setChromeBinaryPath(browserPath);
const driver = await new Builder().forBrowser('chrome').setChromeOptions(options).build();

await driver.get('about:blank');

console.log('Chrome is open. Close the browser window to end this program.');
try {
  while (true) {
    await driver.getWindowHandle();
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
} catch {
  // Closing the final browser window ends the WebDriver session.
} finally {
  await driver.quit().catch(() => {});
}
