using ControlPermisos.Api.Controllers;
using ControlPermisos.Api.Models;
using Microsoft.AspNetCore.Mvc;

namespace ControlPermisos.Api.Tests;

// Validaciones de forma del controlador: se rechazan con 400 antes de consultar el alcance o la
// base, por eso los servicios no hacen falta (null).
public sealed class PermisosControllerTests
{
    private static readonly PermisosController Controller = new(null!, null!);

    private static SavePermisoDiaDto Dia(
        string motivo = "Cita médica", string? noPago = "12345", string? lugar = "Tegucigalpa", string? telefono = "9988-7766") =>
        new(10, motivo, DateTime.Today, DateTime.Today, noPago, lugar, telefono);

    private static SavePermisoJefeDto Jefe(string nivel = PermisoValores.NivelJefe, int? idArea = 5, string dominioP = "BA") =>
        new("juan.perez", "Juan Pérez", nivel, null, idArea, 1, dominioP, null);

    private static void EsBadRequest(IActionResult result, string mensaje)
    {
        var badRequest = Assert.IsType<BadRequestObjectResult>(result);
        Assert.Contains(mensaje, badRequest.Value?.GetType().GetProperty("Message")?.GetValue(badRequest.Value) as string);
    }

    [Theory]
    [InlineData("", "Escribe el motivo")]
    [InlineData("   ", "Escribe el motivo")]
    public async Task PermisoSinMotivoSeRechaza(string motivo, string mensaje)
    {
        EsBadRequest(await Controller.CreatePermisoDia(Dia(motivo), default), mensaje);
    }

    // El No. de pago se escribe en cada permiso: obligatorio y de hasta 20 caracteres.
    [Theory]
    [InlineData(null, "Escribe el No. de pago")]
    [InlineData("   ", "Escribe el No. de pago")]
    [InlineData("123456789012345678901", "no puede superar 20 caracteres")]
    public async Task PermisoSinNoPagoOConUnoMuyLargoSeRechaza(string? noPago, string mensaje)
    {
        EsBadRequest(await Controller.CreatePermisoDia(Dia(noPago: noPago), default), mensaje);
        EsBadRequest(await Controller.UpdatePermisoDia(5, Dia(noPago: noPago), default), mensaje);
        var hora = new SavePermisoHoraDto(10, "Trámite", DateTime.Today, "09:00", "10:00", noPago);
        EsBadRequest(await Controller.CreatePermisoHora(hora, default), mensaje);
    }

    // El No. de pago del empleado (Personal) cabe en EMPLEADOS_IHSS.NPAGO: hasta 15 caracteres.
    [Fact]
    public async Task NoPagoDelEmpleadoInvalidoSeRechaza()
    {
        EsBadRequest(await Controller.GuardarNoPagoEmpleado(0, new NoPagoEmpleadoDto("123"), default), "El empleado no es válido");
        EsBadRequest(await Controller.GuardarNoPagoEmpleado(5, new NoPagoEmpleadoDto("1234567890123456"), default),
            "no puede superar 15 caracteres");
    }

    // El permiso por día pide el teléfono donde localizar al empleado y el lugar (su formato impreso).
    [Theory]
    [InlineData(null, "Tegucigalpa", "número de teléfono donde localizar")]
    [InlineData("  ", "Tegucigalpa", "número de teléfono donde localizar")]
    [InlineData("99-88", "Tegucigalpa", "no es válido")]
    [InlineData("9988 77AB", "Tegucigalpa", "no es válido")]
    [InlineData("+504 (2) 2239-9999 x", "Tegucigalpa", "no es válido")]
    [InlineData("9988-7766", null, "Escribe el lugar")]
    [InlineData("9988-7766", " ", "Escribe el lugar")]
    public async Task PermisoPorDiaSinTelefonoOLugarValidosSeRechaza(string? telefono, string? lugar, string mensaje)
    {
        EsBadRequest(await Controller.CreatePermisoDia(Dia(telefono: telefono, lugar: lugar), default), mensaje);
        EsBadRequest(await Controller.UpdatePermisoDia(5, Dia(telefono: telefono, lugar: lugar), default), mensaje);
    }

    [Fact]
    public async Task ElLugarNoPasaDe100Caracteres()
    {
        EsBadRequest(await Controller.CreatePermisoDia(Dia(lugar: new string('L', 101)), default), "100 caracteres");
    }

    [Fact]
    public async Task MotivoDeMasDe1000CaracteresSeRechaza()
    {
        EsBadRequest(await Controller.CreatePermisoDia(Dia(new string('x', 1001)), default), "1000 caracteres");
    }

    [Fact]
    public async Task PermisoPorHoraSinHorasSeRechaza()
    {
        var permiso = new SavePermisoHoraDto(10, "Trámite", DateTime.Today, "09:00", " ", "12345");
        EsBadRequest(await Controller.CreatePermisoHora(permiso, default), "hora de salida y la hora de regreso");
    }

