using System.Data.Common;
using System.Globalization;
using Microsoft.EntityFrameworkCore;
using ControlPermisos.Api.Data;
using ControlPermisos.Api.Models;

namespace ControlPermisos.Api.Services;

// Departamentos, áreas (jefaturas) y usuarios del Control de permisos. Los usuarios son los de
// USUARIOS_PERMISOS (propios de este sistema, aparte de USUARIOS del inventario), con un solo
// nivel por usuario:
//   PERMISO_ADMIN = 1    -> administrador general (todos los departamentos).
//   ID_DEPTO_PERMISO     -> jefe (administrador) de ese departamento, o su secretaría cuando
//                           PERMISO_SECRETARIA = 1 (ve y exporta ese departamento, no registra).
//   ID_AREA_PERMISO      -> jefe de esa área.
public sealed class PermisoAreaService(PermisosDbContext dbContext) : OracleRepository(dbContext), IPermisoAreaService
{
    // Contraseña con la que se crean o restablecen los usuarios locales; se pide cambiarla al entrar.
    private const string InitialPassword = "1234";
    // Cuenta que puede iniciar sesión hoy: activa y sin vencer (la misma condición del login).
    // Las vencidas no cuentan como jefes o administradores activos.
    private const string VigenteSql = """
        u.ESTADO = 'ACTIVO' AND (u.FECHA_EXPIRACION IS NULL OR u.FECHA_EXPIRACION >= TRUNC(SYSDATE))
        """;

    // Se lee en cada solicitud para que un cambio de nivel, área o departamento aplique de
    // inmediato, sin esperar a que el usuario vuelva a iniciar sesión. Lo mismo con el estado y
    // el vencimiento de la cuenta: un usuario desactivado o vencido deja de operar aunque su token
    // siga vigente.
    public async Task<PermisoAlcance> GetAlcance(int idUsuario, CancellationToken cancellationToken)
    {
        var rows = await ReadList($"""
            SELECT u.PERMISO_ADMIN, u.PERMISO_SECRETARIA,
                   u.ID_DEPTO_PERMISO, dd.ESTADO AS ESTADO_DEPTO,
                   u.ID_AREA_PERMISO, a.ESTADO AS ESTADO_AREA,
                   a.DEPARTAMENTO_IHSS_ID AS DEPTO_AREA, da.ESTADO AS ESTADO_DEPTO_AREA,
                   u.ID_EMPLEADO_PERMISO, emp.DEPARTAMENTO_IHSS_ID AS DEPTO_EMPLEADO,
                   emp.ESTADO AS ESTADO_EMPLEADO, de.ESTADO AS ESTADO_DEPTO_EMPLEADO, ae.ID_AREA AS AREA_EMPLEADO
            FROM USUARIOS_PERMISOS u
            LEFT JOIN PERMISO_DEPARTAMENTO dd ON dd.DEPARTAMENTO_IHSS_ID = u.ID_DEPTO_PERMISO
            LEFT JOIN PERMISO_AREA a ON a.ID_AREA = u.ID_AREA_PERMISO
            LEFT JOIN PERMISO_DEPARTAMENTO da ON da.DEPARTAMENTO_IHSS_ID = a.DEPARTAMENTO_IHSS_ID
            LEFT JOIN EMPLEADOS_IHSS emp ON emp.EMPLEADOS_IHSS_ID = u.ID_EMPLEADO_PERMISO
            LEFT JOIN PERMISO_DEPARTAMENTO de ON de.DEPARTAMENTO_IHSS_ID = emp.DEPARTAMENTO_IHSS_ID
            LEFT JOIN (SELECT ae.ID_EMPLEADO, ae.ID_AREA
                       FROM PERMISO_AREA_EMPLEADO ae
                       JOIN PERMISO_AREA aa ON aa.ID_AREA = ae.ID_AREA AND aa.ESTADO = 'ACTIVO') ae
                   ON ae.ID_EMPLEADO = u.ID_EMPLEADO_PERMISO
            WHERE u.ID_USUARIO = :idUsuario AND {VigenteSql}
            """, reader => new
            {
                EsAdmin = ReadNullableInt(reader, "PERMISO_ADMIN") == 1,
                EsSecretaria = ReadNullableInt(reader, "PERMISO_SECRETARIA") == 1,
                IdDepartamento = ReadNullableInt(reader, "ID_DEPTO_PERMISO"),
                EstadoDepartamento = ReadNullableString(reader, "ESTADO_DEPTO"),
                IdArea = ReadNullableInt(reader, "ID_AREA_PERMISO"),
                EstadoArea = ReadNullableString(reader, "ESTADO_AREA"),
                DepartamentoArea = ReadNullableInt(reader, "DEPTO_AREA"),
                EstadoDepartamentoArea = ReadNullableString(reader, "ESTADO_DEPTO_AREA"),
                IdEmpleado = ReadNullableInt(reader, "ID_EMPLEADO_PERMISO"),
                DepartamentoEmpleado = ReadNullableInt(reader, "DEPTO_EMPLEADO"),
                EstadoEmpleado = ReadNullableInt(reader, "ESTADO_EMPLEADO"),
                EstadoDepartamentoEmpleado = ReadNullableString(reader, "ESTADO_DEPTO_EMPLEADO"),
                AreaEmpleado = ReadNullableInt(reader, "AREA_EMPLEADO"),
            },
            cancellationToken, ("idUsuario", idUsuario));

        if (rows.Count == 0)
        {
            throw new UnauthorizedAccessException(
                "Tu usuario está inactivo o vencido, o no tiene acceso al control de permisos. Vuelve a iniciar sesión.");
        }
        var perfil = rows[0];
        if (perfil.EsAdmin) return new PermisoAlcance(idUsuario, PermisoValores.NivelAdmin, null, null);
        if (perfil.IdDepartamento is { } idDepartamento && perfil.EstadoDepartamento == PermisoValores.Activo)
        {
            var nivel = perfil.EsSecretaria ? PermisoValores.NivelSecretaria : PermisoValores.NivelAdminDepartamento;
            return new PermisoAlcance(idUsuario, nivel, idDepartamento, null);
        }
        if (perfil.IdArea is { } idArea && perfil.EstadoArea == PermisoValores.Activo
            && perfil.EstadoDepartamentoArea == PermisoValores.Activo)
        {
            return new PermisoAlcance(idUsuario, PermisoValores.NivelJefe, perfil.DepartamentoArea, idArea);
        }
        // Empleado: ve y registra solo lo suyo. Necesita estar activo y su departamento habilitado;
        // su área (la de los permisos que registra) puede faltar todavía.
        if (perfil.IdEmpleado is { } idEmpleado && perfil.EstadoEmpleado == 1
            && perfil.EstadoDepartamentoEmpleado == PermisoValores.Activo)
        {
            return new PermisoAlcance(
                idUsuario, PermisoValores.NivelUsuario, perfil.DepartamentoEmpleado, perfil.AreaEmpleado, idEmpleado);
        }

        throw new UnauthorizedAccessException(
            "Tu usuario no tiene un área ni un departamento activo en el control de permisos. Pide al administrador que te asigne uno.");
    }

