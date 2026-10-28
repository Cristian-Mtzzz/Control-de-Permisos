using ControlPermisos.Api.Models;
using ControlPermisos.Api.Services;

namespace ControlPermisos.Api.Tests;

// Qué ve y qué modifica cada nivel.
public sealed class PermisoAlcanceTests
{
    private static readonly PermisoAlcance Admin = new(1, PermisoValores.NivelAdmin, null, null);
    private static readonly PermisoAlcance Consulta = new(2, PermisoValores.NivelConsulta, null, null);
    private static readonly PermisoAlcance AdminDepto = new(3, PermisoValores.NivelAdminDepartamento, 20, null);
    private static readonly PermisoAlcance Jefe = new(4, PermisoValores.NivelJefe, 20, 5);

    [Fact]
    public void ElGeneralYLaConsultaVenTodoPeroSoloElGeneralAdministra()
    {
        Assert.True(Admin.VeTodo && Admin.Administra && Admin.EsAdmin && !Admin.SoloLectura);
        Assert.True(Consulta.VeTodo && Consulta.SoloLectura);
        Assert.False(Consulta.Administra);
        Assert.Null(Admin.FiltroArea("a."));
        Assert.Empty(Consulta.ParametrosArea());
        Assert.True(Admin.IncluyeArea(99, 99));
    }

    [Fact]
    public void ElAdministradorDeDepartamentoSeLimitaASuDepartamento()
    {
        Assert.True(AdminDepto.Administra);
        Assert.False(AdminDepto.VeTodo || AdminDepto.EsAdmin);
        Assert.True(AdminDepto.IncluyeArea(7, 20));
        Assert.False(AdminDepto.IncluyeArea(7, 21));
        Assert.Equal("a.DEPARTAMENTO_IHSS_ID = :alcanceDepto", AdminDepto.FiltroArea("a."));
        Assert.Equal(new (string, object?)[] { ("alcanceDepto", 20) }, AdminDepto.ParametrosArea());
    }

    [Fact]
    public void ElJefeSeLimitaASuArea()
    {
        Assert.False(Jefe.Administra || Jefe.VeTodo || Jefe.SoloLectura);
        Assert.True(Jefe.IncluyeArea(5, 20));
        Assert.False(Jefe.IncluyeArea(6, 20));
        Assert.Equal("a.ID_AREA = :alcanceArea", Jefe.FiltroArea("a."));
        Assert.Equal(new (string, object?)[] { ("alcanceArea", 5) }, Jefe.ParametrosArea());
    }
}
