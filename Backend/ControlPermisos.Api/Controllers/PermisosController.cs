using System.Security.Claims;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using ControlPermisos.Api.Models;
using ControlPermisos.Api.Services;

namespace ControlPermisos.Api.Controllers;

[ApiController]
// [Authorize] aplica la política por defecto (contraseña inicial ya cambiada). El acceso no se
// decide por rol ni por módulos sino por el perfil del usuario en USUARIOS_PERMISOS (nivel,
// departamento o área), que se lee en cada solicitud.
[Authorize]
[Route("api/permisos")]
// Control de permisos por departamento y área (jefatura). El jefe ve y registra lo de su área; el
// administrador de departamento, lo de su departamento y sus áreas y jefes; el administrador
// general, todo, incluidos los departamentos; la consulta ve y exporta todo sin modificar nada.
public sealed class PermisosController(IPermisoService permisoService, IPermisoAreaService areaService) : ControllerBase
{
    private const string PermisoNotFound = "No se encontró el permiso indicado.";

    [HttpGet("sesion")]
    public async Task<ActionResult<PermisoSesionDto>> GetSesion(CancellationToken cancellationToken) =>
        Ok(await areaService.GetSesion(await Alcance(cancellationToken), cancellationToken));

    // ?desde=yyyy-MM-dd deja los permisos que terminan ese día o después; ?hasta=yyyy-MM-dd, los
    // que empiezan ese día o antes; ?idEmpleado=, los de un empleado. Sin filtros devuelve todo el
    // historial del alcance.
    [HttpGet]
    public async Task<ActionResult<IReadOnlyList<PermisoDto>>> GetPermisos(
        [FromQuery] DateTime? desde,
        [FromQuery] DateTime? hasta,
        [FromQuery] int? idEmpleado,
        CancellationToken cancellationToken)
    {
        if (idEmpleado is <= 0) return BadRequest(new { Message = "El empleado no es válido." });
        if (desde is { } inicio && hasta is { } fin && fin.Date < inicio.Date)
        {
            return BadRequest(new { Message = "La fecha \"desde\" no puede ser posterior a la fecha \"hasta\"." });
        }
        return Ok(await permisoService.GetPermisos(
            await Alcance(cancellationToken), new PermisoFiltro(desde, hasta, idEmpleado), cancellationToken));
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
        return await permisoService.UpdatePermisoDia(await ModificarAlcance(cancellationToken), idPermiso, permiso, cancellationToken)
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
        return await permisoService.UpdatePermisoHora(await ModificarAlcance(cancellationToken), idPermiso, permiso, cancellationToken)
            ? NoContent()
            : NotFound(new { Message = PermisoNotFound });
    }

    // Las vacaciones se listan con los permisos (GET /permisos, tipo VAC) y se anulan igual que ellos.
    // Una solicitud puede traer varios períodos: se registran todos o ninguno.
    [HttpPost("vacaciones")]
    public async Task<IActionResult> CreateVacaciones(SaveVacacionesDto vacaciones, CancellationToken cancellationToken)
    {
        if (ValidateVacaciones(vacaciones) is { } message) return BadRequest(new { Message = message });
        await permisoService.CreateVacaciones(await EscrituraAlcance(cancellationToken), vacaciones, cancellationToken);
        return NoContent();
    }

    [HttpPut("vacaciones/{idPermiso:int}")]
    public async Task<IActionResult> UpdateVacacion(int idPermiso, SaveVacacionDto vacacion, CancellationToken cancellationToken)
    {
        if (idPermiso <= 0) return BadRequest(new { Message = "Las vacaciones no son válidas." });
        if (ValidateVacacion(vacacion) is { } message) return BadRequest(new { Message = message });
        return await permisoService.UpdateVacacion(await ModificarAlcance(cancellationToken), idPermiso, vacacion, cancellationToken)
            ? NoContent()
            : NotFound(new { Message = "No se encontraron las vacaciones indicadas." });
    }

    [HttpPut("{idPermiso:int}/anular")]
    public async Task<IActionResult> AnularPermiso(int idPermiso, CancellationToken cancellationToken)
    {
        if (idPermiso <= 0) return BadRequest(new { Message = "El permiso no es válido." });
        return await permisoService.AnularPermiso(await ModificarAlcance(cancellationToken), idPermiso, cancellationToken)
            ? NoContent()
            : NotFound(new { Message = "No se encontró un permiso activo con ese número." });
    }

    // ---- Personal de cada área -----------------------------------------------------------

    [HttpPut("personal/{idEmpleado:int}")]
    public async Task<IActionResult> AsignarArea(int idEmpleado, AsignarAreaDto asignacion, CancellationToken cancellationToken)
    {
        if (idEmpleado <= 0 || asignacion.IdArea <= 0) return BadRequest(new { Message = "Selecciona el empleado y el área." });
        await permisoService.AsignarArea(await ModificarAlcance(cancellationToken), idEmpleado, asignacion.IdArea, cancellationToken);
        return NoContent();
    }