    // Departamentos y áreas que el usuario puede ver, con la jornada efectiva y los feriados de
    // cada departamento (del año anterior al siguiente, para la vista previa de días hábiles).
    public async Task<PermisoSesionDto> GetSesion(PermisoAlcance alcance, CancellationToken cancellationToken)
    {
        var filtroDepto = alcance.VeTodo ? string.Empty : "WHERE pd.DEPARTAMENTO_IHSS_ID = :alcanceDepto";
        (string Name, object? Value)[] parametrosDepto = alcance.VeTodo ? [] : [("alcanceDepto", alcance.IdDepartamento)];
        // Una sola conexión para las cuatro consultas (ReadList no la cierra si ya estaba abierta).
        await DbContext.Database.OpenConnectionAsync(cancellationToken);
        try
        {
            var filas = await ReadList(PermisoParametros.Sql, PermisoParametros.Leer, cancellationToken);
            var anio = DateTime.Today.Year;
            var feriados = await ReadList("""
                SELECT DEPARTAMENTO_IHSS_ID, FECHA FROM PERMISO_FERIADO
                WHERE FECHA >= :desde AND FECHA < :hasta
                ORDER BY FECHA
                """, reader => (
                    IdDepartamento: ReadNullableInt(reader, "DEPARTAMENTO_IHSS_ID"),
                    Fecha: ReadDate(reader, "FECHA").ToString("yyyy-MM-dd", CultureInfo.InvariantCulture)),
                cancellationToken, ("desde", new DateTime(anio - 1, 1, 1)), ("hasta", new DateTime(anio + 2, 1, 1)));
            // Los generales (sin departamento) van en todos; los propios, solo en su departamento.
            var generales = feriados.Where(feriado => feriado.IdDepartamento is null).Select(feriado => feriado.Fecha).ToList();
            var propios = feriados.Where(feriado => feriado.IdDepartamento is not null)
                .ToLookup(feriado => feriado.IdDepartamento!.Value, feriado => feriado.Fecha);
            var departamentos = await ReadList($"""
                SELECT pd.DEPARTAMENTO_IHSS_ID, d.DEPARTAMENTO_IHSS_DESC AS NOMBRE, pd.ESTADO,
                       (SELECT COUNT(*) FROM PERMISO_AREA a
                        WHERE a.DEPARTAMENTO_IHSS_ID = pd.DEPARTAMENTO_IHSS_ID AND a.ESTADO = 'ACTIVO') AS AREAS,
                       (SELECT COUNT(*) FROM EMPLEADOS_IHSS e
                        WHERE e.DEPARTAMENTO_IHSS_ID = pd.DEPARTAMENTO_IHSS_ID AND e.ESTADO = 1) AS EMPLEADOS
                FROM PERMISO_DEPARTAMENTO pd
                JOIN DEPARTAMENTO_IHSS d ON d.DEPARTAMENTO_IHSS_ID = pd.DEPARTAMENTO_IHSS_ID
                {filtroDepto}
                ORDER BY UPPER(d.DEPARTAMENTO_IHSS_DESC)
                """, reader =>
                {
                    var idDepartamento = ReadInt(reader, "DEPARTAMENTO_IHSS_ID");
                    // Un parámetro mal escrito no debe dejar sin pantalla a todos: se muestra la jornada
                    // por defecto con un aviso. Registrar en ese departamento sigue fallando con el
                    // mismo mensaje hasta que se corrija, para no saltarse sus límites.
                    string? aviso = null;
                    PermisoParametros parametros;
                    try
                    {
                        parametros = PermisoParametros.Para(idDepartamento, filas);
                    }
                    catch (ArgumentException exception)
                    {
                        parametros = PermisoParametros.PorDefecto;
                        aviso = exception.Message;
                    }
                    return new PermisoDepartamentoDto(
                        idDepartamento,
                        ReadString(reader, "NOMBRE").Trim(),
                        ReadString(reader, "ESTADO").Trim().ToUpperInvariant(),
                        parametros.InicioJornada.ToString("HH:mm", CultureInfo.InvariantCulture),
                        parametros.FinJornada.ToString("HH:mm", CultureInfo.InvariantCulture),
                        parametros.MinutosJornada,
                        ReadInt(reader, "AREAS"),
                        ReadInt(reader, "EMPLEADOS"),
                        generales.Concat(propios[idDepartamento]).Order(StringComparer.Ordinal).ToList(),
                        aviso);
                },
                cancellationToken, parametrosDepto);

            var areas = await ReadList($"""
                SELECT a.ID_AREA, a.DEPARTAMENTO_IHSS_ID, a.NOMBRE, a.ESTADO,
                       (SELECT COUNT(*) FROM PERMISO_AREA_EMPLEADO ae
                        JOIN EMPLEADOS_IHSS e ON e.EMPLEADOS_IHSS_ID = ae.ID_EMPLEADO
                        WHERE ae.ID_AREA = a.ID_AREA AND e.ESTADO = 1
                          AND e.DEPARTAMENTO_IHSS_ID = a.DEPARTAMENTO_IHSS_ID) AS EMPLEADOS,
                       (SELECT COUNT(*) FROM USUARIOS_PERMISOS u
                        WHERE u.ID_AREA_PERMISO = a.ID_AREA AND {VigenteSql}) AS JEFES
                FROM PERMISO_AREA a
                {(alcance.FiltroArea("a.") is { } filtro ? $"WHERE {filtro}" : string.Empty)}
                ORDER BY UPPER(a.NOMBRE)
                """, reader => new PermisoAreaDto(
                    ReadInt(reader, "ID_AREA"),
                    ReadInt(reader, "DEPARTAMENTO_IHSS_ID"),
                    ReadString(reader, "NOMBRE"),
                    ReadString(reader, "ESTADO").Trim().ToUpperInvariant(),
                    ReadInt(reader, "EMPLEADOS"),
                    ReadInt(reader, "JEFES")),
                cancellationToken, alcance.ParametrosArea());

            return new PermisoSesionDto(
                alcance.Nivel,
                alcance.IdDepartamento,
                departamentos.FirstOrDefault(departamento => departamento.IdDepartamento == alcance.IdDepartamento)?.Nombre,
                alcance.IdArea,
                areas.FirstOrDefault(area => area.IdArea == alcance.IdArea)?.Nombre,
                departamentos,
                areas,
                alcance.IdEmpleado);
        }
        finally
        {
            await DbContext.Database.CloseConnectionAsync();
        }
    }

