using System.Data.Common;
using System.Globalization;
using Microsoft.EntityFrameworkCore;
using ControlPermisos.Api.Data;
using ControlPermisos.Api.Models;
using static ControlPermisos.Api.Services.PermisoReglas;

namespace ControlPermisos.Api.Services;

// Persistencia y reglas del Control de permisos. Lo que puede cambiar (jornada y límites) se lee
// de PERMISO_PARAMETRO, con los valores propios de cada departamento en PERMISO_PARAMETRO_DEPTO,
// y los feriados de PERMISO_FERIADO, para ajustarlos en la base sin volver a publicar la aplicación.
public sealed class PermisoService(PermisosDbContext dbContext) : OracleRepository(dbContext), IPermisoService
{
    // Cada usuario recibe los permisos de su alcance: el jefe los de su área, el administrador de
    // departamento los de las áreas de su departamento, y el general y la consulta todos. El jefe y
    // el de departamento reciben además todos los permisos de su personal actual aunque se hayan
    // registrado en otra área: son los mismos que se cuentan para choques y límites. Solo
    // modifican los registrados en su alcance. El filtro limita la lista para no enviar siempre
    // todo el historial: Desde deja los que terminan ese día o después, Hasta los que empiezan
    // ese día o antes, IdEmpleado los de uno.
    public async Task<IReadOnlyList<PermisoDto>> GetPermisos(
        PermisoAlcance alcance,
        PermisoFiltro filtro,
        CancellationToken cancellationToken)
    {
        var condiciones = new List<string>();
        var valores = new List<(string Name, object? Value)>();
        switch (alcance.Nivel)
        {
            case PermisoValores.NivelJefe:
                condiciones.Add("""
                    (a.ID_AREA = :alcanceArea
                     OR (e.DEPARTAMENTO_IHSS_ID = :alcanceDepto
                         AND EXISTS (SELECT 1 FROM PERMISO_AREA_EMPLEADO ae
                                     WHERE ae.ID_EMPLEADO = p.ID_EMPLEADO AND ae.ID_AREA = :alcanceArea)))
                    """);
                valores.AddRange([("alcanceArea", alcance.IdArea), ("alcanceDepto", alcance.IdDepartamento)]);
                break;
            case PermisoValores.NivelAdminDepartamento:
            case PermisoValores.NivelSecretaria:
                condiciones.Add("(a.DEPARTAMENTO_IHSS_ID = :alcanceDepto OR e.DEPARTAMENTO_IHSS_ID = :alcanceDepto)");
                valores.Add(("alcanceDepto", alcance.IdDepartamento));
                break;
            // El empleado solo ve los suyos, sin importar el área en que se registraron.
            case PermisoValores.NivelUsuario:
                condiciones.Add("p.ID_EMPLEADO = :alcanceEmpleado");
                valores.Add(("alcanceEmpleado", alcance.IdEmpleado));
                break;
        }
        if (filtro.Desde is { } desde)
        {
            condiciones.Add("p.FECHA_FIN >= :desde");
            valores.Add(("desde", desde.Date));
        }
        if (filtro.Hasta is { } hasta)
        {
            // Semiabierto: FECHA_INICIO puede traer hora.
            condiciones.Add("p.FECHA_INICIO < :hastaExclusivo");
            valores.Add(("hastaExclusivo", hasta.Date.AddDays(1)));
        }
        if (filtro.IdEmpleado is { } idEmpleado)
        {
            condiciones.Add("p.ID_EMPLEADO = :idEmpleado");
            valores.Add(("idEmpleado", idEmpleado));
        }
        var where = condiciones.Count > 0 ? "WHERE " + string.Join(" AND ", condiciones) : string.Empty;

        // Una sola conexión para los parámetros y los permisos (ReadList no la cierra si ya estaba abierta).
        await DbContext.Database.OpenConnectionAsync(cancellationToken);
        try
        {
            var filasParametros = await ReadList(PermisoParametros.Sql, PermisoParametros.Leer, cancellationToken);
            var finJornada = new Dictionary<int, string>();
            // Igual que LeerModificable: la jornada del departamento del área o, sin área, la del
            // empleado; un parámetro mal escrito usa la jornada por defecto, como en GetSesion.
            string FinJornada(int? idDepartamento)
            {
                if (idDepartamento is not { } id) return FormatoHora(PermisoParametros.PorDefecto.FinJornada);
                if (finJornada.TryGetValue(id, out var hora)) return hora;
                PermisoParametros parametros;
                try
                {
                    parametros = PermisoParametros.Para(id, filasParametros);
                }
                catch (ArgumentException)
                {
                    parametros = PermisoParametros.PorDefecto;
                }
                return finJornada[id] = FormatoHora(parametros.FinJornada);
            }

            return await ReadList($"""
                SELECT p.ID_PERMISO, p.TIPO, p.ID_EMPLEADO, e.NOMBRE_EMPLEADO AS EMPLEADO, p.NO_PAGO,
                       p.MOTIVO, p.FECHA_INICIO, p.FECHA_FIN, p.HORA_SALIDA, p.HORA_ENTRADA,
                       p.DIAS_HABILES, p.MINUTOS, p.FECHA_SOLICITUD,
                       p.ESTADO, p.FECHA_REGISTRO, p.ID_AREA, a.NOMBRE AS NOMBRE_AREA,
                       a.DEPARTAMENTO_IHSS_ID, d.DEPARTAMENTO_IHSS_DESC AS NOMBRE_DEPARTAMENTO,
                       p.LUGAR_SOLICITUD, p.TELEFONO,
                       COALESCE(a.DEPARTAMENTO_IHSS_ID, e.DEPARTAMENTO_IHSS_ID) AS DEPTO_JORNADA
                FROM PERMISO_SOLICITUD p
                LEFT JOIN EMPLEADOS_IHSS e ON e.EMPLEADOS_IHSS_ID = p.ID_EMPLEADO
                LEFT JOIN PERMISO_AREA a ON a.ID_AREA = p.ID_AREA
                LEFT JOIN DEPARTAMENTO_IHSS d ON d.DEPARTAMENTO_IHSS_ID = a.DEPARTAMENTO_IHSS_ID
                {where}
                ORDER BY p.FECHA_INICIO DESC, p.ID_PERMISO DESC
                """, reader => new PermisoDto(
                    ReadInt(reader, "ID_PERMISO"),
                    ReadString(reader, "TIPO").Trim().ToUpperInvariant(),
                    ReadInt(reader, "ID_EMPLEADO"),
                    ReadString(reader, "EMPLEADO"),
                    ReadNullableString(reader, "NO_PAGO"),
                    ReadString(reader, "MOTIVO"),
                    ReadDate(reader, "FECHA_INICIO"),
                    ReadDate(reader, "FECHA_FIN"),
                    ReadNullableString(reader, "HORA_SALIDA"),
                    ReadNullableString(reader, "HORA_ENTRADA"),
                    ReadNullableInt(reader, "DIAS_HABILES") ?? 0,
                    ReadNullableInt(reader, "MINUTOS") ?? 0,
                    ReadNullableDate(reader, "FECHA_SOLICITUD"),
                    ReadString(reader, "ESTADO").Trim().ToUpperInvariant(),
                    ReadDate(reader, "FECHA_REGISTRO"),
                    ReadNullableInt(reader, "ID_AREA"),
                    ReadNullableString(reader, "NOMBRE_AREA"),
                    ReadNullableInt(reader, "DEPARTAMENTO_IHSS_ID"),
                    ReadNullableString(reader, "NOMBRE_DEPARTAMENTO"),
                    FinJornada(ReadNullableInt(reader, "DEPTO_JORNADA")),
                    ReadNullableString(reader, "LUGAR_SOLICITUD"),
                    ReadNullableString(reader, "TELEFONO")),
                cancellationToken, [.. valores]);
        }
        finally
        {
            await DbContext.Database.CloseConnectionAsync();
        }
    }

