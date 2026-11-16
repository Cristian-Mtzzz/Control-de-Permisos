import { Permiso } from './permisos.models';
import { apiDay } from './permisos-resumen';

/**
 * Formatos oficiales de impresión del IHSS, llenos con los datos de un permiso:
 *  - por día: "Solicitud de permiso día";
 *  - por hora: "Permiso por horas".
 * Cada hoja carta lleva dos copias iguales, como los formatos en papel. Las firmas y el goce de
 * sueldo se llenan a mano. Los logos están en public/impresion.
 */

const escapar = (texto: string | null | undefined): string =>
  (texto ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

const fecha = (dia: string): Date => {
  const [anio, mes, numero] = dia.split('-').map(Number);
  return new Date(anio, mes - 1, numero);
};
const formato = (opciones: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat('es-HN', opciones);
const capital = (texto: string): string => texto.charAt(0).toLocaleUpperCase('es') + texto.slice(1);

// "lunes 9 de noviembre de 2026"
export function fechaLarga(dia: string): string {
  return formato({ weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(fecha(dia)).replace(',', '');
}

// "9 de noviembre de 2026"
function fechaSinDia(dia: string): string {
  return formato({ day: 'numeric', month: 'long', year: 'numeric' }).format(fecha(dia));
}

// "Martes 10 de n6", "Del martes 10 al miércoles 11 de noviembre de 2026",
// "Del lunes 30 de noviembre al oviembre de 202martes 1 de diciembre de 2026" o, entre años, las dos fechas completas.
export function rangoLargo(desde: string, hasta: string): string {
  if (desde === hasta) return capital(fechaLarga(desde));
  const [inicio, fin] = [fecha(desde), fecha(hasta)];
  const diaSemana = (d: Date) => formato({ weekday: 'long' }).format(d);
  const mesAnio = formato({ month: 'long', year: 'numeric' }).format(fin);
  if (inicio.getFullYear() !== fin.getFullYear()) return `Del ${fechaLarga(desde)} al ${fechaLarga(hasta)}`;
  if (inicio.getMonth() === fin.getMonth()) {
    return `Del ${diaSemana(inicio)} ${inicio.getDate()} al ${diaSemana(fin)} ${fin.getDate()} de ${mesAnio}`;
  }
  const mes = (d: Date) => formato({ month: 'long' }).format(d);
  return `Del ${diaSemana(inicio)} ${inicio.getDate()} de ${mes(inicio)} al ${diaSemana(fin)} ${fin.getDate()} de ${mesAnio}`;
}

const ESTILOS = `
  @page { size: letter; margin: 0; }
  * { box-sizing: border-box; }
  html, body { margin: 0; background: #fff; }
  body { width: 8.5in; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  .hoja { width: 8.5in; height: 11in; overflow: hidden; }
  .copia { position: relative; height: 5.5in; }
  .encabezado { display: flex; justify-content: space-between; align-items: flex-start; }
  .logo-ihss { height: .55in; }
  .logo-honduras { height: .62in; }
  .valor { border-bottom: 1px solid currentColor; padding: 0 .05in; min-height: 1.15em; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }

  /* Permiso por horas (Times, azul oscuro). */
  .horas { font-family: 'Times New Roman', Times, serif; color: #000; padding: .3in .55in 0 .95in; }
  .horas h1 { margin: .02in 0 .16in; text-align: center; font-size: 11pt; text-decoration: underline; }
  .horas .campo { display: flex; align-items: baseline; gap: .06in; margin: 0 0 .15in; font-size: 10.5pt; font-weight: 700; }
  .horas .valor { flex: 1; font: 400 10.5pt Arial, sans-serif; color: #000; }
  .horas .linea-extra { border-bottom: 1px solid #000; height: 1.1em; margin: -.04in 0 .15in; }
  .horas .par { display: flex; gap: .7in; }
  .horas .par .valor { flex: 0 0 1.05in; text-align: center; }
  .horas .firmas { display: grid; grid-template-columns: 1fr 1.35fr; column-gap: .5in; margin-top: .42in; font-size: 10pt; font-weight: 700; }
  .horas .firma { border-top: 1px solid #000; padding-top: 2px; width: 2in; }
  .horas .firma.ancha { width: 2.45in; }
  .horas .goce { font-size: 10pt; font-weight: 700; line-height: 1.35; padding-left: .35in; }
  .horas .fila2 { margin-top: .48in; }

  /* Solicitud de permiso día (Calibri). */
  .dia { font-family: Calibri, Carlito, 'Segoe UI', Arial, sans-serif; color: #000; padding: .26in .55in 0 .75in; }
  .dia h2 { margin: -.12in 0 0; text-align: center; font-size: 12pt; }
  .dia h1 { margin: 0 0 .14in; text-align: center; font-size: 16pt; }
  .dia .campo { display: flex; align-items: baseline; gap: .04in; margin: 0 0 .05in; font-size: 10.5pt; }
  .dia .valor { flex: 1; font-weight: 600; color: #000; }
  .dia .valor.pago { flex: 0 0 1.3in; }
  .dia .firmas { position: relative; height: 1.45in; margin-top: .28in; font-size: 10.5pt; }
  .dia .firma { position: absolute; width: 2.45in; border-top: 1px solid #000; text-align: center; padding-top: 2px; }
  .dia .f1 { left: .3in; top: .12in; } .dia .f2 { right: 0; top: 0; } .dia .f3 { left: .2in; top: .85in; }
  .dia .goce { position: absolute; right: .45in; top: .85in; line-height: 1.35; }
  .dia .nota { position: absolute; left: .2in; top: 1.1in; font-size: 8pt; line-height: 1.3; }
  .dia .nota b { display: block; }
`;

/**
 * Logos del encabezado, en "data:image/png;base64,...", como los guarda Mantenimiento en la base.
 * El que falte se imprime con el que trae el sistema (public/impresion).
 */
export interface LogosImpresion {
  Izquierdo?: string;
  Derecho?: string;
}

/** Pasa los logos que manda la API a las direcciones "data:" que usa el formato. */
export function logosParaImpresion(logos: readonly { Clave: string; TipoMime: string; Imagen: string }[]): LogosImpresion {
  const direccion = (clave: string): string | undefined => {
    const logo = logos.find((item) => item.Clave === clave);
    return logo?.Imagen ? `data:${logo.TipoMime};base64,${logo.Imagen}` : undefined;
  };
  return { Izquierdo: direccion('IZQUIERDO'), Derecho: direccion('DERECHO') };
}

function encabezado(base: string, logos: LogosImpresion): string {
  const izquierdo = logos.Izquierdo || `${base}impresion/logo-ihss.png`;
  const derecho = logos.Derecho || `${base}impresion/logo-honduras.png`;
  return `<div class="encabezado">
    <img class="logo-ihss" src="${escapar(izquierdo)}" alt="">
    <img class="logo-honduras" src="${escapar(derecho)}" alt="">
  </div>`;
}

function copiaDia(p: Permiso, base: string, logos: LogosImpresion): string {
  const desde = apiDay(p.FechaInicio);
  const hasta = apiDay(p.FechaFin);
  const tiempo = `${p.DiasHabiles} ${p.DiasHabiles === 1 ? 'día hábil' : 'días hábiles'}`;
  const solicitud = apiDay(p.FechaSolicitud);
  const lugarFecha = [p.Lugar?.trim() || '', solicitud ? fechaSinDia(solicitud) : ''].filter(Boolean).join(', ');
  return `<section class="copia dia">
    ${encabezado(base, logos)}
    <h2>INSTITUTO HONDUREÑO DE SEGURIDAD SOCIAL</h2>
    <h1>SOLICITUD DE PERMISO DÍA</h1>
    <div class="campo">Nombre del empleado: <span class="valor">${escapar(p.Empleado)}</span>N° de pago<span class="valor pago">${escapar(p.NoPago)}</span></div>
    <div class="campo">Motivo del permiso: <span class="valor">${escapar(p.Motivo)}</span></div>
    <div class="campo">Tiempo que utilizara: <span class="valor">${escapar(tiempo)}</span></div>
    <div class="campo">Fecha del día o días que utilizara: <span class="valor">${escapar(rangoLargo(desde, hasta))}</span></div>
    <div class="campo">Número de teléfono: <span class="valor">${escapar(p.Telefono)}</span></div>
    <div class="campo">Lugar y Fecha: <span class="valor">${escapar(lugarFecha)}</span></div>
    <div class="firmas">
      <div class="firma f1">Firma del Empleado</div>
      <div class="firma f2">Firma del Jefe Inmediato</div>
      <div class="firma f3">Firma Jefe Departamento</div>
      <div class="goce">Con goce de sueldo&nbsp;&nbsp;&nbsp; (&nbsp;&nbsp;)<br>Sin goce de sueldo&nbsp;&nbsp;&nbsp;&nbsp; (&nbsp;&nbsp;)</div>
      <div class="nota"><b>NOTA:</b>1. Este formulario es válido para permisos no mayores de 2 días.<br>2. Deberán especificarse si el permiso es con goce o sin goce de sueldo.</div>
    </div>
  </section>`;
}

function copiaHoras(p: Permiso, base: string, logos: LogosImpresion): string {
  return `<section class="copia horas">
    ${encabezado(base, logos)}
    <h1>PERMISO POR HORAS</h1>
    <div class="campo">NOMBRE: <span class="valor">${escapar(p.Empleado)}</span></div>
    <div class="campo">NO. DE PAGO: <span class="valor">${escapar(p.NoPago)}</span></div>
    <div class="campo">MOTIVO DEL PERMISO: <span class="valor">${escapar(p.Motivo)}</span></div>
    <div class="linea-extra"></div>
    <div class="campo">FECHA DEL PERMISO: <span class="valor">${escapar(capital(fechaLarga(apiDay(p.FechaInicio))))}</span></div>
    <div class="par">
      <div class="campo">HORA DE SALIDA: <span class="valor">${escapar(p.HoraSalida)}</span></div>
      <div class="campo">HORA DE ENTRADA: <span class="valor">${escapar(p.HoraEntrada)}</span></div>
    </div>
    <div class="firmas">
      <div class="firma">FIRMA DEL EMPLEADO</div>
      <div class="firma ancha">FIRMA JEFE DEL DEPARTAMENTO</div>
      <div class="firma fila2">JEFATURA INMEDIATA</div>
      <div class="goce fila2">Con goce de salario&nbsp; (&nbsp;&nbsp;)<br>Sin goce de salario&nbsp;&nbsp; (&nbsp;&nbsp;)</div>
    </div>
  </section>`;
}

/** Documento HTML del formato del permiso (día u horas), con dos copias en una hoja carta. */
export function documentoImpresion(permiso: Permiso, base: string, logos: LogosImpresion = {}): string {
  const copia = permiso.Tipo === 'HORA' ? copiaHoras(permiso, base, logos) : copiaDia(permiso, base, logos);
  const titulo = permiso.Tipo === 'HORA' ? 'Permiso por horas' : 'Solicitud de permiso día';
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>${titulo} #${permiso.IdPermiso}</title>
    <style>${ESTILOS}</style></head><body><div class="hoja">${copia}</div></body></html>`;
}

/**
 * Imprime el formato desde un marco oculto (sin ventanas emergentes). Espera a que carguen los
 * logos para que salgan en el papel, y quita el marco al terminar.
 */
export function imprimirPermiso(permiso: Permiso, logos: LogosImpresion = {}, documento: Document = window.document): void {
  const marco = documento.createElement('iframe');
  marco.setAttribute('aria-hidden', 'true');
  marco.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden';
  documento.body.appendChild(marco);
  const ventana = marco.contentWindow;
  if (!ventana) { marco.remove(); return; }
  ventana.document.open();
  ventana.document.write(documentoImpresion(permiso, documento.baseURI, logos));
  ventana.document.close();
  const imagenes = Array.from(ventana.document.images);
  const cargadas = imagenes.map((imagen) => imagen.complete
    ? Promise.resolve()
    : new Promise<void>((resolve) => { imagen.onload = imagen.onerror = () => resolve(); }));
  Promise.all(cargadas).then(() => {
    ventana.focus();
    ventana.print();
    setTimeout(() => marco.remove(), 1000);
  });
}
