import { existsSync } from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';

const profileDir = path.join(process.cwd(), '.youtube-profile');
const browserCandidates = process.platform === 'win32'
  ? [
      'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
      'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe'
    ]
  : ['/usr/bin/google-chrome', '/usr/bin/google-chrome-stable'];
const browserPath = browserCandidates.find(existsSync);

if (!browserPath) {
  console.error('Google Chrome was not found. Install it, then run this command again.');
  process.exit(1);
}

console.log('Opening regular Google Chrome. Sign in to YouTube, then close every Chrome window using this profile.');
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