    // ---- Departamentos (administrador general) -------------------------------------------

    // Departamentos con empleados activos que todavía no usan el sistema, con su edificio y su
    // regional para filtrarlos. Igual que en el inventario, la regional es la del departamento o,
    // si no tiene, la de su edificio.
    public Task<IReadOnlyList<PermisoDepartamentoDisponibleDto>> GetDepartamentosDisponibles(CancellationToken cancellationToken) =>
        ReadList("""
            SELECT d.DEPARTAMENTO_IHSS_ID, d.DEPARTAMENTO_IHSS_DESC AS NOMBRE, COUNT(e.EMPLEADOS_IHSS_ID) AS EMPLEADOS,
                   b.EDIFICIO_ID, b.EDIFICIO_DESCRIPCION AS NOMBRE_EDIFICIO,
                   r.REGIONA_ID AS ID_REGIONAL, r.DESCRIPCION AS NOMBRE_REGIONAL
            FROM DEPARTAMENTO_IHSS d
            JOIN EMPLEADOS_IHSS e ON e.DEPARTAMENTO_IHSS_ID = d.DEPARTAMENTO_IHSS_ID AND e.ESTADO = 1
            LEFT JOIN EDIFICIO b ON b.EDIFICIO_ID = d.EDIFICIO_ID
            LEFT JOIN REGIONAL r ON r.REGIONA_ID = COALESCE(d.REGIONA_ID, b.REGIONA_ID)
            WHERE NOT EXISTS (SELECT 1 FROM PERMISO_DEPARTAMENTO pd WHERE pd.DEPARTAMENTO_IHSS_ID = d.DEPARTAMENTO_IHSS_ID)
            GROUP BY d.DEPARTAMENTO_IHSS_ID, d.DEPARTAMENTO_IHSS_DESC, b.EDIFICIO_ID, b.EDIFICIO_DESCRIPCION,
                     r.REGIONA_ID, r.DESCRIPCION
            ORDER BY UPPER(d.DEPARTAMENTO_IHSS_DESC)
            """, reader => new PermisoDepartamentoDisponibleDto(
                ReadInt(reader, "DEPARTAMENTO_IHSS_ID"),
                ReadString(reader, "NOMBRE").Trim(),
                ReadInt(reader, "EMPLEADOS"),
                ReadNullableInt(reader, "EDIFICIO_ID"),
                ReadNullableString(reader, "NOMBRE_EDIFICIO")?.Trim(),
                ReadNullableInt(reader, "ID_REGIONAL"),
                ReadNullableString(reader, "NOMBRE_REGIONAL")?.Trim()),
            cancellationToken);

    public Task AgregarDepartamento(int idDepartamento, CancellationToken cancellationToken) =>
        InTransaction(async (connection, transaction) =>
        {
            var existe = await Exists(connection, transaction,
                "SELECT 1 FROM DEPARTAMENTO_IHSS WHERE DEPARTAMENTO_IHSS_ID = :idDepartamento",
                cancellationToken, ("idDepartamento", idDepartamento));
            if (!existe) throw new ArgumentException("El departamento seleccionado no existe.");
            var habilitado = await Exists(connection, transaction,
                "SELECT 1 FROM PERMISO_DEPARTAMENTO WHERE DEPARTAMENTO_IHSS_ID = :idDepartamento",
                cancellationToken, ("idDepartamento", idDepartamento));
            if (habilitado) throw new ArgumentException("El departamento ya usa el control de permisos.");
            await Execute(connection, transaction, """
                INSERT INTO PERMISO_DEPARTAMENTO (DEPARTAMENTO_IHSS_ID, ESTADO) VALUES (:idDepartamento, 'ACTIVO')
                """, cancellationToken, ("idDepartamento", idDepartamento));
        }, cancellationToken);

