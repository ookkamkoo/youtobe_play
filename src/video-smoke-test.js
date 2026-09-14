import dotenv from 'dotenv';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';

dotenv.config({ override: true });

// อ่านค่าการทำงานจาก .env
const videoUrl = process.env.VIDEO_URL;
const searchTermsFile = process.env.SEARCH_TERMS_FILE;
const headless = process.env.HEADLESS !== 'false';
const keepOpen = process.env.KEEP_OPEN === 'true';
const actionDelayMs = Number.parseInt(process.env.ACTION_DELAY_MS ?? '2000', 10);
const sessionMinHours = Number.parseFloat(process.env.SESSION_MIN_HOURS ?? '2');
const sessionMaxHours = Number.parseFloat(process.env.SESSION_MAX_HOURS ?? '8');
const startDelayMaxMinutes = Number.parseFloat(process.env.START_DELAY_MAX_MINUTES ?? '0.01');
// บน Raspberry Pi ใช้ Chromium ของระบบโดยอัตโนมัติ; Windows ยังคงใช้ Chrome channel เดิม
const browserPath = process.env.BROWSER_PATH
  || (process.platform === 'linux' && existsSync('/usr/bin/chromium') ? '/usr/bin/chromium' : undefined);

if (!videoUrl && !searchTermsFile) {
  console.error('Set VIDEO_URL or SEARCH_TERMS_FILE in .env.');
  process.exit(1);
}

if (!Number.isFinite(actionDelayMs) || actionDelayMs < 0) {
  console.error('ACTION_DELAY_MS must be a non-negative whole number.');
  process.exit(1);
}

if (!Number.isFinite(sessionMinHours) || !Number.isFinite(sessionMaxHours)
  || sessionMinHours <= 0 || sessionMaxHours < sessionMinHours) {
  console.error('SESSION_MIN_HOURS must be positive and SESSION_MAX_HOURS must be at least SESSION_MIN_HOURS.');
  process.exit(1);
}

if (!Number.isFinite(startDelayMaxMinutes) || startDelayMaxMinutes < 0) {
  console.error('START_DELAY_MAX_MINUTES must be a non-negative number.');
  process.exit(1);
}

// ป้องกันไม่ให้สคริปต์เปิด URL นอก YouTube โดยไม่ตั้งใจ
function assertYouTubeUrl(url) {
  let parsedUrl;
  try {
    parsedUrl = new URL(url);
  } catch {
    throw new Error('VIDEO_URL must be a valid URL.');
  }

  if (!['youtube.com', 'www.youtube.com', 'm.youtube.com'].includes(parsedUrl.hostname)) {
    throw new Error('For safety, VIDEO_URL must be a youtube.com URL.');
  }
}

// บน Linux ใช้ profile Chromium ของ user เพื่อใช้ login เดิม; ระบบอื่นใช้ profile แยกของโปรเจกต์
const profileDir = process.env.BROWSER_PROFILE_DIR
  ? path.resolve(process.env.BROWSER_PROFILE_DIR)
  : process.platform === 'linux'
    ? path.join(process.env.HOME ?? process.cwd(), '.config', 'chromium')
    : path.join(process.cwd(), '.youtube-profile');
// สุ่มเวลารอก่อนเริ่มทั้งหมด เพื่อลดการเริ่มงานในช่วงเวลาเดิมทุกครั้ง
const startDelayMs = Math.random() * startDelayMaxMinutes * 60 * 1000;
if (startDelayMs > 0) {
  console.log(`Waiting ${(startDelayMs / 60_000).toFixed(2)} minutes before starting.`);
  await new Promise((resolve) => setTimeout(resolve, startDelayMs));
}

// หลังรอครบแล้วจึงเปิด Chrome และเริ่มขั้นตอนทั้งหมดด้านล่าง
const context = await chromium.launchPersistentContext(profileDir, {
  ...(browserPath ? { executablePath: browserPath } : { channel: 'chrome' }),
  headless,
  chromiumSandbox: true,
  locale: 'en-US'
});
// Persistent Chrome มักเปิดแท็บ about:blank มาแล้ว จึงใช้แท็บนั้นแทนการสร้างแท็บเพิ่ม
const page = context.pages()[0] ?? await context.newPage();
let contextClosed = false;
context.on('close', () => {
  contextClosed = true;
});

