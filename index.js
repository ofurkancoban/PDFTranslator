const puppeteer = require('puppeteer');
const fs = require('fs');
const axios = require('axios');
const path = require('path');

// CONFIG
const TARGET_URL = 'https://www.onlinedoctranslator.com/en/translationform';
const INPUT_FILE_PATH = './document.pdf';
const DOWNLOAD_DIR = path.resolve('./indirilenler');
const API_KEY = '3e71c09ed20cd28f6588180347c17070'; // 2Captcha Key

// 2Captcha çözüm fonksiyonu
async function solveRecaptcha(siteKey, pageUrl) {
    console.log('[INFO] 2Captcha çözüm başlatılıyor...');
    const res = await axios.post('http://2captcha.com/in.php', null, {
        params: {
            key: API_KEY,
            method: 'userrecaptcha',
            googlekey: siteKey,
            pageurl: pageUrl,
            json: 1
        }
    });
    const requestId = res.data.request;
    console.log('[INFO] Task ID:', requestId);

    for (let i = 0; i < 30; i++) {
        await new Promise(resolve => setTimeout(resolve, 5000));
        const check = await axios.get('http://2captcha.com/res.php', {
            params: {
                key: API_KEY,
                action: 'get',
                id: requestId,
                json: 1
            }
        });
        if (check.data.status === 1) {
            return check.data.request;
        }
    }
    throw new Error('CAPTCHA çözümü zaman aşımına uğradı.');
}

// Ana Fonksiyon
async function main() {
    if (!fs.existsSync(DOWNLOAD_DIR)) {
        fs.mkdirSync(DOWNLOAD_DIR);
    }

    const browser = await puppeteer.launch({
        headless: false,
        args: [
            '--window-size=1200,800',
            '--no-sandbox',
            '--disable-setuid-sandbox'
        ]
    });

    const page = await browser.newPage();
    await page.setViewport({ width: 1200, height: 800 });
    await page.goto(TARGET_URL, { waitUntil: 'networkidle2' });

    console.log('[INFO] Sayfa açıldı, dosya yükleniyor...');

    // Dosya yükle
    const fileInput = await page.waitForSelector('input[type=file]');
    await fileInput.uploadFile(INPUT_FILE_PATH);

    console.log('[INFO] Dosya yüklendi, CAPTCHA çözülüyor...');

    // Site key bul
    await page.waitForSelector('iframe[src*="recaptcha"]');
    const frameHandle = await page.$('iframe[src*="recaptcha"]');
    const src = await frameHandle.evaluate(el => el.getAttribute('src'));
    const siteKey = src.split('k=')[1].split('&')[0];
    console.log('[INFO] Site key bulundu:', siteKey);

    // 2Captcha ile çözüm al
    const token = await solveRecaptcha(siteKey, TARGET_URL);
    console.log('[INFO] CAPTCHA token alındı.');

    // Token'ı enjekte et
    await page.evaluate((token) => {
        let textarea = document.querySelector('textarea[name="g-recaptcha-response"]');
        if (!textarea) {
            textarea = document.createElement('textarea');
            textarea.name = 'g-recaptcha-response';
            textarea.style = 'display:none';
            document.body.appendChild(textarea);
        }
        textarea.value = token;
    }, token);

    console.log('[INFO] CAPTCHA token enjekte edildi, callback tetikleniyor...');

    // Callback fonksiyonu tetikle
    await page.evaluate((token) => {
        if (typeof recaptchaCallbackTranslator === 'function') {
            recaptchaCallbackTranslator(token);
        }
    }, token);

    // Translate buton aktifleşmesini bekle
    await page.waitForFunction(() => {
        const btn = document.querySelector('#translation-button');
        return btn && !btn.disabled;
    }, { timeout: 60000 });

    console.log('[INFO] Translate butonu aktifleşti, gerçek click gönderiliyor...');

    // Native click
    await page.evaluate(() => {
        const btn = document.querySelector('#translation-button');
        if (btn) {
            btn.click();
        }
    });

    // Navigation bekle
    await page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 120000 }).catch(() => {
        console.warn('[WARN] Navigation timeout, devam ediliyor...');
    });

    console.log('[INFO] Çeviri işlemi başladı, indirilebilir dosya aranıyor...');

    // Doğru indirilebilir linki bekle
    await page.waitForFunction(() => {
        const link = document.querySelector('#download-link');
        return link && link.href && !link.href.endsWith('/gettranslateddocument');
    }, { timeout: 60000 });

    const fullDownloadUrl = await page.evaluate(() => {
        const link = document.querySelector('#download-link');
        return link ? link.href : null;
    });

    if (!fullDownloadUrl) {
        throw new Error('İndirme linki bulunamadı!');
    }

    console.log('[INFO] Doğru indirme linki bulundu:', fullDownloadUrl);

    // Puppeteer'dan cookies çek
    const cookies = await page.cookies();
    const cookieHeader = cookies.map(cookie => `${cookie.name}=${cookie.value}`).join('; ');

    // Axios ile dosya indir (cookie ile)
    const response = await axios.get(fullDownloadUrl, {
        responseType: 'arraybuffer',
        headers: {
            'Cookie': cookieHeader,
            'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36 Edg/135.0.0.0',
            'Accept': 'application/pdf',
            'Referer': 'https://www.onlinedoctranslator.com/app/translationprocess-pdf',
        }
    });

    // Dosyayı kaydet
    const fileName = path.basename(fullDownloadUrl);
    const filePath = path.join(DOWNLOAD_DIR, fileName);
    fs.writeFileSync(filePath, response.data);

    console.log(`✅ Dosya başarıyla indirildi: ${filePath}`);

    await browser.close();
}

// Çalıştır
main().catch(err => console.error('❌ Hata:', err.message));