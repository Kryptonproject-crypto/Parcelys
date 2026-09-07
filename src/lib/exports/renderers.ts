import 'server-only';
import type { ExportDataset } from '@/lib/exports/datasets';

/**
 * Génération CSV compatible Excel francophone : séparateur `;` et BOM UTF-8
 * (sans lui, Excel interprète mal les accents).
 */
export function renderCsv(dataset: ExportDataset): Buffer {
  const escape = (value: string | number): string => {
    const text = String(value ?? '');
    // Neutralise l'injection de formule dans les tableurs.
    const safe = /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
    return `"${safe.replace(/"/g, '""')}"`;
  };

  const lines: string[] = [];
  lines.push(dataset.columns.map((c) => escape(c.header)).join(';'));
  for (const row of dataset.rows) {
    lines.push(dataset.columns.map((c) => escape(row[c.key] ?? '')).join(';'));
  }

  const utf8Bom = Buffer.from([0xef, 0xbb, 0xbf]);
  return Buffer.concat([utf8Bom, Buffer.from(lines.join('\r\n'), 'utf8')]);
}

export async function renderXlsx(dataset: ExportDataset): Promise<Buffer> {
  const ExcelJS = (await import('exceljs')).default;
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Parcelys';
  workbook.created = new Date();

  const sheet = workbook.addWorksheet(dataset.title.slice(0, 30), {
    views: [{ state: 'frozen', ySplit: 3 }],
  });

  const lastColumn = String.fromCharCode(64 + Math.min(dataset.columns.length, 26));

  sheet.mergeCells(`A1:${lastColumn}1`);
  const titleCell = sheet.getCell('A1');
  titleCell.value = dataset.title;
  titleCell.font = { size: 15, bold: true, color: { argb: 'FF1F3A20' } };

  sheet.mergeCells(`A2:${lastColumn}2`);
  const subtitleCell = sheet.getCell('A2');
  subtitleCell.value = `${dataset.subtitle} — édité le ${new Date().toLocaleDateString('fr-FR')}`;
  subtitleCell.font = { size: 10, color: { argb: 'FF5B6B55' } };

  const headerRow = sheet.getRow(3);
  dataset.columns.forEach((column, index) => {
    const cell = headerRow.getCell(index + 1);
    cell.value = column.header;
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF2F6B34' } };
    cell.alignment = { vertical: 'middle', wrapText: true };
    sheet.getColumn(index + 1).width = column.width ?? 18;
  });
  headerRow.height = 24;
  headerRow.commit();

  for (const row of dataset.rows) {
    sheet.addRow(dataset.columns.map((c) => row[c.key] ?? ''));
  }

  sheet.autoFilter = {
    from: { row: 3, column: 1 },
    to: { row: 3, column: dataset.columns.length },
  };

  if (dataset.footnote) {
    const noteRow = sheet.addRow([]);
    sheet.addRow([dataset.footnote]);
    sheet.getRow(noteRow.number + 1).font = { italic: true, size: 9, color: { argb: 'FF5B6B55' } };
  }

  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
}

/**
 * PDF paysage généré avec PDFKit. La police Helvetica intégrée couvre le
 * latin-1 ; les caractères hors jeu (₂, ₅) sont translittérés à l'affichage.
 */
