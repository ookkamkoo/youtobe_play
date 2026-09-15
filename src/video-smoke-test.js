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
const minRunHours = Number.parseFloat(process.env.MIN_RUN_HOURS ?? '2');
const maxRunHours = Number.parseFloat(process.env.MAX_RUN_HOURS ?? '4');
const minStartDelayMinutes = Number.parseFloat(process.env.MIN_START_DELAY_MINUTES ?? '1');
const maxStartDelayMinutes = Number.parseFloat(process.env.MAX_START_DELAY_MINUTES ?? '20');
const minStartDelayOn = process.env.MIN_START_DELAY_ON !== 'false';
const browserPath = process.env.BROWSER_PATH || (process.platform === 'linux' && existsSync('/usr/bin/chromium') ? '/usr/bin/chromium' : undefined);
const chromeDriverPath = process.env.CHROMEDRIVER_PATH || (process.platform === 'linux' && existsSync('/usr/bin/chromedriver') ? '/usr/bin/chromedriver' : undefined);
const profileDir = process.env.BROWSER_PROFILE_DIR ? path.resolve(process.env.BROWSER_PROFILE_DIR) : path.join(process.cwd(), '.youtube-profile');
let currentStep = 'configuration';
let driver;

function logStep(step, details = {}) {
  currentStep = step;
  console.log(JSON.stringify({ status: 'running', step, checkedAt: new Date().toISOString(), ...details }));
}
function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
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

async function watchRandomPortion(player, watchPercent, videoNumber, deadline) {
  const targetTime = await driver.executeScript((video, percent) => video.duration * percent, player, watchPercent);
  if (!Number.isFinite(targetTime) || targetTime <= 0) throw new Error('Video duration is not available for percentage-based playback.');
  const remainingMs = Math.max(0, deadline - Date.now());
  logStep('video-playing', { videoNumber, url: await driver.getCurrentUrl(), watchPercent: Math.round(watchPercent * 100), targetTime, remainingMs });
  return driver.executeAsyncScript((video, target, maxWaitMs, done) => {
    let timeoutId;
    const finish = () => {
      video.removeEventListener('timeupdate', checkProgress);
      video.removeEventListener('ended', finish);
      clearTimeout(timeoutId);
      done({ currentTime: video.currentTime, duration: video.duration, ended: video.ended, sessionEnded: false });
    };
    const finishSession = () => {
      video.removeEventListener('timeupdate', checkProgress);
      video.removeEventListener('ended', finish);
      done({ currentTime: video.currentTime, duration: video.duration, ended: video.ended, sessionEnded: true });
    };
    const checkProgress = () => {
      if (video.currentTime >= target || video.ended) finish();
    };
    video.addEventListener('timeupdate', checkProgress);
    video.addEventListener('ended', finish, { once: true });
    timeoutId = setTimeout(finishSession, maxWaitMs);
    checkProgress();
  }, player, targetTime, remainingMs);
}

async function playRandomRecommendedVideo(videoNumber) {
  const previousUrl = await driver.getCurrentUrl();
  logStep('recommended-video-loading', { previousUrl, videoNumber });
  await driver.wait(until.elementLocated(By.css('ytd-compact-video-renderer a#thumbnail[href*="/watch"]')), 30_000);
  const recommended = await driver.executeScript(() => [...document.querySelectorAll('ytd-compact-video-renderer a#thumbnail[href*="/watch"]')]
    .filter((link) => link.offsetParent !== null)
    .slice(0, 4));
  if (!recommended.length) throw new Error('No recommended videos were found.');
  const selectionNumber = Math.floor(Math.random() * recommended.length);
  logStep('recommended-video-selected', { videoNumber, selectionNumber: selectionNumber + 1, candidateCount: recommended.length });
  await driver.executeScript('arguments[0].click()', recommended[selectionNumber]);
  await driver.wait(async () => (await driver.getCurrentUrl()) !== previousUrl, 30_000);
}

if (!videoUrl && !searchTermsFile) {
  console.error('Set VIDEO_URL or SEARCH_TERMS_FILE in .env.');
  process.exit(1);
}
if (!Number.isFinite(actionDelayMs) || actionDelayMs < 0) throw new Error('ACTION_DELAY_MS must be a non-negative whole number.');
if (!Number.isFinite(minRunHours) || !Number.isFinite(maxRunHours) || minRunHours <= 0 || maxRunHours < minRunHours) {
  throw new Error('MIN_RUN_HOURS and MAX_RUN_HOURS must be positive numbers, with MAX_RUN_HOURS >= MIN_RUN_HOURS.');
}
if (!Number.isFinite(minStartDelayMinutes) || !Number.isFinite(maxStartDelayMinutes) || minStartDelayMinutes < 0 || maxStartDelayMinutes < minStartDelayMinutes) {
  throw new Error('MIN_START_DELAY_MINUTES and MAX_START_DELAY_MINUTES must be non-negative numbers, with MAX_START_DELAY_MINUTES >= MIN_START_DELAY_MINUTES.');
}

try {
  const startDelayMinutes = minStartDelayOn ? minStartDelayMinutes + Math.random() * (maxStartDelayMinutes - minStartDelayMinutes) : 0;
  const startDelayMs = Math.round(startDelayMinutes * 60 * 1000);
  if (startDelayMs > 0) {
    logStep('start-delay', { startDelayMinutes, startsAt: new Date(Date.now() + startDelayMs).toISOString() });
    await sleep(startDelayMs);
  }
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
  // The async playback watcher can wait for the remainder of the session.
  await driver.manage().setTimeouts({ script: Math.ceil(maxRunHours * 60 * 60 * 1000) + 30_000 });

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
  const runHours = minRunHours + Math.random() * (maxRunHours - minRunHours);
  const deadline = Date.now() + runHours * 60 * 60 * 1000;
  console.log(JSON.stringify({ status: 'running', step: 'session-started', checkedAt: new Date().toISOString(), runHours, deadline: new Date(deadline).toISOString() }));
  while (true) {
    if (Date.now() >= deadline) break;
    const { player, result } = await startPlaybackAndVerify();
    const url = await driver.getCurrentUrl();
    const watchPercent = (40 + Math.floor(Math.random() * 61)) / 100;
    logStep('playback-verified', { videoNumber, currentTime: result.currentTime, duration: result.duration });
    console.log(JSON.stringify({ status: 'playing', videoNumber, url, searchTerm, checkedAt: new Date().toISOString(), actionDelayMs, watchPercent: Math.round(watchPercent * 100), ...result }));
    const watched = await watchRandomPortion(player, watchPercent, videoNumber, deadline);
    console.log(JSON.stringify({ status: 'portion-watched', videoNumber, url, checkedAt: new Date().toISOString(), watchPercent: Math.round(watchPercent * 100), ...watched }));
    if (watched.sessionEnded) break;
    await playRandomRecommendedVideo(videoNumber + 1);
    videoNumber += 1;
  }
  console.log(JSON.stringify({ status: 'completed', checkedAt: new Date().toISOString(), runHours }));
} catch (error) {
  console.error(JSON.stringify({ status: 'failed', step: currentStep, url: videoUrl, checkedAt: new Date().toISOString(), error: error.message }));
  process.exitCode = 1;
} finally {
  await driver?.quit().catch(() => {});
}
