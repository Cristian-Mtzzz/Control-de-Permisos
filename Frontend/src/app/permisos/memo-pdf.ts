import { Permiso } from './permisos.models';
import { apiDay } from './permisos-resumen';

const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

// "11 de noviembre de 2026": la fecha del memorando, como en el oficial.
function fechaSinDia(dia: string): string {
  const [anio, mes, numero] = dia.split('-').map(Number);
  return `${numero} de ${MESES[mes - 1]} de ${anio}`;
}

/**
 * Memorando de remisión de permisos a Recursos Humanos, en PDF con el membrete del IHSS
 * (public/impresion/membrete-memo.jpg: encabezado, escudo de fondo y franja del pie, tomados del memo
 * oficial). El PDF se arma aquí mismo, sin librerías: el membrete de fondo, las fuentes estándar del
 * PDF (Helvetica en lugar de Tahoma y Times) y la tabla dibujada con líneas. Si la tabla no cabe en
 * una hoja sigue en la siguiente con su encabezado.
 */

export interface MemoDatos {
  // El número completo es Numero-Siglas-IHSS-año de la fecha: "2732-GTIC-IHSS-2026".
  Numero: string;
  Siglas: string;
  Fecha: string;
  ParaNombre: string;
  ParaCargo: string;
  DeNombre: string;
  DeCargo: string;
  Asunto: string;
  Texto: string;
  // Cargo bajo la firma (el de quien firma, no el de la gerencia) e iniciales bajo "Archivo".
  FirmaCargo: string;
  Iniciales: string;
}

// Una fila de la tabla: Dia lleva los días del permiso por día y Hora el rango del de horas.
export interface MemoFila {
  Nombre: string;
  NoPago: string;
  Fecha: string;
  Dia: string;
  Hora: string;
}

export const MEMO_ASUNTO = 'REMISION DE PERMISO';
const MEMO_TEXTO =
  'Por medio de la presente se remite a usted, la ausencia del personal de esta Gerencia, conforme a lo detallado a continuación:';

export const emptyMemo = (): MemoDatos => ({
  Numero: '', Siglas: '', Fecha: '', ParaNombre: '', ParaCargo: '', DeNombre: '', DeCargo: '',
  Asunto: MEMO_ASUNTO, Texto: MEMO_TEXTO, FirmaCargo: '', Iniciales: '',
});

// "2732-GTIC-IHSS-2026"
export function numeroMemo(datos: MemoDatos): string {
  return `${datos.Numero.trim()}-${datos.Siglas.trim().toUpperCase()}-IHSS-${datos.Fecha.slice(0, 4)}`;
}

// ---- Sin datos guardados ----------------------------------------------------------------
// El formulario del memo no se guarda: empieza en blanco cada vez. Una versión anterior lo
// recordaba en el navegador con esta clave; se borra para que no quede a la vista de quien entre.

const CLAVE_MEMO_ANTERIOR = 'control-permisos.memo';

export function olvidarEncabezadoMemo(): void {
  try {
    localStorage.removeItem(CLAVE_MEMO_ANTERIOR);
  } catch {
    // Sin almacenamiento (ventana privada): no hay nada que borrar.
  }
}

// ---- Filas ------------------------------------------------------------------------------

const PARTICULAS = new Set(['de', 'del', 'la', 'las', 'los', 'y', 'e']);

// "JOCELYN ARLETTE DE LA O" -> "Jocelyn Arlette de la O", como en el memo oficial.
export function nombrePropio(nombre: string): string {
  return nombre.trim().toLocaleLowerCase('es').split(/\s+/)
    .map((parte, i) => i > 0 && PARTICULAS.has(parte) ? parte : parte.charAt(0).toLocaleUpperCase('es') + parte.slice(1))
    .join(' ');
}

// Permisos por día y por horas activos que salieron (fecha de inicio) dentro del rango, sin
// vacaciones ni anulados. Como en el memo oficial: primero los de horas y luego los de día, cada
// grupo por fecha, hora y nombre.
export function permisosParaMemo(permisos: readonly Permiso[], desde: string, hasta: string): Permiso[] {
  const orden = (permiso: Permiso) => permiso.Tipo === 'HORA' ? 0 : 1;
  return permisos
    .filter((permiso) => {
      const dia = apiDay(permiso.FechaInicio);
      return permiso.Tipo !== 'VAC' && permiso.Estado === 'ACTIVO' && dia >= desde && dia <= hasta;
    })
    .sort((a, b) => orden(a) - orden(b)
      || apiDay(a.FechaInicio).localeCompare(apiDay(b.FechaInicio))
      || (a.HoraSalida ?? '').localeCompare(b.HoraSalida ?? '')
      || a.Empleado.localeCompare(b.Empleado, 'es'));
}