    // Un departamento solo se desactiva sin áreas activas ni administradores, para que nadie
    // quede con un acceso a algo que ya no existe.
    public Task<bool> UpdateDepartamentoEstado(int idDepartamento, string estado, CancellationToken cancellationToken) =>
        InTransaction(async (connection, transaction) =>
        {
            if (estado == PermisoValores.Inactivo)
            {
                var areas = await GetScalar<int>(connection, transaction, """
                    SELECT COUNT(*) FROM PERMISO_AREA WHERE DEPARTAMENTO_IHSS_ID = :idDepartamento AND ESTADO = 'ACTIVO'
                    """, cancellationToken, ("idDepartamento", idDepartamento));
                var administradores = await GetScalar<int>(connection, transaction, $"""
                    SELECT COUNT(*) FROM USUARIOS_PERMISOS u WHERE u.ID_DEPTO_PERMISO = :idDepartamento AND {VigenteSql}
                    """, cancellationToken, ("idDepartamento", idDepartamento));
                if (areas > 0 || administradores > 0)
                {
                    throw new ArgumentException(
                        $"El departamento tiene {areas} área(s) activa(s) y {administradores} administrador(es). "
                        + "Desactiva sus áreas y quita sus administradores antes de desactivarlo.");
                }
            }

            return await Execute(connection, transaction, """
                UPDATE PERMISO_DEPARTAMENTO SET ESTADO = :estado WHERE DEPARTAMENTO_IHSS_ID = :idDepartamento
                """, cancellationToken, ("estado", estado), ("idDepartamento", idDepartamento)) == 1;
        }, cancellationToken);

    // ---- Áreas ---------------------------------------------------------------------------

    // El administrador de departamento siempre crea en el suyo; el general elige el departamento.
    public Task CreateArea(PermisoAlcance alcance, SavePermisoAreaDto area, CancellationToken cancellationToken) =>
        InTransaction(async (connection, transaction) =>
        {
            var idDepartamento = alcance.EsAdmin
                ? area.IdDepartamento ?? throw new ArgumentException("Selecciona el departamento del área.")
                : alcance.IdDepartamento!.Value;
            await ValidarDepartamentoActivo(connection, transaction, idDepartamento, cancellationToken);
            await ValidarNombreArea(connection, transaction, idDepartamento, area.Nombre, null, cancellationToken);
            var idArea = await NextId(connection, transaction, "PERMISO_AREA", "ID_AREA", cancellationToken);
            await Execute(connection, transaction, """
                INSERT INTO PERMISO_AREA (ID_AREA, DEPARTAMENTO_IHSS_ID, NOMBRE, ESTADO)
                VALUES (:idArea, :idDepartamento, :nombre, 'ACTIVO')
                """, cancellationToken,
                ("idArea", idArea), ("idDepartamento", idDepartamento), ("nombre", area.Nombre.Trim()));
        }, cancellationToken);

    // Un área solo se desactiva vacía: sin personal y sin jefe activo, para que nadie quede
    // con un área que ya no existe; y solo se activa si su departamento está activo. El
    // departamento de un área no cambia.
    public Task<bool> UpdateArea(PermisoAlcance alcance, int idArea, SavePermisoAreaDto area, CancellationToken cancellationToken) =>
        InTransaction(async (connection, transaction) =>
        {
            var idDepartamento = await GetScalar<int?>(connection, transaction,
                "SELECT DEPARTAMENTO_IHSS_ID FROM PERMISO_AREA WHERE ID_AREA = :idArea", cancellationToken, ("idArea", idArea));
            if (idDepartamento is not { } depto || !alcance.IncluyeArea(idArea, depto)) return false;

            await ValidarNombreArea(connection, transaction, depto, area.Nombre, idArea, cancellationToken);
            var estado = area.Estado?.Trim().ToUpperInvariant() ?? PermisoValores.Activo;
            if (estado == PermisoValores.Activo)
            {
                var departamentoActivo = await Exists(connection, transaction, """
                    SELECT 1 FROM PERMISO_DEPARTAMENTO WHERE DEPARTAMENTO_IHSS_ID = :idDepartamento AND ESTADO = 'ACTIVO'
                    """, cancellationToken, ("idDepartamento", depto));
                if (!departamentoActivo)
                {
                    throw new ArgumentException("El departamento de esta área está desactivado. Actívalo antes de activar el área.");
                }
            }
            else
            {
                // Los trasladados a otro departamento no cuentan: ya no aparecen en el área.
                var empleados = await GetScalar<int>(connection, transaction, """
                    SELECT COUNT(*) FROM PERMISO_AREA_EMPLEADO ae
                    JOIN PERMISO_AREA a ON a.ID_AREA = ae.ID_AREA
                    JOIN EMPLEADOS_IHSS e ON e.EMPLEADOS_IHSS_ID = ae.ID_EMPLEADO
                    WHERE ae.ID_AREA = :idArea AND e.ESTADO = 1 AND e.DEPARTAMENTO_IHSS_ID = a.DEPARTAMENTO_IHSS_ID
                    """, cancellationToken, ("idArea", idArea));
                var jefes = await GetScalar<int>(connection, transaction, $"""
                    SELECT COUNT(*) FROM USUARIOS_PERMISOS u WHERE u.ID_AREA_PERMISO = :idArea AND {VigenteSql}
                    """, cancellationToken, ("idArea", idArea));
                if (empleados > 0 || jefes > 0)
                {
                    throw new ArgumentException(
                        $"El área tiene {empleados} empleado(s) y {jefes} jefe(s) activo(s). "
                        + "Muévelos a otra área o quítales el acceso antes de desactivarla.");
                }
            }

            return await Execute(connection, transaction, """
                UPDATE PERMISO_AREA SET NOMBRE = :nombre, ESTADO = :estado WHERE ID_AREA = :idArea
                """, cancellationToken, ("nombre", area.Nombre.Trim()), ("estado", estado), ("idArea", idArea)) == 1;
        }, cancellationToken);

