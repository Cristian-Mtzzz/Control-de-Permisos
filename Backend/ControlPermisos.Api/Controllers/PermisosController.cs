using System.Security.Claims;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using ControlPermisos.Api.Models;
using ControlPermisos.Api.Services;

namespace ControlPermisos.Api.Controllers;

[ApiController]
// [Authorize] aplica la política por defecto (contraseña inicial ya cambiada). El acceso no se
// decide por rol ni por módulos sino por el perfil en la base (nivel, departamento o área), que
// se lee en cada solicitud: así una cuenta de inventario puede ser jefe de un área, y ni el Admin
// general ni el acceso total (ADMIN_TOTAL) entran por serlo.
[Authorize]
[Route("api/permisos")]
// Control de permisos por departamento y área (jefatura). El jefe ve y registra lo de su área; el
// administrador de departamento, lo de su departamento y sus áreas y jefes; el administrador
// general, todo, incluidos los departamentos; la consulta ve y exporta todo sin modificar nada.
public sealed class PermisosController(IPermisoService permisoService, IPermisoAreaService areaService) : ControllerBase
{
    private const string PermisoNotFound = "No se encontró el permiso indicado.";
    private static readonly string[] Dominios = ["BA", "HE", "HRN", "IVM"];

    [HttpGet("sesion")]
    public async Task<ActionResult<PermisoSesionDto>> GetSesion(CancellationToken cancellationToken) =>
        Ok(await areaService.GetSesion(await Alcance(cancellationToken), cancellationToken));

    // ?desde=yyyy-MM-dd deja los permisos que terminan ese día o después; ?idEmpleado=, los de un
    // empleado. Sin filtros devuelve todo el historial del alcance (lo usa el reporte completo).
    [HttpGet]
    public async Task<ActionResult<IReadOnlyList<PermisoDto>>> GetPermisos(
        [FromQuery] DateTime? desde,
        [FromQuery] int? idEmpleado,
        CancellationToken cancellationToken)
    {
        if (idEmpleado is <= 0) return BadRequest(new { Message = "El empleado no es válido." });
        return Ok(await permisoService.GetPermisos(
            await Alcance(cancellationToken), new PermisoFiltro(desde, idEmpleado), cancellationToken));
    }

    [HttpGet("empleados")]
    public async Task<ActionResult<IReadOnlyList<PermisoEmpleadoDto>>> GetEmpleados(CancellationToken cancellationToken) =>
        Ok(await permisoService.GetEmpleados(await Alcance(cancellationToken), cancellationToken));

    [HttpPost("dia")]
    public async Task<IActionResult> CreatePermisoDia(SavePermisoDiaDto permiso, CancellationToken cancellationToken)
    {
        if (ValidateDia(permiso) is { } message) return BadRequest(new { Message = message });
        await permisoService.CreatePermisoDia(await EscrituraAlcance(cancellationToken), permiso, cancellationToken);
        return NoContent();
    }

    [HttpPut("dia/{idPermiso:int}")]
    public async Task<IActionResult> UpdatePermisoDia(int idPermiso, SavePermisoDiaDto permiso, CancellationToken cancellationToken)
    {
        if (idPermiso <= 0) return BadRequest(new { Message = "El permiso no es válido." });
        if (ValidateDia(permiso) is { } message) return BadRequest(new { Message = message });
        return await permisoService.UpdatePermisoDia(await EscrituraAlcance(cancellationToken), idPermiso, permiso, cancellationToken)
            ? NoContent()
            : NotFound(new { Message = PermisoNotFound });
    }

    [HttpPost("hora")]
    public async Task<IActionResult> CreatePermisoHora(SavePermisoHoraDto permiso, CancellationToken cancellationToken)
    {
        if (ValidateHora(permiso) is { } message) return BadRequest(new { Message = message });
        await permisoService.CreatePermisoHora(await EscrituraAlcance(cancellationToken), permiso, cancellationToken);
        return NoContent();
    }

