#!/usr/bin/env node
/** Split combined main.jsx into web-only or stock-only variants for separate PRs. */
import { readFileSync, writeFileSync } from 'node:fs';
import { execSync } from 'node:child_process';

const mode = process.argv[2];
if (mode !== 'web' && mode !== 'stock') {
  console.error('Usage: node scripts/split-main-for-prs.mjs <web|stock>');
  process.exit(1);
}

const bothPath = process.argv[3] || '/tmp/main-both.jsx';
const outPath = process.argv[4] || 'src/main.jsx';
const both = readFileSync(bothPath, 'utf8');
const origin = execSync('git show origin/main:src/main.jsx', { encoding: 'utf8' });

function extractBetween(src, start, end) {
  const i = src.indexOf(start);
  const j = src.indexOf(end, i);
  if (i < 0 || j < 0) throw new Error(`Marker not found: ${JSON.stringify(start)}`);
  return src.slice(i, j);
}

function sliceReplace(src, start, end, replacement) {
  const i = src.indexOf(start);
  const j = src.indexOf(end, i);
  if (i < 0 || j < 0) throw new Error(`Marker not found: ${JSON.stringify(start)} -> ${JSON.stringify(end)}`);
  return src.slice(0, i) + replacement + src.slice(j);
}

function lineStart(src, needle, from = 0) {
  const i = src.indexOf(needle, from);
  if (i < 0) throw new Error(`Needle not found: ${JSON.stringify(needle)}`);
  return src.lastIndexOf('\n', i) + 1;
}

const originToolbar = extractBetween(
  origin,
  '{/* Top bar: search + sort + advanced filter button.',
  '{/* Brand chips (top-level facet) */}',
);

const editStockNeedle = 'running average override), stock read-only.';
const editStockStart = origin.slice(
  lineStart(origin, editStockNeedle),
  origin.indexOf(editStockNeedle) + editStockNeedle.length + 1,
);
const costHistoryComment = origin.indexOf('ProductCostHistory productId={draft.id}', origin.indexOf(editStockNeedle));
const editStockEnd = origin.lastIndexOf('{/*', costHistoryComment);
const originEditStock = origin.slice(origin.indexOf(editStockStart), editStockEnd);
const editStockEndMarker = origin.slice(editStockEnd, origin.indexOf('{/*', editStockEnd + 1));

const originStockPanel = extractBetween(
  origin,
  'const STOCK_REASON_LABELS = {',
  'function ProductCostHistory',
);

let out = both;

if (mode === 'web') {
  out = out
    .replace("import { parseManualAdjustNotes } from './lib/stock-manual-adjust.js';\n", '')
    .replace("import StockAdjustModal from './components/products/StockAdjustModal.jsx';\n", '')
    .replace('  const [stockAdjustOpen, setStockAdjustOpen] = useState(false);\n', '')
    .replace('  const [stockHistoryReload, setStockHistoryReload] = useState(0);\n', '')
    .replace('    setStockAdjustOpen(false);\n', '');

  out = sliceReplace(
    out,
    '{/* Top bar: search + sort + filter + export.',
    '{/* Brand chips (top-level facet) */}',
    originToolbar,
  );

  out = sliceReplace(
    out,
    'const STOCK_REASON_LABELS = {',
    'function ProductCostHistory',
    originStockPanel,
  );

  out = sliceReplace(out, editStockStart, editStockEndMarker, originEditStock);

  out = out.replace(
    '<StockHistoryPanel productId={draft.id} reloadToken={stockHistoryReload}/>',
    '<StockHistoryPanel productId={draft.id}/>',
  );

  out = sliceReplace(
    out,
    '    <StockAdjustModal',
    '    <BarcodeScannerModal',
    '',
  );
} else {
  out = out
    .replace("import { findPendingWebOverlap, formatWebOverlapWarning } from './lib/web-checkout-guard.js';\n", '')
    .replace("import WebConfirmPanel from './components/pos/WebConfirmPanel.jsx';\n", '')
    .replace('              <WebConfirmPanel toast={toast.push} />\n', '')
    .replace('  const [webOverlap, setWebOverlap] = useState(null);\n', '')
    .replace(
      '  const submit = async ({ skipTikTokOverlapGuard = false, skipWebOverlapGuard = false } = {}) => {',
      '  const submit = async ({ skipTikTokOverlapGuard = false } = {}) => {',
    );

  out = sliceReplace(
    out,
    "      if (!skipWebOverlapGuard && cart.some(l => l.product_id)) {",
    '      const grandR = roundMoney(grand);',
    '',
  );

  out = sliceReplace(
    out,
    '  const confirmWebOverlapProceed = () => {',
    '  const SearchInput = (',
    '',
  );

  out = sliceReplace(
    out,
    '      <Modal\n        open={Boolean(webOverlap?.length)}',
    '      {/* Desktop page header',
    '',
  );

  out = out.replace(
    '<WebConfirmPanel toast={toast.push} onConfirmed={setReceiptOrderId}/>',
    '',
  );
}

writeFileSync(outPath, out);
console.log(`Wrote ${mode}-only ${outPath}`);