    // ---- Logos de los formatos -----------------------------------------------------------

    public Task<IReadOnlyList<PermisoLogoDto>> GetLogos(CancellationToken cancellationToken) =>
        ReadList("""
            SELECT CLAVE, TIPO_MIME, IMAGEN
            FROM PERMISO_LOGO
            ORDER BY CLAVE
            """, reader => new PermisoLogoDto(
                ReadString(reader, "CLAVE").Trim(),
                ReadString(reader, "TIPO_MIME").Trim(),
                Convert.ToBase64String(ReadBytes(reader, "IMAGEN"))),
            cancellationToken);

    // ---- Usuarios ------------------------------------------------------------------------

    // El general ve a todos; el de departamento, a los jefes de sus áreas y a los administradores
    // de su departamento.
    public Task<IReadOnlyList<PermisoJefeDto>> GetJefes(PermisoAlcance alcance, CancellationToken cancellationToken) =>
        ReadList($"""
            SELECT u.ID_USUARIO, u.USUARIO, u.NOMBRE_PERSONA, u.PERMISO_ADMIN, u.PERMISO_SECRETARIA,
                   u.ID_DEPTO_PERMISO, u.ID_AREA_PERMISO, a.NOMBRE AS NOMBRE_AREA,
                   NVL(NVL(u.ID_DEPTO_PERMISO, a.DEPARTAMENTO_IHSS_ID), emp.DEPARTAMENTO_IHSS_ID) AS ID_DEPARTAMENTO,
                   d.DEPARTAMENTO_IHSS_DESC AS NOMBRE_DEPARTAMENTO,
                   u.ID_EMPLEADO_PERMISO, emp.NOMBRE_EMPLEADO,
                   u.ESTADO, u.DOMINIO, u.DOMINIOP
            FROM USUARIOS_PERMISOS u
            LEFT JOIN PERMISO_AREA a ON a.ID_AREA = u.ID_AREA_PERMISO
            LEFT JOIN EMPLEADOS_IHSS emp ON emp.EMPLEADOS_IHSS_ID = u.ID_EMPLEADO_PERMISO
            LEFT JOIN DEPARTAMENTO_IHSS d
                   ON d.DEPARTAMENTO_IHSS_ID = NVL(NVL(u.ID_DEPTO_PERMISO, a.DEPARTAMENTO_IHSS_ID), emp.DEPARTAMENTO_IHSS_ID)
            {(alcance.EsAdmin ? string.Empty : """
                WHERE a.DEPARTAMENTO_IHSS_ID = :alcanceDepto OR u.ID_DEPTO_PERMISO = :alcanceDepto
                   OR emp.DEPARTAMENTO_IHSS_ID = :alcanceDepto
                """)}
            ORDER BY UPPER(u.NOMBRE_PERSONA), u.USUARIO
            """, reader => new PermisoJefeDto(
                ReadInt(reader, "ID_USUARIO"),
                ReadString(reader, "USUARIO"),
                ReadString(reader, "NOMBRE_PERSONA"),
                NivelDe(reader),
                ReadNullableInt(reader, "ID_DEPARTAMENTO"),
                ReadNullableString(reader, "NOMBRE_DEPARTAMENTO")?.Trim(),
                ReadNullableInt(reader, "ID_AREA_PERMISO"),
                ReadNullableString(reader, "NOMBRE_AREA"),
                ReadString(reader, "ESTADO").Trim().ToUpperInvariant(),
                ReadNullableInt(reader, "DOMINIO") ?? 0,
                ReadString(reader, "DOMINIOP").Trim(),
                ReadNullableInt(reader, "ID_EMPLEADO_PERMISO"),
                ReadNullableString(reader, "NOMBRE_EMPLEADO")?.Trim()),
            cancellationToken, alcance.EsAdmin ? [] : [("alcanceDepto", alcance.IdDepartamento)]);

    // Crea un usuario del control de permisos.
    public Task CreateJefe(PermisoAlcance alcance, SavePermisoJefeDto jefe, CancellationToken cancellationToken) =>
        InTransaction(async (connection, transaction) =>
        {
            await ValidarUsuario(connection, transaction, jefe.Usuario, null, cancellationToken);
            var perfil = await ValidarNivel(connection, transaction, alcance, jefe, cancellationToken);
            var idUsuario = await NextId(connection, transaction, "USUARIOS_PERMISOS", "ID_USUARIO", cancellationToken);
            await Execute(connection, transaction, """
                INSERT INTO USUARIOS_PERMISOS
                    (ID_USUARIO, USUARIO, NOMBRE_PERSONA, FECHA_EXPIRACION, ESTADO,
                     PASSWORD_HASH, DOMINIOP, DOMINIO, CLAVE_SEGURA,
                     PERMISO_ADMIN, ID_DEPTO_PERMISO, ID_AREA_PERMISO, PERMISO_SECRETARIA, ID_EMPLEADO_PERMISO)
                VALUES
                    (:idUsuario, :usuario, :nombrePersona, NULL, 'ACTIVO',
                     :passwordHash, :dominioP, :dominio, '0',
                     :permisoAdmin, :idDepto, :idArea, :secretaria, :idEmpleadoPerfil)
                """, cancellationToken,
                [("idUsuario", idUsuario), ("usuario", jefe.Usuario.Trim()),
                 ("nombrePersona", jefe.NombrePersona.Trim()),
                 ("passwordHash", PasswordHashing.Hash(InitialPassword)),
                 ("dominioP", jefe.DominioP.Trim().ToUpperInvariant()), ("dominio", jefe.Dominio),
                 .. perfil.Parametros()]);
        }, cancellationToken);

