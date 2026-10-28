import { Permiso } from './permisos.models';

// Cálculos del Control de permisos que comparten la pantalla y el reporte de Excel. Las
// fechas se manejan como texto yyyy-mm-dd: se comparan sin problemas de zona horaria.

export type PermisoPeriodo = 'mes' | 'anio' | 'todo';

const pad = (value: number) => String(value).padStart(2, '0');

/** Fecha local como yyyy-mm-dd. */
export function dayKey(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** Fecha de la API ("2026-10-27T00:00:00") como yyyy-mm-dd. */
export function apiDay(value: string | null | undefined): string {
  return value ? value.slice(0, 10) : '';
}

/** "2026-10-27" → "27/10/2026"; vacío → "-". */
export function formatDay(value: string | null | undefined): string {
  const day = apiDay(value);
  if (!day) return '-';
  const [year, month, date] = day.split('-');
  return `${date}/${month}/${year}`;
}

/** Minutos como "2 h 30 min"; 0 → "-". */
export function formatMinutes(minutes: number): string {
  if (!minutes) return '-';
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours === 0) return `${rest} min`;
  return rest === 0 ? `${hours} h` : `${hours} h ${rest} min`;
}

/** Número con hasta dos decimales, sin ceros de más: 1.5, 2, 0.25. */
export function formatNumber(value: number): string {
  return String(Math.round(value * 100) / 100);
}

export const isActive = (permiso: Permiso): boolean => permiso.Estado === 'ACTIVO';

/** Estado que se muestra: un permiso activo cuyo fin ya pasó se ve como finalizado. */
export type PermisoEstadoVista = 'ACTIVO' | 'FINALIZADO' | 'ANULADO';

/**
 * El de hora termina en su hora de entrada; el de día, al cierre de la jornada de su último
 * día. Es solo de pantalla: en la base sigue ACTIVO y cuenta igual en totales y límites.
 */
export function estadoVista(permiso: Permiso, now: Date, finJornada: string): PermisoEstadoVista {
  if (!isActive(permiso)) return 'ANULADO';
  const horaFin = permiso.Tipo === 'HORA' && permiso.HoraEntrada ? permiso.HoraEntrada : finJornada;
  const fin = `${apiDay(permiso.FechaFin)} ${horaFin}`;
  const ahora = `${dayKey(now)} ${pad(now.getHours())}:${pad(now.getMinutes())}`;
  return ahora >= fin ? 'FINALIZADO' : 'ACTIVO';
}

export const PERMISO_ESTADOS: { value: PermisoEstadoVista; label: string }[] = [
  { value: 'ACTIVO', label: 'Activos' },
  { value: 'FINALIZADO', label: 'Finalizados' },
  { value: 'ANULADO', label: 'Anulados' },
];

/** El permiso toca algún día del rango [desde, hasta] (yyyy-mm-dd, ambos incluidos). */
export function overlaps(permiso: Permiso, desde: string, hasta: string): boolean {
  return apiDay(permiso.FechaInicio) <= hasta && apiDay(permiso.FechaFin) >= desde;
}

/**
 * Minutos de la jornada para convertir horas en días: un número fijo o, cuando hay varios
 * departamentos, el de la jornada del departamento de cada permiso.
 */
export type MinutosJornada = number | ((permiso: Permiso) => number);

const minutosDe = (minutosJornada: MinutosJornada, permiso: Permiso): number =>
  typeof minutosJornada === 'number' ? minutosJornada : minutosJornada(permiso);

/** Días que representa el permiso: los hábiles, o las horas divididas entre la jornada. */
export function equivalentDays(permiso: Permiso, minutosJornada: number): number {
  return permiso.Tipo === 'DIA' ? permiso.DiasHabiles : permiso.Minutos / Math.max(minutosJornada, 1);
}

/** Lunes a domingo de la semana de la fecha indicada. */
export function weekRange(today: Date): { desde: string; hasta: string } {
  const monday = new Date(today.getFullYear(), today.getMonth(), today.getDate() - ((today.getDay() + 6) % 7));
  const sunday = new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + 6);
  return { desde: dayKey(monday), hasta: dayKey(sunday) };
}

export function monthRange(today: Date): { desde: string; hasta: string } {
  return {
    desde: dayKey(new Date(today.getFullYear(), today.getMonth(), 1)),
    hasta: dayKey(new Date(today.getFullYear(), today.getMonth() + 1, 0)),
  };
}

/**
 * Días hábiles del rango: lunes a viernes sin los feriados indicados (yyyy-mm-dd), igual que
 * los cuenta la API al guardar.
 */
