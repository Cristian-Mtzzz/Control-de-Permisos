using System.Data.Common;
using System.Globalization;
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
    // todo el historial: Desde deja los que terminan ese día o después, IdEmpleado los de uno.
    public Task<IReadOnlyList<PermisoDto>> GetPermisos(
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
                condiciones.Add("(a.DEPARTAMENTO_IHSS_ID = :alcanceDepto OR e.DEPARTAMENTO_IHSS_ID = :alcanceDepto)");
                valores.Add(("alcanceDepto", alcance.IdDepartamento));
                break;
        }
        if (filtro.Desde is { } desde)
        {
            condiciones.Add("p.FECHA_FIN >= :desde");
            valores.Add(("desde", desde.Date));
        }
        if (filtro.IdEmpleado is { } idEmpleado)
        {
            condiciones.Add("p.ID_EMPLEADO = :idEmpleado");
            valores.Add(("idEmpleado", idEmpleado));
        }
        var where = condiciones.Count > 0 ? "WHERE " + string.Join(" AND ", condiciones) : string.Empty;

        return ReadList($"""
            SELECT p.ID_PERMISO, p.TIPO, p.ID_EMPLEADO, e.NOMBRE_EMPLEADO AS EMPLEADO, TRIM(e.NPAGO) AS NO_PAGO,
                   p.MOTIVO, p.FECHA_INICIO, p.FECHA_FIN, p.HORA_SALIDA, p.HORA_ENTRADA,
                   p.DIAS_HABILES, p.MINUTOS, p.FECHA_SOLICITUD,
                   p.ESTADO, p.FECHA_REGISTRO, p.ID_AREA, a.NOMBRE AS NOMBRE_AREA,
                   a.DEPARTAMENTO_IHSS_ID, d.DEPARTAMENTO_IHSS_DESC AS NOMBRE_DEPARTAMENTO
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
                ReadNullableString(reader, "NOMBRE_DEPARTAMENTO")),
            cancellationToken, [.. valores]);
    }

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
            PermisoValores.NivelAdminDepartamento => "AND e.DEPARTAMENTO_IHSS_ID = :alcanceDepto",
            _ => string.Empty,
        };
        (string Name, object? Value)[] valores = alcance.Nivel switch
        {
            PermisoValores.NivelJefe => [("alcanceDepto", alcance.IdDepartamento), ("alcanceArea", alcance.IdArea)],
            PermisoValores.NivelAdminDepartamento => [("alcanceDepto", alcance.IdDepartamento)],
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
        Guardar(alcance, null, SolicitudDia(permiso), cancellationToken);

    public Task<bool> UpdatePermisoDia(PermisoAlcance alcance, int idPermiso, SavePermisoDiaDto permiso, CancellationToken cancellationToken) =>
        Guardar(alcance, idPermiso, SolicitudDia(permiso), cancellationToken);

    public Task CreatePermisoHora(PermisoAlcance alcance, SavePermisoHoraDto permiso, CancellationToken cancellationToken) =>
        Guardar(alcance, null, SolicitudHora(permiso), cancellationToken);

    public Task<bool> UpdatePermisoHora(PermisoAlcance alcance, int idPermiso, SavePermisoHoraDto permiso, CancellationToken cancellationToken) =>
        Guardar(alcance, idPermiso, SolicitudHora(permiso), cancellationToken);

    // Anular conserva el registro, pero deja de contar en los totales, los choques y los límites.
    // Cada usuario solo anula permisos de su alcance.
    public async Task<bool> AnularPermiso(PermisoAlcance alcance, int idPermiso, CancellationToken cancellationToken) =>
        await Execute($"""
            UPDATE PERMISO_SOLICITUD p
            SET p.ESTADO = 'ANULADO'
            WHERE p.ID_PERMISO = :idPermiso
              AND p.ESTADO = 'ACTIVO'
              {DentroDelAlcance(alcance, "p.ID_AREA")}
            """, cancellationToken, [("idPermiso", idPermiso), .. alcance.ParametrosArea()]) > 0;

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

    // "AND EXISTS (...)" que limita una fila con área (columna indicada) al alcance del usuario;
    // vacío para quien ve todo. Usa los parámetros de PermisoAlcance.ParametrosArea().
    private static string DentroDelAlcance(PermisoAlcance alcance, string columnaArea) =>
        alcance.FiltroArea("a.") is { } filtro
            ? $"AND EXISTS (SELECT 1 FROM PERMISO_AREA a WHERE a.ID_AREA = {columnaArea} AND {filtro})"
            : string.Empty;

    private static Solicitud SolicitudDia(SavePermisoDiaDto permiso) => new(
        PermisoValores.TipoDia, permiso.IdEmpleado, permiso.Motivo.Trim(),
        permiso.FechaInicio.Date, permiso.FechaFin.Date, null, null,
        permiso.FechaSolicitud.Date);

    private static Solicitud SolicitudHora(SavePermisoHoraDto permiso) => new(
        PermisoValores.TipoHora, permiso.IdEmpleado, permiso.Motivo.Trim(),
        permiso.Fecha.Date, permiso.Fecha.Date,
        ParseHora(permiso.HoraSalida, "salida"), ParseHora(permiso.HoraEntrada, "entrada"),
        permiso.FechaSolicitud.Date);

    // Alta (idPermiso null) o edición. Todo ocurre en una transacción con la tabla bloqueada,
    // para que dos registros simultáneos del mismo empleado no pasen ambos la revisión de choques.
    // Devuelve false si el permiso a editar no existe o está fuera del alcance del usuario.
    private Task<bool> Guardar(PermisoAlcance alcance, int? idPermiso, Solicitud nueva, CancellationToken cancellationToken) =>
        InTransaction(async (connection, transaction) =>
        {
            await Execute(connection, transaction,
                "LOCK TABLE PERMISO_SOLICITUD IN EXCLUSIVE MODE WAIT 10", cancellationToken);

            // Área con la que se guarda el permiso: al editar sin cambiar de empleado se conserva
            // la original (aunque el empleado ya esté en otra área, otro departamento o inactivo:
            // el permiso es de cuando estaba ahí); en un alta o con otro empleado, la que el
            // empleado tiene hoy, y el empleado debe estar activo.
            int? idArea = null;
            if (idPermiso is { } id)
            {
                var actual = await ReadRows(connection, transaction, """
                    SELECT p.ESTADO, p.ID_EMPLEADO, p.ID_AREA, a.DEPARTAMENTO_IHSS_ID
                    FROM PERMISO_SOLICITUD p
                    LEFT JOIN PERMISO_AREA a ON a.ID_AREA = p.ID_AREA
                    WHERE p.ID_PERMISO = :idPermiso
                    """, reader => (
                        Estado: ReadString(reader, "ESTADO").Trim(),
                        IdEmpleado: ReadInt(reader, "ID_EMPLEADO"),
                        IdArea: ReadNullableInt(reader, "ID_AREA"),
                        IdDepartamento: ReadNullableInt(reader, "DEPARTAMENTO_IHSS_ID")),
                    cancellationToken, ("idPermiso", id));
                if (actual.Count == 0) return false;
                // Los permisos sin área (anteriores a las áreas) solo los ve quien ve todo.
                var dentro = actual[0] is { IdArea: { } areaActual, IdDepartamento: { } deptoActual }
                    ? alcance.IncluyeArea(areaActual, deptoActual)
                    : alcance.VeTodo;
                if (!dentro) return false;
                if (!actual[0].Estado.Equals(PermisoValores.Activo, StringComparison.OrdinalIgnoreCase))
                {
                    throw new ArgumentException("El permiso está anulado y ya no se puede editar.");
                }
                if (actual[0].IdEmpleado == nueva.IdEmpleado && actual[0].IdArea is not null) idArea = actual[0].IdArea;
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

            var parametros = PermisoParametros.Para(idDepartamento,
                await ReadRows(connection, transaction, PermisoParametros.Sql, PermisoParametros.Leer, cancellationToken));
            // Feriados de los años que toca el permiso: alcanzan para contar sus días y para el límite anual.
            var feriados = await LeerFeriados(connection, transaction, idDepartamento,
                new DateTime(nueva.FechaInicio.Year, 1, 1), new DateTime(nueva.FechaFin.Year + 1, 1, 1), cancellationToken);
            var existentes = await ReadRows(connection, transaction, """
                SELECT TIPO, FECHA_INICIO, FECHA_FIN, HORA_SALIDA, HORA_ENTRADA, MINUTOS
                FROM PERMISO_SOLICITUD
                WHERE ID_EMPLEADO = :idEmpleado
                  AND ESTADO = 'ACTIVO'
                  AND ID_PERMISO <> :idPermiso
                """, reader => new Existente(
                    ReadString(reader, "TIPO").Trim().ToUpperInvariant(),
                    ReadDate(reader, "FECHA_INICIO").Date,
                    ReadDate(reader, "FECHA_FIN").Date,
                    PermisoParametros.TryParseHora(ReadNullableString(reader, "HORA_SALIDA")),
                    PermisoParametros.TryParseHora(ReadNullableString(reader, "HORA_ENTRADA")),
                    ReadNullableInt(reader, "MINUTOS") ?? 0),
                cancellationToken, ("idEmpleado", nueva.IdEmpleado), ("idPermiso", idPermiso ?? 0));

            var (dias, minutos) = Calcular(nueva, parametros, feriados);
            ValidarChoques(nueva, existentes);
            ValidarLimites(nueva, dias, minutos, existentes, parametros, feriados);

            (string Name, object? Value)[] valores =
            [
                ("idEmpleado", nueva.IdEmpleado), ("motivo", nueva.Motivo),
                ("fechaInicio", nueva.FechaInicio), ("fechaFin", nueva.FechaFin),
                ("horaSalida", nueva.HoraSalida?.ToString("HH:mm", CultureInfo.InvariantCulture)),
                ("horaEntrada", nueva.HoraEntrada?.ToString("HH:mm", CultureInfo.InvariantCulture)),
                ("diasHabiles", dias), ("minutos", minutos),
                ("fechaSolicitud", nueva.FechaSolicitud),
                ("idArea", idArea),
            ];

            if (idPermiso is { } idActual)
            {
                await Execute(connection, transaction, """
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
                        FECHA_SOLICITUD = :fechaSolicitud,
                        ID_AREA = :idArea
                    WHERE ID_PERMISO = :idPermiso
                    """, cancellationToken, [.. valores, ("idPermiso", idActual), ("tipo", nueva.Tipo)]);
                return true;
            }

            var nuevoId = await NextId(connection, transaction, "PERMISO_SOLICITUD", "ID_PERMISO", cancellationToken);
            await Execute(connection, transaction, """
                INSERT INTO PERMISO_SOLICITUD
                    (ID_PERMISO, TIPO, ID_EMPLEADO, MOTIVO, FECHA_INICIO, FECHA_FIN,
                     HORA_SALIDA, HORA_ENTRADA, DIAS_HABILES, MINUTOS,
                     FECHA_SOLICITUD, ESTADO, FECHA_REGISTRO, ID_AREA)
                VALUES
                    (:idPermiso, :tipo, :idEmpleado, :motivo, :fechaInicio, :fechaFin,
                     :horaSalida, :horaEntrada, :diasHabiles, :minutos,
                     :fechaSolicitud, 'ACTIVO', SYSDATE, :idArea)
                """, cancellationToken, [.. valores, ("idPermiso", nuevoId), ("tipo", nueva.Tipo)]);
            return true;
        }, cancellationToken);

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
        if (filas.Count == 0)
        {
            throw new ArgumentException(
                "El empleado no tiene un área asignada en su departamento. Agrégalo primero en la sección Personal.");
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

    private static DateTime ReadDate(DbDataReader reader, string column) =>
        Convert.ToDateTime(reader.GetValue(reader.GetOrdinal(column)), CultureInfo.InvariantCulture);

    // Departamento y estados de un área.
    private sealed record AreaDatos(int IdDepartamento, string Estado, string EstadoDepartamento);
}
