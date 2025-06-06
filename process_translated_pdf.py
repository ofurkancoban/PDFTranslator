import sys
import fitz  # PyMuPDF
from pathlib import Path
import re
from dotenv import load_dotenv
import os
import tempfile
import pikepdf
from pypdf import PdfReader, PdfWriter, Transformation

# --- KOŞULLU NORMALİZE & ROTATE SİSTEMİ ---

def box_tuple(box):
    return tuple(float(x) for x in box)

def is_problematic_page(page):
    mediabox = box_tuple(page.mediabox)
    cropbox = box_tuple(page.cropbox)
    rotate = page.get('/Rotate', 0)
    return mediabox != cropbox or rotate != 0

def normalize_pdf(input_path, temp_output):
    with pikepdf.open(input_path) as pdf:
        new_pdf = pikepdf.Pdf.new()
        for page in pdf.pages:
            if '/Rotate' in page:
                del page['/Rotate']
            if '/CropBox' in page and page['/CropBox'] != page['/MediaBox']:
                page['/MediaBox'] = page['/CropBox']
                del page['/CropBox']
            new_pdf.pages.append(page)
        new_pdf.Root.Info = pikepdf.Dictionary()
        new_pdf.save(temp_output)

def rotate_pdf_left_90_conditional(orig_input_path, input_path, output_path):
    orig_reader = PdfReader(orig_input_path)
    reader = PdfReader(input_path)
    writer = PdfWriter()
    for orig_page, page in zip(orig_reader.pages, reader.pages):
        if is_problematic_page(orig_page):
            width = float(page.mediabox.width)
            height = float(page.mediabox.height)
            tf = Transformation().rotate(-90).translate(tx=0, ty=width)
            page.add_transformation(tf)
            page.mediabox.upper_right = (height, width)
            page.cropbox.upper_right = (height, width)
            page.rotate = 0
        writer.add_page(page)
    with open(output_path, "wb") as f:
        writer.write(f)

def normalize_and_rotate_conditional(input_pdf_path):
    """
    Eğer problemli bir sayfa varsa PDF'yi normalize ve döndür.
    Yoksa girdi dosyasını aynen döndür.
    Her durumda dönen dosya path'i kesinlikle yeni bir temp dosya olur!
    """
    with tempfile.NamedTemporaryFile(delete=False, suffix=".pdf") as tmp_norm:
        temp_norm_path = tmp_norm.name

    with tempfile.NamedTemporaryFile(delete=False, suffix=".pdf") as tmp_final:
        temp_final_path = tmp_final.name

    try:
        need_process = False
        with PdfReader(input_pdf_path) as reader:
            for page in reader.pages:
                if is_problematic_page(page):
                    need_process = True
                    break

        if need_process:
            normalize_pdf(input_pdf_path, temp_norm_path)
            rotate_pdf_left_90_conditional(input_pdf_path, temp_norm_path, temp_final_path)
            os.remove(temp_norm_path)
            return temp_final_path
        else:
            # Hiç işlem yoksa, orijinal dosyanın bir kopyasını döndür
            with open(input_pdf_path, "rb") as src, open(temp_final_path, "wb") as dst:
                dst.write(src.read())
            return temp_final_path
    except Exception as e:
        # Temp dosyaları temizle
        if os.path.exists(temp_norm_path): os.remove(temp_norm_path)
        if os.path.exists(temp_final_path): os.remove(temp_final_path)
        raise e

# --- ANA PDF SCRIPTİ ---

load_dotenv()
DOM = os.getenv("DOM")

if len(sys.argv) < 4:
    print("Usage: python process_translated_pdf.py original.pdf translated.pdf to_lang")
    sys.exit(1)

