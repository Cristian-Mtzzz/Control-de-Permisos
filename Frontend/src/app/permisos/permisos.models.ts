// Contratos del Control de permisos. Deben coincidir con PermisoDtos.cs del backend. Todo se
// organiza por departamento y, dentro de cada uno, por área (jefatura).

export type PermisoTipo = 'DIA' | 'HORA';
export type PermisoEstado = 'ACTIVO' | 'ANULADO';

// Un solo nivel por usuario: administrador general, administrador de departamento, jefe de área
// o consulta (ve y exporta todo, no modifica).
export type PermisoNivel = 'ADMIN' | 'ADMIN_DEPTO' | 'JEFE' | 'CONSULTA';

// En el permiso por hora FechaInicio y FechaFin son la misma fecha; DiasHabiles es 0 en
// los de hora y Minutos es 0 en los de día. IdArea es el área cuando se registró y el
// departamento es el de esa área.
export interface Permiso {
  IdPermiso: number;
  Tipo: PermisoTipo;
  IdEmpleado: number;
  Empleado: string;
  NoPago: string | null;
  Motivo: string;
  FechaInicio: string;
  FechaFin: string;
  HoraSalida: string | null;
  HoraEntrada: string | null;
  DiasHabiles: number;
  Minutos: number;
  FechaSolicitud: string | null;
  Estado: PermisoEstado;
  FechaRegistro: string;
  IdArea: number | null;
  NombreArea: string | null;
  IdDepartamento: number | null;
  NombreDepartamento: string | null;
}

// Empleado activo de un departamento habilitado, con su área (null = todavía sin área).
export interface PermisoEmpleado {
  IdEmpleado: number;
  NombreCompleto: string;
  NoPago: string | null;
  IdDepartamento: number;
  IdArea: number | null;
  NombreArea: string | null;
}

// Jornada laboral: valida las horas y convierte horas en días (una jornada completa = 1 día).
// Feriados (yyyy-mm-dd) son los días no hábiles de la vista previa, del año anterior al siguiente.
export interface PermisoJornada {
  HoraInicioJornada: string;
  HoraFinJornada: string;
  MinutosJornada: number;
  Feriados: string[];
}

// Departamento habilitado con su jornada efectiva (la general o la propia del departamento).
// AvisoParametros: error de un parámetro mal escrito; mientras tanto se usa la jornada por
// defecto y la API no deja registrar en ese departamento.
export interface PermisoDepartamento extends PermisoJornada {
  IdDepartamento: number;
  Nombre: string;
  Estado: 'ACTIVO' | 'INACTIVO';
  Areas: number;
  Empleados: number;
  AvisoParametros: string | null;
}

// Departamento que todavía no usa el sistema.
// Departamento que todavía no usa el sistema, con el edificio y la regional para filtrarlo.
export interface PermisoDepartamentoDisponible {
  IdDepartamento: number;
  Nombre: string;
  Empleados: number;
  IdEdificio: number | null;
  NombreEdificio: string | null;
  IdRegional: number | null;
  NombreRegional: string | null;
}

export interface PermisoArea {
  IdArea: number;
  IdDepartamento: number;
  Nombre: string;
  Estado: 'ACTIVO' | 'INACTIVO';
  Empleados: number;
  Jefes: number;
}

// Quién está en sesión. Departamentos y Areas traen solo lo que el usuario puede ver.
export interface PermisoSesion {
  Nivel: PermisoNivel;
  IdDepartamento: number | null;
  NombreDepartamento: string | null;
  IdArea: number | null;
  NombreArea: string | null;
  Departamentos: PermisoDepartamento[];
  Areas: PermisoArea[];
}

export interface PermisoJefe {
  IdUsuario: number;
  Usuario: string;
  NombrePersona: string;
  // Vacío cuando la cuenta propia de permisos ya no tiene nivel.
  Nivel: PermisoNivel | '';
  IdDepartamento: number | null;
  NombreDepartamento: string | null;
  IdArea: number | null;
  NombreArea: string | null;
  Estado: string;
  Dominio: number;
  DominioP: string;
  // true = cuenta creada para este sistema; false = cuenta de inventario con acceso a permisos.
  SoloPermisos: boolean;
}

// Cuenta de inventario activa que todavía no tiene acceso a permisos.
export interface PermisoUsuarioInventario {
  IdUsuario: number;
  Usuario: string;
  NombrePersona: string;
}

// Dominio 1 = usuario de directorio activo; 0 = local con contraseña inicial 1234. Según el
// nivel se usa IdDepartamento (administrador de departamento) o IdArea (jefe de área).
export interface SavePermisoJefeRequest {
  Usuario: string;
  NombrePersona: string;
  Nivel: PermisoNivel;
  IdDepartamento: number | null;
  IdArea: number | null;
  Dominio: number;
  DominioP: string;
  Estado: string | null;
}

// Las fechas van como yyyy-mm-dd (valor del input date) y las horas como HH:mm.
export interface SavePermisoDiaRequest {
  IdEmpleado: number;
  Motivo: string;
  FechaInicio: string;
  FechaFin: string;
  FechaSolicitud: string;
}

export interface SavePermisoHoraRequest {
  IdEmpleado: number;
  Motivo: string;
  Fecha: string;
  HoraSalida: string;
  HoraEntrada: string;
}

export const PERMISO_TIPOS: { value: PermisoTipo; label: string }[] = [
  { value: 'DIA', label: 'Por día' },
  { value: 'HORA', label: 'Por hora' },
];

export const PERMISO_NIVELES: { value: PermisoNivel; label: string }[] = [
  { value: 'JEFE', label: 'Jefe de área' },
  { value: 'ADMIN_DEPTO', label: 'Administrador de departamento' },
  { value: 'CONSULTA', label: 'Consulta' },
  { value: 'ADMIN', label: 'Administrador general' },
];

export const nivelLabel = (nivel: PermisoNivel | ''): string =>
  PERMISO_NIVELES.find((item) => item.value === nivel)?.label ?? 'Sin acceso';

export const PERMISO_DOMINIOS = ['BA', 'HE', 'HRN', 'IVM'];

// Jornada de referencia mientras llega la del departamento o si el permiso no tiene uno.
export const JORNADA_POR_DEFECTO: PermisoJornada = {
  HoraInicioJornada: '08:00', HoraFinJornada: '16:00', MinutosJornada: 480, Feriados: [],
};
