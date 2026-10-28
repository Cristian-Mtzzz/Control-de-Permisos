using System.Data.Common;
using System.Globalization;

namespace ControlPermisos.Api.Services;

// Parámetros del Control de permisos (jornada y límites) de un departamento: el valor general
// de PERMISO_PARAMETRO, reemplazado por el de PERMISO_PARAMETRO_DEPTO cuando el departamento
// tiene el suyo. Los límites vacíos (null) significan "sin límite".
internal sealed record PermisoParametros(
    TimeOnly InicioJornada,
    TimeOnly FinJornada,
    decimal? MaxDiasPorPermiso,
    decimal? MaxHorasPorPermiso,
    decimal? MaxDiasPorAnio,
    decimal? MaxHorasPorMes)
{
    // Filas generales (sin departamento) y las propias de cada departamento; se combinan en Para().
    public const string Sql = """
        SELECT CAST(NULL AS NUMBER) AS DEPARTAMENTO_IHSS_ID, CLAVE, VALOR FROM PERMISO_PARAMETRO
        UNION ALL
        SELECT DEPARTAMENTO_IHSS_ID, CLAVE, VALOR FROM PERMISO_PARAMETRO_DEPTO
        """;

    private static readonly string[] FormatosHora = ["HH:mm", "H:mm"];

    // Jornada de 08:00 a 16:00 sin límites: la que se muestra mientras se corrige un parámetro mal escrito.
    public static PermisoParametros PorDefecto { get; } = new(new TimeOnly(8, 0), new TimeOnly(16, 0), null, null, null, null);

    public int MinutosJornada => (int)(FinJornada - InicioJornada).TotalMinutes;

    public static Fila Leer(DbDataReader reader) => new(
        reader.IsDBNull(0) ? null : Convert.ToInt32(reader.GetValue(0), CultureInfo.InvariantCulture),
        Convert.ToString(reader.GetValue(1), CultureInfo.InvariantCulture)?.Trim() ?? string.Empty,
        reader.IsDBNull(2) ? null : Convert.ToString(reader.GetValue(2), CultureInfo.InvariantCulture));

    public static PermisoParametros Para(int idDepartamento, IEnumerable<Fila> filas)
    {
        var lista = filas as IReadOnlyCollection<Fila> ?? filas.ToList();
        var valores = new Dictionary<string, string?>(StringComparer.OrdinalIgnoreCase);
        foreach (var fila in lista.Where(fila => fila.IdDepartamento is null)) valores[fila.Clave] = Limpio(fila.Valor);
        foreach (var fila in lista.Where(fila => fila.IdDepartamento == idDepartamento)) valores[fila.Clave] = Limpio(fila.Valor);
        string? Valor(string clave) => valores.TryGetValue(clave, out var valor) ? valor : null;

        TimeOnly Hora(string clave, TimeOnly porDefecto) => Valor(clave) is not { } texto
            ? porDefecto
            : TryParseHora(texto) ?? throw new ArgumentException(
                $"El parámetro {clave} del departamento {idDepartamento} debe tener el formato HH:mm.");

        decimal? Limite(string clave) => Valor(clave) is not { } texto
            ? null
            : decimal.TryParse(texto, NumberStyles.Number, CultureInfo.InvariantCulture, out var numero) && numero >= 0
                ? numero
                : throw new ArgumentException($"El parámetro {clave} del departamento {idDepartamento} debe ser un número.");

        var inicio = Hora("HORA_INICIO_JORNADA", PorDefecto.InicioJornada);
        var fin = Hora("HORA_FIN_JORNADA", PorDefecto.FinJornada);
        if (fin <= inicio)
        {
            throw new ArgumentException(
                $"En los parámetros del departamento {idDepartamento}, HORA_FIN_JORNADA debe ser posterior a HORA_INICIO_JORNADA.");
        }

        return new PermisoParametros(inicio, fin,
            Limite("MAX_DIAS_POR_PERMISO"), Limite("MAX_HORAS_POR_PERMISO"),
            Limite("MAX_DIAS_POR_ANIO"), Limite("MAX_HORAS_POR_MES"));
    }

    public static TimeOnly? TryParseHora(string? valor) =>
        TimeOnly.TryParseExact(valor?.Trim(), FormatosHora, CultureInfo.InvariantCulture, DateTimeStyles.None, out var hora)
            ? hora
            : null;

    private static string? Limpio(string? valor) => string.IsNullOrWhiteSpace(valor) ? null : valor.Trim();

    public readonly record struct Fila(int? IdDepartamento, string Clave, string? Valor);
}