export async function renderPdf(dataset: ExportDataset): Promise<Buffer> {
  const PDFDocument = (await import('pdfkit')).default;

  const doc = new PDFDocument({
    size: 'A4',
    layout: 'landscape',
    margins: { top: 40, bottom: 46, left: 32, right: 32 },
    bufferPages: true,
    info: { Title: dataset.title, Author: 'Parcelys' },
  });

  const chunks: Buffer[] = [];
  doc.on('data', (chunk: Buffer) => chunks.push(chunk));
  const done = new Promise<Buffer>((resolve) => {
    doc.on('end', () => resolve(Buffer.concat(chunks)));
  });

  const pageWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;
  const totalWeight = dataset.columns.reduce((sum, c) => sum + (c.width ?? 18), 0);
  const widths = dataset.columns.map((c) => ((c.width ?? 18) / totalWeight) * pageWidth);

  const sanitize = (value: string | number): string =>
    String(value ?? '')
      .replace(/₂/g, '2')
      .replace(/₅/g, '5')
      .replace(/[‘’]/g, "'")
      .replace(/[“”]/g, '"');

  const drawHeader = (): void => {
    doc.fillColor('#1f3a20').fontSize(16).font('Helvetica-Bold').text(dataset.title);
    doc
      .fillColor('#5b6b55')
      .fontSize(9)
      .font('Helvetica')
      .text(`${sanitize(dataset.subtitle)} — édité le ${new Date().toLocaleDateString('fr-FR')}`);
    doc.moveDown(0.6);
  };

  const drawTableHeader = (): void => {
    const y = doc.y;
    doc.rect(doc.page.margins.left, y, pageWidth, 18).fill('#2f6b34');
    doc.fillColor('#ffffff').fontSize(7.5).font('Helvetica-Bold');

    let x = doc.page.margins.left;
    dataset.columns.forEach((column, i) => {
      const width = widths[i] ?? 40;
      doc.text(sanitize(column.header), x + 3, y + 5, {
        width: width - 6,
        lineBreak: false,
        ellipsis: true,
      });
      x += width;
    });

    doc.y = y + 20;
    doc.fillColor('#1f2a1c').font('Helvetica').fontSize(7.5);
  };

  drawHeader();
  drawTableHeader();

  const bottomLimit = doc.page.height - doc.page.margins.bottom - 16;
  let striped = false;

  for (const row of dataset.rows) {
    if (doc.y + 15 > bottomLimit) {
      doc.addPage();
      drawHeader();
      drawTableHeader();
      striped = false;
    }

    const y = doc.y;
    if (striped) {
      doc.rect(doc.page.margins.left, y - 2, pageWidth, 14).fill('#f4f7f1');
      doc.fillColor('#1f2a1c');
    }
    striped = !striped;

    let x = doc.page.margins.left;
    dataset.columns.forEach((column, i) => {
      const width = widths[i] ?? 40;
      doc.text(sanitize(row[column.key] ?? ''), x + 3, y + 1, {
        width: width - 6,
        lineBreak: false,
        ellipsis: true,
      });
      x += width;
    });

    doc.y = y + 14;
  }

  if (dataset.rows.length === 0) {
    doc.moveDown(1).fillColor('#5b6b55').fontSize(10)
      .text('Aucune donnée pour les critères sélectionnés.');
  }

  // Pied de page sur chaque page.
  const range = doc.bufferedPageRange();
  for (let i = 0; i < range.count; i += 1) {
    doc.switchToPage(range.start + i);
    const footerY = doc.page.height - doc.page.margins.bottom + 8;
    doc.fontSize(7).fillColor('#8a9783').font('Helvetica');
    doc.text(
      sanitize(dataset.footnote ?? 'Document généré par Parcelys'),
      doc.page.margins.left,
      footerY,
      { width: pageWidth - 60, lineBreak: false, ellipsis: true },
    );
    doc.text(
      `Page ${i + 1} / ${range.count}`,
      doc.page.width - doc.page.margins.right - 60,
      footerY,
      { width: 60, align: 'right', lineBreak: false },
    );
  }

  doc.end();
  return done;
}

export function exportFileName(
  dataset: ExportDataset,
  format: 'csv' | 'xlsx' | 'pdf',
): string {
  const slug = dataset.title
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
  return `${slug}-${new Date().toISOString().slice(0, 10)}.${format}`;
}

export const CONTENT_TYPES: Record<'csv' | 'xlsx' | 'pdf', string> = {
  csv: 'text/csv; charset=utf-8',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  pdf: 'application/pdf',
};
