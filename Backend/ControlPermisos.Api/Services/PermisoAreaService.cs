using System.Data.Common;
using System.Globalization;
using ControlPermisos.Api.Data;
using ControlPermisos.Api.Models;

namespace ControlPermisos.Api.Services;

// Departamentos, áreas (jefaturas) y usuarios del Control de permisos. El acceso no depende del
// rol sino del perfil, con un solo nivel por usuario:
//   USUARIOS.PERMISO_ADMIN = 1    -> administrador general (todos los departamentos).
//   USUARIOS.ID_DEPTO_PERMISO     -> administrador de ese departamento.
//   USUARIOS.ID_AREA_PERMISO      -> jefe de esa área.
//   USUARIOS.PERMISO_CONSULTA = 1 -> consulta: ve y exporta todo, no modifica nada.
// Así una cuenta de inventario también puede tener acceso; las cuentas con rol 'Permisos' son
// las que solo usan este sistema.
public sealed class PermisoAreaService(PermisosDbContext dbContext) : OracleRepository(dbContext), IPermisoAreaService
{
    // Contraseña con la que se crean o restablecen los usuarios locales; se pide cambiarla al entrar.
    private const string InitialPassword = "1234";
    // Usuarios con acceso a permisos (o cuentas propias del sistema aunque hoy no tengan nivel).
    private const string ConAccesoSql = """
        (u.ROL = 'Permisos' OR u.PERMISO_ADMIN = 1 OR u.PERMISO_CONSULTA = 1
         OR u.ID_DEPTO_PERMISO IS NOT NULL OR u.ID_AREA_PERMISO IS NOT NULL)
        """;

