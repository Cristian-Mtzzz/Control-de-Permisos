import { Component } from '@angular/core';
import { ComponentFixture } from '@angular/core/testing';
import { HttpTestingController, TestRequest } from '@angular/common/http/testing';
import { HttpRequest } from '@angular/common/http';
import {
  Permiso, PermisoArea, PermisoDepartamento, PermisoEmpleado, PermisoJefe, PermisoSesion,
} from '../permisos/permisos.models';
import { dayKey } from '../permisos/permisos-resumen';

// Ayudas de las pruebas de pantalla: buscan botones y campos como los ve el usuario, simulan
// clics y escritura, y responden las llamadas a la API (bien o con error).

@Component({ template: '' })
export class PantallaVacia {}

export const rutasDePrueba = [
  { path: 'login', component: PantallaVacia },
  { path: 'permisos', component: PantallaVacia },
  { path: 'change-password', component: PantallaVacia },
];

const normalizar = (texto: string | null | undefined): string => (texto ?? '').replace(/\s+/g, ' ').trim();

export function textoDe(fixture: ComponentFixture<unknown>): string {
  return normalizar((fixture.nativeElement as HTMLElement).textContent);
}

/** Botones visibles cuyo texto (o aria-label) coincide. */
export function botones(raiz: ParentNode, texto: string | RegExp): HTMLButtonElement[] {
  return Array.from(raiz.querySelectorAll<HTMLButtonElement>('button')).filter((boton) =>
    [normalizar(boton.textContent), boton.getAttribute('aria-label') ?? ''].some((etiqueta) =>
      typeof texto === 'string' ? etiqueta === texto : texto.test(etiqueta)));
}

export function boton(raiz: ParentNode, texto: string | RegExp): HTMLButtonElement {
  const encontrados = botones(raiz, texto);
  if (encontrados.length === 0) throw new Error(`No hay un botón "${texto}".`);
  return encontrados[0];
}

export function campo<T extends HTMLElement>(raiz: ParentNode, selector: string): T {
  const elemento = raiz.querySelector<T>(selector);
  if (!elemento) throw new Error(`No existe ${selector}.`);
  return elemento;
}

/**
 * Deja que ngModel y la pantalla se actualicen. No usa whenStable: espera también a las llamadas
 * a la API pendientes, y en estas pruebas siguen abiertas hasta que se responden a mano.
 */
export async function actualizar(fixture: ComponentFixture<unknown>): Promise<void> {
  fixture.detectChanges();
  await new Promise((resolve) => setTimeout(resolve));
  fixture.detectChanges();
}

export async function clic(fixture: ComponentFixture<unknown>, elemento: HTMLElement): Promise<void> {
  elemento.click();
  await actualizar(fixture);
}

export async function escribir(
  fixture: ComponentFixture<unknown>,
  elemento: HTMLInputElement | HTMLTextAreaElement,
  valor: string,
): Promise<void> {
  elemento.value = valor;
  elemento.dispatchEvent(new Event('input', { bubbles: true }));
  await actualizar(fixture);
}

/** Elige la opción cuyo texto contiene el indicado. */
export async function elegir(fixture: ComponentFixture<unknown>, select: HTMLSelectElement, texto: string): Promise<void> {
  await actualizar(fixture);
  const opcion = Array.from(select.options).find((item) => normalizar(item.textContent).includes(texto));
  if (!opcion) {
    throw new Error(`"${texto}" no está entre: ${Array.from(select.options).map((item) => normalizar(item.textContent)).join(' | ')}`);
  }
  select.selectedIndex = opcion.index;
  select.dispatchEvent(new Event('change', { bubbles: true }));
  await actualizar(fixture);
}

export function opcionesDe(select: HTMLSelectElement): string[] {
  return Array.from(select.options).map((opcion) => normalizar(opcion.textContent));
}

export async function enviar(fixture: ComponentFixture<unknown>, formulario: HTMLFormElement): Promise<void> {
  formulario.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  await actualizar(fixture);
}

/** localStorage en memoria: el entorno de pruebas no siempre trae uno. */
export function almacenamientoEnMemoria(): Storage {
  const datos = new Map<string, string>();
  return {
    get length() { return datos.size; },
    clear: () => datos.clear(),
    getItem: (clave) => datos.get(clave) ?? null,
    key: (indice) => Array.from(datos.keys())[indice] ?? null,
    removeItem: (clave) => { datos.delete(clave); },
    setItem: (clave, valor) => { datos.set(clave, String(valor)); },
  };
}

// ---- API ---------------------------------------------------------------------------------

/** Llamada pendiente a la ruta indicada (termina en ella) y con el método indicado. */
export function llamada(http: HttpTestingController, metodo: string, ruta: string): TestRequest {
  return http.expectOne((request: HttpRequest<unknown>) => request.method === metodo && request.url.endsWith(ruta),
    `${metodo} ${ruta}`);
}

