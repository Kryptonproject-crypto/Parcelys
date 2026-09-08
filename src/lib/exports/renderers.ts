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
  if (dataset.totals && dataset.rows.length > 0) {
    lines.push(dataset.columns.map((c) => escape(dataset.totals?.[c.key] ?? '')).join(';'));
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

  // La ligne de totaux vient après le filtre : elle ne doit pas être triée
  // avec les données.
  if (dataset.totals && dataset.rows.length > 0) {
    const totals = sheet.addRow(
      dataset.columns.map((c) => dataset.totals?.[c.key] ?? ''),
    );
    totals.font = { bold: true };
    totals.eachCell((cell) => {
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEEF3EA' } };
    });
  }

  for (const notice of dataset.notices ?? []) {
    sheet.addRow([]);
    const row = sheet.addRow([notice]);
    row.font = { bold: true, size: 9, color: { argb: 'FF8A5A12' } };
  }

  if (dataset.footnote) {
    const noteRow = sheet.addRow([]);
    sheet.addRow([dataset.footnote]);
    sheet.getRow(noteRow.number + 1).font = { italic: true, size: 9, color: { argb: 'FF5B6B55' } };
  }

  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
}

/** Palette du document imprimé, alignée sur celle de l'interface. */
const PDF = {
  ink: '#1f2a1c',
  inkSoft: '#5b6b55',
  inkFaint: '#8a9783',
  accent: '#2f6b34',
  accentDark: '#1f3a20',
  stripe: '#f4f7f1',
  band: '#eef3ea',
  line: '#d7e0d2',
  warn: '#8a5a12',
  warnBand: '#fdf6e6',
} as const;

/**
 * PDF généré avec PDFKit.
 *
 * Deux partis pris : le texte est **replié**, jamais tronqué — un registre
 * réglementaire dont on couperait les substances actives ne vaudrait rien — et
 * le document s'ouvre sur les chiffres clés, le détail venant ensuite. La
 * police Helvetica intégrée couvre le latin-1 ; les caractères hors jeu
 * (₂, ₅, apostrophes typographiques) sont translittérés.
 */