    private static string FormatoHora(TimeOnly hora) => hora.ToString("HH:mm", CultureInfo.InvariantCulture);

    // Solo empleados activos (ESTADO = 1) de departamentos habilitados. El jefe recibe los de su
    // departamento que están en su área o todavía no tienen área; el administrador de
    // departamento, todos los de su departamento; el general y la consulta, todos. Un área de
    // otro departamento (el empleado fue trasladado) no cuenta: el empleado aparece sin área.
    public Task<IReadOnlyList<PermisoEmpleadoDto>> GetEmpleados(PermisoAlcance alcance, CancellationToken cancellationToken)
    {
        var filtro = alcance.Nivel switch
        {
            PermisoValores.NivelJefe =>
                "AND e.DEPARTAMENTO_IHSS_ID = :alcanceDepto AND (ea.ID_AREA = :alcanceArea OR ea.ID_AREA IS NULL)",
            PermisoValores.NivelAdminDepartamento or PermisoValores.NivelSecretaria => "AND e.DEPARTAMENTO_IHSS_ID = :alcanceDepto",
            // El empleado solo se recibe a sí mismo: es el único al que registra permisos.
            PermisoValores.NivelUsuario => "AND e.EMPLEADOS_IHSS_ID = :alcanceEmpleado",
            _ => string.Empty,
        };
        (string Name, object? Value)[] valores = alcance.Nivel switch
        {
            PermisoValores.NivelJefe => [("alcanceDepto", alcance.IdDepartamento), ("alcanceArea", alcance.IdArea)],
            PermisoValores.NivelAdminDepartamento or PermisoValores.NivelSecretaria => [("alcanceDepto", alcance.IdDepartamento)],
            PermisoValores.NivelUsuario => [("alcanceEmpleado", alcance.IdEmpleado)],
            _ => [],
        };

        return ReadList($"""
            SELECT e.EMPLEADOS_IHSS_ID AS ID_EMPLEADO, e.NOMBRE_EMPLEADO AS NOMBRE_COMPLETO, TRIM(e.NPAGO) AS NO_PAGO,
                   e.DEPARTAMENTO_IHSS_ID, ea.ID_AREA, ea.NOMBRE AS NOMBRE_AREA
            FROM EMPLEADOS_IHSS e
            JOIN PERMISO_DEPARTAMENTO pd ON pd.DEPARTAMENTO_IHSS_ID = e.DEPARTAMENTO_IHSS_ID AND pd.ESTADO = 'ACTIVO'
            LEFT JOIN (SELECT ae.ID_EMPLEADO, ae.ID_AREA, a.NOMBRE, a.DEPARTAMENTO_IHSS_ID
                       FROM PERMISO_AREA_EMPLEADO ae
                       JOIN PERMISO_AREA a ON a.ID_AREA = ae.ID_AREA) ea
                   ON ea.ID_EMPLEADO = e.EMPLEADOS_IHSS_ID AND ea.DEPARTAMENTO_IHSS_ID = e.DEPARTAMENTO_IHSS_ID
            WHERE e.ESTADO = 1
            {filtro}
            ORDER BY UPPER(e.NOMBRE_EMPLEADO)
            """, reader => new PermisoEmpleadoDto(
                ReadInt(reader, "ID_EMPLEADO"),
                ReadString(reader, "NOMBRE_COMPLETO"),
                ReadNullableString(reader, "NO_PAGO"),
                ReadInt(reader, "DEPARTAMENTO_IHSS_ID"),
                ReadNullableInt(reader, "ID_AREA"),
                ReadNullableString(reader, "NOMBRE_AREA")),
            cancellationToken, valores);
    }