export function filaMemo(permiso: Permiso, noPago: string): MemoFila {
  const [anio, mes, dia] = apiDay(permiso.FechaInicio).split('-');
  const horas = permiso.Tipo === 'HORA' && permiso.HoraSalida && permiso.HoraEntrada
    ? `${permiso.HoraSalida}-${permiso.HoraEntrada}` : '';
  return {
    Nombre: nombrePropio(permiso.Empleado),
    NoPago: noPago.trim(),
    Fecha: `${dia}/${mes}/${anio}`,
    Dia: permiso.Tipo === 'DIA' ? String(permiso.DiasHabiles) : '',
    Hora: horas,
  };
}

// ---- Medición del texto -----------------------------------------------------------------
// F1 Helvetica-Bold, F2 Helvetica, F3 Times-Roman, F4 Times-Bold. Arial y Times New Roman tienen las
// mismas medidas que Helvetica y Times, así que el navegador mide con ellas para centrar y partir.

export type MemoFuente = 'F1' | 'F2' | 'F3' | 'F4';
export type MemoMedidor = (texto: string, fuente: MemoFuente, tamano: number) => number;

const FUENTES_PDF: Record<MemoFuente, string> = { F1: 'Helvetica-Bold', F2: 'Helvetica', F3: 'Times-Roman', F4: 'Times-Bold' };
const FUENTES_CSS: Record<MemoFuente, string> = {
  F1: 'bold 100px Arial', F2: '100px Arial', F3: '100px "Times New Roman"', F4: 'bold 100px "Times New Roman"',
};

// Sin lienzo (pruebas): un ancho promedio por letra.
export const medidorAproximado: MemoMedidor = (texto, fuente, tamano) => texto.length * tamano * (fuente === 'F1' ? 0.6 : 0.5);

function medidorNavegador(): MemoMedidor {
  const contexto = typeof OffscreenCanvas === 'undefined' ? null : new OffscreenCanvas(1, 1).getContext('2d');
  if (!contexto) return medidorAproximado;
  return (texto, fuente, tamano) => {
    contexto.font = FUENTES_CSS[fuente];
    return (contexto.measureText(texto).width * tamano) / 100;
  };
}

// ---- PDF --------------------------------------------------------------------------------

const ANCHO = 612;
const ALTO = 792;
const IZQ = 72;
const DER = 540;
// Debajo de esta altura empieza el pie del membrete (línea en 722, dirección y franja). Las filas de
// la tabla llegan hasta LIMITE; la firma, que va sola a la izquierda, puede bajar hasta LIMITE_FIRMA.
const LIMITE = 705;
const LIMITE_FIRMA = 714;
// Inicio del contenido en las hojas siguientes, debajo del encabezado del membrete.
const INICIO_SIGUIENTE = 112;
// Columnas del memo oficial (en puntos): No., Nombre, Número de pago, Fecha, Día, Hora.
const COLUMNAS = [35.2, 134.65, 70.9, 92.15, 42.5, 123.3];
const TITULOS = ['No.', 'Nombre', 'Número de Pago', 'FECHA', 'DIA', 'HORA'];
const TABLA_X = (ANCHO - COLUMNAS.reduce((suma, ancho) => suma + ancho, 0)) / 2;

const WIN_ANSI: Record<string, number> = {
  '€': 0x80, '‚': 0x82, 'ƒ': 0x83, '„': 0x84, '…': 0x85, '†': 0x86, '‡': 0x87, 'ˆ': 0x88, '‰': 0x89, 'Š': 0x8a,
  '‹': 0x8b, 'Œ': 0x8c, 'Ž': 0x8e, '‘': 0x91, '’': 0x92, '“': 0x93, '”': 0x94, '•': 0x95, '–': 0x96, '—': 0x97,
  '˜': 0x98, '™': 0x99, 'š': 0x9a, '›': 0x9b, 'œ': 0x9c, 'ž': 0x9e, 'Ÿ': 0x9f,
};

// Cadena del PDF en WinAnsi (la codificación de las fuentes estándar); lo que no existe sale "?".
function cadena(texto: string): string {
  let salida = '';
  for (const letra of texto.normalize('NFC').replace(/\s+/g, ' ')) {
    const codigo = letra.charCodeAt(0);
    const byte = (codigo >= 0x20 && codigo < 0x7f) || (codigo >= 0xa0 && codigo <= 0xff) ? codigo : WIN_ANSI[letra] ?? 0x3f;
    const caracter = String.fromCharCode(byte);
    salida += caracter === '(' || caracter === ')' || caracter === '\\' ? `\\${caracter}` : caracter;
  }
  return `(${salida})`;
}

