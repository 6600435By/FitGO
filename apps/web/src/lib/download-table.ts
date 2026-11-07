/** Client-side CSV / Excel (SpreadsheetML .xls) downloads without exceljs. */

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function escapeCsv(value: string | number | null | undefined): string {
  const s = value == null ? '' : String(value);
  return `"${s.replace(/"/g, '""')}"`;
}

function escapeXml(value: string | number | null | undefined): string {
  const s = value == null ? '' : String(value);
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function downloadCsv(
  headers: string[],
  rows: Array<Array<string | number | null | undefined>>,
  filename: string,
) {
  const lines = [
    headers.map(escapeCsv).join(','),
    ...rows.map((row) => row.map(escapeCsv).join(',')),
  ];
  // BOM so Excel opens UTF-8 Cyrillic correctly
  const blob = new Blob(['\uFEFF' + lines.join('\n')], {
    type: 'text/csv;charset=utf-8',
  });
  downloadBlob(blob, filename.endsWith('.csv') ? filename : `${filename}.csv`);
}

/** SpreadsheetML that Excel / Numbers open as a workbook. */
export function downloadExcel(
  headers: string[],
  rows: Array<Array<string | number | null | undefined>>,
  filename: string,
  sheetName = 'Sheet1',
) {
  const headerCells = headers
    .map((h) => `<Cell><Data ss:Type="String">${escapeXml(h)}</Data></Cell>`)
    .join('');
  const body = rows
    .map((row) => {
      const cells = row
        .map((cell) => {
          if (typeof cell === 'number' && Number.isFinite(cell)) {
            return `<Cell><Data ss:Type="Number">${cell}</Data></Cell>`;
          }
          return `<Cell><Data ss:Type="String">${escapeXml(cell)}</Data></Cell>`;
        })
        .join('');
      return `<Row>${cells}</Row>`;
    })
    .join('');

  const xml = `<?xml version="1.0"?>
<?mso-application progid="Excel.Sheet"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"
 xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">
 <Worksheet ss:Name="${escapeXml(sheetName)}">
  <Table>
   <Row>${headerCells}</Row>
   ${body}
  </Table>
 </Worksheet>
</Workbook>`;

  const blob = new Blob([xml], { type: 'application/vnd.ms-excel' });
  const name = filename.replace(/\.(csv|xlsx|xls)$/i, '');
  downloadBlob(blob, `${name}.xls`);
}
