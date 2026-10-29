using System.Globalization;
using ControlPermisos.Api.Models;

namespace ControlPermisos.Api.Services;

// Reglas de un permiso que no necesitan la base: días hábiles, jornada, choques y límites.
// PermisoService las aplica dentro de la transacción que guarda el permiso, con los permisos
// activos del empleado, los parámetros de su departamento y los feriados ya leídos.
internal static class PermisoReglas
{
    // Días hábiles del permiso por día o minutos del permiso por hora, con sus reglas de forma.
    public static (int Dias, int Minutos) Calcular(Solicitud nueva, PermisoParametros parametros, IReadOnlySet<DateTime> feriados)
    {
        if (nueva.Tipo == PermisoValores.TipoDia)
        {
            if (nueva.FechaFin < nueva.FechaInicio)
            {
                throw new ArgumentException("La fecha final no puede ser anterior a la fecha inicial.");
            }
            if ((nueva.FechaFin - nueva.FechaInicio).TotalDays > 366)
            {
                throw new ArgumentException("El rango de fechas no puede ser mayor a un año.");
            }

            var dias = ContarDiasHabiles(nueva.FechaInicio, nueva.FechaFin, feriados);
            return dias > 0
                ? (dias, 0)
                : throw new ArgumentException("El rango elegido no tiene días hábiles.");
        }

        if (!EsDiaHabil(nueva.FechaInicio, feriados))
        {
            throw new ArgumentException("La fecha del permiso no es un día hábil.");
        }

        var salida = nueva.HoraSalida!.Value;
        var entrada = nueva.HoraEntrada!.Value;
        if (salida < parametros.InicioJornada || entrada > parametros.FinJornada)
        {
            throw new ArgumentException(
                $"Las horas deben estar dentro de la jornada laboral, de {parametros.InicioJornada:HH:mm} a {parametros.FinJornada:HH:mm}.");
        }
        if (entrada <= salida)
        {
            throw new ArgumentException("La hora de entrada debe ser posterior a la hora de salida.");
        }

        return (0, (int)(entrada - salida).TotalMinutes);
    }

    // Un empleado no puede tener dos permisos activos que se crucen en fecha u horario.
    public static void ValidarChoques(Solicitud nueva, IEnumerable<Existente> existentes)
    {
        foreach (var existente in existentes)
        {
            var choca = (nueva.Tipo, existente.Tipo) switch
            {
                (PermisoValores.TipoDia, PermisoValores.TipoDia) =>
                    existente.FechaInicio <= nueva.FechaFin && existente.FechaFin >= nueva.FechaInicio,
                (PermisoValores.TipoDia, _) =>
                    existente.FechaInicio >= nueva.FechaInicio && existente.FechaInicio <= nueva.FechaFin,
                (_, PermisoValores.TipoDia) =>
                    nueva.FechaInicio >= existente.FechaInicio && nueva.FechaInicio <= existente.FechaFin,
                _ => existente.FechaInicio == nueva.FechaInicio
                    && existente.HoraSalida < nueva.HoraEntrada
                    && existente.HoraEntrada > nueva.HoraSalida,
            };
            if (choca)
            {
                throw new ArgumentException($"El empleado ya tiene {Describir(existente)} que se cruza con este permiso.");
            }
        }
    }

    // Límites del departamento (PERMISO_PARAMETRO o PERMISO_PARAMETRO_DEPTO); los vacíos no se
    // aplican. Las horas cuentan como días: una jornada completa equivale a 1 día.
    public static void ValidarLimites(
        Solicitud nueva,
        int dias,
        int minutos,
        IReadOnlyCollection<Existente> existentes,
        PermisoParametros parametros,
        IReadOnlySet<DateTime> feriados)
    {
        if (nueva.Tipo == PermisoValores.TipoDia && parametros.MaxDiasPorPermiso is { } maxDias && dias > maxDias)
        {
            throw new ArgumentException(
                $"El permiso suma {dias} días hábiles y el máximo por permiso es {Numero(maxDias)}.");
        }

        if (nueva.Tipo == PermisoValores.TipoHora)
        {
            if (parametros.MaxHorasPorPermiso is { } maxHoras && minutos > maxHoras * 60)
            {
                throw new ArgumentException(
                    $"El permiso dura {Numero(minutos / 60m)} horas y el máximo por permiso es {Numero(maxHoras)}.");
            }

            if (parametros.MaxHorasPorMes is { } maxMes)
            {
                var delMes = existentes
                    .Where(e => e.Tipo == PermisoValores.TipoHora
                        && e.FechaInicio.Year == nueva.FechaInicio.Year && e.FechaInicio.Month == nueva.FechaInicio.Month)
                    .Sum(e => e.Minutos) + minutos;
                if (delMes > maxMes * 60)
                {
                    throw new ArgumentException(
                        $"Con este permiso el empleado sumaría {Numero(delMes / 60m)} horas en {nueva.FechaInicio:MM/yyyy} "
                        + $"y el máximo mensual es {Numero(maxMes)} horas.");
                }
            }
        }

        if (parametros.MaxDiasPorAnio is not { } maxAnio) return;
        for (var anio = nueva.FechaInicio.Year; anio <= nueva.FechaFin.Year; anio++)
        {
            var usados = existentes.Sum(e => DiasEnAnio(e.Tipo, e.FechaInicio, e.FechaFin, e.Minutos, anio, parametros, feriados))
                + DiasEnAnio(nueva.Tipo, nueva.FechaInicio, nueva.FechaFin, minutos, anio, parametros, feriados);
            if (usados > maxAnio)
            {
                throw new ArgumentException(
                    $"Con este permiso el empleado sumaría {Numero(usados)} días en {anio} y el máximo anual es {Numero(maxAnio)}.");
            }
        }
    }