    public Task CreatePermisoDia(PermisoAlcance alcance, SavePermisoDiaDto permiso, CancellationToken cancellationToken) =>
        Guardar(alcance, null, [SolicitudDia(permiso)], cancellationToken);

    public Task<bool> UpdatePermisoDia(PermisoAlcance alcance, int idPermiso, SavePermisoDiaDto permiso, CancellationToken cancellationToken) =>
        Guardar(alcance, idPermiso, [SolicitudDia(permiso)], cancellationToken);

    public Task CreatePermisoHora(PermisoAlcance alcance, SavePermisoHoraDto permiso, CancellationToken cancellationToken) =>
        Guardar(alcance, null, [SolicitudHora(permiso)], cancellationToken);

    public Task<bool> UpdatePermisoHora(PermisoAlcance alcance, int idPermiso, SavePermisoHoraDto permiso, CancellationToken cancellationToken) =>
        Guardar(alcance, idPermiso, [SolicitudHora(permiso)], cancellationToken);

    // Un registro por período, todos con la misma fecha de solicitud.
    public Task CreateVacaciones(PermisoAlcance alcance, SaveVacacionesDto vacaciones, CancellationToken cancellationToken) =>
        Guardar(alcance, null,
            [.. (vacaciones.Periodos ?? []).Select(periodo => SolicitudVacacion(
                vacaciones.IdEmpleado, periodo.FechaInicio, periodo.FechaFin, vacaciones.FechaSolicitud))],
            cancellationToken);

    public Task<bool> UpdateVacacion(PermisoAlcance alcance, int idPermiso, SaveVacacionDto vacacion, CancellationToken cancellationToken) =>
        Guardar(alcance, idPermiso,
            [SolicitudVacacion(vacacion.IdEmpleado, vacacion.FechaInicio, vacacion.FechaFin, vacacion.FechaSolicitud)],
            cancellationToken);

    // Anular conserva el registro, pero deja de contar en los totales, los choques y los límites.
    // Cada usuario solo anula permisos de su alcance, y solo mientras no hayan finalizado.
    public Task<bool> AnularPermiso(PermisoAlcance alcance, int idPermiso, CancellationToken cancellationToken) =>
        InTransaction(async (connection, transaction) =>
        {
            if (await LeerModificable(connection, transaction, alcance, idPermiso, "anular", null, cancellationToken) is null) return false;
            await Execute(connection, transaction,
                "UPDATE PERMISO_SOLICITUD SET ESTADO = 'ANULADO' WHERE ID_PERMISO = :idPermiso", cancellationToken,
                ("idPermiso", idPermiso));
            return true;
        }, cancellationToken);

    // Agrega al empleado a un área de su mismo departamento. El jefe solo toma empleados sin
    // área y los lleva a la suya; los administradores mueven a cualquiera dentro de su alcance.
    public Task AsignarArea(PermisoAlcance alcance, int idEmpleado, int idArea, CancellationToken cancellationToken) =>
        InTransaction(async (connection, transaction) =>
        {
            var area = await LeerArea(connection, transaction, idArea, cancellationToken);
            if (area is not { } datos || datos.Estado != PermisoValores.Activo || datos.EstadoDepartamento != PermisoValores.Activo)
            {
                throw new ArgumentException("El área seleccionada no existe o está desactivada.");
            }
            if (!alcance.IncluyeArea(idArea, datos.IdDepartamento))
            {
                throw new ArgumentException(alcance.Nivel == PermisoValores.NivelJefe
                    ? "Solo puedes agregar empleados a tu área."
                    : "Solo puedes asignar empleados a las áreas de tu departamento.");
            }
            await ValidarEmpleado(connection, transaction, idEmpleado, datos.IdDepartamento, cancellationToken);

            // Un área de otro departamento (el empleado fue trasladado) no cuenta: se reemplaza.
            var actual = await ReadRows(connection, transaction, """
                SELECT ae.ID_AREA, a.NOMBRE
                FROM PERMISO_AREA_EMPLEADO ae
                JOIN PERMISO_AREA a ON a.ID_AREA = ae.ID_AREA
                WHERE ae.ID_EMPLEADO = :idEmpleado
                  AND a.DEPARTAMENTO_IHSS_ID = :idDepartamento
                FOR UPDATE
                """, reader => (IdArea: ReadInt(reader, "ID_AREA"), Nombre: ReadString(reader, "NOMBRE")),
                cancellationToken, ("idEmpleado", idEmpleado), ("idDepartamento", datos.IdDepartamento));
            if (actual.Count > 0 && actual[0].IdArea == idArea) return;
            if (actual.Count > 0 && alcance.Nivel == PermisoValores.NivelJefe)
            {
                throw new ArgumentException(
                    $"El empleado ya pertenece al área {actual[0].Nombre}. Pide al administrador de tu departamento que lo mueva.");
            }

            await Execute(connection, transaction,
                "DELETE FROM PERMISO_AREA_EMPLEADO WHERE ID_EMPLEADO = :idEmpleado", cancellationToken,
                ("idEmpleado", idEmpleado));
            await Execute(connection, transaction, """
                INSERT INTO PERMISO_AREA_EMPLEADO (ID_EMPLEADO, ID_AREA) VALUES (:idEmpleado, :idArea)
                """, cancellationToken, ("idEmpleado", idEmpleado), ("idArea", idArea));
        }, cancellationToken);

