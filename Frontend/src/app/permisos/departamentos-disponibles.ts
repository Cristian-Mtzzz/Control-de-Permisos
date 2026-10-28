import { PermisoDepartamentoDisponible } from './permisos.models';

// Filtros de "Agregar departamento": regional y edificio (0 = todos). Las opciones salen de los
// departamentos disponibles, así nunca se ofrece una regional o un edificio sin nada que agregar.

/** Opción de un filtro. Detalle acompaña al nombre cuando hace falta distinguirla (la regional de un edificio). */
export interface OpcionFiltro {
  Id: number;
  Nombre: string;
  Detalle: string | null;
}

export function filtrarDisponibles(
  departamentos: readonly PermisoDepartamentoDisponible[],
  idRegional: number,
  idEdificio: number,
): PermisoDepartamentoDisponible[] {
  return departamentos.filter((departamento) =>
    (idRegional === 0 || departamento.IdRegional === idRegional)
    && (idEdificio === 0 || departamento.IdEdificio === idEdificio));
}

/** Regionales de los departamentos, sin repetir y por nombre. */
export function regionalesDe(departamentos: readonly PermisoDepartamentoDisponible[]): OpcionFiltro[] {
  return opciones(departamentos.map((departamento) => ({
    Id: departamento.IdRegional, Nombre: departamento.NombreRegional, Detalle: null,
  })));
}

/** Edificios de los departamentos de la regional elegida (o de todas), con su regional como detalle. */
export function edificiosDe(departamentos: readonly PermisoDepartamentoDisponible[], idRegional: number): OpcionFiltro[] {
  return opciones(filtrarDisponibles(departamentos, idRegional, 0).map((departamento) => ({
    Id: departamento.IdEdificio, Nombre: departamento.NombreEdificio, Detalle: departamento.NombreRegional,
  })));
}

// Sin Id (null, o undefined si la API todavía no envía el dato) el elemento no es una opción.
function opciones(items: { Id: number | null; Nombre: string | null; Detalle: string | null }[]): OpcionFiltro[] {
  const unicas = new Map<number, OpcionFiltro>();
  for (const item of items) {
    if (item.Id == null || unicas.has(item.Id)) continue;
    unicas.set(item.Id, { Id: item.Id, Nombre: item.Nombre?.trim() || `Sin nombre (${item.Id})`, Detalle: item.Detalle });
  }
  return [...unicas.values()].sort((a, b) => a.Nombre.localeCompare(b.Nombre, 'es'));
}
