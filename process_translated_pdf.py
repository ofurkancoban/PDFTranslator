import sys
import fitz  # PyMuPDF
from pathlib import Path
import re
import os

if len(sys.argv) < 4:
    print("Usage: python process_translated_pdf.py original.pdf translated.pdf to_lang")
    sys.exit(1)

original_path = Path(sys.argv[1])
translated_path = Path(sys.argv[2])
to_lang = sys.argv[3]

# Get the base filename without extension
base_filename = os.path.splitext(os.path.basename(translated_path))[0]
# Extract language codes from filename (e.g., "filename.en.de" -> "en" and "de")
lang_codes = base_filename.split('.')[-2:]
if len(lang_codes) == 2:
    source_lang, target_lang = lang_codes
else:
    print("⚠️ Could not detect source language from filename. Using 'auto'.")
    source_lang = 'auto'
    target_lang = to_lang

# Get original filename from the original path
original_filename = os.path.splitext(os.path.basename(original_path))[0]

# Create output filenames
single_output = f"{original_filename}_{source_lang}.{target_lang}_single.pdf"
merged_output = f"{original_filename}_{source_lang}.{target_lang}_merged.pdf"

# Output paths
patched_filename = single_output
patched_path = translated_path.parent / patched_filename

merged_filename = merged_output
merged_path = translated_path.parent / merged_filename

print(f"📝 Generated filenames:")
print(f"  - Single: {patched_filename}")
print(f"  - Merged: {merged_filename}")

# ✅ Validate PDF
try:
    doc = fitz.open(translated_path)
    if not doc.is_pdf or doc.page_count == 0:
        raise ValueError("Invalid or empty PDF.")
except Exception as e:
    print(f"❌ Invalid translated PDF file: {translated_path}")
    print("Error:", e)
    sys.exit(1)

# 🧼 Remove watermark
print("🧼 Removing watermark text...")
for page in doc:
    blocks = page.get_text("blocks")
    for block in blocks:
        if "onlinedoctranslator.com" in block[4].lower():
            rect = fitz.Rect(block[:4])
            page.add_redact_annot(rect, fill=(1, 1, 1))
    page.apply_redactions()

# 🖼 Overlay header from original
print("🖼 Extracting and overlaying top header from original...")
orig = fitz.open(original_path)
width, height = orig[0].rect.width, orig[0].rect.height
clip_rect = fitz.Rect(0, 0, width, 20)
pix = orig[0].get_pixmap(clip=clip_rect)
pix_path = "patch.png"
pix.save(pix_path)

img_rect = fitz.Rect(0, 0, width, 20)
doc[0].insert_image(img_rect, filename=pix_path)
doc.save(patched_path)
print(f"✅ Watermark removed and header added → {patched_path}")

# 📘 Merge both PDFs
print("📘 Merging original and translated PDFs...")
patched = fitz.open(patched_path)
merged = fitz.open()
page_count = min(len(orig), len(patched))
is_portrait = orig[0].rect.width < orig[0].rect.height

for i in range(page_count):
    w1, h1 = orig[i].rect.width, orig[i].rect.height
    w2, h2 = patched[i].rect.width, patched[i].rect.height

    if is_portrait:
        # Side-by-side layout
        new_width = w1 + w2
        new_height = max(h1, h2)
        new_page = merged.new_page(width=new_width, height=new_height)
        new_page.show_pdf_page(fitz.Rect(0, 0, w1, h1), orig, i)
        new_page.show_pdf_page(fitz.Rect(w1, 0, new_width, h2), patched, i)
        new_page.draw_line(p1=(w1, 0), p2=(w1, new_height), color=(0.6, 0.6, 0.6), width=1.5)
    else:
        # Top-bottom layout
        new_width = max(w1, w2)
        new_height = h1 + h2
        new_page = merged.new_page(width=new_width, height=new_height)
        new_page.show_pdf_page(fitz.Rect(0, 0, w1, h1), orig, i)
        new_page.show_pdf_page(fitz.Rect(0, h1, w2, h1 + h2), patched, i)
        new_page.draw_line(p1=(0, h1), p2=(new_width, h1), color=(0.6, 0.6, 0.6), width=1.5)

merged.save(merged_path)
print(f"🎉 Merged PDF created: {merged_path}")

# 🧹 Cleanup
try:
    Path(pix_path).unlink()
    print("🗑 Deleted temporary patch.png")
except Exception as e:
    print(f"⚠️ Could not delete patch.png: {e}")

try:
    translated_path.unlink()
    print(f"🗑 Deleted temporary translated PDF: {translated_path.name}")
except Exception as e:
    print(f"⚠️ Could not delete {translated_path.name}: {e}")