    // Saca al empleado de su área. Sus permisos ya registrados se quedan en el área.
    public async Task<bool> QuitarArea(PermisoAlcance alcance, int idEmpleado, CancellationToken cancellationToken) =>
        await Execute($"""
            DELETE FROM PERMISO_AREA_EMPLEADO ae
            WHERE ae.ID_EMPLEADO = :idEmpleado
              {DentroDelAlcance(alcance, "ae.ID_AREA")}
            """, cancellationToken, [("idEmpleado", idEmpleado), .. alcance.ParametrosArea()]) > 0;

    // Guarda el No. de pago del empleado (EMPLEADOS_IHSS.NPAGO), el que el formulario del permiso
    // carga al elegirlo; vacío lo borra. Solo empleados activos de departamentos habilitados dentro
    // del alcance: el jefe, los de su área; el administrador de departamento, los de su
    // departamento; el general, todos. Dos empleados activos no pueden tener el mismo número.
    public Task<bool> GuardarNoPagoEmpleado(PermisoAlcance alcance, int idEmpleado, string? noPago, CancellationToken cancellationToken) =>
        InTransaction(async (connection, transaction) =>
        {
            var valor = string.IsNullOrWhiteSpace(noPago) ? null : noPago.Trim();
            var filtro = alcance.Nivel switch
            {
                PermisoValores.NivelJefe => """
                    AND e.DEPARTAMENTO_IHSS_ID = :alcanceDepto
                    AND EXISTS (SELECT 1 FROM PERMISO_AREA_EMPLEADO ae JOIN PERMISO_AREA a ON a.ID_AREA = ae.ID_AREA
                                WHERE ae.ID_EMPLEADO = e.EMPLEADOS_IHSS_ID AND ae.ID_AREA = :alcanceArea
                                  AND a.DEPARTAMENTO_IHSS_ID = e.DEPARTAMENTO_IHSS_ID)
                    """,
                PermisoValores.NivelAdminDepartamento or PermisoValores.NivelSecretaria => "AND e.DEPARTAMENTO_IHSS_ID = :alcanceDepto",
                _ => string.Empty,
            };
            (string Name, object? Value)[] valores = alcance.Nivel switch
            {
                PermisoValores.NivelJefe => [("alcanceDepto", alcance.IdDepartamento), ("alcanceArea", alcance.IdArea)],
                PermisoValores.NivelAdminDepartamento or PermisoValores.NivelSecretaria => [("alcanceDepto", alcance.IdDepartamento)],
                _ => [],
            };

            if (valor is not null)
            {
                var otro = await ReadRows(connection, transaction, """
                    SELECT NOMBRE_EMPLEADO FROM EMPLEADOS_IHSS
                    WHERE TRIM(NPAGO) = :noPago AND EMPLEADOS_IHSS_ID <> :idEmpleado AND ESTADO = 1 AND ROWNUM = 1
                    """, reader => ReadString(reader, "NOMBRE_EMPLEADO").Trim(),
                    cancellationToken, ("noPago", valor), ("idEmpleado", idEmpleado));
                if (otro.Count > 0) throw new ArgumentException($"El No. de pago {valor} ya lo tiene {otro[0]}.");
            }

            return await Execute(connection, transaction, $"""
                UPDATE EMPLEADOS_IHSS e SET e.NPAGO = :noPago
                WHERE e.EMPLEADOS_IHSS_ID = :idEmpleado
                  AND e.ESTADO = 1
                  AND EXISTS (SELECT 1 FROM PERMISO_DEPARTAMENTO pd
                              WHERE pd.DEPARTAMENTO_IHSS_ID = e.DEPARTAMENTO_IHSS_ID AND pd.ESTADO = 'ACTIVO')
                  {filtro}
                """, cancellationToken, [("noPago", valor), ("idEmpleado", idEmpleado), .. valores]) > 0;
        }, cancellationToken);

    // "AND EXISTS (...)" que limita una fila con área (columna indicada) al alcance del usuario;
    // vacío para quien ve todo. Usa los parámetros de PermisoAlcance.ParametrosArea().
    private static string DentroDelAlcance(PermisoAlcance alcance, string columnaArea) =>
        alcance.FiltroArea("a.") is { } filtro
            ? $"AND EXISTS (SELECT 1 FROM PERMISO_AREA a WHERE a.ID_AREA = {columnaArea} AND {filtro})"
            : string.Empty;

