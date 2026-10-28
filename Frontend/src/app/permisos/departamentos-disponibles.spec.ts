import { edificiosDe, filtrarDisponibles, regionalesDe } from './departamentos-disponibles';
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
];

describe('filtros de departamentos disponibles', () => {
  it('ofrece cada regional una vez, por nombre, sin las vacías', () => {
    expect(regionalesDe(departamentos).map((regional) => regional.Nombre)).toEqual(['San Pedro Sula', 'Tegucigalpa']);
  });

  it('ofrece los edificios de la regional elegida, o de todas con su regional como detalle', () => {
    expect(edificiosDe(departamentos, 1).map((edificio) => edificio.Id)).toEqual([20, 10]);
    expect(edificiosDe(departamentos, 0)).toContainEqual({ Id: 30, Nombre: 'Hospital Regional', Detalle: 'San Pedro Sula' });
    expect(edificiosDe(departamentos, 0)).toHaveLength(3);
  });

  it('filtra por regional y por edificio; sin filtros deja todos', () => {
    expect(filtrarDisponibles(departamentos, 0, 0)).toHaveLength(5);
    expect(filtrarDisponibles(departamentos, 1, 0).map((item) => item.IdDepartamento)).toEqual([1, 2, 3]);
    expect(filtrarDisponibles(departamentos, 1, 10).map((item) => item.IdDepartamento)).toEqual([1, 2]);
    expect(filtrarDisponibles(departamentos, 2, 10)).toEqual([]);
  });
});
