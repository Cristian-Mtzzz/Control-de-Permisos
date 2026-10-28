namespace ControlPermisos.Api.Models;

// Contratos del sistema de Control de permisos. Hay dos tipos: por día (rango de fechas,
// cuenta solo días hábiles) y por hora (una fecha con hora de salida y de entrada dentro de
// la jornada). Se organiza por departamento y, dentro de cada uno, por área (jefatura).

/// <summary>
/// Permiso tal como lo muestra la tabla. En el permiso por hora FechaInicio y FechaFin son
/// la misma fecha; DiasHabiles es 0 en los de hora y Minutos es 0 en los de día.
/// IdArea es el área del empleado cuando se registró el permiso; el departamento es el de esa área.
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
    string? NombreDepartamento);

/// <summary>Empleado activo de un departamento habilitado, con su área (null = sin área).</summary>
public sealed record PermisoEmpleadoDto(
    int IdEmpleado,
    string NombreCompleto,
    string? NoPago,
    int IdDepartamento,
    int? IdArea,
    string? NombreArea);

/// <summary>Permiso por día: rango de fechas y fecha en que se hizo la solicitud.</summary>
public sealed record SavePermisoDiaDto(
    int IdEmpleado,
    string Motivo,
    DateTime FechaInicio,
    DateTime FechaFin,
    DateTime FechaSolicitud);

/// <summary>Permiso por hora: una fecha con hora de salida y de entrada en formato HH:mm.</summary>
public sealed record SavePermisoHoraDto(
    int IdEmpleado,
    string Motivo,
    DateTime Fecha,
    string HoraSalida,
    string HoraEntrada);

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
    IReadOnlyList<PermisoAreaDto> Areas);

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

/// <summary>
/// Usuario con acceso al Control de permisos y su nivel. SoloPermisos indica una cuenta creada
/// para este sistema; si es false, es una cuenta de inventario a la que se le dio acceso (su
/// usuario, contraseña y estado se administran en inventario).
/// </summary>
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
    bool SoloPermisos);

/// <summary>Cuenta de inventario activa que todavía no tiene acceso al Control de permisos.</summary>
public sealed record PermisoUsuarioInventarioDto(int IdUsuario, string Usuario, string NombrePersona);

/// <summary>
/// Alta o edición de un usuario del Control de permisos. Dominio 1 = usuario de directorio
/// activo; 0 = usuario local con contraseña inicial 1234. Estado solo al editar. Según el Nivel
/// se usa IdDepartamento (administrador de departamento) o IdArea (jefe de área). En una cuenta
/// de inventario solo se aplican el nivel, el departamento y el área.
/// </summary>
public sealed record SavePermisoJefeDto(
    string Usuario,
    string NombrePersona,
    string Nivel,
    int? IdDepartamento,
    int? IdArea,
    int Dominio,
    string DominioP,
    string? Estado);

/// <summary>Tipos, estados y niveles que admiten las tablas del Control de permisos.</summary>
public static class PermisoValores
{
    public const string TipoDia = "DIA";
    public const string TipoHora = "HORA";
    public const string Activo = "ACTIVO";
    public const string Anulado = "ANULADO";
    public const string Inactivo = "INACTIVO";

    public const string NivelAdmin = "ADMIN";
    public const string NivelAdminDepartamento = "ADMIN_DEPTO";
    public const string NivelJefe = "JEFE";
    public const string NivelConsulta = "CONSULTA";

    public static readonly string[] Niveles = [NivelAdmin, NivelAdminDepartamento, NivelJefe, NivelConsulta];
}
