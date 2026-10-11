export function parseCsv(text: string): Record<string, string>[] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let inQuotes = false;
  const input = text.replace(/^\uFEFF/, '');
  for (let i = 0; i < input.length; i++) {
    const ch = input[i];
    if (inQuotes) {
      if (ch === '"') {
        if (input[i + 1] === '"') {
          cell += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        cell += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      row.push(cell);
      cell = '';
    } else if (ch === '\n') {
      row.push(cell.replace(/\r$/, ''));
      if (row.some((value) => value.trim() !== '')) rows.push(row);
      row = [];
      cell = '';
    } else {
      cell += ch;
    }
  }
  if (cell || row.length) {
    row.push(cell.replace(/\r$/, ''));
    if (row.some((value) => value.trim() !== '')) rows.push(row);
  }
  if (rows.length === 0) return [];
  const headers = rows[0].map((h) => h.trim().toLowerCase());
  return rows.slice(1).map((values) => {
    const record: Record<string, string> = {};
    headers.forEach((header, index) => {
      record[header] = (values[index] ?? '').trim();
    });
    return record;
  });
}

export function getField(row: Record<string, string>, ...names: string[]) {
  for (const name of names) {
    const key = name.toLowerCase();
    if (row[key] !== undefined && row[key] !== '') return row[key];
  }
  return '';
}

/**
 * 把订单 CSV 收成「一笔订单、多行商品」。
 * Shopify 导出有两种写法：后续行重复订单号，或把订单号留空。
 */
export function groupOrderRows(rows: Record<string, string>[]) {
  const groups: Record<string, string>[][] = [];
  let current: Record<string, string>[] | null = null;
  for (const row of rows) {
    const name = getField(row, 'name');
    if (!name) {
      if (current && getField(row, 'lineitem name')) current.push(row);
      continue;
    }
    if (!current || getField(current[0], 'name') !== name) {
      current = [row];
      groups.push(current);
    } else {
      current.push(row);
    }
  }
  return groups;
}

export function moneyToCents(value: string) {
  if (!value) return 0;
  const n = Number(value.replace(/[^0-9.-]/g, ''));
  if (Number.isNaN(n)) return 0;
  return Math.round(n * 100);
}

export function categoryOf(title: string) {
  const t = title.toLowerCase();
  if (t.includes('litter') || t.includes('arena')) return 'cat_litter';
  if (t.includes('dog')) return 'dog_food';
  if (t.includes('chew') || t.includes('toy') || t.includes('catnip')) return 'treats';
  return 'cat_food';
}

export function inferLanguage(tags: string, country: string) {
  const tag = tags.toLowerCase();
  if (tag.includes('lang:es')) return 'es';
  if (tag.includes('lang:en')) return 'en';
  if (['MX', 'ES', 'AR', 'CO', 'CL', 'PE'].includes(country.toUpperCase())) return 'es';
  return 'en';
}

export function daysBetween(from: string, to: string) {
  const a = Date.parse(from.slice(0, 10) + 'T00:00:00Z');
  const b = Date.parse(to.slice(0, 10) + 'T00:00:00Z');
  return Math.floor((b - a) / 86400000);
}