export async function renderPdf(dataset: ExportDataset): Promise<Buffer> {
  const PDFDocument = (await import('pdfkit')).default;

  const landscape = dataset.orientation !== 'portrait';
  const doc = new PDFDocument({
    size: 'A4',
    layout: landscape ? 'landscape' : 'portrait',
    margins: { top: 38, bottom: 46, left: 30, right: 30 },
    bufferPages: true,
    info: {
      Title: dataset.title,
      Author: 'Parcelys',
      Subject: dataset.subtitle,
      CreationDate: new Date(),
    },
  });

  const chunks: Buffer[] = [];
  doc.on('data', (chunk: Buffer) => chunks.push(chunk));
  const done = new Promise<Buffer>((resolve) => {
    doc.on('end', () => resolve(Buffer.concat(chunks)));
  });

  const left = doc.page.margins.left;
  const pageWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;
  const totalWeight = dataset.columns.reduce((sum, c) => sum + (c.width ?? 18), 0);
  const widths = dataset.columns.map((c) => ((c.width ?? 18) / totalWeight) * pageWidth);

  const sanitize = (value: string | number): string =>
    String(value ?? '')
      .replace(/₂/g, '2')
      .replace(/₅/g, '5')
      .replace(/₃/g, '3')
      .replace(/[‘’]/g, "'")
      .replace(/[“”]/g, '"')
      .replace(/[–—]/g, '-')
      .replace(/[   ]/g, ' ')
      .replace(/…/g, '...');

  const editedOn = new Date().toLocaleDateString('fr-FR', {
    day: '2-digit',
    month: 'long',
    year: 'numeric',
  });

  // La taille du corps s'adapte au nombre de colonnes : un registre à treize
  // colonnes ne se lit pas dans le même corps qu'un tableau à cinq.
  const bodySize = dataset.columns.length > 11 ? 6.8 : dataset.columns.length > 8 ? 7.4 : 8.2;
  const lineHeight = bodySize + 2.2;
  const cellPadding = 3.5;

  /** Hauteur d'une ligne, une fois chaque cellule repliée dans sa colonne. */
  const rowHeight = (row: Record<string, string | number>, bold = false): number => {
    doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(bodySize);
    let lines = 1;
    dataset.columns.forEach((column, i) => {
      const width = (widths[i] ?? 40) - cellPadding * 2;
      const text = sanitize(row[column.key] ?? '');
      if (!text) return;
      lines = Math.max(lines, Math.ceil(doc.heightOfString(text, { width }) / lineHeight));
    });
    return lines * lineHeight + 5;
  };

  const drawRow = (
    row: Record<string, string | number>,
    y: number,
    height: number,
    bold = false,
  ): void => {
    doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(bodySize).fillColor(PDF.ink);
    let x = left;
    dataset.columns.forEach((column, i) => {
      const width = widths[i] ?? 40;
      doc.text(sanitize(row[column.key] ?? ''), x + cellPadding, y + 3, {
        width: width - cellPadding * 2,
        height: height - 4,
        align: column.align === 'right' ? 'right' : 'left',
      });
      x += width;
    });
  };

  const drawTitle = (continued: boolean): void => {
    doc.y = doc.page.margins.top;
    doc.fillColor(PDF.accentDark).fontSize(15).font('Helvetica-Bold');
    doc.text(sanitize(dataset.title) + (continued ? ' (suite)' : ''), left, doc.y);
    doc.fillColor(PDF.inkSoft).fontSize(8.6).font('Helvetica');
    doc.text(`${sanitize(dataset.subtitle)} · édité le ${editedOn}`, left, doc.y + 1);
    doc.moveDown(0.55);

    // Filet de séparation : l'en-tête se distingue du contenu sans cadre lourd.
    doc.moveTo(left, doc.y).lineTo(left + pageWidth, doc.y)
      .lineWidth(0.6).strokeColor(PDF.line).stroke();
    doc.y += 7;
  };

  /** Bandeau des chiffres clés, sur la première page uniquement. */
  const drawSummary = (): void => {
    const items = dataset.summary;
    if (!items || items.length === 0) return;

    const columns = Math.min(items.length, landscape ? 5 : 3);
    const cellWidth = pageWidth / columns;
    const rows = Math.ceil(items.length / columns);
    const height = rows * 30 + 6;
    const y = doc.y;

    doc.roundedRect(left, y, pageWidth, height, 5).fill(PDF.band);

    items.forEach((item, index) => {
      const x = left + (index % columns) * cellWidth;
      const itemY = y + 6 + Math.floor(index / columns) * 30;
      doc.fillColor(PDF.inkSoft).font('Helvetica').fontSize(7);
      doc.text(sanitize(item.label).toUpperCase(), x + 9, itemY, {
        width: cellWidth - 14,
        lineBreak: false,
        ellipsis: true,
      });
      doc.fillColor(PDF.accentDark).font('Helvetica-Bold').fontSize(11.5);
      doc.text(sanitize(item.value), x + 9, itemY + 9, {
        width: cellWidth - 14,
        lineBreak: false,
        ellipsis: true,
      });
    });

    doc.y = y + height + 9;
  };

  /** Avertissements de complétude, avant le tableau : ils se lisent d'abord. */
  const drawNotices = (): void => {
    const notices = dataset.notices?.filter(Boolean) ?? [];
    if (notices.length === 0) return;

    for (const notice of notices) {
      const text = sanitize(notice);
      doc.font('Helvetica').fontSize(7.8);
      const height = doc.heightOfString(text, { width: pageWidth - 24 }) + 11;
      const y = doc.y;
      doc.roundedRect(left, y, pageWidth, height, 4).fill(PDF.warnBand);
      doc.rect(left, y, 2.5, height).fill(PDF.warn);
      doc.fillColor(PDF.warn).font('Helvetica').fontSize(7.8);
      doc.text(text, left + 12, y + 5.5, { width: pageWidth - 24 });
      doc.y = y + height + 6;
    }
  };

  const drawTableHeader = (): void => {
    doc.font('Helvetica-Bold').fontSize(bodySize);
    let lines = 1;
    dataset.columns.forEach((column, i) => {
      const width = (widths[i] ?? 40) - cellPadding * 2;
      lines = Math.max(
        lines,
        Math.ceil(doc.heightOfString(sanitize(column.header), { width }) / lineHeight),
      );
    });

    const height = lines * lineHeight + 6;
    const y = doc.y;
    doc.rect(left, y, pageWidth, height).fill(PDF.accent);
    doc.fillColor('#ffffff').fontSize(bodySize).font('Helvetica-Bold');

    let x = left;
    dataset.columns.forEach((column, i) => {
      const width = widths[i] ?? 40;
      doc.text(sanitize(column.header), x + cellPadding, y + 3.5, {
        width: width - cellPadding * 2,
        align: column.align === 'right' ? 'right' : 'left',
      });
      x += width;
    });

    doc.y = y + height;
  };

  drawTitle(false);
  drawSummary();
  drawNotices();
  drawTableHeader();

  const bottomLimit = doc.page.height - doc.page.margins.bottom - 14;
  let striped = false;

  for (const row of dataset.rows) {
    const height = rowHeight(row);

    if (doc.y + height > bottomLimit) {
      doc.addPage();
      drawTitle(true);
      drawTableHeader();
      striped = false;
    }

    const y = doc.y;
    if (striped) doc.rect(left, y, pageWidth, height).fill(PDF.stripe);
    striped = !striped;

    drawRow(row, y, height);
    doc.y = y + height;
  }

  if (dataset.totals && dataset.rows.length > 0) {
    const height = rowHeight(dataset.totals, true);
    if (doc.y + height > bottomLimit) {
      doc.addPage();
      drawTitle(true);
      drawTableHeader();
    }
    const y = doc.y;
    doc.rect(left, y, pageWidth, height).fill(PDF.band);
    doc.moveTo(left, y).lineTo(left + pageWidth, y)
      .lineWidth(0.8).strokeColor(PDF.accent).stroke();
    drawRow(dataset.totals, y, height, true);
    doc.y = y + height;
  }

  if (dataset.rows.length === 0) {
    doc.moveDown(1).fillColor(PDF.inkSoft).font('Helvetica').fontSize(9.5)
      .text('Aucune donnée pour les critères sélectionnés.', left, doc.y, {
        width: pageWidth,
      });
  }

  // Pied de page sur chaque page : provenance à gauche, pagination à droite.
  //
  // La marge basse est annulée le temps d'écrire : sans cela, PDFKit considère
  // que le texte déborde et ajoute une page vierge à la fin du document.
  const range = doc.bufferedPageRange();
  for (let i = 0; i < range.count; i += 1) {
    doc.switchToPage(range.start + i);
    const bottomMargin = doc.page.margins.bottom;
    doc.page.margins.bottom = 0;
    const footerY = doc.page.height - bottomMargin + 6;

    doc.moveTo(left, footerY - 5).lineTo(left + pageWidth, footerY - 5)
      .lineWidth(0.5).strokeColor(PDF.line).stroke();

    doc.fontSize(6.6).fillColor(PDF.inkFaint).font('Helvetica');
    doc.text(
      sanitize(dataset.footnote ?? 'Document généré par Parcelys.'),
      left,
      footerY,
      { width: pageWidth - 70, height: bottomMargin - 8, ellipsis: true },
    );
    doc.text(
      `Page ${i + 1} / ${range.count}`,
      doc.page.width - doc.page.margins.right - 70,
      footerY,
      { width: 70, align: 'right', lineBreak: false },
    );
    doc.page.margins.bottom = bottomMargin;
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
