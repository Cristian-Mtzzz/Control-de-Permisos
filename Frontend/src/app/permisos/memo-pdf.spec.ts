import { almacenamientoEnMemoria, permiso } from '../testing/ui';
import {
  MemoDatos, MemoFila, diasEnLetras, emptyMemo, filaMemo, infoJpeg, lineaVacaciones, medidorAproximado, memoPdf,
  memoVacacionesPdf, nombrePropio, numeroEnLetras, numeroMemo, olvidarEncabezadoMemo, permisosParaMemo, rangoVacaciones,
} from './memo-pdf';

// Memorando de remisión de permisos en PDF.
describe('memorando en PDF', () => {
  const datos = (cambios: Partial<MemoDatos> = {}): MemoDatos => ({
    ...emptyMemo(), Numero: '2732', Siglas: 'gtic', Fecha: '2026-11-11',
    ParaNombre: 'Lic. Elda Maribel Sanchez Romero', ParaCargo: 'Subgerente interino de Recursos Humanos',
    DeNombre: 'Ing. Dilcia Elvir', DeCargo: 'Gerencia de Tecnologia', FirmaCargo: 'Gerente de Tecnologías de Información',
    Iniciales: 'de/myn', ...cambios,
  });
  const fila = (i: number): MemoFila => ({ Nombre: `Empleado ${i}`, NoPago: String(8000 + i), Fecha: '30/10/2026', Dia: '', Hora: '08:00-10:00' });
  const latin1 = (pdf: Uint8Array): string => Array.from(pdf, (byte) => String.fromCharCode(byte)).join('');
  // JPEG mínimo: inicio, un marcador APP0 y el SOF0 de 20x10 en RGB.
  const jpeg = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x04, 0x00, 0x00, 0xff, 0xc0, 0x00, 0x11, 0x08, 0x00, 0x0a, 0x00, 0x14, 0x03, 0, 0, 0, 0xff, 0xd9]);

  beforeEach(() => vi.stubGlobal('localStorage', almacenamientoEnMemoria()));
  afterEach(() => vi.unstubAllGlobals());

  it('arma el número, los nombres y las filas como en el memo oficial', () => {
    expect(numeroMemo(datos())).toBe('2732-GTIC-IHSS-2026');
    expect(nombrePropio('JOCELYN ARLETTE DE LA O')).toBe('Jocelyn Arlette de la O');
    expect(nombrePropio('  osman   reyes ')).toBe('Osman Reyes');

    const hora = filaMemo(permiso({ IdPermiso: 1, Tipo: 'HORA', Empleado: 'CLAUDIA BARAHONA', FechaInicio: '2026-10-30T00:00:00',
      FechaFin: '2026-10-30T00:00:00', HoraSalida: '10:00', HoraEntrada: '15:30' }), ' 10820 ');
    expect(hora).toEqual({ Nombre: 'Claudia Barahona', NoPago: '10820', Fecha: '30/10/2026', Dia: '', Hora: '10:00-15:30' });

    const dia = filaMemo(permiso({ IdPermiso: 2, Tipo: 'DIA', Empleado: 'MARCO VINICIO', FechaInicio: '2026-10-29T00:00:00',
      FechaFin: '2026-10-30T00:00:00', DiasHabiles: 2 }), '7194');
    expect(dia).toEqual({ Nombre: 'Marco Vinicio', NoPago: '7194', Fecha: '29/10/2026', Dia: '2', Hora: '' });
  });

  it('toma los permisos por día y por horas activos que salieron en el rango: primero horas, luego días', () => {
    const lista = [
      permiso({ IdPermiso: 1, Tipo: 'DIA', Empleado: 'B', FechaInicio: '2026-10-14T00:00:00' }),
      permiso({ IdPermiso: 2, Tipo: 'HORA', Empleado: 'A', FechaInicio: '2026-10-30T00:00:00', HoraSalida: '08:00' }),
      permiso({ IdPermiso: 3, Tipo: 'HORA', Empleado: 'C', FechaInicio: '2026-10-15T00:00:00', HoraSalida: '08:00' }),
      permiso({ IdPermiso: 4, Tipo: 'VAC', Empleado: 'D', FechaInicio: '2026-10-10T00:00:00' }),
      permiso({ IdPermiso: 5, Tipo: 'DIA', Empleado: 'E', FechaInicio: '2026-10-12T00:00:00', Estado: 'ANULADO' }),
      permiso({ IdPermiso: 6, Tipo: 'DIA', Empleado: 'F', FechaInicio: '2026-09-30T00:00:00', FechaFin: '2026-10-01T00:00:00' }),
      permiso({ IdPermiso: 7, Tipo: 'HORA', Empleado: 'G', FechaInicio: '2026-10-30T00:00:00', HoraSalida: '07:30' }),
    ];
    expect(permisosParaMemo(lista, '2026-10-01', '2026-10-31').map((p) => p.IdPermiso)).toEqual([3, 7, 2, 1]);
  });

  it('genera un PDF carta válido con el membrete de fondo, el encabezado, la tabla y la firma', () => {
    const pdf = latin1(memoPdf(datos(), [fila(1), { ...fila(2), Dia: '1', Hora: '' }], jpeg, medidorAproximado));
    expect(pdf.startsWith('%PDF-1.4')).toBe(true);
    expect(pdf.trimEnd().endsWith('%%EOF')).toBe(true);
    expect(pdf).toContain('/MediaBox [0 0 612 792]');
    expect(pdf).toContain('/Width 20 /Height 10 /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode');
    expect(pdf).toContain('/Im1 Do');
    expect(pdf).toContain('/Count 1');
    for (const texto of ['(MEMORANDO No. 2732-GTIC-IHSS-2026)', '(PARA:)', '(LIC. ELDA MARIBEL SANCHEZ ROMERO)',
      '(SUBGERENTE INTERINO DE RECURSOS HUMANOS)', '(ING. DILCIA ELVIR)', '(REMISION DE PERMISO)', '(11 de noviembre de 2026)',
      '(Empleado 1)', '(8001)', '(30/10/2026)', '(08:00-10:00)', '(Sin m\xe1s sobre el particular,)', '(Atentamente,)',
      '(Gerente de Tecnolog\xedas de Informaci\xf3n)', '(DE/MYN)', '(N\xfamero de)', '(Pago)', '(Archivo)']) {
      expect(pdf).toContain(texto);
    }

    // Cada referencia de la tabla xref apunta al inicio de su objeto.
    const xref = Number(/startxref\n(\d+)/.exec(pdf)![1]);
    const entradas = pdf.slice(xref).split('\n').slice(2).filter((linea) => / 00000 n $/.test(linea));
    entradas.forEach((linea, i) => expect(pdf.slice(Number(linea.slice(0, 10))).startsWith(`${i + 1} 0 obj`)).toBe(true));
  });

  it('escapa paréntesis y barras y cambia lo que no existe en WinAnsi', () => {
    const pdf = latin1(memoPdf(datos({ Asunto: 'Permiso (octubre) \\ ✓' }), [], null, medidorAproximado));
    expect(pdf).toContain('(PERMISO \\(OCTUBRE\\) \\\\ ?)');
    expect(pdf).not.toContain('/XObject');
  });

  it('si la tabla no cabe sigue en otra hoja con su encabezado y numera las hojas', () => {
    const pdf = latin1(memoPdf(datos(), Array.from({ length: 45 }, (_, i) => fila(i + 1)), jpeg, medidorAproximado));
    expect(pdf).toContain('/Count 2');
    expect(pdf.split('(FECHA)').length - 1).toBe(2);
    expect(pdf).toContain('(P\xe1gina 1 de 2)');
    expect(pdf).toContain('(P\xe1gina 2 de 2)');
    expect(pdf.split('/Im1 Do').length - 1).toBe(2);
  });

  it('lee el tamaño del JPEG', () => {
    expect(infoJpeg(jpeg)).toEqual({ ancho: 20, alto: 10, componentes: 3 });
    expect(infoJpeg(Uint8Array.from([0x89, 0x50]))).toBeNull();
  });

  it('escribe los días en letras mayúsculas con el número entre paréntesis', () => {
    expect([1, 2, 10, 15, 16, 18, 20, 21, 22, 29, 30, 31, 45, 100, 101, 250].map(numeroEnLetras)).toEqual([
      'UN', 'DOS', 'DIEZ', 'QUINCE', 'DIECISÉIS', 'DIECIOCHO', 'VEINTE', 'VEINTIÚN', 'VEINTIDÓS', 'VEINTINUEVE', 'TREINTA',
      'TREINTA Y UN', 'CUARENTA Y CINCO', 'CIEN', 'CIENTO UN', 'DOSCIENTOS CINCUENTA',
    ]);
    expect(diasEnLetras(18)).toBe('DIECIOCHO (18)');
    expect(diasEnLetras(1.5)).toBe('(1.5)');
  });

  it('arma cada línea de vacaciones con su rango y lo que va entre paréntesis', () => {
    expect(rangoVacaciones('2026-11-16', '2026-11-30')).toBe('Del 16 al 30 de noviembre del 2026');
    expect(rangoVacaciones('2026-11-30', '2026-12-04')).toBe('Del 30 de noviembre al 4 de diciembre del 2026');
    expect(rangoVacaciones('2026-12-28', '2027-01-08')).toBe('Del 28 de diciembre del 2026 al 8 de enero del 2027');
    expect(rangoVacaciones('2026-11-16', '2026-11-16')).toBe('El 16 de noviembre del 2026');
    expect(lineaVacaciones({ Desde: '2026-11-16', Hasta: '2026-11-30', Periodo: ' 2024-2025 ' }))
      .toBe('Del 16 al 30 de noviembre del 2026, inclusive (2024-2025)');
    expect(lineaVacaciones({ Desde: '2026-11-16', Hasta: '2026-11-30', Periodo: '' })).toBe('Del 16 al 30 de noviembre del 2026, inclusive');
  });

  it('memo de vacaciones: días, nombre y No. de pago en negrita y subrayados, y la lista de períodos', () => {
    const vacaciones = (dias: number, periodos = 1) => ({
      Nombre: 'Julio David Lang', NoPago: '9697', Dias: dias,
      Periodos: Array.from({ length: periodos }, (_, i) => ({ Desde: '2026-11-16', Hasta: '2026-11-30', Periodo: `202${4 + i}-202${5 + i}` })),
    });
    const pdf = latin1(memoVacacionesPdf(datos({ Asunto: 'Remision solicitud de vacaciones' }), vacaciones(18, 2), jpeg, medidorAproximado));
    expect(pdf).toContain('(REMISION SOLICITUD DE VACACIONES)');
    // Las partes del sistema van en Helvetica-Bold (F1); el resto del párrafo en Helvetica (F2).
    for (const palabra of ['DIECIOCHO', 'Julio', 'David', 'Lang', '9697']) {
      expect(pdf).toMatch(new RegExp(`/F1 11 Tf [\\d.]+ Tw [\\d.]+ [\\d.]+ Td \\(${palabra}\\) Tj`));
    }
    // "(18)" va escapado dentro de la cadena del PDF: (\(18\)).
    expect(pdf).toMatch(/\/F1 11 Tf [\d.]+ Tw [\d.]+ [\d.]+ Td \(\\\(18\\\)\) Tj/);
    expect(pdf).toMatch(/\/F2 11 Tf [\d.]+ Tw [\d.]+ [\d.]+ Td \(vacaciones\) Tj/);
    // Subrayado: DIECIOCHO (18) [2 palabras + 1 espacio], Julio David Lang [3 + 2] y 9697 [1].
    // (los espacios solo si las palabras quedaron en el mismo renglón).
    const subrayados = pdf.match(/0\.6 w /g)!.length;
    expect(subrayados).toBeGreaterThanOrEqual(6);
    expect(subrayados).toBeLessThanOrEqual(9);
    expect(pdf).toContain('(1.)');
    expect(pdf).toContain('(Del 16 al 30 de noviembre del 2026, inclusive \\(2024-2025\\))');
    expect(pdf).toContain('(2.)');
    expect(pdf).toContain('(Del 16 al 30 de noviembre del 2026, inclusive \\(2025-2026\\))');
    expect(pdf).toContain('(serán)');
    expect(pdf).toContain('(Atentamente)');
    expect(pdf).toContain('/Count 1');

    const uno = latin1(memoVacacionesPdf(datos(), vacaciones(1), null, medidorAproximado));
    expect(uno).toContain('(UN)');
    expect(uno).toContain('(día)');
    expect(uno).toContain('(será)');
    expect(uno).toContain('(gozado)');
  });

  it('borra el encabezado que una versión anterior dejó guardado en el navegador', () => {
    localStorage.setItem('control-permisos.memo', JSON.stringify(datos()));
    localStorage.setItem('otra-clave', 'se queda');
    olvidarEncabezadoMemo();
    expect(localStorage.getItem('control-permisos.memo')).toBeNull();
    expect(localStorage.getItem('otra-clave')).toBe('se queda');
    vi.stubGlobal('localStorage', undefined);
    expect(() => olvidarEncabezadoMemo()).not.toThrow();
  });
});
