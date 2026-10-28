import { ReportColumn, addReportSheet, cellText, createReportWorkbook, downloadReportWorkbook, excelDate, generatedAt, reportFileName } from '../shared/excel-report';
import { PERMISO_TIPOS, Permiso, PermisoTipo } from './permisos.models';
import {
  MinutosJornada, PERMISO_ESTADOS, PermisoEstadoVista, ResumenEmpleado, apiDay, formatDay, isActive, resumenPorEmpleado,
} from './permisos-resumen';

// Filtros de la ventana "Exportar reporte". Las fechas son yyyy-mm-dd (input date): entra
// todo permiso que toque algún día del rango. Vacío = sin límite. idsEmpleado: los empleados
// marcados; vacío = todos.
export interface PermisoReportFilters {
  desde: string;
  hasta: string;
  tipo: PermisoTipo | '';
  estado: PermisoEstadoVista | '';
  idsEmpleado: number[];
}

export const emptyPermisoReportFilters = (): PermisoReportFilters => ({
  desde: '', hasta: '', tipo: '', estado: '', idsEmpleado: [],
});

const estadoLabel = (estado: PermisoEstadoVista): string =>
  PERMISO_ESTADOS.find((item) => item.value === estado)?.label ?? estado;

export const tipoLabel = (tipo: string): string =>
  PERMISO_TIPOS.find((item) => item.value === tipo)?.label ?? tipo;

// estadoDe da el estado que se ve en pantalla (activo, finalizado o anulado).
export function filterPermisosForReport(
  permisos: readonly Permiso[],
  filters: PermisoReportFilters,
  estadoDe: (permiso: Permiso) => PermisoEstadoVista,
): Permiso[] {
  return permisos.filter((permiso) => {
    if (filters.desde && apiDay(permiso.FechaFin) < filters.desde) return false;
    if (filters.hasta && apiDay(permiso.FechaInicio) > filters.hasta) return false;
    if (filters.tipo && permiso.Tipo !== filters.tipo) return false;
    if (filters.estado && estadoDe(permiso) !== filters.estado) return false;
    if (filters.idsEmpleado.length > 0 && !filters.idsEmpleado.includes(permiso.IdEmpleado)) return false;
    return true;
  });
}

/** "Empleado: ANA LOPEZ", "Empleados: ANA LOPEZ, LUIS PAZ" o, con más de tres, "Empleados: 5 seleccionados". */
export function employeesLabel(employeeNames: readonly string[]): string {
  if (employeeNames.length === 0) return '';
  if (employeeNames.length === 1) return `Empleado: ${employeeNames[0]}`;
  return employeeNames.length <= 3
    ? `Empleados: ${employeeNames.join(', ')}`
    : `Empleados: ${employeeNames.length} seleccionados`;
}

function filtersLabel(filters: PermisoReportFilters, employeeNames: readonly string[], alcanceName: string): string {
  const period = filters.desde && filters.hasta ? `Del ${formatDay(filters.desde)} al ${formatDay(filters.hasta)}`
    : filters.desde ? `Desde el ${formatDay(filters.desde)}`
      : filters.hasta ? `Hasta el ${formatDay(filters.hasta)}` : 'Todos los permisos';
  return [
    alcanceName || 'Todos los departamentos',
    period,
    filters.tipo ? `Tipo: ${tipoLabel(filters.tipo).toLowerCase()}` : '',
    filters.estado ? `Estado: ${estadoLabel(filters.estado).toLowerCase()}` : '',
    employeesLabel(employeeNames),
  ].filter(Boolean).join(' · ');
}

const hours = (minutes: number): number => Math.round((minutes / 60) * 100) / 100;

/**
 * Genera y descarga el Excel del Control de permisos con el formato común de los reportes:
 * hoja "Permisos" con las columnas de la tabla web y hoja "Por empleado" con los totales
 * de los permisos activos del reporte.
 */