    // Cuenta, estado y nivel del usuario. Nadie puede cambiar su propio nivel ni desactivarse.
    public Task<bool> UpdateJefe(PermisoAlcance alcance, int idUsuario, SavePermisoJefeDto jefe, CancellationToken cancellationToken) =>
        InTransaction(async (connection, transaction) =>
        {
            var estado = jefe.Estado?.Trim().ToUpperInvariant() ?? PermisoValores.Activo;
            if (idUsuario == alcance.IdUsuario && (jefe.Nivel != alcance.Nivel || estado != PermisoValores.Activo))
            {
                throw new ArgumentException("No puedes cambiar tu propio nivel de acceso ni desactivar tu usuario.");
            }

            var actual = await LeerUsuario(connection, transaction, idUsuario, cancellationToken);
            if (actual is null) return false;
            // Un usuario sin nivel lo puede tomar cualquier administrador; uno con nivel, solo quien lo administra.
            if (actual.Nivel is not null && !Administra(alcance, actual)) return false;
            var perfil = await ValidarNivel(connection, transaction, alcance, jefe, cancellationToken, idUsuario);
            await ValidarUsuario(connection, transaction, jefe.Usuario, idUsuario, cancellationToken);
            // Una cuenta de dominio que pasa a local no conserva la contraseña guardada (puede ser la
            // inicial sin obligación de cambiarla): queda con 1234 y se le pide cambiarla al entrar.
            // En el SET de Oracle, DOMINIO del CASE es el valor anterior a esta actualización.
            return await Execute(connection, transaction, """
                UPDATE USUARIOS_PERMISOS
                SET USUARIO = :usuario,
                    NOMBRE_PERSONA = :nombrePersona,
                    ESTADO = :estado,
                    DOMINIOP = :dominioP,
                    PASSWORD_HASH = CASE WHEN DOMINIO = 1 AND :dominio = 0 THEN :passwordHash ELSE PASSWORD_HASH END,
                    CLAVE_SEGURA = CASE WHEN DOMINIO = 1 AND :dominio = 0 THEN '0' ELSE CLAVE_SEGURA END,
                    DOMINIO = :dominio,
                    PERMISO_ADMIN = :permisoAdmin,
                    ID_DEPTO_PERMISO = :idDepto,
                    ID_AREA_PERMISO = :idArea,
                    PERMISO_SECRETARIA = :secretaria,
                    ID_EMPLEADO_PERMISO = :idEmpleadoPerfil
                WHERE ID_USUARIO = :idUsuario
                """, cancellationToken,
                [("usuario", jefe.Usuario.Trim()), ("nombrePersona", jefe.NombrePersona.Trim()),
                 ("estado", estado), ("dominioP", jefe.DominioP.Trim().ToUpperInvariant()), ("dominio", jefe.Dominio),
                 ("passwordHash", PasswordHashing.Hash(InitialPassword)),
                 .. perfil.Parametros(), ("idUsuario", idUsuario)]) == 1;
        }, cancellationToken);

    // Solo los usuarios locales; los de dominio usan su contraseña de Active Directory.
    public Task<bool> ResetJefePassword(PermisoAlcance alcance, int idUsuario, CancellationToken cancellationToken) =>
        InTransaction(async (connection, transaction) =>
        {
            var actual = await LeerUsuario(connection, transaction, idUsuario, cancellationToken);
            if (actual is null || !Administra(alcance, actual)) return false;
            return await Execute(connection, transaction, """
                UPDATE USUARIOS_PERMISOS
                SET PASSWORD_HASH = :passwordHash,
                    CLAVE_SEGURA = '0'
                WHERE ID_USUARIO = :idUsuario
                  AND DOMINIO = 0
                """, cancellationToken,
                ("passwordHash", PasswordHashing.Hash(InitialPassword)), ("idUsuario", idUsuario)) == 1;
        }, cancellationToken);

    // Borra la cuenta. Los permisos no guardan quién los registró, así que no queda nada colgado.
    // Nadie se elimina a sí mismo (así siempre queda al menos un administrador general).
    public Task<bool> DeleteJefe(PermisoAlcance alcance, int idUsuario, CancellationToken cancellationToken) =>
        InTransaction(async (connection, transaction) =>
        {
            if (idUsuario == alcance.IdUsuario) throw new ArgumentException("No puedes eliminar tu propio usuario.");
            var actual = await LeerUsuario(connection, transaction, idUsuario, cancellationToken);
            if (actual is null || (actual.Nivel is not null && !Administra(alcance, actual))) return false;
            return await Execute(connection, transaction, """
                DELETE FROM USUARIOS_PERMISOS WHERE ID_USUARIO = :idUsuario
                """, cancellationToken, ("idUsuario", idUsuario)) == 1;
        }, cancellationToken);

