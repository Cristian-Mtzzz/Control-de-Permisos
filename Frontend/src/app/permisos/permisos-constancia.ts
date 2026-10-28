import { Permiso } from './permisos.models';
import { formatDay, formatMinutes } from './permisos-resumen';
import { tipoLabel } from './permisos-report';

// Constancia de un permiso para imprimir y firmar (tamaño carta), con el departamento del
// permiso en el encabezado. Se arma como HTML en un iframe oculto y se abre el diálogo de
// impresión del navegador, desde donde también se puede guardar como PDF. No usa ventanas
// emergentes, así que el navegador no la bloquea.

const escape = (value: string | number | null | undefined): string =>
  String(value ?? '').replace(/[&<>"']/g, (char) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char] ?? char);

const fila = (label: string, value: string | number | null | undefined): string =>
  `<tr><th>${escape(label)}</th><td>${escape(value || '-')}</td></tr>`;

function detalle(permiso: Permiso): string {
  if (permiso.Tipo === 'DIA') {
    const dias = permiso.DiasHabiles;
    return [
      fila('Desde', formatDay(permiso.FechaInicio)),
      fila('Hasta', formatDay(permiso.FechaFin)),
      fila('Días hábiles', `${dias} ${dias === 1 ? 'día' : 'días'}`),
      fila('Fecha de solicitud', formatDay(permiso.FechaSolicitud)),
    ].join('');
  }
  return [
    fila('Fecha', formatDay(permiso.FechaInicio)),
    fila('Hora de salida', permiso.HoraSalida),
    fila('Hora de entrada', permiso.HoraEntrada),
    fila('Duración', formatMinutes(permiso.Minutos)),
  ].join('');
}

export function constanciaHtml(permiso: Permiso, logoUrl: string): string {
  const anulado = permiso.Estado === 'ANULADO';
  const impreso = new Date().toLocaleString('es-HN', { dateStyle: 'short', timeStyle: 'short' });
  return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<title>Constancia de permiso ${escape(permiso.IdPermiso)}</title>
<style>
  @page { size: letter portrait; margin: 18mm; }
  * { box-sizing: border-box; }
  body { margin: 0; color: #1d2b2f; font: 11pt/1.45 Arial, Helvetica, sans-serif; }
  header { display: flex; align-items: center; gap: 14px; padding-bottom: 10px; border-bottom: 2px solid #276968; }
  header img { height: 52px; }
  header p { margin: 0; }
  .org { font-size: 9pt; letter-spacing: .08em; color: #276968; font-weight: bold; }
  h1 { margin: 2px 0 0; font-size: 15pt; }
  .numero { margin-left: auto; text-align: right; font-size: 9pt; color: #55626a; }
  .numero strong { display: block; font-size: 14pt; color: #1d2b2f; }
  table { width: 100%; margin-top: 18px; border-collapse: collapse; }
  th, td { padding: 7px 10px; border: 1px solid #c9d6d3; text-align: left; vertical-align: top; }
  th { width: 32%; background: #eef5f2; font-weight: bold; }
  .motivo { white-space: pre-wrap; }
  .anulado { margin-top: 16px; padding: 8px 10px; border: 2px solid #8c2f39; color: #8c2f39;
    font-weight: bold; text-align: center; letter-spacing: .1em; }
  .firmas { display: grid; grid-template-columns: 1fr 1fr; gap: 48px; margin-top: 90px; }
  .firma { padding-top: 6px; border-top: 1px solid #1d2b2f; text-align: center; font-size: 10pt; }
  .firma span { display: block; color: #55626a; font-size: 9pt; }
  footer { margin-top: 40px; color: #7a878c; font-size: 8pt; }
</style>
</head>
<body>
  <header>
    <img src="${escape(logoUrl)}" alt="">
    <div>
      <p class="org">${escape((permiso.NombreDepartamento ?? 'Control de permisos').toUpperCase())}</p>
      <h1>Constancia de permiso</h1>
    </div>
    <p class="numero">Permiso No.<strong>${escape(permiso.IdPermiso)}</strong></p>
  </header>

  <table>
    ${fila('Empleado', permiso.Empleado)}
    ${fila('No. de pago', permiso.NoPago)}
    ${fila('Área', permiso.NombreArea)}
    ${fila('Tipo de permiso', tipoLabel(permiso.Tipo))}
    ${detalle(permiso)}
    <tr><th>Motivo</th><td class="motivo">${escape(permiso.Motivo)}</td></tr>
  </table>

  ${anulado ? '<p class="anulado">PERMISO ANULADO</p>' : ''}

  <div class="firmas">
    <p class="firma">${escape(permiso.Empleado)}<span>Empleado</span></p>
    <p class="firma">&nbsp;<span>Jefe inmediato</span></p>
  </div>

  <footer>Impreso el ${escape(impreso)}</footer>
</body>
</html>`;
}

export function imprimirConstancia(permiso: Permiso): void {
  const frame = document.createElement('iframe');
  frame.setAttribute('aria-hidden', 'true');
  frame.style.cssText = 'position:fixed;width:0;height:0;border:0;right:0;bottom:0;visibility:hidden';
  // El evento load espera al logo, así la hoja sale completa.
  frame.onload = () => {
    const ventana = frame.contentWindow;
    if (!ventana) return;
    ventana.addEventListener('afterprint', () => frame.remove(), { once: true });
    ventana.focus();
    ventana.print();
  };
  frame.srcdoc = constanciaHtml(permiso, new URL('logo.png', document.baseURI).href);
  document.body.appendChild(frame);
}
