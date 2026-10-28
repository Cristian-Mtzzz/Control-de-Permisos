using ControlPermisos.Api.Services;
using static ControlPermisos.Api.Services.PermisoReglas;

namespace ControlPermisos.Api.Tests;

// Días hábiles, jornada, choques y límites. Semana de referencia: lunes 26/10/2026 a domingo 01/11/2026.
public sealed class PermisoReglasTests
{
    private static readonly DateTime Lunes = new(2026, 10, 26);
    private static readonly IReadOnlySet<DateTime> SinFeriados = new HashSet<DateTime>();

    private static PermisoParametros Parametros(
        decimal? maxDiasPorPermiso = null,
        decimal? maxHorasPorPermiso = null,
        decimal? maxDiasPorAnio = null,
        decimal? maxHorasPorMes = null) =>
        new(new TimeOnly(8, 0), new TimeOnly(16, 0), maxDiasPorPermiso, maxHorasPorPermiso, maxDiasPorAnio, maxHorasPorMes);

    private static Solicitud Dia(DateTime inicio, DateTime fin) => new("DIA", 1, "Motivo", inicio, fin, null, null, inicio);

    private static Solicitud Hora(DateTime fecha, string salida, string entrada) =>
        new("HORA", 1, "Motivo", fecha, fecha, TimeOnly.Parse(salida), TimeOnly.Parse(entrada), null);

    private static Existente ExistenteDia(DateTime inicio, DateTime fin) => new("DIA", inicio, fin, null, null, 0);

    private static Existente ExistenteHora(DateTime fecha, string salida, string entrada)
    {
        var (s, e) = (TimeOnly.Parse(salida), TimeOnly.Parse(entrada));
        return new("HORA", fecha, fecha, s, e, (int)(e - s).TotalMinutes);
    }

    private static string Falla(Action accion) => Assert.Throws<ArgumentException>(accion).Message;

    // ---- Cálculo -------------------------------------------------------------------------

    [Fact]
    public void PermisoPorDiaCuentaSoloLunesAViernes()
    {
        Assert.Equal((5, 0), Calcular(Dia(Lunes, Lunes.AddDays(6)), Parametros(), SinFeriados));
    }

    [Fact]
    public void PermisoPorDiaNoCuentaLosFeriados()
    {
        var feriados = new HashSet<DateTime> { Lunes.AddDays(2) };
        Assert.Equal((4, 0), Calcular(Dia(Lunes, Lunes.AddDays(4)), Parametros(), feriados));
    }

    [Fact]
    public void PermisoPorDiaSinDiasHabilesFalla()
    {
        Assert.Contains("no tiene días hábiles", Falla(() => Calcular(Dia(Lunes.AddDays(5), Lunes.AddDays(6)), Parametros(), SinFeriados)));
    }

    [Fact]
    public void PermisoPorDiaConFechaFinalAnteriorFalla()
    {
        Assert.Contains("anterior a la fecha inicial", Falla(() => Calcular(Dia(Lunes, Lunes.AddDays(-1)), Parametros(), SinFeriados)));
    }

    [Fact]
    public void PermisoPorDiaDeMasDeUnAnioFalla()
    {
        Assert.Contains("mayor a un año",
            Falla(() => Calcular(Dia(new DateTime(2026, 1, 1), new DateTime(2027, 1, 3)), Parametros(), SinFeriados)));
    }

    [Fact]
    public void PermisoPorHoraCalculaLosMinutos()
    {
        Assert.Equal((0, 150), Calcular(Hora(Lunes, "09:00", "11:30"), Parametros(), SinFeriados));
    }

    [Theory]
    [InlineData("07:30", "09:00")]
    [InlineData("15:00", "16:30")]
    public void PermisoPorHoraFueraDeLaJornadaFalla(string salida, string entrada)
    {
        Assert.Contains("dentro de la jornada", Falla(() => Calcular(Hora(Lunes, salida, entrada), Parametros(), SinFeriados)));
    }

    [Theory]
    [InlineData("10:00", "10:00")]
    [InlineData("11:00", "10:00")]
    public void PermisoPorHoraConEntradaNoPosteriorFalla(string salida, string entrada)
    {
        Assert.Contains("posterior a la hora de salida", Falla(() => Calcular(Hora(Lunes, salida, entrada), Parametros(), SinFeriados)));
    }

    [Fact]
    public void PermisoPorHoraEnFinDeSemanaOFeriadoFalla()
    {
        var feriados = new HashSet<DateTime> { Lunes };
        Assert.Contains("no es un día hábil", Falla(() => Calcular(Hora(Lunes.AddDays(5), "09:00", "10:00"), Parametros(), SinFeriados)));
        Assert.Contains("no es un día hábil", Falla(() => Calcular(Hora(Lunes, "09:00", "10:00"), Parametros(), feriados)));
    }

    // ---- Choques -------------------------------------------------------------------------

    [Fact]
    public void DosPermisosPorDiaQueSeCruzanChocan()
    {
        var existentes = new[] { ExistenteDia(Lunes.AddDays(2), Lunes.AddDays(4)) };
        Assert.Contains("se cruza", Falla(() => ValidarChoques(Dia(Lunes, Lunes.AddDays(2)), existentes)));
    }

