// CSV download helpers. Two flavors:
//
//   downloadCsv(filename, rows)
//     Object-based. Headers come from Object.keys(rows[0]). Used for the
//     analytics exports (dead-stock, reorder suggestions, etc.) where we
//     just want a flat table.
//
//   downloadStructuredCsv(filename, lines)
//     Array-of-arrays. Caller controls every cell — including blank rows,
//     metadata header rows, and a totals footer. Used for the ภ.พ.30
//     สรรพากร reports where the format must include shop info above the
//     data table and a รวม row at the bottom.
//
// Both prepend a UTF-8 BOM (\uFEFF) so Excel parses Thai correctly, and
// use \r\n line endings (Windows/Excel standard — Numbers/LibreOffice
// also accept this).

const escapeCell = (v) => {
  const s = v === null || v === undefined ? '' : String(v);
  return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
};

function triggerDownload(filename, csvText) {
  const blob = new Blob(['\uFEFF' + csvText], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  // Defer revoke so Safari has time to start the download.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Object-based CSV. Skips when rows is empty/null. */
export function downloadCsv(filename, rows) {
  if (!rows?.length) return;
  const cols = Object.keys(rows[0]);
  const csv = [
    cols.join(','),
    ...rows.map((r) => cols.map((c) => escapeCell(r[c])).join(',')),
  ].join('\r\n');
  triggerDownload(filename, csv);
}

/**
 * Array-of-arrays CSV with full control over every cell.
 * @param {string} filename
 * @param {Array<Array<string|number|null>>} lines  — each inner array = one CSV line
 */
export function downloadStructuredCsv(filename, lines) {
  if (!lines?.length) return;
  const csv = lines.map((line) => line.map(escapeCell).join(',')).join('\r\n');
  triggerDownload(filename, csv);
}