const num = (valor: number): string => String(Math.round(valor * 100) / 100);

// Contenido de una hoja. Las coordenadas se dan desde arriba (como se lee la hoja) y se pasan a
// las del PDF, que cuenta desde abajo.
class Hoja {
  readonly ops: string[] = [];

  texto(texto: string, x: number, y: number, fuente: MemoFuente, tamano: number, espacioPalabras = 0): void {
    if (!texto) return;
    this.ops.push(`BT /${fuente} ${num(tamano)} Tf ${num(espacioPalabras)} Tw ${num(x)} ${num(ALTO - y)} Td ${cadena(texto)} Tj ET`);
  }

  linea(x1: number, y1: number, x2: number, y2: number, grosor = 0.75): void {
    this.ops.push(`${num(grosor)} w ${num(x1)} ${num(ALTO - y1)} m ${num(x2)} ${num(ALTO - y2)} l S`);
  }

  rectangulo(x: number, y: number, ancho: number, alto: number, relleno?: number): void {
    const caja = `${num(x)} ${num(ALTO - y - alto)} ${num(ancho)} ${num(alto)} re`;
    if (relleno !== undefined) this.ops.push(`${num(relleno)} g ${caja} f 0 g`);
    this.ops.push(`0.5 w ${caja} S`);
  }

  // Carpeta pequeña delante de "Archivo" y de las iniciales, como en el memo oficial.
  carpeta(x: number, base: number): void {
    const arriba = base - 7;
    const abajo = base + 0.5;
    const puntos: [number, number][] = [[x, arriba], [x + 4, arriba], [x + 5, arriba + 1.5], [x + 11, arriba + 1.5], [x + 11, abajo]];
    this.ops.push(`0.5 w ${num(x)} ${num(ALTO - abajo)} m ${puntos.map(([px, py]) => `${num(px)} ${num(ALTO - py)} l`).join(' ')} h S`);
  }
}

// Parte el texto en renglones que quepan en el ancho (una palabra más larga que el ancho va sola).
function partir(texto: string, ancho: number, fuente: MemoFuente, tamano: number, medir: MemoMedidor): string[] {
  const renglones: string[] = [];
  let actual = '';
  for (const palabra of texto.trim().split(/\s+/).filter(Boolean)) {
    const prueba = actual ? `${actual} ${palabra}` : palabra;
    if (!actual || medir(prueba, fuente, tamano) <= ancho) actual = prueba;
    else { renglones.push(actual); actual = palabra; }
  }
  if (actual) renglones.push(actual);
  return renglones.length ? renglones : [''];
}

interface Jpeg { ancho: number; alto: number; componentes: number }

// Tamaño y canales del JPEG (marcador SOF), que el PDF necesita para mostrarlo tal cual.
export function infoJpeg(bytes: Uint8Array): Jpeg | null {
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
  let i = 2;
  while (i + 9 < bytes.length) {
    if (bytes[i] !== 0xff) return null;
    const marcador = bytes[i + 1];
    if (marcador >= 0xc0 && marcador <= 0xcf && marcador !== 0xc4 && marcador !== 0xc8 && marcador !== 0xcc) {
      return { alto: (bytes[i + 5] << 8) | bytes[i + 6], ancho: (bytes[i + 7] << 8) | bytes[i + 8], componentes: bytes[i + 9] };
    }
    i += 2 + ((bytes[i + 2] << 8) | bytes[i + 3]);
  }
  return null;
}

// Hojas de un memo en construcción y la altura (desde arriba) por donde va el contenido.
class Memo {
  readonly hojas: Hoja[] = [];
  hoja!: Hoja;
  y = 0;

  constructor(readonly datos: MemoDatos, readonly medir: MemoMedidor) { this.nuevaHoja(); }

  nuevaHoja(): void {
    this.hoja = new Hoja();
    this.hojas.push(this.hoja);
    this.y = INICIO_SIGUIENTE;
  }

  centrado(texto: string, y: number, fuente: MemoFuente, tamano: number): void {
    this.hoja.texto(texto, (ANCHO - this.medir(texto, fuente, tamano)) / 2, y, fuente, tamano);
  }
}

