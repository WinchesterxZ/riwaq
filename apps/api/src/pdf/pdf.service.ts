import { Injectable } from '@nestjs/common';
import PDFDocument from 'pdfkit';
import { ArabicShaper } from 'arabic-persian-reshaper';
import bidiFactory from 'bidi-js';
import { join } from 'path';

const bidi = bidiFactory();

/** Convert logical-order text to visual-order with Arabic shaping for pdfkit. */
export function visual(text: string | number | null | undefined): string {
  const s = String(text ?? '');
  if (!s) return '';
  const shaped = ArabicShaper.convertArabic(s);
  const levels = bidi.getEmbeddingLevels(shaped, 'rtl');
  const flips = bidi.getReorderSegments(shaped, levels);
  const chars = [...shaped];
  for (const [st, en] of flips) {
    const sub = chars.slice(st, en + 1).reverse();
    for (let i = 0; i < sub.length; i++) chars[st + i] = sub[i];
  }
  return chars.join('');
}

const FONTS_DIR = join(__dirname, '..', '..', 'assets', 'fonts');

export interface PdfTable {
  headers: string[];
  /** Column widths as fractions of usable width, RTL order (first = rightmost). */
  widths: number[];
  rows: string[][];
}

export interface PdfDocSpec {
  titleAr: string;
  titleEn: string;
  companyAr: string;
  companyEn: string;
  meta: Array<[string, string]>; // [label, value] pairs
  tables: PdfTable[];
  totals?: Array<[string, string]>;
  footerAr?: string;
  footerEn?: string;
}

@Injectable()
export class PdfService {
  render(spec: PdfDocSpec): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const doc = new PDFDocument({ size: 'A4', margin: 48 });
      const chunks: Buffer[] = [];
      doc.on('data', (c) => chunks.push(c));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      try {
        doc.registerFont('ar', join(FONTS_DIR, 'Amiri-Regular.ttf'));
        doc.registerFont('ar-bold', join(FONTS_DIR, 'Amiri-Bold.ttf'));
      } catch (e) {
        reject(new Error('Arabic font not found in assets/fonts'));
        return;
      }

      const W = doc.page.width - 96;
      let y = 60;

      // Header: company + title (RTL: right-aligned)
      doc.font('ar-bold').fontSize(18);
      doc.text(visual(spec.companyAr), 48, y, { width: W, align: 'right' });
      y = doc.y + 2;
      doc.font('ar').fontSize(11);
      doc.text(visual(spec.companyEn), 48, y, { width: W, align: 'right' });
      y = doc.y + 14;

      doc.font('ar-bold').fontSize(16);
      doc.text(visual(spec.titleAr), 48, y, { width: W, align: 'right' });
      y = doc.y + 2;
      doc.font('ar').fontSize(11);
      doc.text(visual(spec.titleEn), 48, y, { width: W, align: 'right' });
      y = doc.y + 12;

      // Meta lines
      doc.font('ar').fontSize(10);
      for (const [label, value] of spec.meta) {
        doc.text(visual(`${label}: ${value}`), 48, y, { width: W, align: 'right' });
        y = doc.y + 3;
      }
      y += 8;

      // Tables
      for (const t of spec.tables) {
        y = this.renderTable(doc, t, 48, y, W);
        y += 10;
      }

      // Totals
      if (spec.totals?.length) {
        doc.font('ar-bold').fontSize(11);
        for (const [label, value] of spec.totals) {
          if (y > doc.page.height - 90) { doc.addPage(); y = 60; }
          doc.text(visual(`${label}: ${value}`), 48, y, { width: W, align: 'right' });
          y = doc.y + 4;
        }
        y += 6;
      }

      // Footer
      if (spec.footerAr || spec.footerEn) {
        doc.font('ar').fontSize(9);
        if (spec.footerAr) { doc.text(visual(spec.footerAr), 48, y, { width: W, align: 'right' }); y = doc.y + 2; }
        if (spec.footerEn) { doc.text(visual(spec.footerEn), 48, y, { width: W, align: 'right' }); y = doc.y + 2; }
      }

      // Page numbers
      const pages = doc.bufferedPageRange();
      for (let i = 0; i < pages.count; i++) {
        doc.switchToPage(i);
        doc.font('ar').fontSize(8);
        doc.text(visual(`صفحة ${i + 1} من ${pages.count}`), 48, doc.page.height - 40, { width: W, align: 'center' });
      }

      doc.end();
    });
  }

  private renderTable(doc: PDFKit.PDFDocument, t: PdfTable, x: number, y: number, W: number): number {
    const colW = t.widths.map((w) => w * W);
    const rowH = 22;
    const headerH = 26;

    const ensureSpace = (h: number) => {
      if (y + h > doc.page.height - 70) { doc.addPage(); y = 60; }
    };

    // Header row (right to left)
    ensureSpace(headerH);
    let cx = x + W;
    doc.font('ar-bold').fontSize(10);
    t.headers.forEach((h, i) => {
      cx -= colW[i];
      doc.rect(cx, y, colW[i], headerH).fill('#1f4d3a');
      doc.fillColor('#ffffff').text(visual(h), cx + 4, y + 7, { width: colW[i] - 8, align: 'center' });
      doc.fillColor('#000000');
    });
    y += headerH;

    // Data rows
    doc.font('ar').fontSize(10);
    t.rows.forEach((row, ri) => {
      ensureSpace(rowH);
      cx = x + W;
      if (ri % 2 === 1) {
        doc.rect(x, y, W, rowH).fill('#f4f6f5');
        doc.fillColor('#000000');
      }
      row.forEach((cell, i) => {
        cx -= colW[i];
        doc.rect(cx, y, colW[i], rowH).stroke('#d7dcd9');
        doc.text(visual(cell), cx + 4, y + 5, { width: colW[i] - 8, align: 'center' });
      });
      y += rowH;
    });
    // redraw header bg on top is already done; return
    return y;
  }
}