    [HttpPut("hora/{idPermiso:int}")]
    public async Task<IActionResult> UpdatePermisoHora(int idPermiso, SavePermisoHoraDto permiso, CancellationToken cancellationToken)
    {
        if (idPermiso <= 0) return BadRequest(new { Message = "El permiso no es válido." });
        if (ValidateHora(permiso) is { } message) return BadRequest(new { Message = message });
        return await permisoService.UpdatePermisoHora(await EscrituraAlcance(cancellationToken), idPermiso, permiso, cancellationToken)
            ? NoContent()
            : NotFound(new { Message = PermisoNotFound });
    }

    [HttpPut("{idPermiso:int}/anular")]
    public async Task<IActionResult> AnularPermiso(int idPermiso, CancellationToken cancellationToken)
    {
        if (idPermiso <= 0) return BadRequest(new { Message = "El permiso no es válido." });
        return await permisoService.AnularPermiso(await EscrituraAlcance(cancellationToken), idPermiso, cancellationToken)
            ? NoContent()
            : NotFound(new { Message = "No se encontró un permiso activo con ese número." });
    }

    // ---- Personal de cada área -----------------------------------------------------------

    [HttpPut("personal/{idEmpleado:int}")]
    public async Task<IActionResult> AsignarArea(int idEmpleado, AsignarAreaDto asignacion, CancellationToken cancellationToken)
    {
        if (idEmpleado <= 0 || asignacion.IdArea <= 0) return BadRequest(new { Message = "Selecciona el empleado y el área." });
        await permisoService.AsignarArea(await EscrituraAlcance(cancellationToken), idEmpleado, asignacion.IdArea, cancellationToken);
        return NoContent();
    }

    [HttpDelete("personal/{idEmpleado:int}")]
    public async Task<IActionResult> QuitarArea(int idEmpleado, CancellationToken cancellationToken)
    {
        if (idEmpleado <= 0) return BadRequest(new { Message = "El empleado no es válido." });
        return await permisoService.QuitarArea(await EscrituraAlcance(cancellationToken), idEmpleado, cancellationToken)
            ? NoContent()
            : NotFound(new { Message = "El empleado no pertenece a un área que administres." });
    }

    // ---- Departamentos (solo administrador general) --------------------------------------

    [HttpGet("departamentos/disponibles")]
    public async Task<ActionResult<IReadOnlyList<PermisoDepartamentoDisponibleDto>>> GetDepartamentosDisponibles(
        CancellationToken cancellationToken)
    {
        await AdminGeneralAlcance(cancellationToken);
        return Ok(await areaService.GetDepartamentosDisponibles(cancellationToken));
    }

    [HttpPost("departamentos")]
    public async Task<IActionResult> AgregarDepartamento(AgregarDepartamentoDto departamento, CancellationToken cancellationToken)
    {
        if (departamento.IdDepartamento <= 0) return BadRequest(new { Message = "Selecciona el departamento." });
        await AdminGeneralAlcance(cancellationToken);
        await areaService.AgregarDepartamento(departamento.IdDepartamento, cancellationToken);
        return NoContent();
    }

    [HttpPut("departamentos/{idDepartamento:int}")]
    public async Task<IActionResult> UpdateDepartamento(int idDepartamento, SaveDepartamentoEstadoDto departamento,
        CancellationToken cancellationToken)
    {
        var estado = departamento.Estado?.Trim().ToUpperInvariant();
        if (idDepartamento <= 0 || estado is not (PermisoValores.Activo or PermisoValores.Inactivo))
        {
            return BadRequest(new { Message = "Indica el departamento y si queda ACTIVO o INACTIVO." });
        }
        await AdminGeneralAlcance(cancellationToken);
        return await areaService.UpdateDepartamentoEstado(idDepartamento, estado, cancellationToken)
            ? NoContent()
            : NotFound(new { Message = "No se encontró el departamento indicado." });
    }

    // ---- Áreas y usuarios (administradores, cada uno en su alcance) ----------------------

    [HttpPost("areas")]
    public async Task<IActionResult> CreateArea(SavePermisoAreaDto area, CancellationToken cancellationToken)
    {
        if (ValidateArea(area) is { } message) return BadRequest(new { Message = message });
        await areaService.CreateArea(await AdminAlcance(cancellationToken), area, cancellationToken);
        return NoContent();
    }

