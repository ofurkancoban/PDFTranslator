import puppeteer from 'puppeteer';
import fs from 'fs';
import path from 'path';
import fetch from 'node-fetch';
import FormData from 'form-data';
import dotenv from 'dotenv';
dotenv.config();

const TARGET_URL = 'https://www.onlinedoctranslator.com/en/translationform';
const FILE_PATH = './document.pdf'; // Yüklenecek dosyanın yolu
const API_KEY = process.env.API_KEY; // .env içinden 2Captcha API anahtarı
const DOWNLOAD_DIR = './translated'; // İndirilecek klasör
const TARGET_LANGUAGE = 'fr'; // 🌐 Buraya hedef dil kodunu yaz ('en', 'de', 'fr', 'tr', vs.)

// ✅ 2Captcha çözümü
async function solveCaptcha(sitekey, pageUrl) {
  const form = new FormData();
  form.append('key', API_KEY);
  form.append('method', 'userrecaptcha');
  form.append('googlekey', sitekey);
  form.append('pageurl', pageUrl);
  form.append('json', 1);

  const res = await fetch('http://2captcha.com/in.php', { method: 'POST', body: form });
  const { request: requestId } = await res.json();

  console.log('⏳ CAPTCHA gönderildi, çözüm bekleniyor...');
  for (let i = 0; i < 24; i++) {
    await new Promise(res => setTimeout(res, 5000));
    const check = await fetch(`http://2captcha.com/res.php?key=${API_KEY}&action=get&id=${requestId}&json=1`);
    const result = await check.json();
    if (result.status === 1) {
      console.log('✅ CAPTCHA çözüldü.');
      return result.request;
    }
  }
  throw new Error('❌ CAPTCHA çözülmedi.');
}

// ✅ Browser içinde gerçek dosya indirme
async function downloadWithPuppeteerFetch(page, url, destinationPath) {
  const buffer = await page.evaluate(async (url) => {
    const response = await fetch(url);
    const arrayBuffer = await response.arrayBuffer();
    return Array.from(new Uint8Array(arrayBuffer));
  }, url);

  fs.writeFileSync(destinationPath, Buffer.from(buffer));
}

(async () => {
  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });
  const page = await browser.newPage();

  await page.goto(TARGET_URL, { waitUntil: 'networkidle2' });

  // 🌐 Hedef dil seçimi (dosya yüklemeden önce!)
  await page.select('#to', TARGET_LANGUAGE);
  console.log(`🌐 Hedef dil "${TARGET_LANGUAGE}" olarak seçildi.`);

  // 📤 Dosyayı yükle
  const fileInput = await page.$('input[type="file"]');
  const absolutePath = path.resolve(FILE_PATH);
  await fileInput.uploadFile(absolutePath);
  console.log('📤 Dosya yüklendi.');

  // 🔑 Sitekey al
  await page.waitForSelector('iframe[src*="recaptcha"]');
  const frameEl = await page.$('iframe[src*="recaptcha"]');
  const src = await frameEl.evaluate(el => el.getAttribute('src'));
  const sitekey = src.split('k=')[1].split('&')[0];
  console.log('🔑 Sitekey:', sitekey);

  // 🧠 CAPTCHA çöz
  const token = await solveCaptcha(sitekey, TARGET_URL);

  // 💉 Token enjekte et
  await page.evaluate(token => {
    let textarea = document.querySelector("textarea[name='g-recaptcha-response']");
    if (!textarea) {
      textarea = document.createElement("textarea");
      textarea.name = "g-recaptcha-response";
      textarea.style = "display:none";
      document.querySelector("form").appendChild(textarea);
    }
    textarea.value = token;
  }, token);

  // 🔄 Callback tetikle
  await page.evaluate(token => {
    if (typeof recaptchaCallbackTranslator === 'function') {
      recaptchaCallbackTranslator(token);
    }
  }, token);
  console.log('✅ CAPTCHA token enjekte edildi ve callback tetiklendi.');

  // ⏳ 10 saniye bekle
  await new Promise(resolve => setTimeout(resolve, 10000));
  console.log('⏳ 10 saniye bekleme tamamlandı. Translate tetiklenecek.');

  // Translate butonu aktifleşince
  await page.waitForSelector('#translation-button', { timeout: 30000 });
  await page.waitForFunction(() => {
    const button = document.querySelector('#translation-button');
    return button && !button.disabled;
  }, { timeout: 30000 });

  // 📘 Translate butonuna arka planda tıklama
  await page.evaluate(() => {
    const button = document.querySelector('#translation-button');
    if (button) {
      const event = new MouseEvent('click', {
        bubbles: true,
        cancelable: true,
        view: window,
      });
      button.dispatchEvent(event);
    }
  });
  console.log('📘 Translate butonuna arka planda tıklama tetiklendi.');

  // 📄 Sayfa yönlendirmesini bekle
  await page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 60000 });
  console.log('📄 Yeni çeviri sayfası yüklendi.');

  // 5 saniye bekle (sayfa tam otursun)
  await new Promise(resolve => setTimeout(resolve, 5000));

  // 📥 İndirme bağlantısını al
  const downloadHref = await page.evaluate(() => {
    const link = document.querySelector('#download-link');
    return link ? link.getAttribute('href') : null;
  });

  if (downloadHref) {
    const fullUrl = downloadHref.startsWith('http')
      ? downloadHref
      : `https://www.onlinedoctranslator.com${downloadHref}`;

    if (!fs.existsSync(DOWNLOAD_DIR)) fs.mkdirSync(DOWNLOAD_DIR);
    const fileName = path.basename(fullUrl).split('?')[0];
    const destination = path.join(DOWNLOAD_DIR, fileName);

    await downloadWithPuppeteerFetch(page, fullUrl, destination);
    console.log('✅ Dosya başarıyla indirildi:', destination);
  } else {
    console.log('⚠️ İndirme bağlantısı bulunamadı.');
  }

  await browser.close();
})();