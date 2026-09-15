import dotenv from 'dotenv';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { Builder, By, until } from 'selenium-webdriver';
import chrome from 'selenium-webdriver/chrome.js';

dotenv.config({ override: true });
const videoUrl = process.env.VIDEO_URL;
const searchTermsFile = process.env.SEARCH_TERMS_FILE;
const headless = process.env.HEADLESS !== 'false';
const actionDelayMs = Number.parseInt(process.env.ACTION_DELAY_MS ?? '2000', 10);
const browserPath = process.env.BROWSER_PATH || (process.platform === 'linux' && existsSync('/usr/bin/chromium') ? '/usr/bin/chromium' : undefined);
const profileDir = process.env.BROWSER_PROFILE_DIR ? path.resolve(process.env.BROWSER_PROFILE_DIR) : path.join(process.cwd(), '.youtube-profile');
let currentStep = 'configuration';
let driver;

function logStep(step, details = {}) {
  currentStep = step;
  console.log(JSON.stringify({ status: 'running', step, checkedAt: new Date().toISOString(), ...details }));
}
function assertYouTubeUrl(url) {
  let parsed;
  try { parsed = new URL(url); } catch { throw new Error('VIDEO_URL must be a valid URL.'); }
  if (!['youtube.com', 'www.youtube.com', 'm.youtube.com'].includes(parsed.hostname)) throw new Error('For safety, VIDEO_URL must be a youtube.com URL.');
}
async function getVideoLinks(selector) {
  await driver.wait(until.elementLocated(By.css(selector)), 30_000);
  const links = await driver.findElements(By.css(selector));
  return (await Promise.all(links.slice(0, 5).map((link) => link.getAttribute('href')))).filter(Boolean);
}

if (!videoUrl && !searchTermsFile) {
  console.error('Set VIDEO_URL or SEARCH_TERMS_FILE in .env.');
  process.exit(1);
}
if (!Number.isFinite(actionDelayMs) || actionDelayMs < 0) throw new Error('ACTION_DELAY_MS must be a non-negative whole number.');

try {
  logStep('browser-launching', { headless, browser: browserPath ?? 'Chrome via Selenium Manager', profileDir });
  const options = new chrome.Options().addArguments(`--user-data-dir=${profileDir}`, '--lang=en-US', '--mute-audio');
  if (browserPath) options.setChromeBinaryPath(browserPath);
  if (process.env.BROWSER_PROFILE_NAME) options.addArguments(`--profile-directory=${process.env.BROWSER_PROFILE_NAME}`);
  if (headless) options.addArguments('--headless=new');
  driver = await new Builder().forBrowser('chrome').setChromeOptions(options).build();

  logStep('youtube-home-loading');
  await driver.get('https://www.youtube.com');
  const cookies = await driver.manage().getCookies();
  const avatars = await driver.findElements(By.css('#avatar-btn'));
  const signedIn = avatars.length > 0;
  logStep('youtube-auth-checked', { signedIn, cookieCount: cookies.length, pageUrl: await driver.getCurrentUrl(), pageTitle: await driver.getTitle() });
  if (!signedIn) throw new Error('YouTube is not signed in. Run "npm run auth", sign in manually, close Chrome, then retry.');

  let targetUrl = videoUrl;
  let searchTerm;
  let selectionNumber;
  if (searchTermsFile) {
    const terms = (await readFile(path.resolve(process.cwd(), searchTermsFile), 'utf8')).split(/\r?\n/).map((value) => value.trim()).filter((value) => value && !value.startsWith('#'));
    if (!terms.length) throw new Error(`No search terms found in ${searchTermsFile}.`);
    searchTerm = terms[Math.floor(Math.random() * terms.length)];
    logStep('search-results-loading');
    await driver.get(`https://www.youtube.com/results?search_query=${encodeURIComponent(searchTerm)}`);
    const candidates = await getVideoLinks('a#video-title[href*="/watch?"]');
    selectionNumber = Math.floor(Math.random() * candidates.length);
    targetUrl = candidates[selectionNumber];
    if (!targetUrl) throw new Error('No video search results found.');
  }

  assertYouTubeUrl(targetUrl);
  logStep('video-loading', { selectionSource: searchTerm ? 'search-results' : 'video-url', selectionNumber: selectionNumber === undefined ? undefined : selectionNumber + 1 });
  await driver.get(targetUrl);
  const accept = await driver.findElements(By.xpath("//button[contains(translate(., 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz'), 'accept all') or contains(translate(., 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz'), 'i agree')]"));
  if (accept[0]) await accept[0].click().catch(() => {});
  logStep('player-waiting');
  const player = await driver.wait(until.elementLocated(By.css('video.html5-main-video')), 30_000);
  const result = await driver.executeAsyncScript((video, delay, done) => {
    video.muted = true;
    video.play().then(() => setTimeout(() => done({ paused: video.paused, currentTime: video.currentTime, readyState: video.readyState, duration: video.duration }), delay)).catch((error) => done({ error: error.message }));
  }, player, actionDelayMs);
  if (result.error || result.paused || result.currentTime <= 0) throw new Error(`Player did not begin playback: ${JSON.stringify(result)}`);
  logStep('playback-verified', { currentTime: result.currentTime, duration: result.duration });
  console.log(JSON.stringify({ status: 'passed', url: targetUrl, searchTerm, checkedAt: new Date().toISOString(), actionDelayMs, ...result }));
} catch (error) {
  console.error(JSON.stringify({ status: 'failed', step: currentStep, url: videoUrl, checkedAt: new Date().toISOString(), error: error.message }));
  process.exitCode = 1;
} finally {
  await driver?.quit().catch(() => {});
}
