/**
 * Minimal RFC 4180 CSV parser: quoted fields (with embedded commas,
 * newlines, and "" as an escaped quote), CRLF/LF line endings, and
 * trailing blank lines ignored. No external dependency for what is a
 * handful of columns (see bulk-receive CSV upload).
 */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  let i = 0;

  function endField() {
    row.push(field);
    field = "";
  }

  function endRow() {
    endField();
    rows.push(row);
    row = [];
  }

  while (i < text.length) {
    const char = text[i];

    if (inQuotes) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i += 1;
        continue;
      }
      field += char;
      i += 1;
      continue;
    }

    if (char === '"') {
      inQuotes = true;
      i += 1;
      continue;
    }

    if (char === ",") {
      endField();
      i += 1;
      continue;
    }

    if (char === "\r") {
      i += 1;
      continue;
    }

    if (char === "\n") {
      endRow();
      i += 1;
      continue;
    }

    field += char;
    i += 1;
  }

  // Only flush a final unterminated row if it actually holds content --
  // otherwise a trailing newline (or empty input) would emit a phantom
  // row of one empty field.
  if (field !== "" || row.length > 0) {
    endRow();
  }

  return rows.filter((r) => !(r.length === 1 && r[0] === ""));
}
