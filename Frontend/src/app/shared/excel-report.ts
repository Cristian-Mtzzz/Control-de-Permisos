import type * as ExcelJS from 'exceljs';

/**
 * Formato de los reportes de Excel del Control de permisos. Cada hoja lleva:
 *  - fila 1: título en blanco sobre verde oscuro;
 *  - fila 2: totales, filtros usados y fecha de generación;
 *  - fila 4 en adelante: tabla de Excel con filtros, filas alternadas y encabezado fijo.
 * Las columnas se definen igual que la tabla de la vista web (mismo orden, nombre y contenido
 * de la celda), para que el archivo muestre lo mismo que la pantalla.
 */

type ReportCell = string | number | Date;

export interface ReportColumn<T> {
  header: string;
  width: number;
  value: (row: T) => ReportCell;
  // Fecha sin hora (dd/mm/aa).
  format?: 'date';
  // Texto largo (detalle, observaciones): se ajusta a varias líneas.
  wrap?: boolean;
}

interface ReportSheet<T> {
  sheetName: string;
  title: string;
  subtitle: string;
  tableName: string;
  columns: ReportColumn<T>[];
  rows: readonly T[];
}

const TITLE_FILL = 'FF173F43';
const SUBTITLE_COLOR = 'FF617573';
const TAB_COLOR = 'FF4F8A83';

/** Libro vacío con los datos del documento; ExcelJS se carga solo al exportar. */
export async function createReportWorkbook(subject: string): Promise<ExcelJS.Workbook> {
  const { default: ExcelJSModule } = await import('exceljs');
  const workbook = new ExcelJSModule.Workbook();
  workbook.creator = 'Control de Permisos';
  workbook.created = new Date();
  workbook.subject = subject;
  workbook.title = subject;
  return workbook;
}

/** Encabezado del reporte (título y subtítulo) en las filas 1 y 2 de la hoja. */
function addReportHeader(sheet: ExcelJS.Worksheet, columnCount: number, title: string, subtitle: string): void {
  const lastColumn = sheet.getColumn(Math.max(columnCount, 1)).letter;
  sheet.mergeCells(`A1:${lastColumn}1`);
  sheet.getCell('A1').value = title;
  sheet.getCell('A1').font = { name: 'Aptos Display', size: 16, bold: true, color: { argb: 'FFFFFFFF' } };
  sheet.getCell('A1').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: TITLE_FILL } };
  sheet.getCell('A1').alignment = { vertical: 'middle' };
  sheet.getRow(1).height = 31;
  sheet.mergeCells(`A2:${lastColumn}2`);
  sheet.getCell('A2').value = subtitle;
  sheet.getCell('A2').font = { name: 'Aptos', size: 10, color: { argb: SUBTITLE_COLOR }, italic: true };
}

/** Hoja de detalle con el formato común: encabezado y tabla igual a la de la vista web. */
export function addReportSheet<T>(workbook: ExcelJS.Workbook, report: ReportSheet<T>): ExcelJS.Worksheet {
  const sheet = workbook.addWorksheet(report.sheetName, { properties: { tabColor: { argb: TAB_COLOR } } });
  addReportHeader(sheet, report.columns.length, report.title, report.subtitle);
  sheet.addTable({
    name: report.tableName,
    ref: 'A4',
    headerRow: true,
    totalsRow: false,
    style: { theme: 'TableStyleMedium2', showRowStripes: true },
    columns: report.columns.map((column) => ({ name: column.header })),
    // Una tabla de Excel necesita al menos una fila de datos.
    rows: report.rows.length > 0
      ? report.rows.map((row) => report.columns.map((column) => column.value(row)))
      : [report.columns.map(() => '')],
  });
  report.columns.forEach((definition, index) => {
    const column = sheet.getColumn(index + 1);
    column.width = definition.width;
    if (definition.format === 'date') column.numFmt = 'dd/mm/yy';
    if (definition.wrap) column.alignment = { wrapText: true, vertical: 'top' };
  });
  sheet.views = [{ state: 'frozen', ySplit: 4 }];
  return sheet;
}

/**
 * Fecha de la API lista para Excel. Excel no maneja zonas horarias y ExcelJS guarda las fechas
 * en UTC, así que se pasa la hora local tal cual (9:30 a. m. se ve 9:30 y no 15:30).
 * Sin fecha devuelve `empty` ("-" como en la tabla web).
 */
export function excelDate(value: string | null | undefined, empty = '-'): Date | string {
  if (!value) return empty;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate(),
    date.getHours(), date.getMinutes(), date.getSeconds()));
}

/** Texto de la celda o "-" si está vacío, como lo muestra la tabla web. */
export function cellText(value: string | number | null | undefined, empty = '-'): string {
  const text = value === null || value === undefined ? '' : String(value).trim();
  return text || empty;
}

/** Texto "Generado dd/mm/aa hh:mm" para el subtítulo. */
export function generatedAt(): string {
  const now = new Date();
  const pad = (value: number) => String(value).padStart(2, '0');
  return `Generado ${pad(now.getDate())}/${pad(now.getMonth() + 1)}/${pad(now.getFullYear() % 100)} ${pad(now.getHours())}:${pad(now.getMinutes())}`;
}

/** Genera el .xlsx, comprueba que sea válido y lo descarga con el nombre indicado. */
export async function downloadReportWorkbook(workbook: ExcelJS.Workbook, fileName: string): Promise<void> {
  const buffer = await workbook.xlsx.writeBuffer();
  const bytes = new Uint8Array(buffer as ArrayBuffer).slice();
  if (bytes.byteLength < 4 || bytes[0] !== 0x50 || bytes[1] !== 0x4b) {
    throw new Error('ExcelJS generó un archivo XLSX vacío o inválido.');
  }
  const file = new Blob([bytes.buffer as ArrayBuffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
  const url = URL.createObjectURL(file);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

/** Nombre de archivo con la fecha del día: reporte-<nombre>-AAAA-MM-DD.xlsx */
export function reportFileName(name: string): string {
  const now = new Date();
  const day = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  return `reporte-${name}-${day}.xlsx`;
}
