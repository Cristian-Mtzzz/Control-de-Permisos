namespace ControlPermisos.Api.Models;

// Contratos del sistema de Control de permisos. Hay dos tipos de permiso: por día (rango de
// fechas, cuenta solo días hábiles) y por hora (una fecha con hora de salida y de entrada dentro
// de la jornada); las vacaciones (VAC) se guardan con ellos como un rango de fechas. Se organiza
// por departamento y, dentro de cada uno, por área (jefatura).

/// <summary>
/// Permiso tal como lo muestra la tabla. En el permiso por hora FechaInicio y FechaFin son
/// la misma fecha; DiasHabiles es 0 en los de hora y Minutos es 0 en los de día.
/// IdArea es el área del empleado cuando se registró el permiso; el departamento es el de esa área.
/// HoraFinJornada (HH:mm) es el cierre de la jornada con que la API decide si un permiso por día
/// ya finalizó: la del departamento del área o, sin área, la del departamento del empleado.
/// NoPago es el guardado en el permiso (PERMISO_SOLICITUD.NO_PAGO), que se carga del empleado al registrarlo;
/// las vacaciones y los permisos anteriores a ese campo no lo tienen. Lugar y Telefono son los del
/// permiso por día (para su formato de impresión); vacíos en los demás.
/// </summary>
public sealed record PermisoDto(
    int IdPermiso,
    string Tipo,
    int IdEmpleado,
    string Empleado,
    string? NoPago,
    string Motivo,
    DateTime FechaInicio,
    DateTime FechaFin,
    string? HoraSalida,
    string? HoraEntrada,
    int DiasHabiles,
    int Minutos,
    DateTime? FechaSolicitud,
    string Estado,
    DateTime FechaRegistro,
    int? IdArea,
    string? NombreArea,
    int? IdDepartamento,
    string? NombreDepartamento,
    string HoraFinJornada,
    string? Lugar = null,
    string? Telefono = null);

/// <summary>Empleado activo de un departamento habilitado, con su área (null = sin área).</summary>
public sealed record PermisoEmpleadoDto(
    int IdEmpleado,
    string NombreCompleto,
    string? NoPago,
    int IdDepartamento,
    int? IdArea,
    string? NombreArea);

/// <summary>
/// Permiso por día: rango de fechas. La fecha de solicitud la pone el servidor al registrarlo.
/// NoPago: el formulario lo carga de EMPLEADOS_IHSS.NPAGO al elegir el empleado (o se escribe si no lo
/// tiene) y se guarda en el permiso tal como llega, para que no cambie si después cambia el del empleado.
/// Lugar (desde dónde se solicita) y Telefono (dónde localizar al empleado) los pide el formato
/// de impresión del permiso por día.
/// </summary>
public sealed record SavePermisoDiaDto(
    int IdEmpleado,
    string Motivo,
    DateTime FechaInicio,
    DateTime FechaFin,
    string? NoPago = null,
    string? Lugar = null,
    string? Telefono = null);

/// <summary>
/// Permiso por hora: una fecha con hora de salida y de regreso (HoraEntrada) en formato HH:mm.
/// La fecha de solicitud la pone el servidor al registrarlo; NoPago, como en el de día.
/// </summary>
public sealed record SavePermisoHoraDto(
    int IdEmpleado,
    string Motivo,
    DateTime Fecha,
    string HoraSalida,
    string HoraEntrada,
    string? NoPago = null);

/// <summary>
/// Vacaciones: rango de fechas (cuenta días hábiles) y la fecha en que el empleado las solicitó,
/// que no puede ser futura. Se guardan junto a los permisos (tipo VAC): chocan con ellos, pero no
/// cuentan en sus límites.
/// </summary>
public sealed record SaveVacacionDto(
    int IdEmpleado,
    DateTime FechaInicio,
    DateTime FechaFin,
    DateTime FechaSolicitud);

/// <summary>
/// Alta de una solicitud de vacaciones con uno o varios períodos del mismo empleado y la misma
/// fecha de solicitud. Cada período se guarda como un registro (tipo VAC), todos en una sola
/// transacción: si uno no se puede registrar, no se guarda ninguno. Después cada período se
/// edita o se anula por separado (SaveVacacionDto).
/// </summary>
public sealed record SaveVacacionesDto(
    int IdEmpleado,
    DateTime FechaSolicitud,
    IReadOnlyList<PeriodoVacacionDto>? Periodos);

public sealed record PeriodoVacacionDto(DateTime FechaInicio, DateTime FechaFin);

/// <summary>
/// Quién está en sesión dentro del Control de permisos. Nivel es uno de PermisoValores.Nivel*.
/// Departamentos y Areas traen solo lo que el usuario puede ver: todo para el administrador
/// general y la consulta, su departamento para el administrador de departamento, y su área
/// (con su departamento) para el jefe.
/// </summary>
public sealed record PermisoSesionDto(
    string Nivel,
    int? IdDepartamento,
    string? NombreDepartamento,
    int? IdArea,
    string? NombreArea,
    IReadOnlyList<PermisoDepartamentoDto> Departamentos,
    IReadOnlyList<PermisoAreaDto> Areas,
    // Solo en el nivel USUARIO: el empleado dueño de la cuenta, el único al que registra permisos.
    int? IdEmpleado = null);