export function weekdaysBetween(desde: string, hasta: string, feriados: readonly string[] = []): number {
  if (!desde || !hasta || hasta < desde) return 0;
  const noHabiles = new Set(feriados);
  const [y1, m1, d1] = desde.split('-').map(Number);
  const [y2, m2, d2] = hasta.split('-').map(Number);
  const end = new Date(y2, m2 - 1, d2);
  let total = 0;
  for (let day = new Date(y1, m1 - 1, d1); day <= end; day.setDate(day.getDate() + 1)) {
    if (day.getDay() !== 0 && day.getDay() !== 6 && !noHabiles.has(dayKey(day))) total++;
  }
  return total;
}

/** Minutos entre dos horas HH:mm; 0 si no son válidas o la entrada no es posterior. */
export function minutesBetween(salida: string, entrada: string): number {
  const toMinutes = (value: string) => {
    const match = /^(\d{1,2}):(\d{2})$/.exec(value?.trim() ?? '');
    return match ? Number(match[1]) * 60 + Number(match[2]) : NaN;
  };
  const difference = toMinutes(entrada) - toMinutes(salida);
  return Number.isFinite(difference) && difference > 0 ? difference : 0;
}

/**
 * Permisos cuya fecha de inicio cae en el período. El resumen usa la fecha de inicio para que
 * un permiso que cruza de un mes a otro se cuente una sola vez.
 */
export function inPeriod(permiso: Permiso, periodo: PermisoPeriodo, today: Date): boolean {
  const start = apiDay(permiso.FechaInicio);
  if (periodo === 'mes') return start.slice(0, 7) === dayKey(today).slice(0, 7);
  if (periodo === 'anio') return start.slice(0, 4) === String(today.getFullYear());
  return true;
}

export interface ResumenEmpleado {
  IdEmpleado: number;
  Empleado: string;
  PermisosDia: number;
  Dias: number;
  PermisosHora: number;
  Minutos: number;
  // Días + horas convertidas con la jornada (jornada completa = 1 día).
  TotalDias: number;
}

/** Totales por empleado de los permisos activos recibidos, de mayor a menor uso. */
export function resumenPorEmpleado(permisos: readonly Permiso[], minutosJornada: MinutosJornada): ResumenEmpleado[] {
  const rows = new Map<number, ResumenEmpleado>();
  for (const permiso of permisos.filter(isActive)) {
    const row = rows.get(permiso.IdEmpleado) ?? {
      IdEmpleado: permiso.IdEmpleado, Empleado: permiso.Empleado,
      PermisosDia: 0, Dias: 0, PermisosHora: 0, Minutos: 0, TotalDias: 0,
    };
    if (permiso.Tipo === 'DIA') {
      row.PermisosDia++;
      row.Dias += permiso.DiasHabiles;
    } else {
      row.PermisosHora++;
      row.Minutos += permiso.Minutos;
    }
    row.TotalDias += equivalentDays(permiso, minutosDe(minutosJornada, permiso));
    rows.set(permiso.IdEmpleado, row);
  }
  return [...rows.values()].sort((a, b) => b.TotalDias - a.TotalDias || a.Empleado.localeCompare(b.Empleado));
}

/** Uso de un empleado en el mes, en el año y en todo el historial. */
export interface ConsumoEmpleado {
  Mes: ResumenEmpleado;
  Anio: ResumenEmpleado;
  Todo: ResumenEmpleado;
}

/**
 * Totales de un empleado con sus permisos activos (sin anulados). excluirId deja fuera el
 * permiso que se está editando, para mostrar lo que lleva sin contarlo dos veces.
 */
export function consumoEmpleado(
  permisos: readonly Permiso[],
  idEmpleado: number,
  today: Date,
  minutosJornada: MinutosJornada,
  excluirId: number | null = null,
): ConsumoEmpleado {
  const propios = permisos.filter((permiso) => permiso.IdEmpleado === idEmpleado && permiso.IdPermiso !== excluirId);
  const total = (periodo: PermisoPeriodo): ResumenEmpleado =>
    resumenPorEmpleado(propios.filter((permiso) => inPeriod(permiso, periodo, today)), minutosJornada)[0] ?? {
      IdEmpleado: idEmpleado, Empleado: '', PermisosDia: 0, Dias: 0, PermisosHora: 0, Minutos: 0, TotalDias: 0,
    };
  return { Mes: total('mes'), Anio: total('anio'), Todo: total('todo') };
}

/** "2 días · 3 h 20 min"; sin permisos → "Sin permisos". */
export function consumoTexto(resumen: ResumenEmpleado): string {
  const partes = [
    resumen.Dias > 0 ? `${resumen.Dias} ${resumen.Dias === 1 ? 'día' : 'días'}` : '',
    resumen.Minutos > 0 ? formatMinutes(resumen.Minutos) : '',
  ].filter(Boolean);
  return partes.length > 0 ? partes.join(' · ') : 'Sin permisos';
}
