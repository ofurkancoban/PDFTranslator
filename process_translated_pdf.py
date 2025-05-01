# process_translated_pdf.py
import sys
import fitz  # PyMuPDF
from pathlib import Path

if len(sys.argv) < 5:
    print("Kullanım: python process_translated_pdf.py orijinal.pdf ceviri.pdf from_lang to_lang")
    sys.exit(1)

original_path = Path(sys.argv[1])
translated_path = Path(sys.argv[2])
from_lang = sys.argv[3]
to_lang = sys.argv[4]

cleaned_path = translated_path.with_stem(translated_path.stem + '.cleaned')
patched_path = translated_path.with_stem(translated_path.stem + '.patched')
merged_filename = f"{original_path.stem}_{from_lang}.{to_lang}_merged.pdf"
merged_path = Path(merged_filename)

# ✅ PDF doğrulama
try:
    doc = fitz.open(translated_path)
    if not doc.is_pdf:
        raise ValueError("Dosya PDF değil.")
except Exception as e:
    print(f"❌ Geçersiz PDF dosyası: {translated_path}")
    print("Hata:", e)
    sys.exit(1)

# 1️⃣ Reklam metnini temizle
print("🧼 Reklam temizleniyor...")
for page in doc:
    blocks = page.get_text("blocks")
    for block in blocks:
        if "onlinedoctranslator.com" in block[4].lower():
            rect = fitz.Rect(block[:4])
            page.add_redact_annot(rect, fill=(1,1,1))
    page.apply_redactions()

doc.save(cleaned_path)
print(f"✅ Reklam temizlendi → {cleaned_path}")

# 2️⃣ Orijinalin ilk sayfasının üst kısmını al, çeviri üstüne bindir
print("🖼 Üst bölge orijinalden alınıyor...")
orig = fitz.open(original_path)
ceviri = fitz.open(cleaned_path)

width, height = orig[0].rect.width, orig[0].rect.height
clip_rect = fitz.Rect(0, 0, width, 20)
pix = orig[0].get_pixmap(clip=clip_rect)
pix_path = "patch.png"
pix.save(pix_path)

img_rect = fitz.Rect(0, 0, width, 20)
ceviri[0].insert_image(img_rect, filename=pix_path)
ceviri.save(patched_path)
print("✅ Üst bölge bindirildi →", patched_path)

# 3️⃣ Orijinal ve çeviriyi birleştir (orijinal önce: solda veya üstte)
print("📘 Sayfa boyutuna göre birleştirme yapılıyor...")
merged = fitz.open()
page_count = min(len(orig), len(ceviri))

is_portrait = orig[0].rect.width < orig[0].rect.height

for i in range(page_count):
    w1, h1 = orig[i].rect.width, orig[i].rect.height
    w2, h2 = ceviri[i].rect.width, ceviri[i].rect.height

    if is_portrait:
        # Yan yana: orijinal solda, çeviri sağda
        new_width = w1 + w2
        new_height = max(h1, h2)
        new_page = merged.new_page(width=new_width, height=new_height)
        new_page.show_pdf_page(fitz.Rect(0, 0, w1, h1), orig, i)
        new_page.show_pdf_page(fitz.Rect(w1, 0, new_width, h2), ceviri, i)
        new_page.draw_line(p1=(w1, 0), p2=(w1, new_height), color=(0.6, 0.6, 0.6), width=1.5)
    else:
        # Alt alta: orijinal üstte, çeviri altta
        new_width = max(w1, w2)
        new_height = h1 + h2
        new_page = merged.new_page(width=new_width, height=new_height)
        new_page.show_pdf_page(fitz.Rect(0, 0, w1, h1), orig, i)
        new_page.show_pdf_page(fitz.Rect(0, h1, w2, h1 + h2), ceviri, i)
        new_page.draw_line(p1=(0, h1), p2=(new_width, h1), color=(0.6, 0.6, 0.6), width=1.5)

merged.save(merged_path)
print(f"🎉 merged PDF oluşturuldu: {merged_path}")

# Geçici dosyayı temizle
try:
    Path(pix_path).unlink()
    print("🗑 Geçici patch.png silindi.")
except Exception as e:
    print("⚠️ patch.png silinemedi:", e)