export function sinLlamadas(http: HttpTestingController, metodo: string, ruta: string): void {
  http.expectNone((request: HttpRequest<unknown>) => request.method === metodo && request.url.endsWith(ruta),
    `${metodo} ${ruta}`);
}

export function errorApi(request: TestRequest, status: number, mensaje?: string): void {
  if (status === 0) {
    request.error(new ProgressEvent('error'), { status: 0, statusText: 'Unknown Error' });
    return;
  }
  request.flush(mensaje === undefined ? null : { Message: mensaje }, { status, statusText: 'Error' });
}

// ---- Datos -------------------------------------------------------------------------------

/** Fecha local (yyyy-mm-dd) a tantos días de hoy. */
export function dia(desplazamiento = 0): string {
  const fecha = new Date();
  fecha.setDate(fecha.getDate() + desplazamiento);
  return dayKey(fecha);
}

/** Próximo lunes a viernes a partir de mañana. */
export function proximoDiaHabil(): string {
  for (let desplazamiento = 1; ; desplazamiento++) {
    const fecha = new Date();
    fecha.setDate(fecha.getDate() + desplazamiento);
    if (fecha.getDay() !== 0 && fecha.getDay() !== 6) return dayKey(fecha);
  }
}

/** Próximo sábado. */
export function proximoSabado(): string {
  for (let desplazamiento = 1; ; desplazamiento++) {
    const fecha = new Date();
    fecha.setDate(fecha.getDate() + desplazamiento);
    if (fecha.getDay() === 6) return dayKey(fecha);
  }
}

const jornada = (inicio: string, fin: string) => ({
  HoraInicioJornada: inicio, HoraFinJornada: fin,
  MinutosJornada: (Number(fin.slice(0, 2)) - Number(inicio.slice(0, 2))) * 60, Feriados: [] as string[],
});

export const departamentos: PermisoDepartamento[] = [
  { IdDepartamento: 10, Nombre: 'INFORMATICA', Estado: 'ACTIVO', Areas: 2, Empleados: 3, AvisoParametros: null, ...jornada('08:00', '16:00') },
  { IdDepartamento: 20, Nombre: 'RECURSOS HUMANOS', Estado: 'ACTIVO', Areas: 1, Empleados: 1, AvisoParametros: null, ...jornada('07:00', '15:00') },
];

export const areas: PermisoArea[] = [
  { IdArea: 100, IdDepartamento: 10, Nombre: 'SOPORTE', Estado: 'ACTIVO', Empleados: 1, Jefes: 1 },
  { IdArea: 101, IdDepartamento: 10, Nombre: 'DESARROLLO', Estado: 'ACTIVO', Empleados: 1, Jefes: 0 },
  { IdArea: 102, IdDepartamento: 10, Nombre: 'ANTIGUA', Estado: 'INACTIVO', Empleados: 0, Jefes: 0 },
  { IdArea: 200, IdDepartamento: 20, Nombre: 'NOMINA', Estado: 'ACTIVO', Empleados: 1, Jefes: 0 },
];

export function sesion(nivel: PermisoSesion['Nivel']): PermisoSesion {
  switch (nivel) {
    case 'ADMIN_DEPTO':
      return {
        Nivel: nivel, IdDepartamento: 10, NombreDepartamento: 'INFORMATICA', IdArea: null, NombreArea: null,
        Departamentos: [departamentos[0]], Areas: areas.filter((area) => area.IdDepartamento === 10),
      };
    case 'JEFE':
      return {
        Nivel: nivel, IdDepartamento: 10, NombreDepartamento: 'INFORMATICA', IdArea: 100, NombreArea: 'SOPORTE',
        Departamentos: [departamentos[0]], Areas: [areas[0]],
      };
    default:
      return { Nivel: nivel, IdDepartamento: null, NombreDepartamento: null, IdArea: null, NombreArea: null, Departamentos: departamentos, Areas: areas };
  }
}

export const empleados: PermisoEmpleado[] = [
  { IdEmpleado: 1, NombreCompleto: 'ANA LOPEZ', NoPago: '1001', IdDepartamento: 10, IdArea: 100, NombreArea: 'SOPORTE' },
  { IdEmpleado: 2, NombreCompleto: 'LUIS PAZ', NoPago: '1002', IdDepartamento: 10, IdArea: 101, NombreArea: 'DESARROLLO' },
  { IdEmpleado: 3, NombreCompleto: 'MARIA RUIZ', NoPago: '2001', IdDepartamento: 20, IdArea: 200, NombreArea: 'NOMINA' },
  { IdEmpleado: 4, NombreCompleto: 'PEDRO SIN AREA', NoPago: null, IdDepartamento: 10, IdArea: null, NombreArea: null },
];