    // Días que un permiso aporta al año indicado: los hábiles del rango dentro de ese año, o
    // las horas convertidas a días con la jornada.
    public static decimal DiasEnAnio(
        string tipo,
        DateTime inicio,
        DateTime fin,
        int minutos,
        int anio,
        PermisoParametros parametros,
        IReadOnlySet<DateTime> feriados)
    {
        if (tipo == PermisoValores.TipoHora)
        {
            return inicio.Year == anio ? (decimal)minutos / parametros.MinutosJornada : 0;
        }

        var desde = inicio > new DateTime(anio, 1, 1) ? inicio : new DateTime(anio, 1, 1);
        var hasta = fin < new DateTime(anio, 12, 31) ? fin : new DateTime(anio, 12, 31);
        return desde <= hasta ? ContarDiasHabiles(desde, hasta, feriados) : 0;
    }

    public static int ContarDiasHabiles(DateTime desde, DateTime hasta, IReadOnlySet<DateTime> feriados)
    {
        var total = 0;
        for (var dia = desde.Date; dia <= hasta.Date; dia = dia.AddDays(1))
        {
            if (EsDiaHabil(dia, feriados)) total++;
        }
        return total;
    }

    public static bool EsDiaHabil(DateTime dia, IReadOnlySet<DateTime> feriados) =>
        dia.DayOfWeek is not (DayOfWeek.Saturday or DayOfWeek.Sunday) && !feriados.Contains(dia.Date);

    // Igual que el estado de la pantalla: el permiso por hora finaliza en su hora de entrada; el
    // de día, al cierre de la jornada de su último día. Finalizado ya no se edita ni se anula.
    public static bool Finalizado(string tipo, DateTime fechaFin, TimeOnly? horaEntrada, TimeOnly finJornada, DateTime ahora)
    {
        var horaFin = tipo == PermisoValores.TipoHora && horaEntrada is { } entrada ? entrada : finJornada;
        return ahora >= fechaFin.Date.Add(horaFin.ToTimeSpan());
    }

    private static string Describir(Existente permiso) => permiso.Tipo == PermisoValores.TipoHora
        ? $"un permiso por hora el {permiso.FechaInicio:dd/MM/yyyy} de {permiso.HoraSalida:HH:mm} a {permiso.HoraEntrada:HH:mm}"
        : permiso.FechaInicio == permiso.FechaFin
            ? $"un permiso por día el {permiso.FechaInicio:dd/MM/yyyy}"
            : $"un permiso por día del {permiso.FechaInicio:dd/MM/yyyy} al {permiso.FechaFin:dd/MM/yyyy}";

    private static string Numero(decimal valor) => valor.ToString("0.##", CultureInfo.InvariantCulture);

    // Permiso a guardar, ya normalizado. En el de hora FechaInicio y FechaFin son la misma fecha.
    public sealed record Solicitud(
        string Tipo,
        int IdEmpleado,
        string Motivo,
        DateTime FechaInicio,
        DateTime FechaFin,
        TimeOnly? HoraSalida,
        TimeOnly? HoraEntrada,
        DateTime? FechaSolicitud);

    // Permiso activo del mismo empleado, usado para revisar choques y límites.
    public sealed record Existente(
        string Tipo,
        DateTime FechaInicio,
        DateTime FechaFin,
        TimeOnly? HoraSalida,
        TimeOnly? HoraEntrada,
        int Minutos);
}
