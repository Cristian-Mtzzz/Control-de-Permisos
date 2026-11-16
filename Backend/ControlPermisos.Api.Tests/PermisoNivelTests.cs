using ControlPermisos.Api.Models;
using ControlPermisos.Api.Services;

namespace ControlPermisos.Api.Tests;

// Quién asigna cada nivel. Estos casos se deciden antes de consultar la base (conexión null).
public sealed class PermisoNivelTests
{
    private static readonly PermisoAlcance Admin = new(1, PermisoValores.NivelAdmin, null, null);
    private static readonly PermisoAlcance AdminDepto = new(3, PermisoValores.NivelAdminDepartamento, 20, null);

    private static SavePermisoJefeDto Usuario(string nivel, int? idDepartamento = null) =>
        new("usuario", "Nombre", nivel, idDepartamento, null, 1, "BA", null);

    private static Task<PermisoAreaService.Perfil> Validar(PermisoAlcance alcance, string nivel) =>
        PermisoAreaService.ValidarNivel(null!, null!, alcance, Usuario(nivel), default);

    [Fact]
    public async Task ElGeneralNombraOtrosAdministradoresGenerales()
    {
        Assert.Equal(new PermisoAreaService.Perfil(1, null, null), await Validar(Admin, PermisoValores.NivelAdmin));
    }

    [Fact]
    public async Task LaConsultaYaNoSeAsigna()
    {
        var error = await Assert.ThrowsAsync<ArgumentException>(() => Validar(Admin, PermisoValores.NivelConsulta));
        Assert.Contains("ya no se asigna", error.Message);
    }

    [Theory]
    [InlineData(PermisoValores.NivelAdmin)]
    [InlineData(PermisoValores.NivelAdminDepartamento)]
    [InlineData(PermisoValores.NivelConsulta)]
    public async Task ElAdministradorDeDepartamentoSoloNombraJefes(string nivel)
    {
        await Assert.ThrowsAsync<UnauthorizedAccessException>(() => Validar(AdminDepto, nivel));
    }

    [Fact]
    public async Task LaSecretariaNecesitaSuDepartamento()
    {
        var error = await Assert.ThrowsAsync<ArgumentException>(() => Validar(Admin, PermisoValores.NivelSecretaria));
        Assert.Contains("departamento de la secretaría", error.Message);
    }

    // Nombrar la secretaría de otro departamento se decide antes de consultar la base.
    [Fact]
    public async Task ElAdministradorDeDepartamentoNoNombraLaSecretariaDeOtro()
    {
        await Assert.ThrowsAsync<UnauthorizedAccessException>(() => PermisoAreaService.ValidarNivel(
            null!, null!, AdminDepto with { IdDepartamento = 99 }, Usuario(PermisoValores.NivelSecretaria, 20), default));
    }

    [Fact]
    public async Task LaCuentaDeEmpleadoNecesitaSuFicha()
    {
        var error = await Assert.ThrowsAsync<ArgumentException>(() => Validar(Admin, PermisoValores.NivelUsuario));
        Assert.Contains("empleado de la cuenta", error.Message);
    }

    // El empleado registra lo suyo, pero no lo modifica después ni toca el personal.
    [Fact]
    public void ElEmpleadoRegistraLoSuyoYNoLoModifica()
    {
        var empleado = new PermisoAlcance(9, PermisoValores.NivelUsuario, 20, 5, 77);
        Assert.True(empleado.EsEmpleado);
        Assert.False(empleado.SoloLectura);
        Assert.False(empleado.ModificaRegistros);
        Assert.False(empleado.Administra);
        Assert.False(empleado.VeTodo);
        Assert.True(empleado.IncluyeEmpleado(77));
        Assert.False(empleado.IncluyeEmpleado(78));
    }

    // Los demás niveles registran a cualquiera de su alcance.
    [Fact]
    public void LosDemasNivelesNoSeLimitanAUnEmpleado()
    {
        Assert.True(AdminDepto.IncluyeEmpleado(123));
        Assert.True(AdminDepto.ModificaRegistros);
        Assert.True(Admin.IncluyeEmpleado(123));
    }

    // El alcance de la secretaría: todo su departamento, sin registrar ni administrar.
    [Fact]
    public void LaSecretariaVeSuDepartamentoYNoEscribe()
    {
        var secretaria = new PermisoAlcance(7, PermisoValores.NivelSecretaria, 20, null);
        Assert.True(secretaria.SoloLectura);
        Assert.False(secretaria.Administra);
        Assert.False(secretaria.VeTodo);
        Assert.False(secretaria.EsAdmin);
        Assert.Equal("a.DEPARTAMENTO_IHSS_ID = :alcanceDepto", secretaria.FiltroArea("a."));
        Assert.Equal([("alcanceDepto", (object?)20)], secretaria.ParametrosArea());
        Assert.True(secretaria.IncluyeArea(1, 20));
        Assert.False(secretaria.IncluyeArea(1, 30));
    }
}
