import { Permiso } from './permisos.models';
import { emptyPermisoReportFilters, employeesLabel, filterPermisosForReport } from './permisos-report';

const permiso = (overrides: Partial<Permiso>): Permiso => ({
  IdPermiso: 1, Tipo: 'DIA', IdEmpleado: 10, Empleado: 'ANA LOPEZ', NoPago: '123', Motivo: 'Cita',
  FechaInicio: '2026-10-26T00:00:00', FechaFin: '2026-10-28T00:00:00', HoraSalida: null, HoraEntrada: null,
  DiasHabiles: 3, Minutos: 0, FechaSolicitud: '2026-10-20T00:00:00',
  Estado: 'ACTIVO', FechaRegistro: '2026-10-20T09:00:00', IdArea: 1, NombreArea: 'Desarrollo',
  IdDepartamento: 20, NombreDepartamento: 'GERENCIA DE INFORMATICA', ...overrides,
});

// Empleados del reporte: todos (lista vacía) o solo los marcados.
describe('reporte por empleados', () => {
  const permisos = [
    permiso({ IdPermiso: 1, IdEmpleado: 10 }),
    permiso({ IdPermiso: 2, IdEmpleado: 11, Empleado: 'LUIS PAZ' }),
    permiso({ IdPermiso: 3, IdEmpleado: 12, Empleado: 'EVA RUIZ' }),
  ];
  const estadoDe = () => 'ACTIVO' as const;
  const ids = (idsEmpleado: number[]) =>
    filterPermisosForReport(permisos, { ...emptyPermisoReportFilters(), idsEmpleado }, estadoDe).map((p) => p.IdPermiso);

  it('sin empleados marcados exporta todos', () => {
    expect(ids([])).toEqual([1, 2, 3]);
  });

  it('con uno o varios marcados exporta solo los suyos', () => {
    expect(ids([11])).toEqual([2]);
    expect(ids([10, 12])).toEqual([1, 3]);
  });

  it('describe en el Excel a quiénes se exportó', () => {
    expect(employeesLabel([])).toBe('');
    expect(employeesLabel(['ANA LOPEZ'])).toBe('Empleado: ANA LOPEZ');
    expect(employeesLabel(['ANA LOPEZ', 'LUIS PAZ'])).toBe('Empleados: ANA LOPEZ, LUIS PAZ');
    expect(employeesLabel(['A', 'B', 'C', 'D'])).toBe('Empleados: 4 seleccionados');
  });
});