    // ---- Reglas --------------------------------------------------------------------------

    // Solo el administrador general asigna administradores generales (el sistema lo administran
    // varias personas) y jefes de departamento; el jefe de departamento solo nombra jefes de las
    // áreas de su departamento. La consulta ya no se asigna. Devuelve las columnas de perfil a guardar.
    internal static async Task<Perfil> ValidarNivel(
        DbConnection connection,
        DbTransaction transaction,
        PermisoAlcance alcance,
        SavePermisoJefeDto jefe,
        CancellationToken cancellationToken,
        int? idUsuarioActual = null)
    {
        // El de departamento solo nombra a los suyos: jefes de sus áreas, su secretaría y los
        // empleados de su departamento.
        if (!alcance.EsAdmin
            && jefe.Nivel is not (PermisoValores.NivelJefe or PermisoValores.NivelSecretaria or PermisoValores.NivelUsuario))
        {
            throw new UnauthorizedAccessException("Solo el administrador general asigna administradores generales y jefes de departamento.");
        }

        switch (jefe.Nivel)
        {
            case PermisoValores.NivelAdmin:
                return new Perfil(1, null, null);
            case PermisoValores.NivelConsulta:
                throw new ArgumentException("El nivel de consulta ya no se asigna.");
            case PermisoValores.NivelSecretaria:
                var idDepartamentoSecretaria = jefe.IdDepartamento
                    ?? throw new ArgumentException("Selecciona el departamento de la secretaría.");
                if (!alcance.EsAdmin && idDepartamentoSecretaria != alcance.IdDepartamento)
                {
                    throw new UnauthorizedAccessException("Solo puedes nombrar la secretaría de tu departamento.");
                }
                await ValidarDepartamentoActivo(connection, transaction, idDepartamentoSecretaria, cancellationToken);
                return new Perfil(0, idDepartamentoSecretaria, null, 1);
            case PermisoValores.NivelAdminDepartamento:
                var idDepartamento = jefe.IdDepartamento ?? throw new ArgumentException("Selecciona el departamento que administra.");
                await ValidarDepartamentoActivo(connection, transaction, idDepartamento, cancellationToken);
                return new Perfil(0, idDepartamento, null);
            // Empleado: la cuenta queda atada a su ficha, y solo ve y registra lo suyo.
            case PermisoValores.NivelUsuario:
                var idEmpleado = jefe.IdEmpleado ?? throw new ArgumentException("Selecciona al empleado de la cuenta.");
                var empleado = await ReadRows(connection, transaction, """
                    SELECT e.DEPARTAMENTO_IHSS_ID
                    FROM EMPLEADOS_IHSS e
                    JOIN PERMISO_DEPARTAMENTO pd ON pd.DEPARTAMENTO_IHSS_ID = e.DEPARTAMENTO_IHSS_ID
                    WHERE e.EMPLEADOS_IHSS_ID = :idEmpleado AND e.ESTADO = 1 AND pd.ESTADO = 'ACTIVO'
                    """, reader => ReadInt(reader, "DEPARTAMENTO_IHSS_ID"), cancellationToken, ("idEmpleado", idEmpleado));
                if (empleado.Count == 0)
                {
                    throw new ArgumentException("El empleado no está activo o su departamento no usa el sistema.");
                }
                if (!alcance.EsAdmin && empleado[0] != alcance.IdDepartamento)
                {
                    throw new UnauthorizedAccessException("Solo puedes crear cuentas de los empleados de tu departamento.");
                }
                var repetido = await ReadRows(connection, transaction, """
                    SELECT USUARIO FROM USUARIOS_PERMISOS
                    WHERE ID_EMPLEADO_PERMISO = :idEmpleado AND ID_USUARIO <> :idUsuario AND ROWNUM = 1
                    """, reader => ReadString(reader, "USUARIO"), cancellationToken,
                    ("idEmpleado", idEmpleado), ("idUsuario", idUsuarioActual ?? 0));
                if (repetido.Count > 0)
                {
                    throw new ArgumentException($"Ese empleado ya tiene la cuenta {repetido[0].Trim()}.");
                }
                return new Perfil(0, null, null, 0, idEmpleado);
            default:
                var idArea = jefe.IdArea ?? throw new ArgumentException("Selecciona el área del jefe.");
                var area = await ReadRows(connection, transaction, """
                    SELECT a.DEPARTAMENTO_IHSS_ID
                    FROM PERMISO_AREA a
                    JOIN PERMISO_DEPARTAMENTO pd ON pd.DEPARTAMENTO_IHSS_ID = a.DEPARTAMENTO_IHSS_ID
                    WHERE a.ID_AREA = :idArea AND a.ESTADO = 'ACTIVO' AND pd.ESTADO = 'ACTIVO'
                    """, reader => ReadInt(reader, "DEPARTAMENTO_IHSS_ID"), cancellationToken, ("idArea", idArea));
                if (area.Count == 0) throw new ArgumentException("El área seleccionada no existe o está desactivada.");
                if (!alcance.IncluyeArea(idArea, area[0]))
                {
                    throw new UnauthorizedAccessException("Solo puedes nombrar jefes de las áreas de tu departamento.");
                }
                return new Perfil(0, null, idArea);
        }
    }

    // El general administra a todos; el de departamento, a los jefes de sus áreas y a la
    // secretaría de su departamento.
    private static bool Administra(PermisoAlcance alcance, UsuarioPermiso usuario) =>
        alcance.EsAdmin
        || (alcance.Nivel == PermisoValores.NivelAdminDepartamento
            && ((usuario.Nivel == PermisoValores.NivelJefe && usuario.IdDepartamentoArea == alcance.IdDepartamento)
                || (usuario.Nivel == PermisoValores.NivelSecretaria && usuario.IdDepartamento == alcance.IdDepartamento)
                || (usuario.Nivel == PermisoValores.NivelUsuario && usuario.IdDepartamentoEmpleado == alcance.IdDepartamento)));