    [HttpPut("areas/{idArea:int}")]
    public async Task<IActionResult> UpdateArea(int idArea, SavePermisoAreaDto area, CancellationToken cancellationToken)
    {
        if (idArea <= 0) return BadRequest(new { Message = "El área no es válida." });
        if (ValidateArea(area) is { } message) return BadRequest(new { Message = message });
        return await areaService.UpdateArea(await AdminAlcance(cancellationToken), idArea, area, cancellationToken)
            ? NoContent()
            : NotFound(new { Message = "No se encontró el área indicada." });
    }

    [HttpGet("jefes")]
    public async Task<ActionResult<IReadOnlyList<PermisoJefeDto>>> GetJefes(CancellationToken cancellationToken) =>
        Ok(await areaService.GetJefes(await AdminAlcance(cancellationToken), cancellationToken));

    [HttpPost("jefes")]
    public async Task<IActionResult> CreateJefe(SavePermisoJefeDto jefe, CancellationToken cancellationToken)
    {
        if (ValidateJefe(jefe) is { } message) return BadRequest(new { Message = message });
        await areaService.CreateJefe(await AdminAlcance(cancellationToken), jefe, cancellationToken);
        return NoContent();
    }

    [HttpPut("jefes/{idUsuario:int}")]
    public async Task<IActionResult> UpdateJefe(int idUsuario, SavePermisoJefeDto jefe, CancellationToken cancellationToken)
    {
        if (idUsuario <= 0) return BadRequest(new { Message = "El usuario no es válido." });
        if (ValidateJefe(jefe) is { } message) return BadRequest(new { Message = message });
        return await areaService.UpdateJefe(await AdminAlcance(cancellationToken), idUsuario, jefe, cancellationToken)
            ? NoContent()
            : NotFound(new { Message = "No se encontró el usuario indicado o no lo administras." });
    }

    [HttpPut("jefes/{idUsuario:int}/reset-password")]
    public async Task<IActionResult> ResetJefePassword(int idUsuario, CancellationToken cancellationToken)
    {
        if (idUsuario <= 0) return BadRequest(new { Message = "El usuario no es válido." });
        return await areaService.ResetJefePassword(await AdminAlcance(cancellationToken), idUsuario, cancellationToken)
            ? NoContent()
            : NotFound(new { Message = "Solo se restablece la contraseña de cuentas locales propias del control de permisos que administras." });
    }

    // Cuentas de inventario a las que se les puede dar acceso con la misma cuenta. El administrador
    // de departamento debe indicar el usuario exacto (?usuario=...).
    [HttpGet("usuarios-inventario")]
    public async Task<ActionResult<IReadOnlyList<PermisoUsuarioInventarioDto>>> GetUsuariosInventario(
        [FromQuery] string? usuario, CancellationToken cancellationToken)
    {
        var alcance = await AdminAlcance(cancellationToken);
        if (!alcance.EsAdmin && string.IsNullOrWhiteSpace(usuario))
        {
            return BadRequest(new { Message = "Escribe el usuario de la cuenta de inventario." });
        }
        return Ok(await areaService.GetUsuariosInventario(alcance, usuario, cancellationToken));
    }

    [HttpDelete("jefes/{idUsuario:int}/acceso")]
    public async Task<IActionResult> QuitarAcceso(int idUsuario, CancellationToken cancellationToken)
    {
        if (idUsuario <= 0) return BadRequest(new { Message = "El usuario no es válido." });
        return await areaService.QuitarAcceso(await AdminAlcance(cancellationToken), idUsuario, cancellationToken)
            ? NoContent()
            : NotFound(new { Message = "Solo se quita el acceso a cuentas de inventario que administras; las propias de permisos se desactivan." });
    }

    // Nivel, departamento y área se leen de la base en cada solicitud (no del token), así un cambio aplica de inmediato.
    private async Task<PermisoAlcance> Alcance(CancellationToken cancellationToken)
    {
        if (!int.TryParse(User.FindFirstValue(ClaimTypes.NameIdentifier) ?? User.FindFirstValue("sub"), out var userId))
        {
            throw new ArgumentException("No se pudo identificar al usuario.");
        }
        return await areaService.GetAlcance(userId, cancellationToken);
    }

