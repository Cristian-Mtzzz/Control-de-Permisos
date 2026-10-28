import { Permiso } from './permisos.models';
import { filterPermisosForReport, emptyPermisoReportFilters } from './permisos-report';
import {
  consumoEmpleado, consumoTexto, estadoVista, formatMinutes, inPeriod, minutesBetween, overlaps, resumenPorEmpleado,
  weekRange, weekdaysBetween,
} from './permisos-resumen';

const permiso = (overrides: Partial<Permiso>): Permiso => ({
  IdPermiso: 1, Tipo: 'DIA', IdEmpleado: 10, Empleado: 'ANA LOPEZ', NoPago: '123', Motivo: 'Cita',
  FechaInicio: '2026-10-26T00:00:00', FechaFin: '2026-10-28T00:00:00', HoraSalida: null, HoraEntrada: null,
  DiasHabiles: 3, Minutos: 0, FechaSolicitud: '2026-10-20T00:00:00',
  Estado: 'ACTIVO', FechaRegistro: '2026-10-20T09:00:00', IdArea: 1, NombreArea: 'Desarrollo',
  IdDepartamento: 20, NombreDepartamento: 'GERENCIA DE INFORMATICA', ...overrides,
});

describe('permisos resumen', () => {
  it('counts only Monday to Friday in a date range', () => {
    // Viernes 23 al martes 27 de octubre de 2026: viernes, lunes y martes.
    expect(weekdaysBetween('2026-10-23', '2026-10-27')).toBe(3);
    expect(weekdaysBetween('2026-10-24', '2026-10-25')).toBe(0);
    expect(weekdaysBetween('2026-10-27', '2026-10-26')).toBe(0);
  });

  it('leaves the holidays of the department out of the working days', () => {
    // Lunes 26 a viernes 30 de octubre con feriado el miércoles 28 (el sábado 31 no cuenta igual).
    expect(weekdaysBetween('2026-10-26', '2026-10-30', ['2026-10-28', '2026-10-31'])).toBe(4);
    expect(weekdaysBetween('2026-10-28', '2026-10-28', ['2026-10-28'])).toBe(0);
  });

  it('measures the minutes between exit and return', () => {
    expect(minutesBetween('08:00', '10:30')).toBe(150);
    expect(minutesBetween('10:30', '10:30')).toBe(0);
    expect(minutesBetween('', '10:30')).toBe(0);
    expect(formatMinutes(150)).toBe('2 h 30 min');
    expect(formatMinutes(45)).toBe('45 min');
  });

  it('builds the Monday to Sunday week of a date', () => {
    expect(weekRange(new Date(2026, 9, 29))).toEqual({ desde: '2026-10-26', hasta: '2026-11-01' });
    expect(weekRange(new Date(2026, 10, 1))).toEqual({ desde: '2026-10-26', hasta: '2026-11-01' });
  });

  it('detects permits that touch a range', () => {
    const p = permiso({});
    expect(overlaps(p, '2026-10-28', '2026-10-28')).toBe(true);
    expect(overlaps(p, '2026-10-29', '2026-10-31')).toBe(false);
  });

  it('assigns permits to the period of their start date', () => {
    const crossing = permiso({ FechaInicio: '2026-10-30T00:00:00', FechaFin: '2026-11-03T00:00:00' });
    expect(inPeriod(crossing, 'mes', new Date(2026, 9, 15))).toBe(true);
    expect(inPeriod(crossing, 'mes', new Date(2026, 10, 15))).toBe(false);
  });

  it('adds days and hours per employee, ignoring cancelled permits', () => {
    const rows = resumenPorEmpleado([
      permiso({}),
      permiso({ IdPermiso: 2, Tipo: 'HORA', DiasHabiles: 0, Minutos: 240 }),
      permiso({ IdPermiso: 3, Estado: 'ANULADO' }),
      permiso({ IdPermiso: 4, IdEmpleado: 11, Empleado: 'LUIS PAZ', DiasHabiles: 1 }),
    ], 480);
    expect(rows.map((row) => row.Empleado)).toEqual(['ANA LOPEZ', 'LUIS PAZ']);
    expect(rows[0]).toMatchObject({ PermisosDia: 1, Dias: 3, PermisosHora: 1, Minutos: 240, TotalDias: 3.5 });
  });

  it('filters the report by overlapping dates and state', () => {
    const permisos = [permiso({}), permiso({ IdPermiso: 2, Estado: 'ANULADO' })];
    const estadoDe = (p: Permiso) => estadoVista(p, new Date(2026, 9, 27, 9, 0), '16:00');
    const filters = { ...emptyPermisoReportFilters(), estado: 'ACTIVO' as const, desde: '2026-10-28', hasta: '2026-10-31' };
    expect(filterPermisosForReport(permisos, filters, estadoDe).map((p) => p.IdPermiso)).toEqual([1]);
    expect(filterPermisosForReport(permisos, { ...filters, desde: '2026-10-29' }, estadoDe)).toEqual([]);
  });

  it('shows an active permit as finished once its end has passed', () => {
    const hora = permiso({ Tipo: 'HORA', FechaInicio: '2026-10-27T00:00:00', FechaFin: '2026-10-27T00:00:00',
      HoraSalida: '10:00', HoraEntrada: '13:00' });
    expect(estadoVista(hora, new Date(2026, 9, 27, 12, 59), '16:00')).toBe('ACTIVO');
    expect(estadoVista(hora, new Date(2026, 9, 27, 13, 0), '16:00')).toBe('FINALIZADO');
    // El de día termina al cierre de la jornada de su último día (28/10 a las 16:00).
    expect(estadoVista(permiso({}), new Date(2026, 9, 28, 15, 59), '16:00')).toBe('ACTIVO');
    expect(estadoVista(permiso({}), new Date(2026, 9, 28, 16, 0), '16:00')).toBe('FINALIZADO');
    expect(estadoVista(permiso({ Estado: 'ANULADO' }), new Date(2026, 9, 20), '16:00')).toBe('ANULADO');
  });

  it('totals what an employee has used in the month, the year and overall', () => {
    const permisos = [
      permiso({}),
      permiso({ IdPermiso: 2, Tipo: 'HORA', DiasHabiles: 0, Minutos: 200,
        FechaInicio: '2026-10-27T00:00:00', FechaFin: '2026-10-27T00:00:00' }),
      permiso({ IdPermiso: 3, FechaInicio: '2026-03-02T00:00:00', FechaFin: '2026-03-02T00:00:00', DiasHabiles: 1 }),
      permiso({ IdPermiso: 4, FechaInicio: '2025-05-05T00:00:00', FechaFin: '2025-05-05T00:00:00', DiasHabiles: 1 }),
      permiso({ IdPermiso: 5, Estado: 'ANULADO' }),
      permiso({ IdPermiso: 6, IdEmpleado: 11 }),
    ];
    const consumo = consumoEmpleado(permisos, 10, new Date(2026, 9, 27), 480);
    expect(consumoTexto(consumo.Mes)).toBe('3 días · 3 h 20 min');
    expect(consumo.Anio.Dias).toBe(4);
    expect(consumo.Todo.Dias).toBe(5);
    // Al editar, el permiso propio no se cuenta.
    expect(consumoTexto(consumoEmpleado(permisos, 10, new Date(2026, 9, 27), 480, 2).Mes)).toBe('3 días');
    expect(consumoTexto(consumoEmpleado(permisos, 99, new Date(2026, 9, 27), 480).Mes)).toBe('Sin permisos');
  });

  it('converts hours to days with the workday of each permit department', () => {
    const permisos = [
      permiso({ IdPermiso: 1, Tipo: 'HORA', DiasHabiles: 0, Minutos: 240, IdDepartamento: 20 }),
      permiso({ IdPermiso: 2, Tipo: 'HORA', DiasHabiles: 0, Minutos: 240, IdDepartamento: 146 }),
    ];
    // Jornada de 8 h en el 20 y de 6 h en el 146: 0.5 + 0.67 días.
    const rows = resumenPorEmpleado(permisos, (p) => (p.IdDepartamento === 146 ? 360 : 480));
    expect(Math.round(rows[0].TotalDias * 100) / 100).toBe(1.17);
  });
});
