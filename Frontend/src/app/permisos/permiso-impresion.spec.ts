import { permiso } from '../testing/ui';
import { documentoImpresion, fechaLarga, logosParaImpresion, rangoLargo } from './permiso-impresion';

// Formatos oficiales de impresión (día y horas) llenos con los datos del permiso.
describe('impresión del permiso', () => {
  const texto = (html: string): string => {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    return doc.body.textContent!.replace(/\s+/g, ' ');
  };
  const copias = (html: string): number => new DOMParser().parseFromString(html, 'text/html').querySelectorAll('.copia').length;

  it('escribe las fechas como en el papel', () => {
    expect(fechaLarga('2026-11-09')).toBe('lunes 9 de noviembre de 2026');
    expect(rangoLargo('2026-11-10', '2026-11-10')).toBe('Martes 10 de noviembre de 2026');
    expect(rangoLargo('2026-11-10', '2026-11-11')).toBe('Del martes 10 al miércoles 11 de noviembre de 2026');
    expect(rangoLargo('2026-11-30', '2026-12-01')).toBe('Del lunes 30 de noviembre al martes 1 de diciembre de 2026');
    expect(rangoLargo('2026-12-31', '2027-01-01')).toBe('Del jueves 31 de diciembre de 2026 al viernes 1 de enero de 2027');
  });

  it('por día: solicitud de permiso día con teléfono, lugar y fecha de solicitud, una copia', () => {
    const html = documentoImpresion(permiso({
      IdPermiso: 38, Empleado: 'BEIREL DICKERMAN', NoPago: '10456', Motivo: 'ESCUELA Y BANCO', DiasHabiles: 2,
      FechaInicio: '2026-11-10T00:00:00', FechaFin: '2026-11-11T00:00:00', FechaSolicitud: '2026-11-09T00:00:00',
      Telefono: '9988-7766', Lugar: 'Tegucigalpa',
    }), 'http://localhost/');
    const contenido = texto(html);
    expect(copias(html)).toBe(1);
    expect(contenido).toContain('SOLICITUD DE PERMISO DÍA');
    expect(contenido).toContain('Nombre del empleado: BEIREL DICKERMAN');
    expect(contenido).toContain('N° de pago10456');
    expect(contenido).toContain('Motivo del permiso: ESCUELA Y BANCO');
    expect(contenido).toContain('Tiempo que utilizara: 2 días hábiles');
    expect(contenido).toContain('Fecha del día o días que utilizara: Del martes 10 al miércoles 11 de noviembre de 2026');
    expect(contenido).toContain('Número de teléfono: 9988-7766');
    expect(contenido).toContain('Lugar y Fecha: Tegucigalpa, 9 de noviembre de 2026');
    expect(contenido).not.toContain('Donde localizarlo');
    expect(html).toContain('http://localhost/impresion/logo-ihss.png');
    expect(html).toContain('http://localhost/impresion/logo-honduras.png');
  });

  it('por hora: permiso por horas con la fecha y las horas', () => {
    const contenido = texto(documentoImpresion(permiso({
      IdPermiso: 37, Tipo: 'HORA', Empleado: 'GUILLERMO URBINA', NoPago: '10457', Motivo: 'PERSONAL',
      FechaInicio: '2026-11-09T00:00:00', FechaFin: '2026-11-09T00:00:00', HoraSalida: '13:00', HoraEntrada: '15:30',
    }), '/'));
    expect(contenido).toContain('PERMISO POR HORAS');
    expect(contenido).toContain('NOMBRE: GUILLERMO URBINA');
    expect(contenido).toContain('NO. DE PAGO: 10457');
    expect(contenido).toContain('FECHA DEL PERMISO: Lunes 9 de noviembre de 2026');
    expect(contenido).toContain('HORA DE SALIDA: 13:00');
    expect(contenido).toContain('HORA DE ENTRADA: 15:30');
    expect(contenido).not.toContain('SOLICITUD DE PERMISO DÍA');
  });

  it('el formato va en blanco y negro: sin la barra de color ni la pestaña del borde', () => {
    for (const tipo of ['DIA', 'HORA'] as const) {
      const estilos = new DOMParser().parseFromString(documentoImpresion(permiso({ IdPermiso: 9, Tipo: tipo }), '/'), 'text/html')
        .querySelector('style')!.textContent!;
      const colores = [...estilos.matchAll(/(?:^|[\s;{])(?:color|background):\s*([^;]+);/g)].map((m) => m[1].trim());
      expect(colores.length).toBeGreaterThan(0);
      expect(colores.every((c) => c === '#000' || c === '#fff')).toBe(true);
      expect(estilos).not.toMatch(/solid #(?!000)/);
      expect(estilos).not.toContain('franja');
      expect(estilos).not.toContain('.tab');
    }
  });

  it('los logos son los de la base; sin ellos, los que trae el sistema', () => {
    for (const tipo of ['DIA', 'HORA'] as const) {
      const dato = permiso({ IdPermiso: 11, Tipo: tipo });
      const sistema = documentoImpresion(dato, 'http://localhost/');
      expect(sistema).toContain('src="http://localhost/impresion/logo-ihss.png"');
      expect(sistema).toContain('src="http://localhost/impresion/logo-honduras.png"');

      const propios = documentoImpresion(dato, 'http://localhost/', logosParaImpresion([
        { Clave: 'IZQUIERDO', TipoMime: 'image/png', Imagen: 'QUFB' },
        { Clave: 'DERECHO', TipoMime: 'image/jpeg', Imagen: 'QkJC' },
      ]));
      expect(propios).toContain('src="data:image/png;base64,QUFB"');
      expect(propios).toContain('src="data:image/jpeg;base64,QkJC"');
      expect(propios).not.toContain('logo-ihss.png');

      // Con uno solo subido, el otro sigue siendo el del sistema.
      const soloUno = documentoImpresion(dato, 'http://localhost/', logosParaImpresion([
        { Clave: 'DERECHO', TipoMime: 'image/png', Imagen: 'Q0ND' },
      ]));
      expect(soloUno).toContain('src="http://localhost/impresion/logo-ihss.png"');
      expect(soloUno).toContain('src="data:image/png;base64,Q0ND"');
    }
  });

  it('los datos van como texto (no como HTML) y lo que falta queda en blanco', () => {
    const html = documentoImpresion(permiso({
      IdPermiso: 5, Motivo: '<b>CITA</b> & "X"', NoPago: null, Lugar: null, Telefono: null, FechaSolicitud: '2026-11-09T00:00:00',
    }), '/');
    expect(html).toContain('&lt;b&gt;CITA&lt;/b&gt; &amp; &quot;X&quot;');
    expect(html).not.toContain('<b>CITA</b>');
    // Un permiso anterior al campo "Lugar" lleva solo la fecha.
    expect(texto(html)).toContain('Lugar y Fecha: 9 de noviembre de 2026');
  });
});
