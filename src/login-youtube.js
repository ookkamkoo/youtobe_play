import dotenv from 'dotenv';
import { existsSync } from 'node:fs';
import { once } from 'node:events';
import path from 'node:path';
import { spawn } from 'node:child_process';

dotenv.config({ override: true });

// Google sign-in must run in a regular browser, not a WebDriver session.
// The Selenium smoke test reuses this profile afterwards.
const profileDir = process.env.BROWSER_PROFILE_DIR
  ? path.resolve(process.env.BROWSER_PROFILE_DIR)
  : path.join(process.cwd(), '.youtube-profile');
const browserProfileName = process.env.BROWSER_PROFILE_NAME;
const openDevTools = process.env.OPEN_DEVTOOLS === 'true';
const browserPath = process.env.BROWSER_PATH
  || (process.platform === 'linux' && existsSync('/usr/bin/chromium') ? '/usr/bin/chromium' : undefined)
  || (process.platform === 'win32' ? 'chrome.exe' : 'chromium');

const args = [
  `--user-data-dir=${profileDir}`,
  '--lang=en-US',
  '--no-first-run',
  'https://www.youtube.com'
];
if (browserProfileName) args.splice(1, 0, `--profile-directory=${browserProfileName}`);
if (openDevTools) args.splice(-1, 0, '--auto-open-devtools-for-tabs');

console.log('Opening Chromium normally. Sign in to YouTube, then close every browser window using this profile.');
const browser = spawn(browserPath, args, { stdio: 'inherit' });
browser.on('error', (error) => console.error(`Could not start Chromium: ${error.message}`));

const [exitCode] = await once(browser, 'exit');
if (exitCode && exitCode !== 0) process.exitCode = exitCode;