    private static Solicitud SolicitudDia(SavePermisoDiaDto permiso) => new(
        PermisoValores.TipoDia, permiso.IdEmpleado, permiso.Motivo.Trim(),
        permiso.FechaInicio.Date, permiso.FechaFin.Date, null, null,
        NoPago: permiso.NoPago?.Trim(), Lugar: permiso.Lugar?.Trim(), Telefono: permiso.Telefono?.Trim());

    private static Solicitud SolicitudHora(SavePermisoHoraDto permiso) => new(
        PermisoValores.TipoHora, permiso.IdEmpleado, permiso.Motivo.Trim(),
        permiso.Fecha.Date, permiso.Fecha.Date,
        ParseHora(permiso.HoraSalida, "salida"), ParseHora(permiso.HoraEntrada, "regreso"), NoPago: permiso.NoPago?.Trim());

    // Las vacaciones no llevan motivo; la columna lo exige, así que se guarda "VACACIONES".
    private static Solicitud SolicitudVacacion(int idEmpleado, DateTime fechaInicio, DateTime fechaFin, DateTime fechaSolicitud) => new(
        PermisoValores.TipoVacaciones, idEmpleado, "VACACIONES", fechaInicio.Date, fechaFin.Date, null, null, fechaSolicitud.Date);

    // Alta (idPermiso null) o edición. En los permisos la fecha de solicitud es la del día del alta
    // (la del servidor) y no cambia al editar; en las vacaciones es la que se indica. Todo ocurre en una transacción con la tabla bloqueada,
    // para que dos registros simultáneos del mismo empleado no pasen ambos la revisión de choques.
    // nuevas: una solicitud, o varios períodos de vacaciones del mismo empleado (solo en el alta);
    // se guardan todos o ninguno. Devuelve false si el permiso a editar no existe o está fuera del
    // alcance del usuario.
    private Task<bool> Guardar(PermisoAlcance alcance, int? idPermiso, IReadOnlyList<Solicitud> nuevas, CancellationToken cancellationToken) =>
        InTransaction(async (connection, transaction) =>
        {
            // Empleado, tipo y fecha de solicitud son los mismos en todos los períodos.
            var nueva = nuevas[0];
            await LockTable(connection, transaction, "PERMISO_SOLICITUD", cancellationToken);
            // Jornada y límites de todos los departamentos: se leen una vez para el permiso que se
            // edita (su fin) y para el nuevo (sus reglas).
            var filasParametros = await ReadRows(connection, transaction, PermisoParametros.Sql, PermisoParametros.Leer, cancellationToken);

            // Área con la que se guarda el permiso: al editar sin cambiar de empleado se conserva
            // la original (aunque el empleado ya esté en otra área, otro departamento o inactivo:
            // el permiso es de cuando estaba ahí); en un alta o con otro empleado, la que el
            // empleado tiene hoy, y el empleado debe estar activo.
            int? idArea = null;
            if (idPermiso is { } id)
            {
                if (await LeerModificable(connection, transaction, alcance, id, "editar", filasParametros, cancellationToken) is not { } actual)
                {
                    return false;
                }
                // Un permiso no pasa a vacaciones ni al revés: cada uno se edita en su sección.
                var eranVacaciones = actual.Tipo == PermisoValores.TipoVacaciones;
                if (eranVacaciones != (nueva.Tipo == PermisoValores.TipoVacaciones))
                {
                    throw new ArgumentException(eranVacaciones
                        ? "Ese registro son vacaciones: se editan en la sección Vacaciones."
                        : "Ese registro es un permiso: se edita en la sección Permisos.");
                }
                if (actual.IdEmpleado == nueva.IdEmpleado && actual.IdArea is not null) idArea = actual.IdArea;
            }

            var conservaArea = idArea is not null;
            idArea ??= await AreaDelEmpleado(connection, transaction, alcance, nueva.IdEmpleado, cancellationToken);
            var area = await LeerArea(connection, transaction, idArea.Value, cancellationToken)
                ?? throw new ArgumentException("El área del empleado ya no existe.");
            var idDepartamento = area.IdDepartamento;
            if (!conservaArea)
            {
                if (area.Estado != PermisoValores.Activo || area.EstadoDepartamento != PermisoValores.Activo)
                {
                    throw new ArgumentException("El área del empleado o su departamento está desactivado.");
                }
                await ValidarEmpleado(connection, transaction, nueva.IdEmpleado, idDepartamento, cancellationToken);
            }

            var parametros = PermisoParametros.Para(idDepartamento, filasParametros);
            // Años que toca el permiso: alcanzan para contar sus días y para los límites. Un choque
            // o un permiso que sume al mes o al año tiene que tocar esos mismos años, así que los
            // permisos que terminaron antes o empiezan después no hace falta leerlos.
            var desdeAnio = new DateTime(nuevas.Min(solicitud => solicitud.FechaInicio).Year, 1, 1);
            var hastaAnio = new DateTime(nuevas.Max(solicitud => solicitud.FechaFin).Year + 1, 1, 1);
            var feriados = await LeerFeriados(connection, transaction, idDepartamento, desdeAnio, hastaAnio, cancellationToken);
            var existentes = (await ReadRows(connection, transaction, """
                SELECT TIPO, FECHA_INICIO, FECHA_FIN, HORA_SALIDA, HORA_ENTRADA, MINUTOS
                FROM PERMISO_SOLICITUD
                WHERE ID_EMPLEADO = :idEmpleado
                  AND ESTADO = 'ACTIVO'
                  AND ID_PERMISO <> :idPermiso
                  AND FECHA_FIN >= :desdeAnio
                  AND FECHA_INICIO < :hastaAnio
                """, reader => new Existente(
                    ReadString(reader, "TIPO").Trim().ToUpperInvariant(),
                    ReadDate(reader, "FECHA_INICIO").Date,
                    ReadDate(reader, "FECHA_FIN").Date,
                    PermisoParametros.TryParseHora(ReadNullableString(reader, "HORA_SALIDA")),
                    PermisoParametros.TryParseHora(ReadNullableString(reader, "HORA_ENTRADA")),
                    ReadNullableInt(reader, "MINUTOS") ?? 0),
                cancellationToken, ("idEmpleado", nueva.IdEmpleado), ("idPermiso", idPermiso ?? 0),
                ("desdeAnio", desdeAnio), ("hastaAnio", hastaAnio))).ToList();

            // Cada período se revisa contra lo registrado y contra los anteriores de la misma
            // solicitud; con varios, el mensaje dice cuál falló.
            var calculadas = new List<(Solicitud Solicitud, int Dias, int Minutos)>();
            foreach (var solicitud in nuevas)
            {
                try
                {
                    var (diasSolicitud, minutosSolicitud) = Calcular(solicitud, parametros, feriados);
                    ValidarChoques(solicitud, existentes);
                    ValidarLimites(solicitud, diasSolicitud, minutosSolicitud, existentes, parametros, feriados);
                    calculadas.Add((solicitud, diasSolicitud, minutosSolicitud));
                    existentes.Add(new Existente(solicitud.Tipo, solicitud.FechaInicio, solicitud.FechaFin,
                        solicitud.HoraSalida, solicitud.HoraEntrada, minutosSolicitud));
                }
                catch (ArgumentException error) when (nuevas.Count > 1)
                {
                    throw new ArgumentException(
                        $"Período del {solicitud.FechaInicio:dd/MM/yyyy} al {solicitud.FechaFin:dd/MM/yyyy}: {error.Message}", error);
                }
            }

            // La fecha de solicitud indicada (vacaciones) se guarda; sin ella, la del servidor al
            // registrar, y al editar se conserva.
            var solicitudIndicada = nueva.FechaSolicitud is not null;
            (string Name, object? Value)[] Valores(Solicitud solicitud, int dias, int minutos)
            {
                (string Name, object? Value)[] valores =
                [
                    ("idEmpleado", solicitud.IdEmpleado), ("motivo", solicitud.Motivo),
                    ("fechaInicio", solicitud.FechaInicio), ("fechaFin", solicitud.FechaFin),
                    ("horaSalida", solicitud.HoraSalida?.ToString("HH:mm", CultureInfo.InvariantCulture)),
                    ("horaEntrada", solicitud.HoraEntrada?.ToString("HH:mm", CultureInfo.InvariantCulture)),
                    ("diasHabiles", dias), ("minutos", minutos),
                    ("idArea", idArea), ("tipo", solicitud.Tipo), ("noPago", solicitud.NoPago),
                    ("lugar", solicitud.Lugar), ("telefono", solicitud.Telefono),
                ];
                return solicitud.FechaSolicitud is { } fechaSolicitud ? [.. valores, ("fechaSolicitud", fechaSolicitud)] : valores;
            }

            if (idPermiso is { } idActual)
            {
                var (editada, dias, minutos) = calculadas[0];
                await Execute(connection, transaction, $"""
                    UPDATE PERMISO_SOLICITUD
                    SET TIPO = :tipo,
                        ID_EMPLEADO = :idEmpleado,
                        MOTIVO = :motivo,
                        FECHA_INICIO = :fechaInicio,
                        FECHA_FIN = :fechaFin,
                        HORA_SALIDA = :horaSalida,
                        HORA_ENTRADA = :horaEntrada,
                        DIAS_HABILES = :diasHabiles,
                        MINUTOS = :minutos,
                        NO_PAGO = :noPago,
                        LUGAR_SOLICITUD = :lugar,
                        TELEFONO = :telefono,
                        {(solicitudIndicada ? "FECHA_SOLICITUD = :fechaSolicitud," : string.Empty)}
                        ID_AREA = :idArea
                    WHERE ID_PERMISO = :idPermiso
                    """, cancellationToken, [.. Valores(editada, dias, minutos), ("idPermiso", idActual)]);
                return true;
            }

            // La tabla sigue bloqueada: cada período toma el siguiente ID.
            foreach (var (solicitud, dias, minutos) in calculadas)
            {
                var nuevoId = await NextId(connection, transaction, "PERMISO_SOLICITUD", "ID_PERMISO", cancellationToken,
                    tablaBloqueada: true);
                await Execute(connection, transaction, $"""
                    INSERT INTO PERMISO_SOLICITUD
                        (ID_PERMISO, TIPO, ID_EMPLEADO, MOTIVO, FECHA_INICIO, FECHA_FIN,
                         HORA_SALIDA, HORA_ENTRADA, DIAS_HABILES, MINUTOS, NO_PAGO, LUGAR_SOLICITUD, TELEFONO,
                         FECHA_SOLICITUD, ESTADO, FECHA_REGISTRO, ID_AREA)
                    VALUES
                        (:idPermiso, :tipo, :idEmpleado, :motivo, :fechaInicio, :fechaFin,
                         :horaSalida, :horaEntrada, :diasHabiles, :minutos, :noPago, :lugar, :telefono,
                         {(solicitudIndicada ? ":fechaSolicitud" : "TRUNC(SYSDATE)")}, 'ACTIVO', SYSDATE, :idArea)
                    """, cancellationToken, [.. Valores(solicitud, dias, minutos), ("idPermiso", nuevoId)]);
            }
            return true;
        }, cancellationToken);