    private static async Task<UsuarioPermiso?> LeerUsuario(
        DbConnection connection,
        DbTransaction transaction,
        int idUsuario,
        CancellationToken cancellationToken)
    {
        var filas = await ReadRows(connection, transaction, """
            SELECT u.PERMISO_ADMIN, u.PERMISO_SECRETARIA, u.ID_DEPTO_PERMISO, u.ID_AREA_PERMISO,
                   u.ID_EMPLEADO_PERMISO, a.DEPARTAMENTO_IHSS_ID AS DEPTO_AREA,
                   emp.DEPARTAMENTO_IHSS_ID AS DEPTO_EMPLEADO
            FROM USUARIOS_PERMISOS u
            LEFT JOIN PERMISO_AREA a ON a.ID_AREA = u.ID_AREA_PERMISO
            LEFT JOIN EMPLEADOS_IHSS emp ON emp.EMPLEADOS_IHSS_ID = u.ID_EMPLEADO_PERMISO
            WHERE u.ID_USUARIO = :idUsuario
            """, reader => new UsuarioPermiso(
                NivelDe(reader) is { Length: > 0 } nivel ? nivel : null,
                ReadNullableInt(reader, "DEPTO_AREA"),
                ReadNullableInt(reader, "ID_DEPTO_PERMISO"),
                ReadNullableInt(reader, "DEPTO_EMPLEADO")),
            cancellationToken, ("idUsuario", idUsuario));
        return filas.Count == 0 ? null : filas[0];
    }

    // Nivel a partir de las columnas de perfil; vacío si el usuario no tiene ninguno.
    private static string NivelDe(DbDataReader reader)
    {
        if (ReadNullableInt(reader, "PERMISO_ADMIN") == 1) return PermisoValores.NivelAdmin;
        if (ReadNullableInt(reader, "ID_DEPTO_PERMISO") is not null)
        {
            return ReadNullableInt(reader, "PERMISO_SECRETARIA") == 1
                ? PermisoValores.NivelSecretaria
                : PermisoValores.NivelAdminDepartamento;
        }
        if (ReadNullableInt(reader, "ID_AREA_PERMISO") is not null) return PermisoValores.NivelJefe;
        return ReadNullableInt(reader, "ID_EMPLEADO_PERMISO") is not null ? PermisoValores.NivelUsuario : string.Empty;
    }

    private static async Task ValidarDepartamentoActivo(
        DbConnection connection,
        DbTransaction transaction,
        int idDepartamento,
        CancellationToken cancellationToken)
    {
        var activo = await Exists(connection, transaction, """
            SELECT 1 FROM PERMISO_DEPARTAMENTO WHERE DEPARTAMENTO_IHSS_ID = :idDepartamento AND ESTADO = 'ACTIVO'
            """, cancellationToken, ("idDepartamento", idDepartamento));
        if (!activo) throw new ArgumentException("El departamento seleccionado no usa el control de permisos o está desactivado.");
    }

    // El nombre se repite solo entre departamentos distintos.
    private static async Task ValidarNombreArea(
        DbConnection connection,
        DbTransaction transaction,
        int idDepartamento,
        string nombre,
        int? idArea,
        CancellationToken cancellationToken)
    {
        var repetida = await Exists(connection, transaction, """
            SELECT 1 FROM PERMISO_AREA
            WHERE DEPARTAMENTO_IHSS_ID = :idDepartamento
              AND UPPER(TRIM(NOMBRE)) = UPPER(TRIM(:nombre))
              AND ID_AREA <> :idArea
            """, cancellationToken, ("idDepartamento", idDepartamento), ("nombre", nombre), ("idArea", idArea ?? 0));
        if (repetida) throw new ArgumentException("Ya existe un área con ese nombre en el departamento.");
    }

    // El nombre de usuario no se repite (sin distinguir mayúsculas ni espacios) porque el login busca por él.
    private static async Task ValidarUsuario(
        DbConnection connection,
        DbTransaction transaction,
        string usuario,
        int? idUsuario,
        CancellationToken cancellationToken)
    {
        var repetido = await Exists(connection, transaction, """
            SELECT 1 FROM USUARIOS_PERMISOS
            WHERE LOWER(TRIM(USUARIO)) = LOWER(TRIM(:usuario)) AND ID_USUARIO <> :idUsuario
            """, cancellationToken, ("usuario", usuario), ("idUsuario", idUsuario ?? 0));
        if (repetido) throw new ArgumentException("Ya existe un usuario con ese nombre.");
    }

    // Columnas de perfil de USUARIOS_PERMISOS para un nivel (solo una queda con valor).
    internal sealed record Perfil(int PermisoAdmin, int? IdDepartamento, int? IdArea, int PermisoSecretaria = 0, int? IdEmpleado = null)
    {
        public (string Name, object? Value)[] Parametros() =>
            [("permisoAdmin", PermisoAdmin), ("idDepto", IdDepartamento), ("idArea", IdArea),
             ("secretaria", PermisoSecretaria), ("idEmpleadoPerfil", IdEmpleado)];
    }

    // Usuario existente: su nivel, el departamento de su área y el que administra (o del que es
    // secretaría), para saber quién puede editarlo.
    private sealed record UsuarioPermiso(string? Nivel, int? IdDepartamentoArea, int? IdDepartamento, int? IdDepartamentoEmpleado);
}
