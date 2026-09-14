import { existsSync } from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import dotenv from 'dotenv';

dotenv.config({ override: true });

// Raspberry Pi ใช้ profile Chromium ปกติของ user เพื่อคงสถานะ login เดิม
const profileDir = process.env.BROWSER_PROFILE_DIR
  ? path.resolve(process.env.BROWSER_PROFILE_DIR)
  : process.platform === 'linux'
    ? path.join(process.env.HOME ?? process.cwd(), '.config', 'chromium')
    : path.join(process.cwd(), '.youtube-profile');
const browserCandidates = process.platform === 'win32'
  ? [
      'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
      'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe'
    ]
  : ['/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser'];
const browserPath = process.env.BROWSER_PATH || browserCandidates.find(existsSync);

if (!browserPath) {
  console.error('No supported Chrome or Chromium browser was found. Install one, then run this command again.');
  process.exit(1);
}

console.log('Opening the browser. Sign in to YouTube, then close every browser window using this profile.');
const chrome = spawn(browserPath, [
  `--user-data-dir=${profileDir}`,
  'https://www.youtube.com'
], { stdio: 'inherit' });

chrome.on('error', (error) => {
  console.error(`Could not start Chrome: ${error.message}`);
  process.exitCode = 1;
});

chrome.on('exit', (code) => {
  process.exitCode = code ?? 1;
});