    // Permiso que se va a editar o anular (accion), bloqueado hasta el fin de la transacción.
    // Devuelve null si no existe o está fuera del alcance del usuario; si está anulado o ya
    // finalizó, no se puede modificar. filasParametros: las de PermisoParametros.Sql si quien
    // llama ya las leyó; null para leerlas solo cuando hacen falta.
    private static async Task<PermisoActual?> LeerModificable(
        DbConnection connection,
        DbTransaction transaction,
        PermisoAlcance alcance,
        int idPermiso,
        string accion,
        IReadOnlyCollection<PermisoParametros.Fila>? filasParametros,
        CancellationToken cancellationToken)
    {
        // La jornada que marca el fin es la del departamento del área del permiso; los permisos sin
        // área usan la del departamento del empleado.
        var filas = await ReadRows(connection, transaction, """
            SELECT p.ESTADO, p.TIPO, p.ID_EMPLEADO, p.ID_AREA, a.DEPARTAMENTO_IHSS_ID, p.FECHA_FIN, p.HORA_ENTRADA,
                   COALESCE(a.DEPARTAMENTO_IHSS_ID, e.DEPARTAMENTO_IHSS_ID) AS DEPTO_JORNADA
            FROM PERMISO_SOLICITUD p
            LEFT JOIN PERMISO_AREA a ON a.ID_AREA = p.ID_AREA
            LEFT JOIN EMPLEADOS_IHSS e ON e.EMPLEADOS_IHSS_ID = p.ID_EMPLEADO
            WHERE p.ID_PERMISO = :idPermiso
            FOR UPDATE OF p.ESTADO
            """, reader => new PermisoActual(
                ReadString(reader, "ESTADO").Trim().ToUpperInvariant(),
                ReadString(reader, "TIPO").Trim().ToUpperInvariant(),
                ReadInt(reader, "ID_EMPLEADO"),
                ReadNullableInt(reader, "ID_AREA"),
                ReadNullableInt(reader, "DEPARTAMENTO_IHSS_ID"),
                ReadDate(reader, "FECHA_FIN"),
                PermisoParametros.TryParseHora(ReadNullableString(reader, "HORA_ENTRADA")),
                ReadNullableInt(reader, "DEPTO_JORNADA")),
            cancellationToken, ("idPermiso", idPermiso));
        if (filas.Count == 0) return null;
        var actual = filas[0];
        // Los permisos sin área (anteriores a las áreas) solo los ve quien ve todo.
        var dentro = actual is { IdArea: { } area, IdDepartamento: { } departamento }
            ? alcance.IncluyeArea(area, departamento)
            : alcance.VeTodo;
        if (!dentro) return null;
        // Los mensajes nombran lo que se modifica: un permiso o unas vacaciones.
        var vacaciones = actual.Tipo == PermisoValores.TipoVacaciones;
        if (actual.Estado != PermisoValores.Activo)
        {
            throw new ArgumentException(vacaciones
                ? $"Las vacaciones están anuladas y ya no se pueden {accion}."
                : $"El permiso está anulado y ya no se puede {accion}.");
        }

        var parametros = actual.IdDepartamentoJornada is { } deptoJornada
            ? PermisoParametros.Para(deptoJornada, filasParametros
                ?? await ReadRows(connection, transaction, PermisoParametros.Sql, PermisoParametros.Leer, cancellationToken))
            : PermisoParametros.PorDefecto;
        if (Finalizado(actual.Tipo, actual.FechaFin, actual.HoraEntrada, parametros.FinJornada, DateTime.Now))
        {
            throw new ArgumentException(vacaciones
                ? $"Las vacaciones ya finalizaron y no se pueden {accion}."
                : $"El permiso ya finalizó y no se puede {accion}.");
        }
        return actual;
    }

