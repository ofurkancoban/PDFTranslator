import axios from 'axios';
import fs from 'fs';
import FormData from 'form-data';
import { CookieJar } from 'tough-cookie';
import { wrapper } from 'axios-cookiejar-support';

const TARGET_URL = 'https://www.onlinedoctranslator.com/en/translationform';
const UPLOAD_URL = 'https://www.onlinedoctranslator.com/app/uploadtotranslationcontainer';
const SUBMIT_URL = 'https://www.onlinedoctranslator.com/app/translationsubmit';
const PROCESS_URL = 'https://www.onlinedoctranslator.com/app/processtranslationdata';
const DOWNLOAD_BASE = 'https://www.onlinedoctranslator.com/app/gettranslateddocument/';

const FILE_PATH = './document.pdf';    // Çevrilecek dosya yolu
const OUTPUT_DIR = './indirilenler';   // İndirilecek klasör
const API_KEY = '3e71c09ed20cd28f6588180347c17070'; // Kendi 2Captcha API Key'in

const FROM_LANG = 'tr';
const TO_LANG = 'en';

async function solveCaptcha(siteKey, pageUrl) {
    const { data } = await axios.post('http://2captcha.com/in.php', null, {
        params: { key: API_KEY, method: 'userrecaptcha', googlekey: siteKey, pageurl: pageUrl, json: 1 }
    });
    const requestId = data.request;

    for (let i = 0; i < 24; i++) {
        await new Promise(r => setTimeout(r, 5000));
        const res = await axios.get('http://2captcha.com/res.php', { params: { key: API_KEY, action: 'get', id: requestId, json: 1 } });
        if (res.data.status === 1) return res.data.request;
    }
    throw new Error('CAPTCHA çözümü zaman aşımı');
}

async function main() {
    const jar = new CookieJar();
    const client = wrapper(axios.create({ jar, withCredentials: true }));

    console.log('[INFO] Ana sayfa açılıyor...');
    await client.get(TARGET_URL);

    console.log('[INFO] Dosya yükleniyor...');
    const form = new FormData();
    form.append('file', fs.createReadStream(FILE_PATH));
    await client.post(UPLOAD_URL, form, { headers: form.getHeaders() });
    console.log('[INFO] Dosya yüklendi.');

    console.log('[INFO] CAPTCHA çözümü başlatılıyor...');
    const token = await solveCaptcha('6Lfn0NkZAAAAAAMTSurqDvBs7lRM_zYY_9pjJGhJ', TARGET_URL);

    console.log('[INFO] Form gönderiliyor...');
    await client.post(SUBMIT_URL, new URLSearchParams({
        from: FROM_LANG,
        to: TO_LANG,
        'g-recaptcha-response': token
    }), {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
    });

    console.log('[INFO] Çeviri işlemi başlatıldı, bekleniyor...');

    let translatedFilename = null;
    for (let i = 0; i < 20; i++) {
        const { data } = await client.post(PROCESS_URL, {
            from: FROM_LANG,
            to: TO_LANG,
            destStringList: [],
            isDocTranslation: true
        }, {
            headers: { 'Content-Type': 'application/json' }
        });

        if (data?.translatedFileName) {
            translatedFilename = data.translatedFileName;
            console.log('[INFO] Çeviri tamamlandı, dosya adı:', translatedFilename);
            break;
        }

        console.log(`[INFO] [${i + 1}] Henüz hazır değil, tekrar deneniyor...`);
        await new Promise(r => setTimeout(r, 3000));
    }

    if (!translatedFilename) throw new Error('Çeviri işlemi tamamlanamadı.');

    console.log('[INFO] Dosya indiriliyor...');
    const { data: fileData } = await client.get(DOWNLOAD_BASE + translatedFilename, { responseType: 'arraybuffer' });
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
    fs.writeFileSync(`${OUTPUT_DIR}/${translatedFilename}`, fileData);

    console.log('✅ Başarıyla indirildi:', `${OUTPUT_DIR}/${translatedFilename}`);
}

main().catch(console.error);