// Encabezado: número, Para, De, Asunto y Fecha entre dos líneas. Deja y sobre la segunda línea.
function encabezado(memo: Memo): void {
  const { datos, medir, hoja } = memo;
  let y = 118;
  memo.centrado(`MEMORANDO No. ${numeroMemo(datos)}`, y, 'F1', 13);
  hoja.linea(IZQ, y + 13, DER, y + 13);
  y = 155;
  // Helvetica es más ancha que la Tahoma del memo oficial: un cargo largo primero achica la letra
  // (hasta 8.5) para quedar en un renglón, y solo si aun así no cabe se parte.
  const campo = (etiqueta: string, renglones: [string, MemoFuente][]) => {
    hoja.texto(etiqueta, 108, y, 'F1', 10);
    let escritos = 0;
    for (const [texto, fuente] of renglones) {
      let tamano = 10;
      while (tamano > 8.5 && medir(texto.trim(), fuente, tamano) > DER - 180) tamano -= 0.25;
      for (const renglon of texto.trim() ? partir(texto, DER - 180, fuente, tamano, medir) : []) {
        hoja.texto(renglon, 180, y, fuente, tamano);
        y += 12;
        escritos++;
      }
    }
    y += (escritos ? 0 : 12) + 13;
  };
  campo('PARA:', [[datos.ParaNombre.toUpperCase(), 'F1'], [datos.ParaCargo.toUpperCase(), 'F2']]);
  campo('DE:', [[datos.DeNombre.toUpperCase(), 'F1'], [datos.DeCargo.toUpperCase(), 'F2']]);
  campo('ASUNTO:', [[datos.Asunto.toUpperCase(), 'F2']]);
  campo('FECHA:', [[datos.Fecha ? fechaSinDia(datos.Fecha) : '', 'F2']]);
  y -= 12;
  hoja.linea(IZQ, y, DER, y);
  memo.y = y;
}

// Cierre ("Sin más...", "Atentamente"), firma, cargo, Archivo e iniciales. Cada memo oficial los
// separa distinto: el de permisos en Times y junto; el de vacaciones en Tahoma y más espaciado.
interface EstiloCierre { fuente: MemoFuente; tamano: number; atentamente: string; antes: number; entre: number; firma: number; archivo: number }
const CIERRE_PERMISOS: EstiloCierre = { fuente: 'F3', tamano: 12, atentamente: 'Atentamente,', antes: 17, entre: 35, firma: 54, archivo: 11 };
const CIERRE_VACACIONES: EstiloCierre = { fuente: 'F2', tamano: 11, atentamente: 'Atentamente', antes: 45, entre: 42, firma: 80, archivo: 36 };

function cierre(memo: Memo, estilo: EstiloCierre): void {
  const { datos, medir } = memo;
  const firmaCargo = datos.FirmaCargo.trim() ? partir(datos.FirmaCargo, DER - IZQ, 'F1', 10, medir) : [];
  const alto = estilo.antes + estilo.entre + estilo.firma + firmaCargo.length * 11 + estilo.archivo + (datos.Iniciales.trim() ? 12 : 0);
  // Si no cabe debajo de lo anterior, pasa entero a otra hoja.
  if (memo.y + alto > LIMITE_FIRMA) {
    memo.nuevaHoja();
    memo.y -= estilo.antes;
  }
  const hoja = memo.hoja;
  memo.y += estilo.antes;
  hoja.texto('Sin más sobre el particular,', IZQ, memo.y, estilo.fuente, estilo.tamano);
  memo.y += estilo.entre;
  hoja.texto(estilo.atentamente, IZQ, memo.y, estilo.fuente, estilo.tamano);
  memo.y += estilo.firma;
  hoja.texto(datos.DeNombre.trim().toUpperCase(), IZQ, memo.y, 'F1', 10);
  for (const renglon of firmaCargo) {
    memo.y += 11;
    hoja.texto(renglon, IZQ, memo.y, 'F1', 10);
  }
  memo.y += estilo.archivo;
  hoja.carpeta(IZQ + 4, memo.y);
  hoja.texto('Archivo', IZQ + 18, memo.y, 'F2', 9);
  if (datos.Iniciales.trim()) {
    memo.y += 12;
    hoja.carpeta(IZQ + 4, memo.y);
    hoja.texto(datos.Iniciales.trim().toUpperCase(), IZQ + 18, memo.y, 'F2', 9);
  }
}