    [Fact]
    public async Task PermisoPorDiaSinFechasSeRechaza()
    {
        var sinFin = new SavePermisoDiaDto(10, "Viaje", DateTime.Today, default, "12345", "Tegucigalpa", "99887766");
        EsBadRequest(await Controller.CreatePermisoDia(sinFin, default), "fecha inicial y la fecha final");
        EsBadRequest(await Controller.UpdatePermisoDia(5, sinFin, default), "fecha inicial y la fecha final");
    }

    private static SaveVacacionesDto Vacaciones(DateTime solicitud, params (int Desde, int Hasta)[] periodos) =>
        new(10, solicitud, [.. periodos.Select(p => new PeriodoVacacionDto(DateTime.Today.AddDays(p.Desde), DateTime.Today.AddDays(p.Hasta)))]);

    [Fact]
    public async Task VacacionesIncompletasOConSolicitudFuturaSeRechazan()
    {
        var hoy = DateTime.Today;
        EsBadRequest(await Controller.CreateVacaciones(Vacaciones(hoy, (0, 0)) with { IdEmpleado = 0 }, default), "Selecciona el empleado");
        EsBadRequest(await Controller.CreateVacaciones(new(10, hoy, [new(hoy, default)]), default), "fecha de inicio y la de finalización");
        EsBadRequest(await Controller.CreateVacaciones(Vacaciones(default, (0, 0)), default), "fecha de solicitud");
        EsBadRequest(await Controller.CreateVacaciones(Vacaciones(hoy.AddDays(1), (0, 0)), default), "no puede ser futura");
        EsBadRequest(await Controller.UpdateVacacion(0, new(10, hoy, hoy, hoy), default), "no son válidas");
        EsBadRequest(await Controller.UpdateVacacion(5, new(10, hoy, hoy, hoy.AddDays(1)), default), "no puede ser futura");
        Assert.Null(PermisosController.ValidateVacacion(new(10, hoy.AddDays(3), hoy.AddDays(5), hoy.AddDays(-2))));
    }

    [Fact]
    public async Task UnaSolicitudDeVacacionesAdmiteVariosPeriodosQueNoSeCrucen()
    {
        var hoy = DateTime.Today;
        Assert.Null(PermisosController.ValidateVacaciones(Vacaciones(hoy, (10, 12), (3, 5), (20, 20))));
        EsBadRequest(await Controller.CreateVacaciones(Vacaciones(hoy), default), "al menos un período");
        EsBadRequest(await Controller.CreateVacaciones(new(10, hoy, null), default), "al menos un período");
        EsBadRequest(await Controller.CreateVacaciones(Vacaciones(hoy, (3, 5), (5, 8)), default), "se cruzan");
        EsBadRequest(await Controller.CreateVacaciones(Vacaciones(hoy, (10, 12), (3, 11)), default), "se cruzan");
        EsBadRequest(await Controller.CreateVacaciones(Vacaciones(hoy, (3, 5), (9, 7)), default), "la finalización es anterior al inicio");
        var demasiados = Enumerable.Range(0, PermisosController.MaxPeriodosVacaciones + 1).Select(i => (i * 2, i * 2)).ToArray();
        EsBadRequest(await Controller.CreateVacaciones(Vacaciones(hoy, demasiados), default), $"hasta {PermisosController.MaxPeriodosVacaciones} períodos");
    }

    [Fact]
    public async Task EditarUnPermisoConIdentificadorInvalidoSeRechaza()
    {
        EsBadRequest(await Controller.UpdatePermisoDia(0, Dia(), default), "no es válido");
        EsBadRequest(await Controller.AnularPermiso(-1, default), "no es válido");
    }

    [Fact]
    public async Task FiltrarPorUnEmpleadoInvalidoSeRechaza()
    {
        var result = await Controller.GetPermisos(null, null, 0, default);
        Assert.IsType<BadRequestObjectResult>(result.Result);
    }

    [Fact]
    public async Task FiltrarConHastaAnteriorADesdeSeRechaza()
    {
        var result = await Controller.GetPermisos(DateTime.Today, DateTime.Today.AddDays(-1), null, default);
        var badRequest = Assert.IsType<BadRequestObjectResult>(result.Result);
        Assert.Contains("posterior", badRequest.Value?.GetType().GetProperty("Message")?.GetValue(badRequest.Value) as string);
    }

    [Fact]
    public async Task JefeSinAreaSeRechaza()
    {
        EsBadRequest(await Controller.CreateJefe(Jefe(idArea: null), default), "área del jefe");
    }

    [Fact]
    public async Task SecretariaSinDepartamentoSeRechaza()
    {
        EsBadRequest(
            await Controller.CreateJefe(Jefe(nivel: PermisoValores.NivelSecretaria, idArea: null), default),
            "departamento de la secretaría");
    }

    [Fact]
    public async Task NivelODominioDesconocidoSeRechaza()
    {
        EsBadRequest(await Controller.CreateJefe(Jefe(nivel: "SUPERUSUARIO"), default), "nivel de acceso");
        EsBadRequest(await Controller.CreateJefe(Jefe(dominioP: "XX"), default), "BA, HE, HRN o IVM");
    }
}