    [Fact]
    public void PermisosPorDiaSeguidosNoChocan()
    {
        ValidarChoques(Dia(Lunes, Lunes.AddDays(1)), [ExistenteDia(Lunes.AddDays(2), Lunes.AddDays(4))]);
    }

    [Fact]
    public void PermisoPorDiaChocaConUnoPorHoraDentroDelRango()
    {
        Assert.Contains("por hora", Falla(() => ValidarChoques(Dia(Lunes, Lunes.AddDays(2)), [ExistenteHora(Lunes.AddDays(1), "09:00", "10:00")])));
    }

    [Fact]
    public void PermisoPorHoraChocaConUnoPorDiaQueLoCubre()
    {
        Assert.Contains("por día", Falla(() => ValidarChoques(Hora(Lunes.AddDays(1), "09:00", "10:00"), [ExistenteDia(Lunes, Lunes.AddDays(2))])));
    }

    [Fact]
    public void PermisosPorHoraQueSeSolapanChocan()
    {
        Assert.Contains("se cruza", Falla(() => ValidarChoques(Hora(Lunes, "09:30", "11:00"), [ExistenteHora(Lunes, "09:00", "10:00")])));
    }

    [Fact]
    public void PermisosPorHoraSeguidosOEnOtroDiaNoChocan()
    {
        ValidarChoques(Hora(Lunes, "10:00", "11:00"), [ExistenteHora(Lunes, "09:00", "10:00"), ExistenteHora(Lunes.AddDays(1), "10:00", "11:00")]);
    }

    // ---- Límites -------------------------------------------------------------------------

    [Fact]
    public void SinLimitesConfiguradosNoFalla()
    {
        ValidarLimites(Dia(Lunes, Lunes.AddDays(4)), 5, 0, [ExistenteDia(new DateTime(2026, 3, 2), new DateTime(2026, 3, 31))], Parametros(), SinFeriados);
    }

    [Fact]
    public void LimiteDeDiasPorPermiso()
    {
        Assert.Contains("máximo por permiso es 3", Falla(() => ValidarLimites(Dia(Lunes, Lunes.AddDays(4)), 5, 0, [], Parametros(maxDiasPorPermiso: 3), SinFeriados)));
        ValidarLimites(Dia(Lunes, Lunes.AddDays(2)), 3, 0, [], Parametros(maxDiasPorPermiso: 3), SinFeriados);
    }

    [Fact]
    public void LimiteDeHorasPorPermiso()
    {
        Assert.Contains("máximo por permiso es 2", Falla(() => ValidarLimites(Hora(Lunes, "09:00", "11:30"), 0, 150, [], Parametros(maxHorasPorPermiso: 2), SinFeriados)));
        ValidarLimites(Hora(Lunes, "09:00", "11:00"), 0, 120, [], Parametros(maxHorasPorPermiso: 2), SinFeriados);
    }

    [Fact]
    public void LimiteDeHorasPorMesSoloSumaElMismoMes()
    {
        var parametros = Parametros(maxHorasPorMes: 4);
        var mismoMes = new[] { ExistenteHora(Lunes.AddDays(-7), "08:00", "11:00") };
        var otroMes = new[] { ExistenteHora(new DateTime(2026, 9, 7), "08:00", "11:00") };

        Assert.Contains("máximo mensual es 4", Falla(() => ValidarLimites(Hora(Lunes, "09:00", "11:00"), 0, 120, mismoMes, parametros, SinFeriados)));
        ValidarLimites(Hora(Lunes, "09:00", "11:00"), 0, 120, otroMes, parametros, SinFeriados);
    }

    [Fact]
    public void LimiteAnualConvierteLasHorasEnDiasConLaJornada()
    {
        var parametros = Parametros(maxDiasPorAnio: 5);
        var cuatroDias = new[] { ExistenteDia(new DateTime(2026, 3, 2), new DateTime(2026, 3, 5)) };

        // 4 días + 4 horas (media jornada de 8 h) = 4.5 días.
        ValidarLimites(Hora(Lunes, "08:00", "12:00"), 0, 240, cuatroDias, parametros, SinFeriados);
        Assert.Contains("sumaría 6 días en 2026", Falla(() => ValidarLimites(Dia(Lunes, Lunes.AddDays(1)), 2, 0, cuatroDias, parametros, SinFeriados)));
    }

    [Fact]
    public void LimiteAnualRevisaCadaAnioDeUnPermisoQueCruzaDeAnio()
    {
        // Del lunes 28/12/2026 al viernes 08/01/2027: 4 días hábiles en 2026 y 6 en 2027.
        var nueva = Dia(new DateTime(2026, 12, 28), new DateTime(2027, 1, 8));
        Assert.Contains("en 2027", Falla(() => ValidarLimites(nueva, 10, 0, [], Parametros(maxDiasPorAnio: 5), SinFeriados)));
        ValidarLimites(nueva, 10, 0, [], Parametros(maxDiasPorAnio: 6), SinFeriados);
    }
}