// Pie de cada hoja (la dirección del membrete y, con varias hojas, el número de hoja) y el archivo.
function terminar(memo: Memo, membrete: Uint8Array | null): Uint8Array {
  const { hojas, medir } = memo;
  hojas.forEach((hoja, i) => {
    memo.hoja = hoja;
    memo.centrado('Unidad de Comunicación Social, undécimo piso, Edificio Administrativo, Bo. Abajo Tegucigalpa', 738, 'F3', 8);
    const telefono = 'Teléfono: (504) 2222-1128, ';
    const correo = 'consultas@ihss.hn';
    const inicio = (ANCHO - medir(telefono + correo, 'F4', 8)) / 2;
    const xCorreo = inicio + medir(telefono, 'F4', 8);
    hoja.texto(telefono + correo, inicio, 747, 'F4', 8);
    hoja.linea(xCorreo, 748.5, xCorreo + medir(correo, 'F4', 8), 748.5, 0.4);
    if (hojas.length > 1) {
      const pagina = `Página ${i + 1} de ${hojas.length}`;
      hoja.texto(pagina, DER - medir(pagina, 'F3', 8), 714, 'F3', 8);
    }
  });
  return ensamblar(hojas, membrete, `Memorando ${numeroMemo(memo.datos)}`);
}

/** PDF del memorando de permisos (hoja carta) con el membrete de fondo, si se da. */
export function memoPdf(datos: MemoDatos, filas: readonly MemoFila[], membrete: Uint8Array | null, medir: MemoMedidor = medidorNavegador()): Uint8Array {
  const memo = new Memo(datos, medir);
  encabezado(memo);

  // Párrafo justificado (Times 12, interlineado de 1.5 como el memo oficial).
  memo.y += 18;
  const parrafo = partir(datos.Texto, DER - IZQ, 'F3', 12, medir);
  parrafo.forEach((renglon, i) => {
    const espacios = renglon.split(' ').length - 1;
    const sobra = DER - IZQ - medir(renglon, 'F3', 12);
    const justificar = i < parrafo.length - 1 && espacios > 0 && sobra > 0;
    memo.hoja.texto(renglon, IZQ, memo.y, 'F3', 12, justificar ? sobra / espacios : 0);
    memo.y += 18;
  });
  memo.y += 6;

  // Tabla: encabezado gris, y cada celda parte su texto si no le cabe (el nombre, sobre todo).
  const INTERLINEA = 11.5;
  const fila = (celdas: string[], fuente: MemoFuente, relleno?: number) => {
    const renglones = celdas.map((texto, i) => partir(texto, COLUMNAS[i] - 6, fuente, 11, medir));
    const alto = Math.max(...renglones.map((r) => r.length)) * INTERLINEA + 3.5;
    let x = TABLA_X;
    renglones.forEach((lineas, i) => {
      memo.hoja.rectangulo(x, memo.y, COLUMNAS[i], alto, relleno);
      let base = memo.y + (alto - lineas.length * INTERLINEA) / 2 + 8.8;
      for (const linea of lineas) {
        const izquierda = i === 1 && relleno === undefined;
        const posicion = izquierda ? x + 4 : x + (COLUMNAS[i] - medir(linea, fuente, 11)) / 2;
        memo.hoja.texto(linea, posicion, base, fuente, 11);
        base += INTERLINEA;
      }
      x += COLUMNAS[i];
    });
    memo.y += alto;
  };
  const altoFila = (celdas: string[]) =>
    Math.max(...celdas.map((texto, i) => partir(texto, COLUMNAS[i] - 6, 'F3', 11, medir).length)) * INTERLINEA + 3.5;
  const encabezadoTabla = () => fila(TITULOS, 'F4', 0.85);

  encabezadoTabla();
  filas.forEach((datosFila, i) => {
    const celdas = [String(i + 1), datosFila.Nombre, datosFila.NoPago, datosFila.Fecha, datosFila.Dia, datosFila.Hora];
    if (memo.y + altoFila(celdas) > LIMITE) {
      memo.nuevaHoja();
      encabezadoTabla();
    }
    fila(celdas, 'F3');
  });

  cierre(memo, CIERRE_PERMISOS);
  return terminar(memo, membrete);
}

// ---- Memo de vacaciones -----------------------------------------------------------------

// Una solicitud de vacaciones de un empleado: los días (hábiles) de los períodos elegidos y cada
// período con lo que se escribe entre paréntesis después de "inclusive" (ej. 2024-2025).
export interface MemoVacaciones {
  Nombre: string;
  NoPago: string;
  Dias: number;
  Periodos: { Desde: string; Hasta: string; Periodo: string }[];
}

export const MEMO_ASUNTO_VACACIONES = 'REMISION SOLICITUD DE VACACIONES';

