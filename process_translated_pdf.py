
import sys
import fitz  # PyMuPDF
from pathlib import Path
import re

if len(sys.argv) < 4:
    print("Usage: python process_translated_pdf.py original.pdf translated.pdf to_lang")
    sys.exit(1)

original_path = Path(sys.argv[1])
translated_path = Path(sys.argv[2])
to_lang = sys.argv[3]

match = re.search(r'\.([a-z]{2})\.([a-z]{2})\.pdf$', translated_path.name.lower())
if match:
    from_lang = match.group(1)
    print(f"🌐 Detected source language: {from_lang}")
else:
    from_lang = "auto"

patched_filename = f"{original_path.stem}_{from_lang}.{to_lang}_single.pdf"
patched_path = translated_path.parent / patched_filename

merged_filename = f"{original_path.stem}_{from_lang}.{to_lang}_merged.pdf"
merged_path = translated_path.parent / merged_filename

try:
    doc = fitz.open(translated_path)
    if not doc.is_pdf or doc.page_count == 0:
        raise ValueError("Invalid or empty PDF.")
except Exception as e:
    print(f"❌ Invalid translated PDF: {translated_path}\nError:", e)
    sys.exit(1)

print("🧼 Removing watermark...")
for page in doc:
    blocks = page.get_text("blocks")
    for block in blocks:
        if "onlinedoctranslator.com" in block[4].lower():
            rect = fitz.Rect(block[:4])
            page.add_redact_annot(rect, fill=(1, 1, 1))
    page.apply_redactions()

print("🖼 Extracting and overlaying header...")
orig = fitz.open(original_path)
width, height = orig[0].rect.width, orig[0].rect.height
clip_rect = fitz.Rect(0, 0, width, 20)
pix = orig[0].get_pixmap(clip=clip_rect)
pix_path = "patch.png"
pix.save(pix_path)

img_rect = fitz.Rect(0, 0, width, 20)
doc[0].insert_image(img_rect, filename=pix_path)
doc.save(patched_path)
print(f"✅ Header added → {patched_path}")

print("📘 Merging PDFs...")
patched = fitz.open(patched_path)
merged = fitz.open()
page_count = min(len(orig), len(patched))
is_portrait = orig[0].rect.width < orig[0].rect.height

for i in range(page_count):
    w1, h1 = orig[i].rect.width, orig[i].rect.height
    w2, h2 = patched[i].rect.width, patched[i].rect.height

    if is_portrait:
        new_width = w1 + w2
        new_height = max(h1, h2)
        new_page = merged.new_page(width=new_width, height=new_height)
        new_page.show_pdf_page(fitz.Rect(0, 0, w1, h1), orig, i)
        new_page.show_pdf_page(fitz.Rect(w1, 0, new_width, h2), patched, i)
        new_page.draw_line(p1=(w1, 0), p2=(w1, new_height), color=(0.6, 0.6, 0.6), width=1.5)
    else:
        new_width = max(w1, w2)
        new_height = h1 + h2
        new_page = merged.new_page(width=new_width, height=new_height)
        new_page.show_pdf_page(fitz.Rect(0, 0, w1, h1), orig, i)
        new_page.show_pdf_page(fitz.Rect(0, h1, w2, h1 + h2), patched, i)
        new_page.draw_line(p1=(0, h1), p2=(new_width, h1), color=(0.6, 0.6, 0.6), width=1.5)

merged.save(merged_path)
print(f"🎉 Merged PDF created: {merged_path}")

try:
    Path(pix_path).unlink()
    translated_path.unlink()
    print("🗑 Cleaned up temporary files.")
except Exception as e:
    print("⚠️ Cleanup error:", e)