// โหมดดูต่อเนื่องจะสุ่มเวลารวมของหนึ่งรอบระหว่าง 2–8 ชั่วโมงโดยค่าเริ่มต้น
const sessionHours = keepOpen
  ? sessionMinHours + Math.random() * (sessionMaxHours - sessionMinHours)
  : undefined;
const sessionEndsAt = keepOpen ? Date.now() + sessionHours * 60 * 60 * 1000 : undefined;

try {
  if (keepOpen) {
    console.log(`This session will run for ${sessionHours.toFixed(2)} hours.`);
  }

  // เปิด YouTube และตรวจว่าผู้ใช้ล็อกอินอยู่ก่อนเริ่มเล่นวิดีโอ
  await page.goto('https://www.youtube.com', { waitUntil: 'domcontentloaded', timeout: 45_000 });
  // YouTube อาจแสดง avatar เป็น element คนละชนิดในแต่ละ Chromium/อุปกรณ์
  const avatar = page.locator('#avatar-btn');
  await avatar.first().waitFor({ state: 'attached', timeout: 15_000 }).catch(() => {});
  const signedIn = await avatar.count() > 0;
  if (!signedIn) {
    throw new Error('YouTube is not signed in. Run "npm run auth", sign in manually, close Chrome, then retry.');
  }

  let searchTerm;
  let searchTerms = [];
  if (searchTermsFile) {
    // อ่านคำค้นที่ใช้ได้จากไฟล์ แล้วสุ่มมา 1 คำ
    const termsPath = path.resolve(process.cwd(), searchTermsFile);
    searchTerms = (await readFile(termsPath, 'utf8'))
      .split(/\r?\n/)
      .map((term) => term.trim())
      .filter((term) => term && !term.startsWith('#'));
    if (!searchTerms.length) throw new Error(`No search terms found in ${searchTermsFile}.`);
    searchTerm = searchTerms[Math.floor(Math.random() * searchTerms.length)];
  }

  let previousUrl;
  do {
    // รอบแรกเลือกวิดีโอจากผลค้นหา ส่วนรอบต่อไปเลือกจากวิดีโอแนะนำ
    let targetUrl = videoUrl;
    let selectionNumber;
    let selectionSource;
    if (searchTerm && !previousUrl) {
      // ดึงเฉพาะ 5 ผลลัพธ์แรก แล้วสุ่มเลือกหนึ่งวิดีโอ
      await page.goto(`https://www.youtube.com/results?search_query=${encodeURIComponent(searchTerm)}`, {
        waitUntil: 'domcontentloaded',
        timeout: 45_000
      });
      const videoLinks = page.locator('a#video-title[href*="/watch?"]');
      await videoLinks.first().waitFor({ state: 'attached', timeout: 30_000 });
      const resultUrls = await videoLinks.evaluateAll((links) => links
        .slice(0, 5)
        .map((link) => link.getAttribute('href'))
        .filter(Boolean));
      const candidates = resultUrls.map((href, index) => ({
        url: new URL(href, 'https://www.youtube.com').href,
        resultNumber: index + 1
      }));
      const differentCandidates = candidates.filter((candidate) => candidate.url !== previousUrl);
      const selectionPool = differentCandidates.length ? differentCandidates : candidates;
      const selected = selectionPool[Math.floor(Math.random() * selectionPool.length)];
      targetUrl = selected.url;
      selectionNumber = selected.resultNumber;
      selectionSource = 'search-results';
    } else if (previousUrl) {
      // ดึงเฉพาะ 5 วิดีโอแนะนำแรก และเลี่ยงวิดีโอเดิมเมื่อเป็นไปได้
      const recommendations = page.locator('ytd-watch-next-secondary-results-renderer a#thumbnail[href*="/watch?"]');
      await recommendations.first().waitFor({ state: 'attached', timeout: 30_000 });
      const recommendationUrls = await recommendations.evaluateAll((links) => links
        .slice(0, 5)
        .map((link) => link.getAttribute('href'))
        .filter(Boolean));
      const candidates = recommendationUrls.map((href, index) => ({
        url: new URL(href, 'https://www.youtube.com').href,
        resultNumber: index + 1
      }));
      const differentCandidates = candidates.filter((candidate) => candidate.url !== previousUrl);
      const selectionPool = differentCandidates.length ? differentCandidates : candidates;
      const selected = selectionPool[Math.floor(Math.random() * selectionPool.length)];
      targetUrl = selected.url;
      selectionNumber = selected.resultNumber;
      selectionSource = 'recommendations';
    }

    assertYouTubeUrl(targetUrl);
    // เปิดหน้าวิดีโอ รับคุกกี้หากมี และสั่งเล่นแบบปิดเสียง
    const response = await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 45_000 });
    if (!response?.ok()) throw new Error(`Page returned HTTP ${response?.status() ?? 'unknown'}`);

    const accept = page.getByRole('button', { name: /accept all|i agree/i });
    if (await accept.count()) await accept.first().click({ timeout: 5_000 });

    const player = page.locator('video.html5-main-video');
    await player.waitFor({ state: 'attached', timeout: 30_000 });
    const result = await player.evaluate(async (video, delayMs) => {
      video.muted = true;
      await video.play();
      await new Promise((resolve) => setTimeout(resolve, delayMs));
      return { paused: video.paused, currentTime: video.currentTime, readyState: video.readyState, duration: video.duration };
    }, actionDelayMs);

    if (result.paused || result.currentTime <= 0) {
      throw new Error(`Player did not begin playback: ${JSON.stringify(result)}`);
    }

    // เมื่อเปิดดูต่อเนื่อง ให้สุ่มช่วงที่ต้องดูของแต่ละวิดีโอระหว่าง 20–100%
    const watchPercent = keepOpen ? 20 + Math.random() * 80 : undefined;

    console.log(JSON.stringify({
      status: 'passed',
      url: targetUrl,
      searchTerm,
      selectionSource,
      selectionNumber,
      checkedAt: new Date().toISOString(),
      actionDelayMs,
      watchPercent,
      sessionHours,
      ...result
    }));
    previousUrl = targetUrl;

    if (keepOpen) {
      console.log(`Watching ${watchPercent.toFixed(1)}% of this video; Chrome will close automatically when the session ends.`);
      try {
        // รอจนวิดีโอเล่นถึงเป้าหมาย, เล่นจบ หรือถึงเวลาสิ้นสุดของรอบ
        const remainingSessionMs = Math.max(0, sessionEndsAt - Date.now());
        await player.evaluate((video, { percent, remainingMs }) => new Promise((resolve) => {
          const targetTime = video.duration * (percent / 100);
          const hasReachedTarget = () => video.ended || video.currentTime >= targetTime;
          let sessionTimer;

          const finish = () => {
            clearTimeout(sessionTimer);
            video.removeEventListener('timeupdate', onTimeUpdate);
            video.removeEventListener('ended', onEnded);
            resolve();
          };

          const onTimeUpdate = () => {
            if (hasReachedTarget()) finish();
          };
          const onEnded = () => finish();

          if (!Number.isFinite(targetTime) || targetTime <= video.currentTime || hasReachedTarget()) {
            finish();
            return;
          }

          video.addEventListener('timeupdate', onTimeUpdate);
          video.addEventListener('ended', onEnded, { once: true });
          sessionTimer = setTimeout(finish, remainingMs);
        }), { percent: watchPercent, remainingMs: remainingSessionMs });
      } catch (error) {
        if (!contextClosed) throw error;
      }
    }
  } while (keepOpen && !contextClosed && Date.now() < sessionEndsAt);
} catch (error) {
  // ส่งผลล้มเหลวเป็น JSON เพื่อให้เรียกใช้จาก scheduler หรือสคริปต์อื่นได้
  console.error(JSON.stringify({ status: 'failed', url: videoUrl, checkedAt: new Date().toISOString(), error: error.message }));
  process.exitCode = 1;
} finally {
  // ปิด Chrome ทุกครั้งเมื่อเสร็จงานหรือเกิดข้อผิดพลาด
  await context.close();
}