const UNIDADES = ['CERO', 'UN', 'DOS', 'TRES', 'CUATRO', 'CINCO', 'SEIS', 'SIETE', 'OCHO', 'NUEVE', 'DIEZ', 'ONCE', 'DOCE',
  'TRECE', 'CATORCE', 'QUINCE', 'DIECISÉIS', 'DIECISIETE', 'DIECIOCHO', 'DIECINUEVE', 'VEINTE', 'VEINTIÚN', 'VEINTIDÓS',
  'VEINTITRÉS', 'VEINTICUATRO', 'VEINTICINCO', 'VEINTISÉIS', 'VEINTISIETE', 'VEINTIOCHO', 'VEINTINUEVE'];
const DECENAS = ['', '', '', 'TREINTA', 'CUARENTA', 'CINCUENTA', 'SESENTA', 'SETENTA', 'OCHENTA', 'NOVENTA'];
const CENTENAS = ['', 'CIENTO', 'DOSCIENTOS', 'TRESCIENTOS', 'CUATROCIENTOS', 'QUINIENTOS', 'SEISCIENTOS', 'SETECIENTOS',
  'OCHOCIENTOS', 'NOVECIENTOS'];

// Cantidad de días en letras, como se escribe antes de "días": 1 UN, 18 DIECIOCHO, 21 VEINTIÚN,
// 31 TREINTA Y UN, 100 CIEN. De 0 a 999.
export function numeroEnLetras(numero: number): string {
  if (numero < 30) return UNIDADES[numero];
  if (numero < 100) return DECENAS[Math.floor(numero / 10)] + (numero % 10 ? ` Y ${UNIDADES[numero % 10]}` : '');
  if (numero === 100) return 'CIEN';
  return CENTENAS[Math.floor(numero / 100)] + (numero % 100 ? ` ${numeroEnLetras(numero % 100)}` : '');
}

// "DIECIOCHO (18)"; con medio día (no debería pasar en vacaciones) solo el número: "(1.5)".
export function diasEnLetras(dias: number): string {
  return Number.isInteger(dias) && dias >= 0 && dias < 1000 ? `${numeroEnLetras(dias)} (${dias})` : `(${dias})`;
}

// "Del 16 al 30 de noviembre del 2026", "Del 30 de noviembre al 4 de diciembre del 2026",
// "Del 28 de diciembre del 2026 al 8 de enero del 2027" o, de un día, "El 16 de noviembre del 2026".
export function rangoVacaciones(desde: string, hasta: string): string {
  const [a1, m1, d1] = desde.split('-').map(Number);
  const [a2, m2, d2] = hasta.split('-').map(Number);
  const dia = (d: number, m: number) => `${d} de ${MESES[m - 1]}`;
  if (desde === hasta) return `El ${dia(d1, m1)} del ${a1}`;
  if (a1 !== a2) return `Del ${dia(d1, m1)} del ${a1} al ${dia(d2, m2)} del ${a2}`;
  if (m1 !== m2) return `Del ${dia(d1, m1)} al ${dia(d2, m2)} del ${a2}`;
  return `Del ${d1} al ${dia(d2, m2)} del ${a2}`;
}

export function lineaVacaciones(periodo: MemoVacaciones['Periodos'][number]): string {
  const parentesis = periodo.Periodo.trim() ? ` (${periodo.Periodo.trim()})` : '';
  return `${rangoVacaciones(periodo.Desde, periodo.Hasta)}, inclusive${parentesis}`;
}

interface Trozo { texto: string; fuente: MemoFuente; subrayado?: boolean; pegado?: boolean }

// Párrafo justificado con partes en negrita y subrayadas: cada palabra se coloca por separado, y
// el subrayado sigue por los espacios entre palabras de una misma parte (el nombre completo).
function parrafoRico(memo: Memo, trozos: Trozo[], tamano: number, interlinea: number): void {
  const { medir } = memo;
  const espacio = medir(' ', 'F2', tamano);
  const palabras = trozos.flatMap((trozo, grupo) => trozo.texto.trim().split(/\s+/).filter(Boolean).map((texto, i) => ({
    texto, fuente: trozo.fuente, ancho: medir(texto, trozo.fuente, tamano), subrayado: !!trozo.subrayado,
    conEspacio: !(i === 0 && trozo.pegado), grupo,
  })));
  const ancho = DER - IZQ;
  const renglones: (typeof palabras)[] = [];
  let actual: typeof palabras = [];
  let usado = 0;
  for (const palabra of palabras) {
    const suma = (actual.length && palabra.conEspacio ? espacio : 0) + palabra.ancho;
    if (actual.length && usado + suma > ancho) {
      renglones.push(actual);
      actual = [palabra];
      usado = palabra.ancho;
    } else {
      actual.push(palabra);
      usado += suma;
    }
  }
  if (actual.length) renglones.push(actual);

  renglones.forEach((renglon, n) => {
    if (memo.y > LIMITE) memo.nuevaHoja();
    const huecos = renglon.filter((p, i) => i > 0 && p.conEspacio).length;
    const natural = renglon.reduce((suma, p, i) => suma + p.ancho + (i > 0 && p.conEspacio ? espacio : 0), 0);
    const hueco = espacio + (n < renglones.length - 1 && huecos ? (ancho - natural) / huecos : 0);
    let x = IZQ;
    renglon.forEach((palabra, i) => {
      if (i > 0 && palabra.conEspacio) {
        const anterior = renglon[i - 1];
        if (palabra.subrayado && anterior.subrayado && anterior.grupo === palabra.grupo) {
          memo.hoja.linea(x, memo.y + 1.8, x + hueco, memo.y + 1.8, 0.6);
        }
        x += hueco;
      }
      memo.hoja.texto(palabra.texto, x, memo.y, palabra.fuente, tamano);
      if (palabra.subrayado) memo.hoja.linea(x, memo.y + 1.8, x + palabra.ancho, memo.y + 1.8, 0.6);
      x += palabra.ancho;
    });
    memo.y += interlinea;
  });
}