    // Se lee en cada solicitud para que un cambio de nivel, área o departamento aplique de
    // inmediato, sin esperar a que el usuario vuelva a iniciar sesión. Lo mismo con el estado y
    // el vencimiento de la cuenta: un usuario desactivado o vencido deja de operar aunque su token
    // siga vigente.
    public async Task<PermisoAlcance> GetAlcance(int idUsuario, CancellationToken cancellationToken)
    {
        var rows = await ReadList("""
            SELECT u.PERMISO_ADMIN, u.PERMISO_CONSULTA,
                   u.ID_DEPTO_PERMISO, dd.ESTADO AS ESTADO_DEPTO,
                   u.ID_AREA_PERMISO, a.ESTADO AS ESTADO_AREA,
                   a.DEPARTAMENTO_IHSS_ID AS DEPTO_AREA, da.ESTADO AS ESTADO_DEPTO_AREA
            FROM USUARIOS u
            LEFT JOIN PERMISO_DEPARTAMENTO dd ON dd.DEPARTAMENTO_IHSS_ID = u.ID_DEPTO_PERMISO
            LEFT JOIN PERMISO_AREA a ON a.ID_AREA = u.ID_AREA_PERMISO
            LEFT JOIN PERMISO_DEPARTAMENTO da ON da.DEPARTAMENTO_IHSS_ID = a.DEPARTAMENTO_IHSS_ID
            WHERE u.ID_USUARIO = :idUsuario
              AND UPPER(u.ESTADO) = 'ACTIVO'
              AND (u.FECHA_EXPIRACION IS NULL OR u.FECHA_EXPIRACION >= TRUNC(SYSDATE))
            """, reader => new
            {
                EsAdmin = ReadNullableInt(reader, "PERMISO_ADMIN") == 1,
                EsConsulta = ReadNullableInt(reader, "PERMISO_CONSULTA") == 1,
                IdDepartamento = ReadNullableInt(reader, "ID_DEPTO_PERMISO"),
                EstadoDepartamento = ReadNullableString(reader, "ESTADO_DEPTO"),
                IdArea = ReadNullableInt(reader, "ID_AREA_PERMISO"),
                EstadoArea = ReadNullableString(reader, "ESTADO_AREA"),
                DepartamentoArea = ReadNullableInt(reader, "DEPTO_AREA"),
                EstadoDepartamentoArea = ReadNullableString(reader, "ESTADO_DEPTO_AREA"),
            },
            cancellationToken, ("idUsuario", idUsuario));

        if (rows.Count == 0)
        {
            throw new UnauthorizedAccessException(
                "Tu usuario está inactivo o vencido, o no tiene acceso al control de permisos. Vuelve a iniciar sesión.");
        }
        var perfil = rows[0];
        if (perfil.EsAdmin) return new PermisoAlcance(idUsuario, PermisoValores.NivelAdmin, null, null);
        if (perfil.EsConsulta) return new PermisoAlcance(idUsuario, PermisoValores.NivelConsulta, null, null);
        if (perfil.IdDepartamento is { } idDepartamento && perfil.EstadoDepartamento == PermisoValores.Activo)
        {
            return new PermisoAlcance(idUsuario, PermisoValores.NivelAdminDepartamento, idDepartamento, null);
        }
        if (perfil.IdArea is { } idArea && perfil.EstadoArea == PermisoValores.Activo
            && perfil.EstadoDepartamentoArea == PermisoValores.Activo)
        {
            return new PermisoAlcance(idUsuario, PermisoValores.NivelJefe, perfil.DepartamentoArea, idArea);
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
        var filas = await ReadList(PermisoParametros.Sql, PermisoParametros.Leer, cancellationToken);
        var anio = DateTime.Today.Year;
        var feriados = await ReadList("""
            SELECT DEPARTAMENTO_IHSS_ID, FECHA FROM PERMISO_FERIADO
            WHERE FECHA >= :desde AND FECHA < :hasta
            ORDER BY FECHA
            """, reader => (
                IdDepartamento: ReadNullableInt(reader, "DEPARTAMENTO_IHSS_ID"),
                Fecha: Convert.ToDateTime(reader.GetValue(reader.GetOrdinal("FECHA")), CultureInfo.InvariantCulture)
                    .ToString("yyyy-MM-dd", CultureInfo.InvariantCulture)),
            cancellationToken, ("desde", new DateTime(anio - 1, 1, 1)), ("hasta", new DateTime(anio + 2, 1, 1)));
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
                    feriados.Where(feriado => feriado.IdDepartamento is null || feriado.IdDepartamento == idDepartamento)
                        .Select(feriado => feriado.Fecha).ToList(),
                    aviso);
            },
            cancellationToken, parametrosDepto);

        var areas = await ReadList($"""
            SELECT a.ID_AREA, a.DEPARTAMENTO_IHSS_ID, a.NOMBRE, a.ESTADO,
                   (SELECT COUNT(*) FROM PERMISO_AREA_EMPLEADO ae
                    JOIN EMPLEADOS_IHSS e ON e.EMPLEADOS_IHSS_ID = ae.ID_EMPLEADO
                    WHERE ae.ID_AREA = a.ID_AREA AND e.ESTADO = 1
                      AND e.DEPARTAMENTO_IHSS_ID = a.DEPARTAMENTO_IHSS_ID) AS EMPLEADOS,
                   (SELECT COUNT(*) FROM USUARIOS u
                    WHERE u.ID_AREA_PERMISO = a.ID_AREA AND UPPER(u.ESTADO) = 'ACTIVO') AS JEFES
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
            areas);
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
                var administradores = await GetScalar<int>(connection, transaction, """
                    SELECT COUNT(*) FROM USUARIOS WHERE ID_DEPTO_PERMISO = :idDepartamento AND UPPER(ESTADO) = 'ACTIVO'
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
                var jefes = await GetScalar<int>(connection, transaction, """
                    SELECT COUNT(*) FROM USUARIOS WHERE ID_AREA_PERMISO = :idArea AND UPPER(ESTADO) = 'ACTIVO'
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

    // ---- Usuarios ------------------------------------------------------------------------

    // El general ve a todos; el de departamento, a los jefes de sus áreas y a los administradores
    // de su departamento.
    public Task<IReadOnlyList<PermisoJefeDto>> GetJefes(PermisoAlcance alcance, CancellationToken cancellationToken) =>
        ReadList($"""
            SELECT u.ID_USUARIO, u.USUARIO, u.NOMBRE_PERSONA, u.ROL, u.PERMISO_ADMIN, u.PERMISO_CONSULTA,
                   u.ID_DEPTO_PERMISO, u.ID_AREA_PERMISO, a.NOMBRE AS NOMBRE_AREA,
                   NVL(u.ID_DEPTO_PERMISO, a.DEPARTAMENTO_IHSS_ID) AS ID_DEPARTAMENTO,
                   d.DEPARTAMENTO_IHSS_DESC AS NOMBRE_DEPARTAMENTO,
                   u.ESTADO, u.DOMINIO, u.DOMINIOP
            FROM USUARIOS u
            LEFT JOIN PERMISO_AREA a ON a.ID_AREA = u.ID_AREA_PERMISO
            LEFT JOIN DEPARTAMENTO_IHSS d ON d.DEPARTAMENTO_IHSS_ID = NVL(u.ID_DEPTO_PERMISO, a.DEPARTAMENTO_IHSS_ID)
            WHERE {ConAccesoSql}
            {(alcance.EsAdmin ? string.Empty : "AND (a.DEPARTAMENTO_IHSS_ID = :alcanceDepto OR u.ID_DEPTO_PERMISO = :alcanceDepto)")}
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
                EsSoloPermisos(ReadString(reader, "ROL"))),
            cancellationToken, alcance.EsAdmin ? [] : [("alcanceDepto", alcance.IdDepartamento)]);

    // Crea una cuenta que solo usa el control de permisos (rol 'Permisos').
    public Task CreateJefe(PermisoAlcance alcance, SavePermisoJefeDto jefe, CancellationToken cancellationToken) =>
        InTransaction(async (connection, transaction) =>
        {
            await ValidarUsuario(connection, transaction, jefe.Usuario, null, cancellationToken);
            var perfil = await ValidarNivel(connection, transaction, alcance, jefe, null, cancellationToken);
            var idUsuario = await NextId(connection, transaction, "USUARIOS", "ID_USUARIO", cancellationToken);
            await Execute(connection, transaction, """
                INSERT INTO USUARIOS
                    (ID_USUARIO, USUARIO, NOMBRE_PERSONA, FECHA_EXPIRACION, ESTADO,
                     PASSWORD_HASH, ROL, DOMINIOP, DOMINIO, CLAVE_SEGURA,
                     PERMISO_ADMIN, PERMISO_CONSULTA, ID_DEPTO_PERMISO, ID_AREA_PERMISO)
                VALUES
                    (:idUsuario, :usuario, :nombrePersona, NULL, 'ACTIVO',
                     :passwordHash, 'Permisos', :dominioP, :dominio, '0',
                     :permisoAdmin, :permisoConsulta, :idDepto, :idArea)
                """, cancellationToken,
                [("idUsuario", idUsuario), ("usuario", jefe.Usuario.Trim()),
                 ("nombrePersona", jefe.NombrePersona.Trim()),
                 ("passwordHash", PasswordHashing.Hash(InitialPassword)),
                 ("dominioP", jefe.DominioP.Trim().ToUpperInvariant()), ("dominio", jefe.Dominio),
                 .. perfil.Parametros()]);
        }, cancellationToken);

    // En una cuenta propia de permisos se edita todo. En una cuenta de inventario solo el nivel,
    // el departamento y el área: su usuario, contraseña y estado se administran en inventario
    // (así también se le da acceso a una cuenta de inventario que no lo tenía). Nadie puede
    // cambiar su propio nivel ni desactivarse.
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
            // Un usuario sin nivel (nuevo acceso de una cuenta de inventario) lo puede tomar cualquier
            // administrador; uno con nivel, solo quien lo administra.
            if (actual.Nivel is not null && !Administra(alcance, actual)) return false;
            var perfil = await ValidarNivel(connection, transaction, alcance, jefe, actual.Nivel, cancellationToken);

            if (!actual.SoloPermisos)
            {
                return await Execute(connection, transaction, """
                    UPDATE USUARIOS
                    SET PERMISO_ADMIN = :permisoAdmin,
                        PERMISO_CONSULTA = :permisoConsulta,
                        ID_DEPTO_PERMISO = :idDepto,
                        ID_AREA_PERMISO = :idArea
                    WHERE ID_USUARIO = :idUsuario
                    """, cancellationToken, [.. perfil.Parametros(), ("idUsuario", idUsuario)]) == 1;
            }

            await ValidarUsuario(connection, transaction, jefe.Usuario, idUsuario, cancellationToken);
            // Una cuenta de dominio que pasa a local no conserva la contraseña guardada (puede ser la
            // inicial sin obligación de cambiarla): queda con 1234 y se le pide cambiarla al entrar.
            // En el SET de Oracle, DOMINIO del CASE es el valor anterior a esta actualización.
            return await Execute(connection, transaction, """
                UPDATE USUARIOS
                SET USUARIO = :usuario,
                    NOMBRE_PERSONA = :nombrePersona,
                    ESTADO = :estado,
                    DOMINIOP = :dominioP,
                    PASSWORD_HASH = CASE WHEN DOMINIO = 1 AND :dominio = 0 THEN :passwordHash ELSE PASSWORD_HASH END,
                    CLAVE_SEGURA = CASE WHEN DOMINIO = 1 AND :dominio = 0 THEN '0' ELSE CLAVE_SEGURA END,
                    DOMINIO = :dominio,
                    PERMISO_ADMIN = :permisoAdmin,
                    PERMISO_CONSULTA = :permisoConsulta,
                    ID_DEPTO_PERMISO = :idDepto,
                    ID_AREA_PERMISO = :idArea
                WHERE ID_USUARIO = :idUsuario
                  AND ROL = 'Permisos'
                """, cancellationToken,
                [("usuario", jefe.Usuario.Trim()), ("nombrePersona", jefe.NombrePersona.Trim()),
                 ("estado", estado), ("dominioP", jefe.DominioP.Trim().ToUpperInvariant()), ("dominio", jefe.Dominio),
                 ("passwordHash", PasswordHashing.Hash(InitialPassword)),
                 .. perfil.Parametros(), ("idUsuario", idUsuario)]) == 1;
        }, cancellationToken);

    // Solo las cuentas propias del sistema con usuario local; las de inventario se restablecen allá.
    public Task<bool> ResetJefePassword(PermisoAlcance alcance, int idUsuario, CancellationToken cancellationToken) =>
        InTransaction(async (connection, transaction) =>
        {
            var actual = await LeerUsuario(connection, transaction, idUsuario, cancellationToken);
            if (actual is null || !Administra(alcance, actual)) return false;
            return await Execute(connection, transaction, """
                UPDATE USUARIOS
                SET PASSWORD_HASH = :passwordHash,
                    CLAVE_SEGURA = '0'
                WHERE ID_USUARIO = :idUsuario
                  AND DOMINIO = 0
                  AND ROL = 'Permisos'
                """, cancellationToken,
                ("passwordHash", PasswordHashing.Hash(InitialPassword)), ("idUsuario", idUsuario)) == 1;
        }, cancellationToken);

    // Cuentas de inventario activas sin acceso a permisos. USUARIOS no tiene departamento, así
    // que el administrador general recibe la lista completa y el de departamento solo la cuenta
    // cuyo usuario escribe exacto (no ve las cuentas de toda la institución).
    public Task<IReadOnlyList<PermisoUsuarioInventarioDto>> GetUsuariosInventario(
        PermisoAlcance alcance,
        string? usuario,
        CancellationToken cancellationToken) =>
        ReadList($"""
            SELECT ID_USUARIO, USUARIO, NOMBRE_PERSONA
            FROM USUARIOS
            WHERE NVL(ROL, '-') <> 'Permisos'
              AND NVL(PERMISO_ADMIN, 0) = 0
              AND NVL(PERMISO_CONSULTA, 0) = 0
              AND ID_DEPTO_PERMISO IS NULL
              AND ID_AREA_PERMISO IS NULL
              AND UPPER(ESTADO) = 'ACTIVO'
              {(alcance.EsAdmin ? string.Empty : "AND LOWER(TRIM(USUARIO)) = LOWER(TRIM(:usuario))")}
            ORDER BY UPPER(NOMBRE_PERSONA), USUARIO
            """, reader => new PermisoUsuarioInventarioDto(
                ReadInt(reader, "ID_USUARIO"),
                ReadString(reader, "USUARIO"),
                ReadString(reader, "NOMBRE_PERSONA")),
            cancellationToken, alcance.EsAdmin ? [] : [("usuario", usuario ?? string.Empty)]);

    public Task<bool> QuitarAcceso(PermisoAlcance alcance, int idUsuario, CancellationToken cancellationToken) =>
        InTransaction(async (connection, transaction) =>
        {
            if (idUsuario == alcance.IdUsuario) throw new ArgumentException("No puedes quitarte tu propio acceso.");
            var actual = await LeerUsuario(connection, transaction, idUsuario, cancellationToken);
            if (actual is null || actual.SoloPermisos || !Administra(alcance, actual)) return false;
            return await Execute(connection, transaction, """
                UPDATE USUARIOS
                SET PERMISO_ADMIN = 0, PERMISO_CONSULTA = 0, ID_DEPTO_PERMISO = NULL, ID_AREA_PERMISO = NULL
                WHERE ID_USUARIO = :idUsuario
                """, cancellationToken, ("idUsuario", idUsuario)) == 1;
        }, cancellationToken);

    // ---- Reglas --------------------------------------------------------------------------

    // Solo el administrador general asigna administradores de departamento y consulta; el de
    // departamento solo nombra jefes de las áreas de su departamento. El nivel de administrador
    // general no se asigna a nadie más (hay uno solo): solo lo conserva quien ya lo tiene
    // (nivelActual). Devuelve las columnas de perfil a guardar.
    internal static async Task<Perfil> ValidarNivel(
        DbConnection connection,
        DbTransaction transaction,
        PermisoAlcance alcance,
        SavePermisoJefeDto jefe,
        string? nivelActual,
        CancellationToken cancellationToken)
    {
        if (!alcance.EsAdmin && jefe.Nivel != PermisoValores.NivelJefe)
        {
            throw new UnauthorizedAccessException("Solo el administrador general asigna administradores y usuarios de consulta.");
        }

        switch (jefe.Nivel)
        {
            case PermisoValores.NivelAdmin:
                if (nivelActual != PermisoValores.NivelAdmin)
                {
                    throw new ArgumentException("El nivel de administrador general no se puede asignar a otro usuario.");
                }
                return new Perfil(1, 0, null, null);
            case PermisoValores.NivelConsulta:
                return new Perfil(0, 1, null, null);
            case PermisoValores.NivelAdminDepartamento:
                var idDepartamento = jefe.IdDepartamento ?? throw new ArgumentException("Selecciona el departamento que administra.");
                await ValidarDepartamentoActivo(connection, transaction, idDepartamento, cancellationToken);
                return new Perfil(0, 0, idDepartamento, null);
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
                return new Perfil(0, 0, null, idArea);
        }
    }

    // El general administra a todos; el de departamento solo a los jefes de sus áreas.
    private static bool Administra(PermisoAlcance alcance, UsuarioPermiso usuario) =>
        alcance.EsAdmin
        || (alcance.Nivel == PermisoValores.NivelAdminDepartamento
            && usuario.Nivel == PermisoValores.NivelJefe
            && usuario.IdDepartamentoArea == alcance.IdDepartamento);

    private static async Task<UsuarioPermiso?> LeerUsuario(
        DbConnection connection,
        DbTransaction transaction,
        int idUsuario,
        CancellationToken cancellationToken)
    {
        var filas = await ReadRows(connection, transaction, """
            SELECT u.ROL, u.PERMISO_ADMIN, u.PERMISO_CONSULTA, u.ID_DEPTO_PERMISO, u.ID_AREA_PERMISO,
                   a.DEPARTAMENTO_IHSS_ID AS DEPTO_AREA
            FROM USUARIOS u
            LEFT JOIN PERMISO_AREA a ON a.ID_AREA = u.ID_AREA_PERMISO
            WHERE u.ID_USUARIO = :idUsuario
            """, reader => new UsuarioPermiso(
                EsSoloPermisos(ReadNullableString(reader, "ROL")),
                NivelDe(reader) is { Length: > 0 } nivel ? nivel : null,
                ReadNullableInt(reader, "DEPTO_AREA")),
            cancellationToken, ("idUsuario", idUsuario));
        return filas.Count == 0 ? null : filas[0];
    }

    // Nivel a partir de las columnas de perfil; vacío si el usuario no tiene ninguno.
    private static string NivelDe(DbDataReader reader)
    {
        if (ReadNullableInt(reader, "PERMISO_ADMIN") == 1) return PermisoValores.NivelAdmin;
        if (ReadNullableInt(reader, "PERMISO_CONSULTA") == 1) return PermisoValores.NivelConsulta;
        if (ReadNullableInt(reader, "ID_DEPTO_PERMISO") is not null) return PermisoValores.NivelAdminDepartamento;
        return ReadNullableInt(reader, "ID_AREA_PERMISO") is not null ? PermisoValores.NivelJefe : string.Empty;
    }

    private static bool EsSoloPermisos(string? rol) =>
        string.Equals(rol?.Trim(), AppRoles.Permisos, StringComparison.OrdinalIgnoreCase);

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

    // El nombre de usuario debe ser único en todo USUARIOS porque el login busca por él. Si la
    // persona ya tiene cuenta de inventario, se le da acceso a esa cuenta en lugar de crear otra.
    private static async Task ValidarUsuario(
        DbConnection connection,
        DbTransaction transaction,
        string usuario,
        int? idUsuario,
        CancellationToken cancellationToken)
    {
        var repetido = await Exists(connection, transaction, """
            SELECT 1 FROM USUARIOS
            WHERE LOWER(TRIM(USUARIO)) = LOWER(TRIM(:usuario)) AND ID_USUARIO <> :idUsuario
            """, cancellationToken, ("usuario", usuario), ("idUsuario", idUsuario ?? 0));
        if (repetido)
        {
            throw new ArgumentException(
                "Ya existe un usuario con ese nombre. Si es una cuenta de inventario, usa \"Dar acceso a usuario de inventario\".");
        }
    }

    // Columnas de perfil de USUARIOS para un nivel (solo una queda con valor).
    internal sealed record Perfil(int PermisoAdmin, int PermisoConsulta, int? IdDepartamento, int? IdArea)
    {
        public (string Name, object? Value)[] Parametros() =>
        [
            ("permisoAdmin", PermisoAdmin), ("permisoConsulta", PermisoConsulta),
            ("idDepto", IdDepartamento), ("idArea", IdArea),
        ];
    }

    // Usuario existente: si es cuenta propia de permisos, su nivel y el departamento de su área.
    private sealed record UsuarioPermiso(bool SoloPermisos, string? Nivel, int? IdDepartamentoArea);
}