export async function exportPermisosReport(
  permisos: readonly Permiso[],
  filters: PermisoReportFilters,
  // Nombres de los empleados marcados; vacío = todos.
  employeeNames: readonly string[],
  // Jornada de cada permiso según su departamento, para convertir horas en días.
  minutosJornada: MinutosJornada,
  // Departamento y área de la pantalla, por ejemplo "GERENCIA DE INFORMATICA · Área: Soporte"; vacío = todo.
  alcanceName: string,
  estadoDe: (permiso: Permiso) => PermisoEstadoVista,
): Promise<void> {
  const workbook = await createReportWorkbook('Reporte de control de permisos');
  const filterText = filtersLabel(filters, employeeNames, alcanceName);
  const activos = permisos.filter(isActive);
  const finalizados = permisos.filter((permiso) => estadoDe(permiso) === 'FINALIZADO').length;

  const columns: ReportColumn<Permiso>[] = [
    { header: '#', width: 8, value: (p) => p.IdPermiso },
    { header: 'Tipo de permiso', width: 15, value: (p) => tipoLabel(p.Tipo) },
    { header: 'Fecha de solicitud', width: 17, format: 'date', value: (p) => excelDate(p.FechaSolicitud) },
    { header: 'Empleado', width: 34, value: (p) => p.Empleado },
    { header: 'No. de pago', width: 12, value: (p) => cellText(p.NoPago) },
    { header: 'Departamento', width: 26, value: (p) => cellText(p.NombreDepartamento) },
    { header: 'Área', width: 18, value: (p) => cellText(p.NombreArea, 'Sin área') },
    { header: 'Motivo', width: 44, wrap: true, value: (p) => p.Motivo },
    { header: 'Desde', width: 12, format: 'date', value: (p) => excelDate(p.FechaInicio) },
    { header: 'Hasta', width: 12, format: 'date', value: (p) => excelDate(p.FechaFin) },
    { header: 'Salida', width: 9, value: (p) => cellText(p.HoraSalida) },
    { header: 'Entrada', width: 9, value: (p) => cellText(p.HoraEntrada) },
    { header: 'Horas', width: 9, value: (p) => p.Tipo === 'HORA' ? hours(p.Minutos) : '-' },
    { header: 'Días hábiles', width: 12, value: (p) => p.Tipo === 'DIA' ? p.DiasHabiles : '-' },
    { header: 'Estado', width: 12, value: (p) => estadoDe(p) },
  ];
  addReportSheet(workbook, {
    sheetName: 'Permisos',
    title: 'REPORTE DE CONTROL DE PERMISOS',
    subtitle: `${permisos.length} permisos · ${activos.length - finalizados} activos · ${finalizados} finalizados · ${filterText} · ${generatedAt()}`,
    tableName: 'ReportePermisos',
    columns,
    rows: permisos,
  });

  const summaryColumns: ReportColumn<ResumenEmpleado>[] = [
    { header: 'Empleado', width: 34, value: (r) => r.Empleado },
    { header: 'Permisos por día', width: 16, value: (r) => r.PermisosDia },
    { header: 'Días hábiles', width: 13, value: (r) => r.Dias },
    { header: 'Permisos por hora', width: 17, value: (r) => r.PermisosHora },
    { header: 'Horas', width: 9, value: (r) => hours(r.Minutos) },
    { header: 'Total en días', width: 14, value: (r) => Math.round(r.TotalDias * 100) / 100 },
  ];
  addReportSheet(workbook, {
    sheetName: 'Por empleado',
    title: 'PERMISOS POR EMPLEADO',
    subtitle: `Sin los permisos anulados · total en días = días hábiles + horas ÷ jornada del departamento · ${filterText} · ${generatedAt()}`,
    tableName: 'ResumenPorEmpleado',
    columns: summaryColumns,
    rows: resumenPorEmpleado(activos, minutosJornada),
  });

  await downloadReportWorkbook(workbook, reportFileName('permisos'));
}