/** PDF del memorando de vacaciones de un empleado, como el oficial (Tahoma -> Helvetica 11, interlineado doble). */
export function memoVacacionesPdf(datos: MemoDatos, vacaciones: MemoVacaciones, membrete: Uint8Array | null,
  medir: MemoMedidor = medidorNavegador()): Uint8Array {
  const memo = new Memo(datos, medir);
  encabezado(memo);
  const TAMANO = 11;
  const INTERLINEA = 21;
  const unDia = vacaciones.Dias === 1;
  memo.y += 30;
  parrafoRico(memo, [
    { texto: 'Para los trámites pertinentes, adjunto al presente remito a usted solicitud de', fuente: 'F2' },
    { texto: diasEnLetras(vacaciones.Dias), fuente: 'F1', subrayado: true },
    { texto: `${unDia ? 'día' : 'días'} de vacaciones de`, fuente: 'F2' },
    { texto: vacaciones.Nombre, fuente: 'F1', subrayado: true },
    { texto: 'con pago No.', fuente: 'F2' },
    { texto: vacaciones.NoPago, fuente: 'F1', subrayado: true, pegado: true },
    { texto: `y empleado de esta gerencia, mismo que ${unDia ? 'será gozado' : 'serán gozados'} de la siguiente manera:`, fuente: 'F2' },
  ], TAMANO, INTERLINEA);

  // Lista numerada de los períodos, con sangría como en el memo oficial.
  vacaciones.Periodos.forEach((periodo, i) => {
    partir(lineaVacaciones(periodo), DER - 92, 'F2', TAMANO, medir).forEach((renglon, j) => {
      if (memo.y > LIMITE) memo.nuevaHoja();
      if (j === 0) memo.hoja.texto(`${i + 1}.`, 77, memo.y, 'F2', TAMANO);
      memo.hoja.texto(renglon, 92, memo.y, 'F2', TAMANO);
      memo.y += INTERLINEA;
    });
  });
  memo.y -= INTERLINEA;

  cierre(memo, CIERRE_VACACIONES);
  return terminar(memo, membrete);
}

