#!/usr/bin/env python3
"""Build src/data/product-image-fallbacks.json from the price-list spreadsheet.

Usage: python3 scripts/build-image-fallbacks.py "<path to Web ราคาสินค้า Database.xlsx>"

Only the SKU and URL columns are read. Keys are normalised like
fuzzy-match.normalizeCode (upper-case, no spaces/dashes). URLs on the common
casio.com prefix are stored without it to keep the bundle small.
"""
import json, re, sys
import openpyxl

PREFIX = 'https://www.casio.com/content/dam/casio/product-info/locales/th/th/timepiece/product/watch/'
OUT = 'src/data/product-image-fallbacks.json'

ws = openpyxl.load_workbook(sys.argv[1], read_only=True).worksheets[0]
rows = ws.iter_rows(values_only=True)
head = [str(h or '').strip().upper() for h in next(rows)]
sku_i, url_i = head.index('SKU'), head.index('URL')

out = {}
for r in rows:
    sku, url = r[sku_i], r[url_i]
    if not sku or not url:
        continue
    key = re.sub(r'[\s-]', '', str(sku).upper())
    url = str(url).strip()
    if not url.startswith('http'):
        continue
    out.setdefault(key, url[len(PREFIX):] if url.startswith(PREFIX) else url)

with open(OUT, 'w') as f:
    json.dump({'prefix': PREFIX, 'images': dict(sorted(out.items()))}, f, ensure_ascii=False, separators=(',', ':'))
print(f'{len(out)} models -> {OUT}')
