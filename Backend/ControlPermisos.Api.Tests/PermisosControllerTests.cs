using ControlPermisos.Api.Controllers;
using ControlPermisos.Api.Models;
using Microsoft.AspNetCore.Mvc;

namespace ControlPermisos.Api.Tests;

// Validaciones de forma del controlador: se rechazan con 400 antes de consultar el alcance o la
// base, por eso los servicios no hacen falta (null).
public sealed class PermisosControllerTests
{
    private static readonly PermisosController Controller = new(null!, null!);

    private static SavePermisoDiaDto Dia(string motivo = "Cita médica", DateTime? solicitud = null) =>
        new(10, motivo, DateTime.Today, DateTime.Today, solicitud ?? DateTime.Today);

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

    [Fact]
    public async Task MotivoDeMasDe1000CaracteresSeRechaza()
    {
        EsBadRequest(await Controller.CreatePermisoDia(Dia(new string('x', 1001)), default), "1000 caracteres");
    }

    [Fact]
    public async Task FechaDeSolicitudFuturaSeRechaza()
    {
        EsBadRequest(await Controller.CreatePermisoDia(Dia(solicitud: DateTime.Today.AddDays(1)), default), "posterior a hoy");
    }

    [Fact]
    public async Task PermisoPorHoraSinHorasSeRechaza()
    {
        var permiso = new SavePermisoHoraDto(10, "Trámite", DateTime.Today, "09:00", " ");
        EsBadRequest(await Controller.CreatePermisoHora(permiso, default), "hora de salida y la hora de entrada");
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
        var result = await Controller.GetPermisos(null, 0, default);
        Assert.IsType<BadRequestObjectResult>(result.Result);
    }

    [Fact]
    public async Task JefeSinAreaSeRechaza()
    {
        EsBadRequest(await Controller.CreateJefe(Jefe(idArea: null), default), "área del jefe");
    }

    [Fact]
    public async Task NivelODominioDesconocidoSeRechaza()
    {
        EsBadRequest(await Controller.CreateJefe(Jefe(nivel: "SUPERUSUARIO"), default), "nivel de acceso");
        EsBadRequest(await Controller.CreateJefe(Jefe(dominioP: "XX"), default), "BA, HE, HRN o IVM");
    }
}