// Archivo PDF 1.4: catálogo, páginas, las cuatro fuentes, el membrete (JPEG tal cual) y cada hoja
// con su contenido; al final la tabla de referencias con la posición de cada objeto.
function ensamblar(hojas: Hoja[], membrete: Uint8Array | null, titulo: string): Uint8Array {
  const jpeg = membrete ? infoJpeg(membrete) : null;
  const partes: Uint8Array[] = [];
  const posiciones: number[] = [];
  let largo = 0;
  const bytes = (texto: string): Uint8Array => Uint8Array.from(texto, (letra) => letra.charCodeAt(0) & 0xff);
  const agregar = (parte: string | Uint8Array) => {
    const datos = typeof parte === 'string' ? bytes(parte) : parte;
    partes.push(datos);
    largo += datos.length;
  };
  const objeto = (numero: number, ...cuerpo: (string | Uint8Array)[]) => {
    posiciones[numero] = largo;
    agregar(`${numero} 0 obj\n`);
    cuerpo.forEach(agregar);
    agregar('\nendobj\n');
  };

  const imagen = jpeg ? 7 : 0;
  const primeraHoja = jpeg ? 8 : 7;
  const info = primeraHoja + hojas.length * 2;
  agregar('%PDF-1.4\n%\xe2\xe3\xcf\xd3\n');
  objeto(1, '<< /Type /Catalog /Pages 2 0 R >>');
  const kids = hojas.map((_, i) => `${primeraHoja + i * 2} 0 R`).join(' ');
  objeto(2, `<< /Type /Pages /Kids [${kids}] /Count ${hojas.length} >>`);
  (['F1', 'F2', 'F3', 'F4'] as MemoFuente[]).forEach((fuente, i) =>
    objeto(3 + i, `<< /Type /Font /Subtype /Type1 /BaseFont /${FUENTES_PDF[fuente]} /Encoding /WinAnsiEncoding >>`));
  if (jpeg && membrete) {
    const espacio = jpeg.componentes === 1 ? '/DeviceGray' : jpeg.componentes === 4 ? '/DeviceCMYK /Decode [1 0 1 0 1 0 1 0]' : '/DeviceRGB';
    objeto(imagen,
      `<< /Type /XObject /Subtype /Image /Width ${jpeg.ancho} /Height ${jpeg.alto} /ColorSpace ${espacio} /BitsPerComponent 8 /Filter /DCTDecode /Length ${membrete.length} >>\nstream\n`,
      membrete, '\nendstream');
  }
  const recursos = `/Font << /F1 3 0 R /F2 4 0 R /F3 5 0 R /F4 6 0 R >>${jpeg ? ` /XObject << /Im1 ${imagen} 0 R >>` : ''}`;
  hojas.forEach((hoja, i) => {
    const numero = primeraHoja + i * 2;
    const fondo = jpeg ? `q ${ANCHO} 0 0 ${ALTO} 0 0 cm /Im1 Do Q\n` : '';
    const contenido = bytes(`${fondo}0 g 0 G\n${hoja.ops.join('\n')}\n`);
    objeto(numero, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${ANCHO} ${ALTO}] /Resources << ${recursos} >> /Contents ${numero + 1} 0 R >>`);
    objeto(numero + 1, `<< /Length ${contenido.length} >>\nstream\n`, contenido, '\nendstream');
  });
  objeto(info, `<< /Title ${cadena(titulo)} /Producer (Control de permisos IHSS) >>`);

  const xref = largo;
  const total = info + 1;
  agregar(`xref\n0 ${total}\n0000000000 65535 f \n`);
  for (let numero = 1; numero < total; numero++) {
    agregar(`${String(posiciones[numero] ?? 0).padStart(10, '0')} 00000 ${posiciones[numero] === undefined ? 'f' : 'n'} \n`);
  }
  agregar(`trailer\n<< /Size ${total} /Root 1 0 R /Info ${info} 0 R >>\nstartxref\n${xref}\n%%EOF\n`);

  const pdf = new Uint8Array(largo);
  let posicion = 0;
  for (const parte of partes) { pdf.set(parte, posicion); posicion += parte.length; }
  return pdf;
}

// ---- Descarga ---------------------------------------------------------------------------

let membreteCache: Uint8Array | null = null;

async function cargarMembrete(base: string): Promise<Uint8Array> {
  if (membreteCache) return membreteCache;
  const respuesta = await fetch(`${base}impresion/membrete-memo.jpg`);
  if (!respuesta.ok) throw new Error(`No se pudo cargar el membrete (${respuesta.status}).`);
  membreteCache = new Uint8Array(await respuesta.arrayBuffer());
  return membreteCache;
}

/** Genera el PDF del memo de permisos y lo descarga como "Memorando 2732-GTIC-IHSS-2026.pdf". Devuelve el nombre. */
export async function descargarMemo(datos: MemoDatos, filas: readonly MemoFila[], documento: Document = window.document): Promise<string> {
  return descargar(datos, (membrete) => memoPdf(datos, filas, membrete), documento);
}

/** Igual, para el memo de vacaciones de un empleado. */
export async function descargarMemoVacaciones(datos: MemoDatos, vacaciones: MemoVacaciones, documento: Document = window.document): Promise<string> {
  return descargar(datos, (membrete) => memoVacacionesPdf(datos, vacaciones, membrete), documento);
}

async function descargar(datos: MemoDatos, generar: (membrete: Uint8Array) => Uint8Array, documento: Document): Promise<string> {
  const membrete = await cargarMembrete(documento.baseURI);
  const pdf = generar(membrete);
  const nombre = `Memorando ${numeroMemo(datos)}.pdf`;
  const url = URL.createObjectURL(new Blob([pdf.buffer as ArrayBuffer], { type: 'application/pdf' }));
  const enlace = documento.createElement('a');
  enlace.href = url;
  enlace.download = nombre;
  documento.body.appendChild(enlace);
  enlace.click();
  enlace.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
  return nombre;
}
