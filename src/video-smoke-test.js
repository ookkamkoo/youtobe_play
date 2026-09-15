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
const openDevTools = process.env.OPEN_DEVTOOLS === 'true';
const reuseExistingChrome = process.env.REUSE_EXISTING_CHROME === 'true';
const debuggingPort = process.env.CHROME_DEBUGGING_PORT ?? '9222';
const actionDelayMs = Number.parseInt(process.env.ACTION_DELAY_MS ?? '2000', 10);
const browserPath = process.env.BROWSER_PATH || (process.platform === 'linux' && existsSync('/usr/bin/chromium') ? '/usr/bin/chromium' : undefined);
const chromeDriverPath = process.env.CHROMEDRIVER_PATH || (process.platform === 'linux' && existsSync('/usr/bin/chromedriver') ? '/usr/bin/chromedriver' : undefined);
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

async function startPlaybackAndVerify() {
  logStep('player-waiting');
  const player = await driver.wait(until.elementLocated(By.css('video.html5-main-video')), 30_000);
  const result = await driver.executeAsyncScript((video, delay, done) => {
    video.muted = true;
    video.play()
      .then(() => setTimeout(() => done({ paused: video.paused, currentTime: video.currentTime, readyState: video.readyState, duration: video.duration }), delay))
      .catch((error) => done({ error: error.message }));
  }, player, actionDelayMs);
  if (result.error || result.paused || result.currentTime <= 0) throw new Error(`Player did not begin playback: ${JSON.stringify(result)}`);
  return { player, result };
}

async function waitForVideoEnd(player) {
  logStep('video-playing', { url: await driver.getCurrentUrl() });
  await driver.executeAsyncScript((video, done) => {
    if (video.ended) return done();
    video.addEventListener('ended', () => done(), { once: true });
  }, player);
}

async function playNextVideo(videoNumber) {
  const previousUrl = await driver.getCurrentUrl();
  logStep('next-video-loading', { previousUrl, videoNumber });
  const nextButton = await driver.wait(until.elementLocated(By.css('button.ytp-next-button')), 15_000);
  await driver.executeScript('arguments[0].click()', nextButton);
  await driver.wait(async () => (await driver.getCurrentUrl()) !== previousUrl, 30_000);
}

if (!videoUrl && !searchTermsFile) {
  console.error('Set VIDEO_URL or SEARCH_TERMS_FILE in .env.');
  process.exit(1);
}
if (!Number.isFinite(actionDelayMs) || actionDelayMs < 0) throw new Error('ACTION_DELAY_MS must be a non-negative whole number.');

try {
  logStep('browser-launching', { headless, reuseExistingChrome, browser: browserPath ?? 'Chrome via Selenium Manager', profileDir });
  const options = new chrome.Options();
  if (reuseExistingChrome) {
    options.debuggerAddress(`127.0.0.1:${debuggingPort}`);
  } else {
    options.addArguments(`--user-data-dir=${profileDir}`, '--lang=en-US', '--mute-audio');
    if (browserPath) options.setChromeBinaryPath(browserPath);
    if (process.env.BROWSER_PROFILE_NAME) options.addArguments(`--profile-directory=${process.env.BROWSER_PROFILE_NAME}`);
    if (headless) options.addArguments('--headless=new');
    if (!headless && openDevTools) options.addArguments('--auto-open-devtools-for-tabs');
  }
  const builder = new Builder().forBrowser('chrome').setChromeOptions(options);
  // Use a locally installed driver on Raspberry Pi and bypass Selenium Manager.
  if (chromeDriverPath) builder.setChromeService(new chrome.ServiceBuilder(chromeDriverPath));
  driver = await builder.build();

  logStep('youtube-home-loading');
  await driver.get('https://www.youtube.com');
  const cookies = await driver.manage().getCookies();
  // Selenium CSS locators do not cross Shadow DOM boundaries, while YouTube's
  // account button can be rendered inside nested web components.
  const hasAvatarButton = await driver.executeScript(() => {
    const findAvatar = (root) => {
      if (root.querySelector('#avatar-btn')) return true;
      return [...root.querySelectorAll('*')].some((element) => element.shadowRoot && findAvatar(element.shadowRoot));
    };
    return findAvatar(document);
  });
  const authCookieNames = new Set(['SID', 'HSID', 'SSID', 'APISID', 'SAPISID', 'LOGIN_INFO']);
  const hasGoogleAuthCookie = cookies.some((cookie) => authCookieNames.has(cookie.name));
  // Google cookies may belong to accounts.google.com and are therefore not
  // visible from youtube.com; use the rendered account button as the primary signal.
  const signedIn = hasAvatarButton || hasGoogleAuthCookie;
  logStep('youtube-auth-checked', { signedIn, cookieCount: cookies.length, hasGoogleAuthCookie, hasAvatarButton, pageUrl: await driver.getCurrentUrl(), pageTitle: await driver.getTitle() });
  if (!signedIn) {
    throw new Error('YouTube is not signed in. Run "npm run auth", sign in manually, close Chromium, then retry.');
  }

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
  let videoNumber = 1;
  while (true) {
    const { player, result } = await startPlaybackAndVerify();
    const url = await driver.getCurrentUrl();
    logStep('playback-verified', { videoNumber, currentTime: result.currentTime, duration: result.duration });
    console.log(JSON.stringify({ status: 'playing', videoNumber, url, searchTerm, checkedAt: new Date().toISOString(), actionDelayMs, ...result }));
    await waitForVideoEnd(player);
    await playNextVideo(videoNumber + 1);
    videoNumber += 1;
  }
} catch (error) {
  console.error(JSON.stringify({ status: 'failed', step: currentStep, url: videoUrl, checkedAt: new Date().toISOString(), error: error.message }));
  process.exitCode = 1;
} finally {
  await driver?.quit().catch(() => {});
}
