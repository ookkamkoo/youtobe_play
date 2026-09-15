# YouTube video smoke test

สคริปต์นี้มีไว้ตรวจว่าวิดีโอ YouTube จาก URL ที่กำหนดเปิดหน้าเว็บและเริ่มเล่นได้หรือไม่ จากนั้นปิดเบราว์เซอร์ทันทีหลังตรวจสอบ ไม่ค้นหาวิดีโอ ไม่สุ่มวิดีโอ และไม่เปิดเล่นต่อเนื่อง

## เปิด Chrome

```powershell
npm run open:chrome
```

คำสั่งนี้เปิด Google Chrome ไปยังหน้าเปล่า และโปรแกรมจะสิ้นสุดเมื่อปิดหน้าต่าง Chrome

## ติดตั้ง

```powershell
npm install
Copy-Item .env.example .env
```

Selenium จะใช้ Selenium Manager เพื่อดาวน์โหลด/เลือก ChromeDriver ที่เข้ากันกับ Chrome โดยอัตโนมัติในการรันครั้งแรก หากต้องการระบุไฟล์เบราว์เซอร์เอง ให้กำหนด `BROWSER_PATH` ใน `.env`

### Raspberry Pi

Install Chromium and its matching driver from the same apt repository, then set the two paths in `.env`:

```bash
sudo apt update
sudo apt install chromium chromium-driver
```

```dotenv
BROWSER_PATH=/usr/bin/chromium
CHROMEDRIVER_PATH=/usr/bin/chromedriver
```

`CHROMEDRIVER_PATH` bypasses Selenium Manager, which is required on Raspberry Pi systems where its bundled binary is not compatible with the installed CPU architecture.

`npm run auth` opens Chromium directly, rather than through Selenium, because Google sign-in may reject an automated WebDriver browser. Sign in manually and close Chromium; the resulting session is saved in the configured profile for `npm run dev`.

กำหนด `VIDEO_URL` ใน `.env` เป็น URL วิดีโอที่คุณมีสิทธิ์ทดสอบ แล้วรัน:

```powershell
npm run dev
```

หากต้องการเห็นหน้าต่างเบราว์เซอร์:

```powershell
$env:HEADLESS = 'false'
npm run dev
```

หากต้องการให้เปิด Chrome DevTools พร้อมหน้าวิดีโอ ให้กำหนดใน `.env`:

```dotenv
HEADLESS=false
OPEN_DEVTOOLS=true
```

Chrome จะจำแท็บล่าสุดของ DevTools; เลือกแท็บ **Network** หนึ่งครั้ง แล้วการเปิดครั้งถัดไปจะกลับไปยังแท็บนั้น.

ผลลัพธ์เป็น JSON พร้อม `status: passed` หรือ `status: failed` เพื่อใช้ต่อกับระบบตรวจสอบหรือ task scheduler ได้
