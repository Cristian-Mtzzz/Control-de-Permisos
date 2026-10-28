using ControlPermisos.Api.Services;
using Fila = ControlPermisos.Api.Services.PermisoParametros.Fila;

namespace ControlPermisos.Api.Tests;

// Combinación de PERMISO_PARAMETRO (general) con PERMISO_PARAMETRO_DEPTO (por departamento).
public sealed class PermisoParametrosTests
{
    private static readonly Fila[] Filas =
    [
        new(null, "HORA_INICIO_JORNADA", "08:00"),
        new(null, "HORA_FIN_JORNADA", "16:00"),
        new(null, "MAX_DIAS_POR_ANIO", "15"),
        new(null, "MAX_HORAS_POR_PERMISO", "1.5"),
        new(146, "HORA_INICIO_JORNADA", "07:00"),
        new(146, "HORA_FIN_JORNADA", "15:00"),
        new(146, "MAX_DIAS_POR_ANIO", null),
    ];

    [Fact]
    public void UsaLosValoresGeneralesSiElDepartamentoNoTieneLosSuyos()
    {
        var parametros = PermisoParametros.Para(20, Filas);
        Assert.Equal(new TimeOnly(8, 0), parametros.InicioJornada);
        Assert.Equal(new TimeOnly(16, 0), parametros.FinJornada);
        Assert.Equal(15m, parametros.MaxDiasPorAnio);
        Assert.Equal(1.5m, parametros.MaxHorasPorPermiso);
        Assert.Null(parametros.MaxDiasPorPermiso);
    }

    [Fact]
    public void ElValorDelDepartamentoReemplazaAlGeneralYVacioQuitaElLimite()
    {
        var parametros = PermisoParametros.Para(146, Filas);
        Assert.Equal(new TimeOnly(7, 0), parametros.InicioJornada);
        Assert.Equal(new TimeOnly(15, 0), parametros.FinJornada);
        Assert.Equal(480, parametros.MinutosJornada);
        Assert.Null(parametros.MaxDiasPorAnio);
        Assert.Equal(1.5m, parametros.MaxHorasPorPermiso);
    }

    [Fact]
    public void SinFilasUsaLaJornadaPorDefectoSinLimites()
    {
        Assert.Equal(PermisoParametros.PorDefecto, PermisoParametros.Para(20, []));
    }

    [Fact]
    public void AceptaHorasDeUnDigito()
    {
        Assert.Equal(new TimeOnly(7, 30), PermisoParametros.Para(20, [new Fila(null, "HORA_INICIO_JORNADA", "7:30")]).InicioJornada);
    }

    [Fact]
    public void HoraMalEscritaFalla()
    {
        var error = Assert.Throws<ArgumentException>(() => PermisoParametros.Para(20, [new Fila(20, "HORA_FIN_JORNADA", "4pm")]));
        Assert.Contains("HH:mm", error.Message);
    }

    [Fact]
    public void FinDeJornadaNoPosteriorAlInicioFalla()
    {
        Fila[] filas = [new(null, "HORA_INICIO_JORNADA", "16:00"), new(null, "HORA_FIN_JORNADA", "08:00")];
        Assert.Throws<ArgumentException>(() => PermisoParametros.Para(20, filas));
    }

    [Theory]
    [InlineData("-1")]
    [InlineData("cinco")]
    public void LimiteQueNoEsUnNumeroValidoFalla(string valor)
    {
        var error = Assert.Throws<ArgumentException>(() => PermisoParametros.Para(20, [new Fila(null, "MAX_HORAS_POR_MES", valor)]));
        Assert.Contains("debe ser un número", error.Message);
    }
}
