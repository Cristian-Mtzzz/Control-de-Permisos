import { SIN_UBICACION, edificiosDe, filtrarDisponibles, regionalesDe } from './departamentos-disponibles';
import { PermisoDepartamentoDisponible } from './permisos.models';

const departamento = (
  IdDepartamento: number,
  IdEdificio: number | null,
  NombreEdificio: string | null,
  IdRegional: number | null,
  NombreRegional: string | null,
): PermisoDepartamentoDisponible => ({
  IdDepartamento, Nombre: `Depto ${IdDepartamento}`, Empleados: 1, IdEdificio, NombreEdificio, IdRegional, NombreRegional,
});

const departamentos = [
  departamento(1, 10, 'Hospital de Especialidades', 1, 'Tegucigalpa'),
  departamento(2, 10, 'Hospital de Especialidades', 1, 'Tegucigalpa'),
  departamento(3, 20, 'Clínica Periférica', 1, 'Tegucigalpa'),
  departamento(4, 30, 'Hospital Regional', 2, 'San Pedro Sula'),
  departamento(5, null, null, null, null),
  // El mismo hospital registrado otra vez en la base, en mayúsculas y sin tilde.
  departamento(6, 11, 'HOSPITAL DE ESPECIALIDADES ', 1, 'Tegucigalpa'),
  // Mismo nombre, pero en otra regional: es otro edificio.
  departamento(7, 31, 'Hospital de Especialidades', 2, 'San Pedro Sula'),
];

describe('filtros de departamentos disponibles', () => {
  it('ofrece cada regional una vez, por nombre, sin las vacías', () => {
    expect(regionalesDe(departamentos).map((regional) => regional.Nombre)).toEqual(['San Pedro Sula', 'Tegucigalpa', 'Sin regional']);
  });

  it('ofrece los edificios de la regional elegida, o de todas con su regional como detalle', () => {
    expect(edificiosDe(departamentos, 1).map((edificio) => edificio.Id)).toEqual([20, 10]);
    expect(edificiosDe(departamentos, 0)).toContainEqual({ Id: 30, Nombre: 'Hospital Regional', Detalle: 'San Pedro Sula' });
    expect(edificiosDe(departamentos, 0)).toHaveLength(5);
  });

  it('junta los edificios repetidos con el mismo nombre en la misma regional', () => {
    expect(edificiosDe(departamentos, 1)).toContainEqual({ Id: 10, Nombre: 'Hospital de Especialidades', Detalle: 'Tegucigalpa' });
    expect(filtrarDisponibles(departamentos, 1, 10).map((item) => item.IdDepartamento)).toEqual([1, 2, 6]);
    expect(filtrarDisponibles(departamentos, 0, 11).map((item) => item.IdDepartamento)).toEqual([1, 2, 6]);
    // El de San Pedro Sula sigue aparte.
    expect(filtrarDisponibles(departamentos, 0, 31).map((item) => item.IdDepartamento)).toEqual([7]);
  });

  it('ofrece "Sin regional" y "Sin edificio" para los departamentos que no tienen', () => {
    expect(regionalesDe(departamentos).at(-1)).toEqual({ Id: SIN_UBICACION, Nombre: 'Sin regional', Detalle: null });
    expect(edificiosDe(departamentos, SIN_UBICACION)).toEqual([{ Id: SIN_UBICACION, Nombre: 'Sin edificio', Detalle: null }]);
    expect(edificiosDe(departamentos, 1).some((edificio) => edificio.Id === SIN_UBICACION)).toBe(false);
    expect(filtrarDisponibles(departamentos, SIN_UBICACION, SIN_UBICACION).map((item) => item.IdDepartamento)).toEqual([5]);
    // Sin departamentos sin ubicación, no se ofrecen.
    expect(regionalesDe(departamentos.slice(0, 4)).some((regional) => regional.Id === SIN_UBICACION)).toBe(false);
  });

  it('filtra por regional y por edificio; sin filtros deja todos', () => {
    expect(filtrarDisponibles(departamentos, 0, 0)).toHaveLength(7);
    expect(filtrarDisponibles(departamentos, 1, 0).map((item) => item.IdDepartamento)).toEqual([1, 2, 3, 6]);
    expect(filtrarDisponibles(departamentos, 1, 20).map((item) => item.IdDepartamento)).toEqual([3]);
    expect(filtrarDisponibles(departamentos, 2, 10)).toEqual([]);
  });
});
