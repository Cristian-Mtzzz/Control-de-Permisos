using System.Globalization;
using ControlPermisos.Api.Models;

namespace ControlPermisos.Api.Services;

// Reglas de un permiso que no necesitan la base: días hábiles, jornada, choques y límites.
// PermisoService las aplica dentro de la transacción que guarda el permiso, con los permisos
// activos del empleado, los parámetros de su departamento y los feriados ya leídos.
internal static class PermisoReglas
{
    // Días hábiles del permiso por día y de las vacaciones, o minutos del permiso por hora, con sus
    // reglas de forma.
    public static (int Dias, int Minutos) Calcular(Solicitud nueva, PermisoParametros parametros, IReadOnlySet<DateTime> feriados)
    {
        if (EsRango(nueva.Tipo))
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
            throw new ArgumentException("La hora de regreso debe ser posterior a la hora de salida.");
        }

        return (0, (int)(entrada - salida).TotalMinutes);
    }

    // Un empleado no puede tener dos permisos o vacaciones activos que se crucen en fecha u
    // horario. El permiso por día y las vacaciones ocupan días completos.
    public static void ValidarChoques(Solicitud nueva, IEnumerable<Existente> existentes)
    {
        foreach (var existente in existentes)
        {
            var choca = (EsRango(nueva.Tipo), EsRango(existente.Tipo)) switch
            {
                (true, true) =>
                    existente.FechaInicio <= nueva.FechaFin && existente.FechaFin >= nueva.FechaInicio,
                (true, false) =>
                    existente.FechaInicio >= nueva.FechaInicio && existente.FechaInicio <= nueva.FechaFin,
                (false, true) =>
                    nueva.FechaInicio >= existente.FechaInicio && nueva.FechaInicio <= existente.FechaFin,
                _ => existente.FechaInicio == nueva.FechaInicio
                    && existente.HoraSalida < nueva.HoraEntrada
                    && existente.HoraEntrada > nueva.HoraSalida,
            };
            if (choca)
            {
                var esta = nueva.Tipo == PermisoValores.TipoVacaciones ? "estas vacaciones" : "este permiso";
                throw new ArgumentException($"El empleado ya tiene {Describir(existente)} que se cruza con {esta}.");
            }
        }
    }

    // El permiso por día y las vacaciones son un rango de días; el permiso por hora, una franja de un día.
    public static bool EsRango(string tipo) => tipo != PermisoValores.TipoHora;

    // Límites del departamento (PERMISO_PARAMETRO o PERMISO_PARAMETRO_DEPTO); los vacíos no se
    // aplican. Las horas cuentan como días: una jornada completa equivale a 1 día. Son límites de
    // permisos: las vacaciones no los tienen ni suman en ellos.
    public static void ValidarLimites(
        Solicitud nueva,
        int dias,
        int minutos,
        IReadOnlyCollection<Existente> todos,
        PermisoParametros parametros,
        IReadOnlySet<DateTime> feriados)
    {
        if (nueva.Tipo == PermisoValores.TipoVacaciones) return;
        var existentes = todos.Where(e => e.Tipo != PermisoValores.TipoVacaciones).ToList();

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

        // Tope mensual: días completos y horas suman juntos (con jornada de 8 h, 2 días = 16 horas).
        // Un permiso que cruza de mes cuenta en cada mes sus días de ese mes.
        if (parametros.MaxDiasPorMes is { } maxDiasMes)
        {
            for (var mes = new DateTime(nueva.FechaInicio.Year, nueva.FechaInicio.Month, 1); mes <= nueva.FechaFin; mes = mes.AddMonths(1))
            {
                var finMes = mes.AddMonths(1).AddDays(-1);
                var usados = existentes.Sum(e => DiasEntre(e.Tipo, e.FechaInicio, e.FechaFin, e.Minutos, mes, finMes, parametros, feriados))
                    + DiasEntre(nueva.Tipo, nueva.FechaInicio, nueva.FechaFin, minutos, mes, finMes, parametros, feriados);
                if (usados > maxDiasMes)
                {
                    throw new ArgumentException(
                        "Permiso no permitido porque se pasa del tiempo estipulado: el máximo es "
                        + $"{Numero(maxDiasMes)} días ({Numero(maxDiasMes * parametros.MinutosJornada / 60m)} horas) al mes y con este permiso "
                        + $"el empleado sumaría {Numero(usados)} días ({Numero(usados * parametros.MinutosJornada / 60m)} horas) en {mes:MM/yyyy}.");
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

    // Días que un permiso aporta al año indicado.
    public static decimal DiasEnAnio(
        string tipo,
        DateTime inicio,
        DateTime fin,
        int minutos,
        int anio,
        PermisoParametros parametros,
        IReadOnlySet<DateTime> feriados) =>
        DiasEntre(tipo, inicio, fin, minutos, new DateTime(anio, 1, 1), new DateTime(anio, 12, 31), parametros, feriados);

    // Días que un permiso aporta entre dos fechas (un mes o un año): los hábiles del rango dentro
    // de ellas, o las horas convertidas a días con la jornada si su fecha cae dentro.
    public static decimal DiasEntre(
        string tipo,
        DateTime inicio,
        DateTime fin,
        int minutos,
        DateTime desdePeriodo,
        DateTime hastaPeriodo,
        PermisoParametros parametros,
        IReadOnlySet<DateTime> feriados)
    {
        if (tipo == PermisoValores.TipoHora)
        {
            return inicio >= desdePeriodo && inicio <= hastaPeriodo ? (decimal)minutos / parametros.MinutosJornada : 0;
        }

        var desde = inicio > desdePeriodo ? inicio : desdePeriodo;
        var hasta = fin < hastaPeriodo ? fin : hastaPeriodo;
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

    private static string Describir(Existente permiso)
    {
        if (permiso.Tipo == PermisoValores.TipoHora)
        {
            return $"un permiso por hora el {permiso.FechaInicio:dd/MM/yyyy} de {permiso.HoraSalida:HH:mm} a {permiso.HoraEntrada:HH:mm}";
        }
        var que = permiso.Tipo == PermisoValores.TipoVacaciones ? "vacaciones" : "un permiso por día";
        return permiso.FechaInicio == permiso.FechaFin
            ? $"{que} el {permiso.FechaInicio:dd/MM/yyyy}"
            : $"{que} del {permiso.FechaInicio:dd/MM/yyyy} al {permiso.FechaFin:dd/MM/yyyy}";
    }

    private static string Numero(decimal valor) => valor.ToString("0.##", CultureInfo.InvariantCulture);

    // Permiso o vacaciones a guardar, ya normalizado. En el de hora FechaInicio y FechaFin son la
    // misma fecha. FechaSolicitud solo viene en las vacaciones; en los permisos la pone el servidor
    // (la del día en que se registra). NoPago es el escrito en el permiso (los de día y hora);
    // Lugar y Telefono, los del permiso por día.
    public sealed record Solicitud(
        string Tipo,
        int IdEmpleado,
        string Motivo,
        DateTime FechaInicio,
        DateTime FechaFin,
        TimeOnly? HoraSalida,
        TimeOnly? HoraEntrada,
        DateTime? FechaSolicitud = null,
        string? NoPago = null,
        string? Lugar = null,
        string? Telefono = null);

    // Permiso activo del mismo empleado, usado para revisar choques y límites.
    public sealed record Existente(
        string Tipo,
        DateTime FechaInicio,
        DateTime FechaFin,
        TimeOnly? HoraSalida,
        TimeOnly? HoraEntrada,
        int Minutos);
}
