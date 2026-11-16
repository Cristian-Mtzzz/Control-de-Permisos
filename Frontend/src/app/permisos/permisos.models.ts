// Contratos del Control de permisos. Deben coincidir con PermisoDtos.cs del backend. Todo se
// organiza por departamento y, dentro de cada uno, por área (jefatura).

// VAC: vacaciones. Se guardan con los permisos (un rango de días hábiles, como el de día), pero
// tienen su propia sección y no cuentan en los límites de permisos.
export type PermisoTipo = 'DIA' | 'HORA' | 'VAC';
export type PermisoEstado = 'ACTIVO' | 'ANULADO';

// Un solo nivel por usuario: administrador general, administrador de departamento, jefe de área
// o consulta (ve y exporta todo, no modifica).
// SECRETARIA: la secretaría de un departamento. Ve y exporta todas sus áreas y genera los
// reportes y los memorandos, pero no registra permisos ni administra áreas, jefes o personal.
// USUARIO: la cuenta de un empleado. Registra y ve solo sus propios permisos y vacaciones.
export type PermisoNivel = 'ADMIN' | 'ADMIN_DEPTO' | 'SECRETARIA' | 'JEFE' | 'USUARIO' | 'CONSULTA';

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
  // Cierre de la jornada (HH:mm) con que la API decide si un permiso por día ya finalizó: la
  // del departamento del área o, sin área, la del departamento del empleado.
  HoraFinJornada?: string;
  // Solo en el permiso por día: lugar desde donde se solicita y teléfono donde localizar al
  // empleado (los pide su formato de impresión). Vacíos en los demás y en los antiguos.
  Lugar?: string | null;
  Telefono?: string | null;
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
  // Solo en el nivel USUARIO: el empleado dueño de la cuenta.
  IdEmpleado?: number | null;
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
  // Solo en el nivel USUARIO: el empleado dueño de la cuenta.
  IdEmpleado: number | null;
  NombreEmpleado: string | null;
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
  IdEmpleado: number | null;
}

// Las fechas van como yyyy-mm-dd (valor del input date) y las horas como HH:mm.
// NoPago se carga del empleado al elegirlo (o se escribe si no lo tiene) y se guarda en el permiso.
export interface SavePermisoDiaRequest {
  IdEmpleado: number;
  NoPago: string;
  Motivo: string;
  FechaInicio: string;
  FechaFin: string;
  Telefono: string;
  Lugar: string;
}

export interface SavePermisoHoraRequest {
  IdEmpleado: number;
  NoPago: string;
  Motivo: string;
  Fecha: string;
  HoraSalida: string;
  HoraEntrada: string;
}

// Vacaciones: rango de fechas y la fecha en que el empleado las pidió (hoy o antes). Es lo que
// se envía al editar un período ya registrado.
export interface SaveVacacionRequest {
  IdEmpleado: number;
  FechaInicio: string;
  FechaFin: string;
  FechaSolicitud: string;
}

export interface PeriodoVacacion {
  FechaInicio: string;
  FechaFin: string;
}

// Alta de una solicitud de vacaciones: uno o varios períodos del mismo empleado con la misma
// fecha de solicitud. La API guarda un registro por período, todos o ninguno.
export interface SaveVacacionesRequest {
  IdEmpleado: number;
  FechaSolicitud: string;
  Periodos: PeriodoVacacion[];
}

// Tipos de permiso (las vacaciones van aparte).
export const PERMISO_TIPOS: { value: PermisoTipo; label: string }[] = [
  { value: 'DIA', label: 'Por día' },
  { value: 'HORA', label: 'Por hora' },
];

export const TIPO_VACACIONES = { value: 'VAC', label: 'Vacaciones' } as const;

// Niveles que se asignan. La consulta ya no se asigna; solo se nombra si queda algún usuario antiguo.
// De menor a mayor alcance, como se ofrecen al crear un usuario.
export const PERMISO_NIVELES: { value: PermisoNivel; label: string }[] = [
  { value: 'USUARIO', label: 'Usuario (empleado)' },
  { value: 'JEFE', label: 'Jefe de área' },
  { value: 'SECRETARIA', label: 'Secretaría de departamento' },
  { value: 'ADMIN_DEPTO', label: 'Jefe de departamento' },
  { value: 'ADMIN', label: 'Administrador general' },
];

export const nivelLabel = (nivel: PermisoNivel | ''): string =>
  nivel === 'CONSULTA' ? 'Consulta' : PERMISO_NIVELES.find((item) => item.value === nivel)?.label ?? 'Sin acceso';

export const PERMISO_DOMINIOS = ['BA', 'HE', 'HRN', 'IVM'];

// Jornada de referencia mientras llega la del departamento o si el permiso no tiene uno.
export const JORNADA_POR_DEFECTO: PermisoJornada = {
  HoraInicioJornada: '08:00', HoraFinJornada: '16:00', MinutosJornada: 480, Feriados: [],
};

// ---- Logos de los formatos de impresión -------------------------------------------------
// Se cargan y se cambian en la base (tabla PERMISO_LOGO): cada período de gobierno cambian.
// IZQUIERDO es el logo de la izquierda del encabezado y DERECHO el de la derecha.
export type PermisoLogoClave = 'IZQUIERDO' | 'DERECHO';

export interface PermisoLogo {
  Clave: PermisoLogoClave;
  TipoMime: string;
  // La imagen en base64, sin el prefijo "data:".
  Imagen: string;
}

