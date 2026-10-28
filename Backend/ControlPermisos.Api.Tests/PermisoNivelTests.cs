using ControlPermisos.Api.Models;
using ControlPermisos.Api.Services;

namespace ControlPermisos.Api.Tests;

// Quién asigna cada nivel. Estos casos se deciden antes de consultar la base (conexión null).
public sealed class PermisoNivelTests
{
    private static readonly PermisoAlcance Admin = new(1, PermisoValores.NivelAdmin, null, null);
    private static readonly PermisoAlcance AdminDepto = new(3, PermisoValores.NivelAdminDepartamento, 20, null);

    private static SavePermisoJefeDto Usuario(string nivel) => new("usuario", "Nombre", nivel, null, null, 1, "BA", null);

    private static Task<PermisoAreaService.Perfil> Validar(PermisoAlcance alcance, string nivel, string? nivelActual) =>
        PermisoAreaService.ValidarNivel(null!, null!, alcance, Usuario(nivel), nivelActual, default);

    [Theory]
    [InlineData(null)]
    [InlineData(PermisoValores.NivelJefe)]
    [InlineData(PermisoValores.NivelConsulta)]
    public async Task NadieRecibeElNivelDeAdministradorGeneral(string? nivelActual)
    {
        var error = await Assert.ThrowsAsync<ArgumentException>(() => Validar(Admin, PermisoValores.NivelAdmin, nivelActual));
        Assert.Contains("no se puede asignar", error.Message);
    }

    [Fact]
    public async Task ElAdministradorGeneralConservaSuNivelAlEditarse()
    {
        Assert.Equal(new PermisoAreaService.Perfil(1, 0, null, null), await Validar(Admin, PermisoValores.NivelAdmin, PermisoValores.NivelAdmin));
    }

    [Fact]
    public async Task ElGeneralAsignaConsulta()
    {
        Assert.Equal(new PermisoAreaService.Perfil(0, 1, null, null), await Validar(Admin, PermisoValores.NivelConsulta, null));
    }

    [Theory]
    [InlineData(PermisoValores.NivelAdmin)]
    [InlineData(PermisoValores.NivelAdminDepartamento)]
    [InlineData(PermisoValores.NivelConsulta)]
    public async Task ElAdministradorDeDepartamentoSoloNombraJefes(string nivel)
    {
        await Assert.ThrowsAsync<UnauthorizedAccessException>(() => Validar(AdminDepto, nivel, null));
    }
}
