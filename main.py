import os
import time
import json
import requests
from pathlib import Path
from bs4 import BeautifulSoup

# ----------------------------------------------------------------------------
# CONFIG
# ----------------------------------------------------------------------------
TARGET_URL = "https://www.onlinedoctranslator.com/en/translationform"
UPLOAD_URL = "https://www.onlinedoctranslator.com/app/uploadtotranslationcontainer"
TRANSLATE_SUBMIT_URL = "https://www.onlinedoctranslator.com/app/translationsubmit"
PROCESS_TRANSLATION_URL = "https://www.onlinedoctranslator.com/app/processtranslationdata"
TRANSLATION_PROCESS_PAGE = "https://www.onlinedoctranslator.com/app/translationprocess-pdf"
INPUT_FILE_PATH = "document.pdf"
DOWNLOAD_DIR = Path("./indirilenler").resolve()
API_KEY = "3e71c09ed20cd28f6588180347c17070"
SOURCE_LANG = "tr"
TARGET_LANG = "en"

# ----------------------------------------------------------------------------
# CAPTCHA Solver
# ----------------------------------------------------------------------------
def solve_recaptcha(site_key, url):
    print("[INFO] 2Captcha çözüm başlatılıyor...")
    resp = requests.post("http://2captcha.com/in.php", data={
        'key': API_KEY,
        'method': 'userrecaptcha',
        'googlekey': site_key,
        'pageurl': url,
        'json': 1
    })
    request_id = resp.json()['request']
    print("[INFO] Task ID:", request_id)

    for _ in range(30):
        time.sleep(5)
        check = requests.get("http://2captcha.com/res.php", params={
            'key': API_KEY,
            'action': 'get',
            'id': request_id,
            'json': 1
        }).json()
        if check['status'] == 1:
            return check['request']
    raise Exception("CAPTCHA çözümü zaman aşımına uğradı.")

# ----------------------------------------------------------------------------
# Main
# ----------------------------------------------------------------------------
def main():
    DOWNLOAD_DIR.mkdir(parents=True, exist_ok=True)
    session = requests.Session()
    session.headers.update({
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36 Edg/135.0.0.0",
        "Accept-Language": "en-US,en;q=0.9",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8"
    })
    r = session.get(TARGET_URL)
    if r.status_code != 200:
        raise Exception("Ana sayfa yüklenemedi!")
    print("[INFO] Ana sayfa açıldı.")

    # 2. Dosyayı yükle
    with open(INPUT_FILE_PATH, "rb") as f:
        files = {
            'file': (os.path.basename(INPUT_FILE_PATH), f, 'application/pdf')
        }
        data = {
            'from': SOURCE_LANG,
            'to': TARGET_LANG,
        }
        response = session.post(UPLOAD_URL, files=files, data=data)
        if response.status_code != 200:
            print(response.text)
            raise Exception("Dosya yükleme başarısız!")
        print("[INFO] Dosya başarıyla yüklendi!")

    # 3. Şimdi reCAPTCHA iframe geldi mi diye kontrol et
    r = session.get(TARGET_URL)  # Form sayfasını tekrar oku
    soup = BeautifulSoup(r.text, "html.parser")
    iframe = soup.find("iframe", {"src": lambda x: x and "recaptcha" in x})

    if not iframe:
        raise Exception("❌ reCAPTCHA iframe bulunamadı! Dosya yükledikten sonra görünmesi lazımdı.")

    site_key = iframe['src'].split('k=')[1].split('&')[0]
    print("[INFO] Site key bulundu:", site_key)

    # 4. CAPTCHA çöz
    token = solve_recaptcha(site_key, TARGET_URL)
    print("[INFO] CAPTCHA token alındı!")

    # 5. translationsubmit (from/to dilleri ve captcha tokenı)
    session.post(TRANSLATE_SUBMIT_URL, data={
        'from': SOURCE_LANG,
        'to': TARGET_LANG,
        'g-recaptcha-response': token
    })

    # 6. İçerik gönderimi (processtranslationdata)
    session.post(PROCESS_TRANSLATION_URL, headers={
        'Content-Type': 'application/json',
        'X-Requested-With': 'XMLHttpRequest'
    }, json={
        'from': SOURCE_LANG,
        'to': TARGET_LANG,
        'destStringList': []
    })

    # 7. Çeviri işlemi için bekle
    print("[INFO] Çeviri işlemi bekleniyor...")
    time.sleep(25)

    # 8. Çeviri tamamlandıktan sonra download linkini al
    r = session.get(TRANSLATION_PROCESS_PAGE)
    if r.status_code != 200:
        raise Exception("Çeviri sayfası yüklenemedi!")

    soup = BeautifulSoup(r.text, "html.parser")
    download_link = soup.find("a", {"id": "download-link"})['href']
    full_download_url = "https://www.onlinedoctranslator.com" + download_link

    # 9. Dosyayı indir
    download_response = session.get(full_download_url)
    filename = full_download_url.split("/")[-1]
    save_path = DOWNLOAD_DIR / filename

    with open(save_path, "wb") as f:
        f.write(download_response.content)

    print(f"✅ Çevrilmiş dosya başarıyla indirildi: {save_path}")

# ----------------------------------------------------------------------------
if __name__ == "__main__":
    main()