    // El empleado debe estar activo y ser del departamento del área (quien llama ya revisó que el
    // área y su departamento estén activos).
    private static async Task ValidarEmpleado(
        DbConnection connection,
        DbTransaction transaction,
        int idEmpleado,
        int idDepartamento,
        CancellationToken cancellationToken)
    {
        var filas = await ReadRows(connection, transaction, """
            SELECT ESTADO, DEPARTAMENTO_IHSS_ID FROM EMPLEADOS_IHSS WHERE EMPLEADOS_IHSS_ID = :idEmpleado
            """, reader => (Estado: ReadNullableInt(reader, "ESTADO"), IdDepartamento: ReadNullableInt(reader, "DEPARTAMENTO_IHSS_ID")),
            cancellationToken, ("idEmpleado", idEmpleado));
        if (filas.Count == 0) throw new ArgumentException("El empleado seleccionado no existe.");
        if (filas[0].Estado != 1) throw new ArgumentException("El empleado está inactivo: ya no se le pueden registrar permisos.");
        if (filas[0].IdDepartamento != idDepartamento)
        {
            throw new ArgumentException("El empleado ya no pertenece al departamento de esa área. Asígnale un área de su departamento actual.");
        }
    }

    // Área actual del empleado en su departamento actual (la de otro departamento, si lo
    // trasladaron, no cuenta). Todo permiso necesita una, y debe estar dentro del alcance del usuario.
    private static async Task<int> AreaDelEmpleado(
        DbConnection connection,
        DbTransaction transaction,
        PermisoAlcance alcance,
        int idEmpleado,
        CancellationToken cancellationToken)
    {
        var filas = await ReadRows(connection, transaction, """
            SELECT ae.ID_AREA, a.DEPARTAMENTO_IHSS_ID
            FROM PERMISO_AREA_EMPLEADO ae
            JOIN PERMISO_AREA a ON a.ID_AREA = ae.ID_AREA
            JOIN EMPLEADOS_IHSS e ON e.EMPLEADOS_IHSS_ID = ae.ID_EMPLEADO AND e.DEPARTAMENTO_IHSS_ID = a.DEPARTAMENTO_IHSS_ID
            WHERE ae.ID_EMPLEADO = :idEmpleado
            """, reader => (IdArea: ReadInt(reader, "ID_AREA"), IdDepartamento: ReadInt(reader, "DEPARTAMENTO_IHSS_ID")),
            cancellationToken, ("idEmpleado", idEmpleado));
        // El empleado solo se registra permisos a sí mismo.
        if (!alcance.IncluyeEmpleado(idEmpleado))
        {
            throw new ArgumentException("Tu usuario solo puede registrar tus propios permisos y vacaciones.");
        }
        if (filas.Count == 0)
        {
            throw new ArgumentException(alcance.EsEmpleado
                ? "Todavía no estás asignado a un área de tu departamento. Pídele a tu jefe que te agregue en Personal."
                : "El empleado no tiene un área asignada en su departamento. Agrégalo primero en la sección Personal.");
        }
        if (!alcance.IncluyeArea(filas[0].IdArea, filas[0].IdDepartamento))
        {
            throw new ArgumentException(alcance.Nivel == PermisoValores.NivelJefe
                ? "El empleado no pertenece a tu área."
                : "El empleado no pertenece a tu departamento.");
        }
        return filas[0].IdArea;
    }

