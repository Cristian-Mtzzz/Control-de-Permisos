using ControlPermisos.Api.Models;

namespace ControlPermisos.Api.Services;

/// <summary>
/// Alcance del usuario en sesión, leído de la base en cada solicitud. Nivel es uno de
/// PermisoValores.Nivel*: el administrador general y la consulta ven todo; el administrador de
/// departamento y la secretaría, su departamento (IdDepartamento); el jefe, su área (IdArea, con
/// el departamento de esa área); el empleado, solo lo suyo (IdEmpleado).
/// </summary>
public sealed record PermisoAlcance(int IdUsuario, string Nivel, int? IdDepartamento, int? IdArea, int? IdEmpleado = null)
{
    public bool EsAdmin => Nivel == PermisoValores.NivelAdmin;
    public bool VeTodo => Nivel is PermisoValores.NivelAdmin or PermisoValores.NivelConsulta;
    // Administra áreas, jefes y personal: el general en todo, el de departamento en el suyo.
    public bool Administra => Nivel is PermisoValores.NivelAdmin or PermisoValores.NivelAdminDepartamento;
    // Ve y exporta, pero no registra: la consulta (en todo) y la secretaría (en su departamento).
    public bool SoloLectura => Nivel is PermisoValores.NivelConsulta or PermisoValores.NivelSecretaria;
    // El empleado solo ve y registra lo suyo: no modifica lo guardado ni toca el personal.
    public bool EsEmpleado => Nivel == PermisoValores.NivelUsuario;
    // Editar, anular y mover personal: todos los que registran menos el empleado.
    public bool ModificaRegistros => !SoloLectura && !EsEmpleado;

    /// <summary>
    /// Condición SQL que limita al alcance las filas de un área (alias de PERMISO_AREA, por
    /// ejemplo "a."); null cuando ve todo. Va con los parámetros de <see cref="ParametrosArea"/>.
    /// </summary>
    public string? FiltroArea(string alias) => Nivel switch
    {
        PermisoValores.NivelAdminDepartamento or PermisoValores.NivelSecretaria => $"{alias}DEPARTAMENTO_IHSS_ID = :alcanceDepto",
        // El empleado solo necesita su área: la de los permisos que registra.
        PermisoValores.NivelJefe or PermisoValores.NivelUsuario => $"{alias}ID_AREA = :alcanceArea",
        _ => null,
    };

    public (string Name, object? Value)[] ParametrosArea() => Nivel switch
    {
        PermisoValores.NivelAdminDepartamento or PermisoValores.NivelSecretaria => [("alcanceDepto", IdDepartamento)],
        PermisoValores.NivelJefe or PermisoValores.NivelUsuario => [("alcanceArea", IdArea)],
        _ => [],
    };

    /// <summary>El área (de ese departamento) está dentro de lo que el usuario puede ver.</summary>
    public bool IncluyeArea(int idArea, int idDepartamento) => Nivel switch
    {
        PermisoValores.NivelAdminDepartamento or PermisoValores.NivelSecretaria => idDepartamento == IdDepartamento,
        PermisoValores.NivelJefe => idArea == IdArea,
        // El empleado no se limita por área: lo suyo se valida por empleado (IncluyeEmpleado).
        _ => true,
    };

    /// <summary>Los permisos de ese empleado están dentro de lo que el usuario puede ver.</summary>
    public bool IncluyeEmpleado(int idEmpleado) => !EsEmpleado || idEmpleado == IdEmpleado;
}

/// <summary>
/// Filtro de la lista de permisos. Desde: los que terminan ese día o después. Hasta: los que
/// empiezan ese día o antes. IdEmpleado: solo los de ese empleado. Vacío = sin límite (siempre
/// dentro del alcance del usuario).
/// </summary>
public sealed record PermisoFiltro(DateTime? Desde, DateTime? Hasta, int? IdEmpleado);

