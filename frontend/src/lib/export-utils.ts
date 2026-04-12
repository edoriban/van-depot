import * as XLSX from 'xlsx';

interface ExportColumn<T> {
  key: keyof T | string;
  label: string;
  format?: (value: unknown, row: T) => string | number;
}

export function exportToExcel<T extends Record<string, unknown>>(
  data: T[],
  filename: string,
  sheetName: string,
  columns: ExportColumn<T>[]
): void {
  const rows = data.map(row =>
    Object.fromEntries(
      columns.map(col => {
        const value = col.key.toString().includes('.')
          ? col.key.toString().split('.').reduce((obj, k) => (obj as Record<string, unknown>)?.[k], row as unknown)
          : row[col.key as keyof T];
        return [col.label, col.format ? col.format(value, row) : (value ?? '')];
      })
    )
  );

  const ws = XLSX.utils.json_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, sheetName);

  const date = new Date().toISOString().split('T')[0];
  XLSX.writeFile(wb, `${filename}_${date}.xlsx`);
}
