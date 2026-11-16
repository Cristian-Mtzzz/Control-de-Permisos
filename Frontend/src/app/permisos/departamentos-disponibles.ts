import { PermisoDepartamentoDisponible } from './permisos.models';

// Filtros de "Agregar departamento": regional y edificio (0 = todos; SIN_UBICACION = los que no
// tienen). Las opciones salen de los departamentos disponibles, así nunca se ofrece una regional
// o un edificio sin nada que agregar.
// En la base hay edificios repetidos con el mismo nombre (otras mayúsculas o tildes) en la misma
// regional: se ofrecen como uno solo y el filtro trae los departamentos de todos.

/** Opción de un filtro. Detalle acompaña al nombre cuando hace falta distinguirla (la regional de un edificio). */
export interface OpcionFiltro {
  Id: number;
  Nombre: string;
  Detalle: string | null;
}

/** Opción para los departamentos sin regional o sin edificio: así también se pueden agregar. */
export const SIN_UBICACION = -1;

export function filtrarDisponibles(
  departamentos: readonly PermisoDepartamentoDisponible[],
  idRegional: number,
  idEdificio: number,
): PermisoDepartamentoDisponible[] {
  const edificio = idEdificio === 0 || idEdificio === SIN_UBICACION ? null : claveDeEdificio(departamentos, idEdificio);
  return departamentos.filter((departamento) =>
    (idRegional === 0 || departamento.IdRegional === (idRegional === SIN_UBICACION ? null : idRegional))
    && (idEdificio === SIN_UBICACION ? departamento.IdEdificio == null
      : edificio === null || (departamento.IdEdificio != null && claveEdificio(departamento) === edificio)));
}

/** Regionales de los departamentos, sin repetir y por nombre; al final "Sin regional" si hace falta. */
export function regionalesDe(departamentos: readonly PermisoDepartamentoDisponible[]): OpcionFiltro[] {
  return conSinUbicacion(opciones(departamentos.map((departamento) => ({
    Id: departamento.IdRegional, Clave: String(departamento.IdRegional), Nombre: departamento.NombreRegional, Detalle: null,
  }))), departamentos.some((departamento) => departamento.IdRegional == null), 'Sin regional');
}

/**
 * Edificios de los departamentos de la regional elegida (o de todas), con su regional como
 * detalle. Los del mismo nombre en la misma regional salen una sola vez; al final "Sin edificio"
 * si hace falta.
 */
export function edificiosDe(departamentos: readonly PermisoDepartamentoDisponible[], idRegional: number): OpcionFiltro[] {
  const deLaRegional = filtrarDisponibles(departamentos, idRegional, 0);
  return conSinUbicacion(opciones(deLaRegional.map((departamento) => ({
    Id: departamento.IdEdificio, Clave: claveEdificio(departamento), Nombre: departamento.NombreEdificio, Detalle: departamento.NombreRegional,
  }))), deLaRegional.some((departamento) => departamento.IdEdificio == null), 'Sin edificio');
}

const conSinUbicacion = (lista: OpcionFiltro[], hace: boolean, nombre: string): OpcionFiltro[] =>
  hace ? [...lista, { Id: SIN_UBICACION, Nombre: nombre, Detalle: null }] : lista;

// Nombre sin mayúsculas, tildes ni espacios de más, junto con la regional.
const normalizar = (texto: string | null): string =>
  (texto ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim().toLowerCase();
const claveEdificio = (departamento: PermisoDepartamentoDisponible): string =>
  `${departamento.IdRegional ?? ''}|${normalizar(departamento.NombreEdificio) || `#${departamento.IdEdificio}`}`;
const claveDeEdificio = (departamentos: readonly PermisoDepartamentoDisponible[], idEdificio: number): string => {
  const departamento = departamentos.find((item) => item.IdEdificio === idEdificio);
  return departamento ? claveEdificio(departamento) : `sin-edificio-${idEdificio}`;
};
// Entre nombres repetidos se muestra el escrito en mayúsculas y minúsculas antes que el todo en mayúsculas.
const todoMayusculas = (nombre: string): boolean => nombre === nombre.toUpperCase() && nombre !== nombre.toLowerCase();

// Sin Id (null, o undefined si la API todavía no envía el dato) el elemento no es una opción. La
// opción usa el menor Id de su clave, para que no cambie con el orden de la lista.
function opciones(items: { Id: number | null; Clave: string; Nombre: string | null; Detalle: string | null }[]): OpcionFiltro[] {
  const unicas = new Map<string, OpcionFiltro>();
  const usados = new Set<number>();
  for (const item of items) {
    // Un mismo Id con dos claves (un edificio en dos regionales) se ofrece una sola vez.
    if (item.Id == null || (usados.has(item.Id) && !unicas.has(item.Clave))) continue;
    usados.add(item.Id);
    const nombre = item.Nombre?.trim() || `Sin nombre (${item.Id})`;
    const actual = unicas.get(item.Clave);
    if (!actual) {
      unicas.set(item.Clave, { Id: item.Id, Nombre: nombre, Detalle: item.Detalle });
      continue;
    }
    actual.Id = Math.min(actual.Id, item.Id);
    if (todoMayusculas(actual.Nombre) && !todoMayusculas(nombre)) actual.Nombre = nombre;
  }
  return [...unicas.values()].sort((a, b) => a.Nombre.localeCompare(b.Nombre, 'es'));
}