// Contrato del Control de permisos: permisos y personal de cada área.
public interface IPermisoService
{
    Task<IReadOnlyList<PermisoDto>> GetPermisos(PermisoAlcance alcance, PermisoFiltro filtro, CancellationToken cancellationToken);
    // Empleados activos de los departamentos habilitados con su área. El jefe recibe los de su
    // área y los de su departamento que todavía no tienen área (para poder agregarlos).
    Task<IReadOnlyList<PermisoEmpleadoDto>> GetEmpleados(PermisoAlcance alcance, CancellationToken cancellationToken);
    // Las reglas de negocio (área, días hábiles, jornada, choques y límites) fallan con ArgumentException.
    Task CreatePermisoDia(PermisoAlcance alcance, SavePermisoDiaDto permiso, CancellationToken cancellationToken);
    Task<bool> UpdatePermisoDia(PermisoAlcance alcance, int idPermiso, SavePermisoDiaDto permiso, CancellationToken cancellationToken);
    Task CreatePermisoHora(PermisoAlcance alcance, SavePermisoHoraDto permiso, CancellationToken cancellationToken);
    Task<bool> UpdatePermisoHora(PermisoAlcance alcance, int idPermiso, SavePermisoHoraDto permiso, CancellationToken cancellationToken);
    // Todos los períodos de la solicitud, o ninguno si uno no se puede registrar.
    Task CreateVacaciones(PermisoAlcance alcance, SaveVacacionesDto vacaciones, CancellationToken cancellationToken);
    Task<bool> UpdateVacacion(PermisoAlcance alcance, int idPermiso, SaveVacacionDto vacacion, CancellationToken cancellationToken);
    // Anula permisos y vacaciones.
    Task<bool> AnularPermiso(PermisoAlcance alcance, int idPermiso, CancellationToken cancellationToken);
    // El jefe solo agrega empleados sin área a la suya; los administradores mueven dentro de su alcance.
    Task AsignarArea(PermisoAlcance alcance, int idEmpleado, int idArea, CancellationToken cancellationToken);
    Task<bool> QuitarArea(PermisoAlcance alcance, int idEmpleado, CancellationToken cancellationToken);
    // No. de pago del empleado (EMPLEADOS_IHSS.NPAGO); false si no existe o está fuera del alcance.
    Task<bool> GuardarNoPagoEmpleado(PermisoAlcance alcance, int idEmpleado, string? noPago, CancellationToken cancellationToken);
}

// Contrato de departamentos, áreas (jefaturas) y usuarios del Control de permisos.
public interface IPermisoAreaService
{
    // Falla con UnauthorizedAccessException si el usuario no tiene un nivel de acceso vigente.
    Task<PermisoAlcance> GetAlcance(int idUsuario, CancellationToken cancellationToken);
    Task<PermisoSesionDto> GetSesion(PermisoAlcance alcance, CancellationToken cancellationToken);
    // Solo administrador general.
    Task<IReadOnlyList<PermisoDepartamentoDisponibleDto>> GetDepartamentosDisponibles(CancellationToken cancellationToken);
    Task AgregarDepartamento(int idDepartamento, CancellationToken cancellationToken);
    Task<bool> UpdateDepartamentoEstado(int idDepartamento, string estado, CancellationToken cancellationToken);
    // Administradores, dentro de su alcance.
    Task CreateArea(PermisoAlcance alcance, SavePermisoAreaDto area, CancellationToken cancellationToken);
    Task<bool> UpdateArea(PermisoAlcance alcance, int idArea, SavePermisoAreaDto area, CancellationToken cancellationToken);
    // Logos del encabezado de los formatos de impresión (PERMISO_LOGO, se cargan en la base);
    // viene solo el que exista.
    Task<IReadOnlyList<PermisoLogoDto>> GetLogos(CancellationToken cancellationToken);
    Task<IReadOnlyList<PermisoJefeDto>> GetJefes(PermisoAlcance alcance, CancellationToken cancellationToken);
    Task CreateJefe(PermisoAlcance alcance, SavePermisoJefeDto jefe, CancellationToken cancellationToken);
    Task<bool> UpdateJefe(PermisoAlcance alcance, int idUsuario, SavePermisoJefeDto jefe, CancellationToken cancellationToken);
    Task<bool> ResetJefePassword(PermisoAlcance alcance, int idUsuario, CancellationToken cancellationToken);
    Task<bool> DeleteJefe(PermisoAlcance alcance, int idUsuario, CancellationToken cancellationToken);
}