    private static async Task<AreaDatos?> LeerArea(
        DbConnection connection,
        DbTransaction transaction,
        int idArea,
        CancellationToken cancellationToken)
    {
        var filas = await ReadRows(connection, transaction, """
            SELECT a.DEPARTAMENTO_IHSS_ID, a.ESTADO, pd.ESTADO AS ESTADO_DEPARTAMENTO
            FROM PERMISO_AREA a
            JOIN PERMISO_DEPARTAMENTO pd ON pd.DEPARTAMENTO_IHSS_ID = a.DEPARTAMENTO_IHSS_ID
            WHERE a.ID_AREA = :idArea
            """, reader => new AreaDatos(
                ReadInt(reader, "DEPARTAMENTO_IHSS_ID"),
                ReadString(reader, "ESTADO").Trim().ToUpperInvariant(),
                ReadString(reader, "ESTADO_DEPARTAMENTO").Trim().ToUpperInvariant()),
            cancellationToken, ("idArea", idArea));
        return filas.Count == 0 ? null : filas[0];
    }

    // Feriados generales (sin departamento) y los del departamento. FECHA puede traer hora: se
    // compara con un rango semiabierto [desde, hasta).
    private static async Task<IReadOnlySet<DateTime>> LeerFeriados(
        DbConnection connection,
        DbTransaction transaction,
        int idDepartamento,
        DateTime desde,
        DateTime hasta,
        CancellationToken cancellationToken) =>
        (await ReadRows(connection, transaction, """
            SELECT FECHA FROM PERMISO_FERIADO
            WHERE FECHA >= :desde AND FECHA < :hasta
              AND (DEPARTAMENTO_IHSS_ID IS NULL OR DEPARTAMENTO_IHSS_ID = :idDepartamento)
            """, reader => ReadDate(reader, "FECHA").Date, cancellationToken,
            ("desde", desde), ("hasta", hasta), ("idDepartamento", idDepartamento)))
            .ToHashSet();

    private static TimeOnly ParseHora(string? valor, string campo) =>
        PermisoParametros.TryParseHora(valor) ?? throw new ArgumentException($"La hora de {campo} no es válida.");

    // Departamento y estados de un área.
    private sealed record AreaDatos(int IdDepartamento, string Estado, string EstadoDepartamento);

    // Permiso guardado que se va a editar o anular.
    private sealed record PermisoActual(
        string Estado,
        string Tipo,
        int IdEmpleado,
        int? IdArea,
        int? IdDepartamento,
        DateTime FechaFin,
        TimeOnly? HoraEntrada,
        int? IdDepartamentoJornada);
}