    [HttpDelete("personal/{idEmpleado:int}")]
    public async Task<IActionResult> QuitarArea(int idEmpleado, CancellationToken cancellationToken)
    {
        if (idEmpleado <= 0) return BadRequest(new { Message = "El empleado no es válido." });
        return await permisoService.QuitarArea(await ModificarAlcance(cancellationToken), idEmpleado, cancellationToken)
            ? NoContent()
            : NotFound(new { Message = "El empleado no pertenece a un área que administres." });
    }

    // No. de pago del empleado, editable en Personal (el formulario del permiso lo carga de ahí).
    [HttpPut("personal/{idEmpleado:int}/no-pago")]
    public async Task<IActionResult> GuardarNoPagoEmpleado(int idEmpleado, NoPagoEmpleadoDto dato, CancellationToken cancellationToken)
    {
        if (idEmpleado <= 0) return BadRequest(new { Message = "El empleado no es válido." });
        if ((dato.NoPago?.Trim().Length ?? 0) > MaxNoPagoEmpleado)
        {
            return BadRequest(new { Message = $"El No. de pago no puede superar {MaxNoPagoEmpleado} caracteres." });
        }
        return await permisoService.GuardarNoPagoEmpleado(await ModificarAlcance(cancellationToken), idEmpleado, dato.NoPago, cancellationToken)
            ? NoContent()
            : NotFound(new { Message = "El empleado no existe, está inactivo o no está en tu alcance." });
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

    // ---- Logos de los formatos de impresión ----------------------------------------------

    // Los carga el administrador de la base en PERMISO_LOGO; aquí solo se leen, y los lee
    // cualquiera que entre porque el formato de impresión los necesita.
    [HttpGet("logos")]
    public async Task<ActionResult<IReadOnlyList<PermisoLogoDto>>> GetLogos(CancellationToken cancellationToken)
    {
        await Alcance(cancellationToken);
        return Ok(await areaService.GetLogos(cancellationToken));
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
            : NotFound(new { Message = "Solo se restablece la contraseña de usuarios locales que administras." });
    }

    [HttpDelete("jefes/{idUsuario:int}")]
    public async Task<IActionResult> DeleteJefe(int idUsuario, CancellationToken cancellationToken)
    {
        if (idUsuario <= 0) return BadRequest(new { Message = "El usuario no es válido." });
        return await areaService.DeleteJefe(await AdminAlcance(cancellationToken), idUsuario, cancellationToken)
            ? NoContent()
            : NotFound(new { Message = "No se encontró el usuario indicado o no lo administras." });
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

    // Registrar permisos y vacaciones: todos menos la consulta y la secretaría. El empleado
    // registra los suyos (el servicio valida que sean de él).
    private async Task<PermisoAlcance> EscrituraAlcance(CancellationToken cancellationToken)
    {
        var alcance = await Alcance(cancellationToken);
        if (!alcance.SoloLectura) return alcance;
        throw new UnauthorizedAccessException(alcance.Nivel == PermisoValores.NivelSecretaria
            ? "Tu usuario es de secretaría: puede ver y exportar los permisos del departamento, pero no registrarlos."
            : "Tu usuario es de consulta: puede ver y exportar, pero no modificar.");
    }

    // Editar, anular y mover personal: lo que el empleado tampoco hace con lo que ya registró.
    private async Task<PermisoAlcance> ModificarAlcance(CancellationToken cancellationToken)
    {
        var alcance = await EscrituraAlcance(cancellationToken);
        return alcance.ModificaRegistros
            ? alcance
            : throw new UnauthorizedAccessException(
                "Tu usuario registra sus permisos y vacaciones, pero no los modifica: pídele el cambio a tu jefe.");
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
    // Máximos de PERMISO_SOLICITUD.LUGAR_SOLICITUD y TELEFONO.
    internal const int MaxLugar = 100;
    internal const int MaxTelefono = 20;

    private static string? ValidateDia(SavePermisoDiaDto permiso)
    {
        if (ValidateCommon(permiso.IdEmpleado, permiso.Motivo, permiso.NoPago) is { } message) return message;
        if (permiso.FechaInicio == default || permiso.FechaFin == default) return "Indica la fecha inicial y la fecha final.";
        if (string.IsNullOrWhiteSpace(permiso.Telefono)) return "Escribe el número de teléfono donde localizar al empleado.";
        var telefono = permiso.Telefono.Trim();
        if (telefono.Length > MaxTelefono || !telefono.All(c => char.IsDigit(c) || c is ' ' or '-' or '+' or '(' or ')')
            || telefono.Count(char.IsDigit) < 7)
        {
            return "El número de teléfono no es válido: usa solo números (al menos 7), espacios, guiones, paréntesis o +.";
        }
        if (string.IsNullOrWhiteSpace(permiso.Lugar)) return "Escribe el lugar.";
        return permiso.Lugar.Trim().Length > MaxLugar ? $"El lugar no puede superar {MaxLugar} caracteres." : null;
    }

    private static string? ValidateHora(SavePermisoHoraDto permiso)
    {
        if (ValidateCommon(permiso.IdEmpleado, permiso.Motivo, permiso.NoPago) is { } message) return message;
        if (permiso.Fecha == default) return "Indica la fecha del permiso.";
        if (string.IsNullOrWhiteSpace(permiso.HoraSalida) || string.IsNullOrWhiteSpace(permiso.HoraEntrada))
        {
            return "Indica la hora de salida y la hora de regreso.";
        }
        return null;
    }

    // La fecha de solicitud es la del día en que el empleado las pidió: hoy o antes.
    internal static string? ValidateVacacion(SaveVacacionDto vacacion)
    {
        if (vacacion.IdEmpleado <= 0) return "Selecciona el empleado.";
        if (vacacion.FechaInicio == default || vacacion.FechaFin == default) return "Indica la fecha de inicio y la de finalización.";
        return ValidateFechaSolicitud(vacacion.FechaSolicitud);
    }

    // Períodos que admite una solicitud de vacaciones.
    internal const int MaxPeriodosVacaciones = 20;

    // Cada período completo y en orden, y ninguno se cruza con otro de la misma solicitud (los
    // choques con lo ya registrado los revisa el servicio).
    internal static string? ValidateVacaciones(SaveVacacionesDto vacaciones)
    {
        if (vacaciones.IdEmpleado <= 0) return "Selecciona el empleado.";
        if (vacaciones.Periodos is not { Count: > 0 } periodos) return "Indica al menos un período de vacaciones.";
        if (periodos.Count > MaxPeriodosVacaciones)
        {
            return $"Una solicitud admite hasta {MaxPeriodosVacaciones} períodos de vacaciones.";
        }
        if (periodos.Any(periodo => periodo is null || periodo.FechaInicio == default || periodo.FechaFin == default))
        {
            return "Indica la fecha de inicio y la de finalización de cada período.";
        }
        if (periodos.FirstOrDefault(periodo => periodo.FechaFin.Date < periodo.FechaInicio.Date) is { } alReves)
        {
            return $"En el período del {alReves.FechaInicio:dd/MM/yyyy} al {alReves.FechaFin:dd/MM/yyyy} la finalización es anterior al inicio.";
        }
        var ordenados = periodos.OrderBy(periodo => periodo.FechaInicio.Date).ToList();
        for (var i = 1; i < ordenados.Count; i++)
        {
            var (anterior, actual) = (ordenados[i - 1], ordenados[i]);
            if (actual.FechaInicio.Date <= anterior.FechaFin.Date)
            {
                return $"Los períodos del {anterior.FechaInicio:dd/MM/yyyy} al {anterior.FechaFin:dd/MM/yyyy} "
                    + $"y del {actual.FechaInicio:dd/MM/yyyy} al {actual.FechaFin:dd/MM/yyyy} se cruzan.";
            }
        }
        return ValidateFechaSolicitud(vacaciones.FechaSolicitud);
    }

    private static string? ValidateFechaSolicitud(DateTime fechaSolicitud)
    {
        if (fechaSolicitud == default) return "Indica la fecha de solicitud.";
        return fechaSolicitud.Date > DateTime.Today ? "La fecha de solicitud no puede ser futura." : null;
    }

    // Máximo de PERMISO_SOLICITUD.NO_PAGO.
    internal const int MaxNoPago = 20;
    // Tamaño de EMPLEADOS_IHSS.NPAGO (VARCHAR2(15)).
    internal const int MaxNoPagoEmpleado = 15;

    // El No. de pago se escribe en cada permiso (no sale del empleado) y es obligatorio.
    private static string? ValidateCommon(int idEmpleado, string? motivo, string? noPago)
    {
        if (idEmpleado <= 0) return "Selecciona el empleado.";
        if (string.IsNullOrWhiteSpace(noPago)) return "Escribe el No. de pago.";
        if (noPago.Trim().Length > MaxNoPago) return $"El No. de pago no puede superar {MaxNoPago} caracteres.";
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
        if (jefe.Nivel == PermisoValores.NivelSecretaria && jefe.IdDepartamento is null or <= 0)
        {
            return "Selecciona el departamento de la secretaría.";
        }
        if (jefe.Nivel == PermisoValores.NivelUsuario && jefe.IdEmpleado is null or <= 0)
        {
            return "Selecciona al empleado de la cuenta.";
        }
        if (jefe.Dominio is not 0 and not 1) return "El tipo de autenticación debe ser de dominio o local.";
        if (!PermisoValores.Dominios.Contains(jefe.DominioP?.Trim().ToUpperInvariant())) return "El dominio debe ser BA, HE, HRN o IVM.";
        return jefe.Estado is null || jefe.Estado.Trim().ToUpperInvariant() is PermisoValores.Activo or PermisoValores.Inactivo
            ? null
            : "El estado debe ser ACTIVO o INACTIVO.";
    }
}