try:
    original_path = Path(sys.argv[1])
    translated_path = Path(sys.argv[2])
    to_lang = sys.argv[3]

    if not original_path.exists():
        raise FileNotFoundError(f"Original file not found: {original_path}")
    if not translated_path.exists():
        raise FileNotFoundError(f"Translated file not found: {translated_path}")

    # --- PDF'LERİ KOŞULLU NORMALİZE ET ---
    normalized_original_path = normalize_and_rotate_conditional(str(original_path))
    normalized_translated_path = normalize_and_rotate_conditional(str(translated_path))

    # ✅ Dosya adı analiz (ör: abc_tr.it.pdf)
    translated_name = translated_path.name
    lang_match = re.search(r'^(.+)_([a-z]{2})\.([a-z]{2})\.pdf$', translated_name)

    if lang_match:
        original_stem = lang_match.group(1)
        from_lang = lang_match.group(2)
        target_lang = lang_match.group(3)
    else:
        original_stem = original_path.stem
        from_lang = "auto"
        target_lang = to_lang
        print("⚠️ Could not detect language codes from translated filename.")

    # ✅ Doğru çıktı adları
    single_output = f"{original_stem}_{from_lang}.{target_lang}_single.pdf"
    merged_output = f"{original_stem}_{from_lang}.{target_lang}_merged.pdf"
    patched_path = translated_path.parent / single_output
    merged_path = translated_path.parent / merged_output

    print(f"Single: {single_output}")
    print(f"Merged: {merged_output}")

    # ✅ Translated PDF aç ve doğrula
    doc = fitz.open(normalized_translated_path)
    if not doc.is_pdf or doc.page_count == 0:
        raise ValueError("Invalid or empty PDF.")
    print(f"✅ PDF is valid with {doc.page_count} pages")

    # 🧼 Watermark temizle
    print("🧼 Removing watermark text...")
    for page in doc:
        for block in page.get_text("blocks"):
            if DOM.lower() in block[4].lower():
                rect = fitz.Rect(block[:4])
                page.add_redact_annot(rect, fill=(1, 1, 1))
        page.apply_redactions()

    # 🖼 Başlık görüntüsünü al ve yerleştir
    print("🖼 Extracting and overlaying top header from original...")
    orig = fitz.open(normalized_original_path)
    width, height = orig[0].rect.width, orig[0].rect.height
    clip_rect = fitz.Rect(0, 0, width, 20)
    pix = orig[0].get_pixmap(clip=clip_rect)
    pix_path = "patch.png"
    pix.save(pix_path)

    img_rect = fitz.Rect(0, 0, width, 20)
    doc[0].insert_image(img_rect, filename=pix_path)
    doc.save(patched_path)
    print(f"✅ Watermark removed and header added → {patched_path.name}")

    # 📘 Orijinal + çeviri PDF'yi birleştir
    print("📘 Merging original and translated PDFs...")
    patched = fitz.open(patched_path)
    merged = fitz.open()
    page_count = min(len(orig), len(patched))
    is_portrait = orig[0].rect.width < orig[0].rect.height

    for i in range(page_count):
        w1, h1 = orig[i].rect.width, orig[i].rect.height
        w2, h2 = patched[i].rect.width, patched[i].rect.height

        if is_portrait:
            new_page = merged.new_page(width=w1 + w2, height=max(h1, h2))
            new_page.show_pdf_page(fitz.Rect(0, 0, w1, h1), orig, i)
            new_page.show_pdf_page(fitz.Rect(w1, 0, w1 + w2, h2), patched, i)
            new_page.draw_line(p1=(w1, 0), p2=(w1, max(h1, h2)), color=(0.6, 0.6, 0.6), width=1.5)
        else:
            new_page = merged.new_page(width=max(w1, w2), height=h1 + h2)
            new_page.show_pdf_page(fitz.Rect(0, 0, w1, h1), orig, i)
            new_page.show_pdf_page(fitz.Rect(0, h1, w2, h1 + h2), patched, i)
            new_page.draw_line(p1=(0, h1), p2=(max(w1, w2), h1), color=(0.6, 0.6, 0.6), width=1.5)

    merged.save(merged_path)
    print(f"🎉 Merged PDF created: {merged_path.name}")

    # 🧹 Geçici dosyaları sil
    try:
        Path(pix_path).unlink()
        print("🗑 Deleted temporary patch.png")
    except Exception as e:
        print(f"⚠️ Could not delete patch.png: {str(e)}")

    try:
        translated_path.unlink()
        print(f"🗑 Deleted temporary translated PDF: {translated_path.name}")
    except Exception as e:
        print(f"⚠️ Could not delete {translated_path.name}: {str(e)}")

    # --- Normalize edilen temp dosyalarını temizle
    for tmpf in [normalized_original_path, normalized_translated_path]:
        try:
            os.remove(tmpf)
        except Exception:
            pass

except Exception as e:
    print(f"❌ Fatal error: {str(e)}")
    sys.exit(1)