/// <summary>
/// Departamento habilitado, con su jornada efectiva (la general o la propia del departamento):
/// el formulario la usa para validar las horas y para convertir horas en días. Feriados
/// (yyyy-MM-dd, generales y propios, del año anterior al siguiente) es para la vista previa de
/// días hábiles. AvisoParametros trae el error si un parámetro del departamento está mal escrito
/// (mientras tanto la jornada es la de 08:00 a 16:00 y no se puede registrar en él).
/// </summary>
public sealed record PermisoDepartamentoDto(
    int IdDepartamento,
    string Nombre,
    string Estado,
    string HoraInicioJornada,
    string HoraFinJornada,
    int MinutosJornada,
    int Areas,
    int Empleados,
    IReadOnlyList<string> Feriados,
    string? AvisoParametros);

/// <summary>
/// Departamento de DEPARTAMENTO_IHSS que todavía no usa el sistema, con su edificio (EDIFICIO) y su
/// regional (REGIONAL: la del departamento o, si no tiene, la de su edificio) para filtrarlo.
/// </summary>
public sealed record PermisoDepartamentoDisponibleDto(
    int IdDepartamento,
    string Nombre,
    int Empleados,
    int? IdEdificio,
    string? NombreEdificio,
    int? IdRegional,
    string? NombreRegional);

public sealed record AgregarDepartamentoDto(int IdDepartamento);

public sealed record SaveDepartamentoEstadoDto(string Estado);

/// <summary>Área (jefatura) de un departamento, con cuántos empleados y jefes activos tiene.</summary>
public sealed record PermisoAreaDto(int IdArea, int IdDepartamento, string Nombre, string Estado, int Empleados, int Jefes);

/// <summary>El departamento solo se usa al crear; el administrador de departamento siempre crea en el suyo.</summary>
public sealed record SavePermisoAreaDto(string Nombre, string? Estado, int? IdDepartamento);

public sealed record AsignarAreaDto(int IdArea);

/// No. de pago del empleado (EMPLEADOS_IHSS.NPAGO) que se edita en Personal; vacío o null lo borra.
public sealed record NoPagoEmpleadoDto(string? NoPago);

/// <summary>
/// Logo del encabezado de los formatos de impresión, de la tabla PERMISO_LOGO. Clave: IZQUIERDO o
/// DERECHO. Imagen va en base64 porque el formato se arma en el navegador. Sin fila para una clave,
/// se imprime el logo que trae el sistema.
/// </summary>
public sealed record PermisoLogoDto(string Clave, string TipoMime, string Imagen);

/// <summary>Usuario del Control de permisos (USUARIOS_PERMISOS) y su nivel.</summary>
public sealed record PermisoJefeDto(
    int IdUsuario,
    string Usuario,
    string NombrePersona,
    string Nivel,
    int? IdDepartamento,
    string? NombreDepartamento,
    int? IdArea,
    string? NombreArea,
    string Estado,
    int Dominio,
    string DominioP,
    // Solo en el nivel USUARIO: el empleado dueño de la cuenta.
    int? IdEmpleado = null,
    string? NombreEmpleado = null);

/// <summary>
/// Alta o edición de un usuario del Control de permisos. Dominio 1 = usuario de directorio
/// activo; 0 = usuario local con contraseña inicial 1234. Estado solo al editar. Según el Nivel
/// se usa IdDepartamento (jefe de departamento o secretaría), IdArea (jefe de área) o IdEmpleado
/// (el empleado dueño de la cuenta).
/// </summary>
public sealed record SavePermisoJefeDto(
    string Usuario,
    string NombrePersona,
    string Nivel,
    int? IdDepartamento,
    int? IdArea,
    int Dominio,
    string DominioP,
    string? Estado,
    int? IdEmpleado = null);

/// <summary>Tipos, estados y niveles que admiten las tablas del Control de permisos.</summary>
public static class PermisoValores
{
    public const string TipoDia = "DIA";
    public const string TipoHora = "HORA";
    public const string TipoVacaciones = "VAC";
    public const string Activo = "ACTIVO";
    public const string Anulado = "ANULADO";
    public const string Inactivo = "INACTIVO";

    public const string NivelAdmin = "ADMIN";
    public const string NivelAdminDepartamento = "ADMIN_DEPTO";
    public const string NivelJefe = "JEFE";
    // Secretaría de un departamento: ve todas sus áreas y saca los reportes y los memorandos,
    // pero no registra permisos ni administra áreas, jefes o personal.
    public const string NivelSecretaria = "SECRETARIA";
    // Empleado: registra y ve solo sus propios permisos y vacaciones (ID_EMPLEADO_PERMISO).
    public const string NivelUsuario = "USUARIO";
    public const string NivelConsulta = "CONSULTA";

    // Niveles que se asignan. La consulta ya no existe (USUARIOS_PERMISOS no la guarda): se rechaza si llega.
    public static readonly string[] Niveles = [NivelAdmin, NivelAdminDepartamento, NivelSecretaria, NivelJefe, NivelUsuario];

    // Dominios de Active Directory que admite USUARIOS_PERMISOS.DOMINIOP.
    public static readonly string[] Dominios = ["BA", "HE", "HRN", "IVM"];
}