export function permiso(datos: Partial<Permiso> & Pick<Permiso, 'IdPermiso'>): Permiso {
  return {
    Tipo: 'DIA', IdEmpleado: 1, Empleado: 'ANA LOPEZ', NoPago: '1001', Motivo: 'CITA MEDICA',
    FechaInicio: `${dia()}T00:00:00`, FechaFin: `${dia()}T00:00:00`, HoraSalida: null, HoraEntrada: null,
    DiasHabiles: 1, Minutos: 0, FechaSolicitud: `${dia()}T00:00:00`, Estado: 'ACTIVO', FechaRegistro: `${dia()}T08:00:00`,
    IdArea: 100, NombreArea: 'SOPORTE', IdDepartamento: 10, NombreDepartamento: 'INFORMATICA', HoraFinJornada: '23:59',
    ...datos,
  };
}

const habil = proximoDiaHabil();

// Uno de cada caso: vigente hoy, por hora futuro, finalizado, anulado y sin área ya terminado
// según la jornada que manda la API.
export const permisos: Permiso[] = [
  permiso({ IdPermiso: 1, FechaFin: `${dia(2)}T00:00:00`, DiasHabiles: 3 }),
  permiso({
    IdPermiso: 2, Tipo: 'HORA', IdEmpleado: 2, Empleado: 'LUIS PAZ', NoPago: '1002', Motivo: 'TRAMITE BANCARIO',
    FechaInicio: `${habil}T00:00:00`, FechaFin: `${habil}T00:00:00`, HoraSalida: '09:00', HoraEntrada: '11:00',
    DiasHabiles: 0, Minutos: 120, IdArea: 101, NombreArea: 'DESARROLLO', HoraFinJornada: '16:00',
  }),
  permiso({
    IdPermiso: 3, IdEmpleado: 3, Empleado: 'MARIA RUIZ', NoPago: '2001', Motivo: 'VACACIONES',
    FechaInicio: `${dia(-10)}T00:00:00`, FechaFin: `${dia(-8)}T00:00:00`, IdArea: 200, NombreArea: 'NOMINA',
    IdDepartamento: 20, NombreDepartamento: 'RECURSOS HUMANOS', HoraFinJornada: '15:00',
  }),
  permiso({ IdPermiso: 4, Estado: 'ANULADO', Motivo: 'DUPLICADO', FechaInicio: `${dia(5)}T00:00:00`, FechaFin: `${dia(5)}T00:00:00` }),
  permiso({
    IdPermiso: 5, IdEmpleado: 4, Empleado: 'PEDRO SIN AREA', NoPago: null, Motivo: 'PERMISO ANTERIOR A LAS AREAS',
    IdArea: null, NombreArea: null, IdDepartamento: null, NombreDepartamento: null, HoraFinJornada: '00:00',
  }),
];

export function jefe(datos: Partial<PermisoJefe> & Pick<PermisoJefe, 'IdUsuario'>): PermisoJefe {
  return {
    Usuario: 'usuario', NombrePersona: 'USUARIO', Nivel: 'JEFE', IdDepartamento: 10, NombreDepartamento: 'INFORMATICA',
    IdArea: 100, NombreArea: 'SOPORTE', Estado: 'ACTIVO', Dominio: 0, DominioP: 'BA', SoloPermisos: true, ...datos,
  };
}

export const jefes: PermisoJefe[] = [
  jefe({ IdUsuario: 50, Usuario: 'admin.permisos', NombrePersona: 'ADMINISTRADOR', Nivel: 'ADMIN', IdDepartamento: null, IdArea: null, NombreArea: null, NombreDepartamento: null }),
  jefe({ IdUsuario: 51, Usuario: 'jefe.soporte', NombrePersona: 'JEFE SOPORTE' }),
  jefe({ IdUsuario: 52, Usuario: 'BA\\jefe.dominio', NombrePersona: 'JEFE DOMINIO', Dominio: 1, IdArea: 101, NombreArea: 'DESARROLLO' }),
  jefe({ IdUsuario: 53, Usuario: 'inventario.rrhh', NombrePersona: 'JEFE NOMINA', SoloPermisos: false, IdDepartamento: 20, NombreDepartamento: 'RECURSOS HUMANOS', IdArea: 200, NombreArea: 'NOMINA' }),
  jefe({ IdUsuario: 54, Usuario: 'admin.rrhh', NombrePersona: 'ADMIN RRHH', Nivel: 'ADMIN_DEPTO', IdDepartamento: 20, NombreDepartamento: 'RECURSOS HUMANOS', IdArea: null, NombreArea: null }),
];