    // Registrar, editar, anular y mover personal: todos menos la consulta.
    private async Task<PermisoAlcance> EscrituraAlcance(CancellationToken cancellationToken)
    {
        var alcance = await Alcance(cancellationToken);
        return alcance.SoloLectura
            ? throw new UnauthorizedAccessException("Tu usuario es de consulta: puede ver y exportar, pero no modificar.")
            : alcance;
    }

    private async Task<PermisoAlcance> AdminAlcance(CancellationToken cancellationToken)
    {
        var alcance = await Alcance(cancellationToken);
        return alcance.Administra
            ? alcance
            : throw new UnauthorizedAccessException("Solo un administrador de permisos puede hacer esto.");
    }

    private async Task<PermisoAlcance> AdminGeneralAlcance(CancellationToken cancellationToken)
    {
        var alcance = await Alcance(cancellationToken);
        return alcance.EsAdmin
            ? alcance
            : throw new UnauthorizedAccessException("Solo el administrador general maneja los departamentos.");
    }

    // Reglas de forma; las de negocio (área, días hábiles, choques y límites) las aplica el servicio.
    private static string? ValidateDia(SavePermisoDiaDto permiso)
    {
        if (ValidateCommon(permiso.IdEmpleado, permiso.Motivo) is { } message) return message;
        if (permiso.FechaInicio == default || permiso.FechaFin == default) return "Indica la fecha inicial y la fecha final.";
        if (permiso.FechaSolicitud == default) return "Indica la fecha en que se hizo la solicitud.";
        // Puede ser posterior al permiso (se pide después de faltar), pero no una fecha que todavía no llega.
        return permiso.FechaSolicitud.Date > DateTime.Today ? "La fecha de solicitud no puede ser posterior a hoy." : null;
    }

    private static string? ValidateHora(SavePermisoHoraDto permiso)
    {
        if (ValidateCommon(permiso.IdEmpleado, permiso.Motivo) is { } message) return message;
        if (permiso.Fecha == default) return "Indica la fecha del permiso.";
        return string.IsNullOrWhiteSpace(permiso.HoraSalida) || string.IsNullOrWhiteSpace(permiso.HoraEntrada)
            ? "Indica la hora de salida y la hora de entrada."
            : null;
    }

    private static string? ValidateCommon(int idEmpleado, string? motivo)
    {
        if (idEmpleado <= 0) return "Selecciona el empleado.";
        if (string.IsNullOrWhiteSpace(motivo)) return "Escribe el motivo del permiso.";
        return motivo.Length > 1000 ? "El motivo no puede superar 1000 caracteres." : null;
    }

    private static string? ValidateArea(SavePermisoAreaDto area)
    {
        if (string.IsNullOrWhiteSpace(area.Nombre)) return "Escribe el nombre del área.";
        if (area.Nombre.Trim().Length > 100) return "El nombre del área no puede superar 100 caracteres.";
        return area.Estado is null || area.Estado.Trim().ToUpperInvariant() is PermisoValores.Activo or PermisoValores.Inactivo
            ? null
            : "El estado debe ser ACTIVO o INACTIVO.";
    }

    private static string? ValidateJefe(SavePermisoJefeDto jefe)
    {
        if (string.IsNullOrWhiteSpace(jefe.Usuario) || string.IsNullOrWhiteSpace(jefe.NombrePersona))
        {
            return "El usuario y el nombre de la persona son obligatorios.";
        }
        if (!PermisoValores.Niveles.Contains(jefe.Nivel)) return "Selecciona el nivel de acceso.";
        if (jefe.Nivel == PermisoValores.NivelJefe && jefe.IdArea is null or <= 0) return "Selecciona el área del jefe.";
        if (jefe.Nivel == PermisoValores.NivelAdminDepartamento && jefe.IdDepartamento is null or <= 0)
        {
            return "Selecciona el departamento que administra.";
        }
        if (jefe.Dominio is not 0 and not 1) return "El tipo de autenticación debe ser de dominio o local.";
        if (!Dominios.Contains(jefe.DominioP?.Trim().ToUpperInvariant())) return "El dominio debe ser BA, HE, HRN o IVM.";
        return jefe.Estado is null || jefe.Estado.Trim().ToUpperInvariant() is PermisoValores.Activo or PermisoValores.Inactivo
            ? null
            : "El estado debe ser ACTIVO o INACTIVO.";
    }
}
