using System.Data;
using System.Data.Common;
using System.DirectoryServices;
using System.Globalization;
using System.IdentityModel.Tokens.Jwt;
using System.Runtime.InteropServices;
using System.Security.Claims;
using System.Text;
using Microsoft.EntityFrameworkCore;
using Microsoft.IdentityModel.Tokens;
using Oracle.ManagedDataAccess.Client;
using ControlPermisos.Api.Data;
using ControlPermisos.Api.Models;

namespace ControlPermisos.Api.Services;

// Servicio de autenticación: valida las credenciales contra USUARIOS (la misma tabla del
// inventario, así cada persona entra con su misma cuenta) o contra Active Directory, exige un
// nivel vigente en el Control de permisos y crea el JWT que el frontend usa para la sesión.
public sealed class AuthService(
    PermisosDbContext dbContext,
    IPermisoAreaService areaService,
    IConfiguration configuration,
    ILogger<AuthService> logger) : IAuthService
{
    private static readonly string[] Dominios = ["BA", "HE", "HRN", "IVM"];

    // Claim con el inicio de sesión en segundos Unix. Nombre propio para que el mapeo de claims
    // de JwtBearer no lo renombre (como hace con "auth_time").
    public const string SessionStartClaim = "session_start";

    public async Task<LoginResponseDto?> AuthenticateUser(
        LoginRequestDto loginRequest,
        CancellationToken cancellationToken)
    {
        var credenciales = await VerificarCredenciales(loginRequest, cancellationToken);
        if (credenciales is null) return null;

        // Credenciales correctas: además debe tener un nivel vigente (si no, UnauthorizedAccessException
        // con el motivo, que el controlador devuelve como 403).
        var alcance = await areaService.GetAlcance(credenciales.User.UserId, cancellationToken);
        logger.LogInformation("Login aceptado para {UserName} con nivel {Nivel}.", loginRequest.UserName, alcance.Nivel);
        var user = credenciales.User;
        return new LoginResponseDto(
            GenerateToken(user, credenciales.MustChangePassword, DateTimeOffset.UtcNow),
            new UserResponseDto(
                user.UserId,
                user.UserName,
                string.IsNullOrWhiteSpace(user.FullName) ? user.UserName : user.FullName,
                alcance.Nivel),
            credenciales.MustChangePassword);
    }

    // Busca al usuario activo y vigente y valida su contraseña: la de dominio contra Active
    // Directory y la local contra el hash guardado. null si algo no coincide.
    private async Task<Credenciales?> VerificarCredenciales(LoginRequestDto loginRequest, CancellationToken cancellationToken)
    {
        var connection = dbContext.Database.GetDbConnection();
        await dbContext.Database.OpenConnectionAsync(cancellationToken);

        try
        {
            await using var command = CreateCommand(connection);
            // Los usuarios locales se buscan tal como se escriben. Los de dominio, como en Active Directory,
            // sin distinguir mayúsculas ni espacios y aceptando "usuario", "DOMINIO\usuario" o "usuario@dominio".
            command.CommandText = """
                SELECT ID_USUARIO, USUARIO, NOMBRE_PERSONA, PASSWORD_HASH, DOMINIOP, DOMINIO, CLAVE_SEGURA
                FROM USUARIOS
                WHERE (USUARIO = :userName OR (DOMINIO = 1 AND LOWER(TRIM(USUARIO)) = :domainUserName))
                  AND UPPER(ESTADO) = 'ACTIVO'
                  AND (FECHA_EXPIRACION IS NULL OR FECHA_EXPIRACION >= TRUNC(SYSDATE))
                ORDER BY CASE WHEN USUARIO = :exactUserName THEN 0 ELSE 1 END
                """;
            AddParameter(command, "userName", loginRequest.UserName);
            AddParameter(command, "domainUserName", NormalizeDomainUserName(loginRequest.UserName));
            AddParameter(command, "exactUserName", loginRequest.UserName);

            User user;
            int domain;
            string domainName;
            string secureKey;
            await using (var reader = await command.ExecuteReaderAsync(cancellationToken))
            {
                if (!await reader.ReadAsync(cancellationToken))
                {
                    // Igual se calcula un hash para que un usuario inexistente no responda más rápido.
                    PasswordHashing.SimulateVerify(loginRequest.Password);
                    logger.LogWarning(
                        "Login rechazado para {UserName}: no existe, está inactivo o expirado.",
                        loginRequest.UserName);
                    return null;
                }

                user = new User
                {
                    UserId = Convert.ToInt32(reader.GetValue(reader.GetOrdinal("ID_USUARIO"))),
                    UserName = ReadString(reader, "USUARIO"),
                    FullName = ReadString(reader, "NOMBRE_PERSONA"),
                    PasswordHash = ReadString(reader, "PASSWORD_HASH"),
                };
                domain = Convert.ToInt32(reader.GetValue(reader.GetOrdinal("DOMINIO")));
                domainName = ReadString(reader, "DOMINIOP").Trim().ToUpperInvariant();
                secureKey = ReadString(reader, "CLAVE_SEGURA");
            }

            if (domain == 1)
            {
                if (!Dominios.Contains(domainName))
                {
                    logger.LogWarning(
                        "El usuario {UserName} tiene un dominio no reconocido: {DomainName}.",
                        loginRequest.UserName,
                        domainName);
                    return null;
                }

                // Se valida con el usuario registrado (no con lo escrito), así "BA\Usuario" o "Usuario " también entran.
                if (!ValidateCredentials(user.UserName.Trim(), loginRequest.Password, domainName)) return null;
            }
            else if (domain == 0)
            {
                if (!await VerifyLocalPassword(connection, user, loginRequest.Password, cancellationToken))
                {
                    logger.LogWarning("Login rechazado para {UserName}: la contraseña local no coincide.", loginRequest.UserName);
                    return null;
                }
            }
            else
            {
                return null;
            }

            return new Credenciales(user, domain == 0 && secureKey == "0");
        }
        finally
        {
            await dbContext.Database.CloseConnectionAsync();
        }
    }

    // "BA\Juan.Perez", "juan.perez@ihss.hn" y " Juan.Perez " se reducen a "juan.perez".
    internal static string NormalizeDomainUserName(string userName)
    {
        var value = userName.Trim();
        var slash = value.LastIndexOf('\\');
        if (slash >= 0) value = value[(slash + 1)..];
        var at = value.IndexOf('@');
        if (at >= 0) value = value[..at];
        return value.Trim().ToLowerInvariant();
    }

    private bool ValidateCredentials(string username, string password, string domain)
    {
        if (!OperatingSystem.IsWindows())
        {
            logger.LogWarning("Se intento validar contra Active Directory en un sistema no Windows.");
            return false;
        }

        try
        {
            // El prefijo "dominio\usuario" evita que las confianzas entre dominios del bosque
            // autentiquen una cuenta de otro dominio distinto al elegido.
            using var entry = new DirectoryEntry($"LDAP://{domain}", $@"{domain}\{username}", password);
            using var searcher = new DirectorySearcher(entry);
            return searcher.FindOne() is not null;
        }
        catch (Exception ex) when (ex is COMException or DirectoryServicesCOMException or UnauthorizedAccessException)
        {
            // ExtendedErrorMessage trae el motivo de AD: "data 52e" contraseña incorrecta, "data 532" contraseña
            // vencida, "data 773" debe cambiar la contraseña, "data 775" cuenta bloqueada, "data 525" no existe.
            logger.LogWarning(ex,
                "Active Directory rechazó a {UserName} en el dominio {Domain}. Detalle: {Detail}",
                username,
                domain,
                (ex as DirectoryServicesCOMException)?.ExtendedErrorMessage ?? ex.Message);
            return false;
        }
    }

    // Valida la contraseña de un usuario local. Si todavía tiene el hash antiguo de ORA_HASH y la
    // contraseña es correcta, lo reemplaza por BCrypt (igual que el inventario, con la misma tabla).
    private async Task<bool> VerifyLocalPassword(
        DbConnection connection,
        User user,
        string password,
        CancellationToken cancellationToken)
    {
        if (PasswordHashing.IsBcrypt(user.PasswordHash))
        {
            return PasswordHashing.Verify(password, user.PasswordHash);
        }

        if (!await MatchesLegacyHash(connection, user.UserId, password, cancellationToken))
        {
            return false;
        }

        try
        {
            await using var command = CreateCommand(connection);
            command.CommandText = """
                UPDATE USUARIOS
                SET PASSWORD_HASH = :newHash
                WHERE ID_USUARIO = :userId
                  AND PASSWORD_HASH = :oldHash
                """;
            AddParameter(command, "newHash", PasswordHashing.Hash(password));
            AddParameter(command, "userId", user.UserId);
            AddParameter(command, "oldHash", user.PasswordHash);
            await command.ExecuteNonQueryAsync(cancellationToken);
        }
        catch (OracleException exception)
        {
            // El login sigue siendo válido; se reintentará la migración en el próximo inicio de sesión.
            logger.LogWarning(exception, "No se pudo actualizar a BCrypt la contraseña de {UserName}.", user.UserName);
        }

        return true;
    }

    // Formato anterior: ORA_HASH(contraseña) || ORA_HASH(usuario), calculado por Oracle.
    private static async Task<bool> MatchesLegacyHash(
        DbConnection connection,
        int userId,
        string password,
        CancellationToken cancellationToken)
    {
        await using var command = CreateCommand(connection);
        command.CommandText = """
            SELECT COUNT(*) FROM USUARIOS
            WHERE ID_USUARIO = :userId
              AND PASSWORD_HASH = ORA_HASH(:password, 4294967295) || ORA_HASH(USUARIO, 4294967295)
            """;
        AddParameter(command, "userId", userId);
        AddParameter(command, "password", password);
        return Convert.ToInt32(await command.ExecuteScalarAsync(cancellationToken)) == 1;
    }

    public async Task<bool> ChangeInitialPassword(
        int userId,
        ChangePasswordDto request,
        CancellationToken cancellationToken)
    {
        var connection = dbContext.Database.GetDbConnection();
        await dbContext.Database.OpenConnectionAsync(cancellationToken);
        try
        {
            string currentHash;
            await using (var select = CreateCommand(connection))
            {
                select.CommandText = """
                    SELECT PASSWORD_HASH FROM USUARIOS
                    WHERE ID_USUARIO = :userId
                      AND DOMINIO = 0
                      AND CLAVE_SEGURA = '0'
                    """;
                AddParameter(select, "userId", userId);
                await using var reader = await select.ExecuteReaderAsync(cancellationToken);
                if (!await reader.ReadAsync(cancellationToken)) return false;
                currentHash = ReadString(reader, "PASSWORD_HASH");
            }

            var currentIsValid = PasswordHashing.IsBcrypt(currentHash)
                ? PasswordHashing.Verify(request.CurrentPassword, currentHash)
                : await MatchesLegacyHash(connection, userId, request.CurrentPassword, cancellationToken);
            if (!currentIsValid) return false;

            await using var update = CreateCommand(connection);
            update.CommandText = """
                UPDATE USUARIOS
                SET PASSWORD_HASH = :newHash,
                    CLAVE_SEGURA = '1'
                WHERE ID_USUARIO = :userId
                  AND DOMINIO = 0
                  AND CLAVE_SEGURA = '0'
                  AND PASSWORD_HASH = :currentHash
                """;
            AddParameter(update, "newHash", PasswordHashing.Hash(request.NewPassword));
            AddParameter(update, "userId", userId);
            AddParameter(update, "currentHash", currentHash);
            return await update.ExecuteNonQueryAsync(cancellationToken) == 1;
        }
        finally
        {
            await dbContext.Database.CloseConnectionAsync();
        }
    }

    // Renueva el token con los datos actuales de la base: un usuario desactivado, expirado o que
    // perdió su nivel en el Control de permisos ya no recibe token nuevo. Tampoco la sesión que
    // llegó a su duración máxima (Jwt:MaxSessionHours desde el inicio de sesión): la inactividad
    // la vigila el navegador, y este tope impide que un token se renueve indefinidamente.
    public async Task<string?> RefreshToken(int userId, DateTimeOffset? sessionStart, CancellationToken cancellationToken)
    {
        if (sessionStart is not { } inicio || !SesionVigente(inicio, DateTimeOffset.UtcNow, MaxSession))
        {
            logger.LogInformation("Renovación de sesión rechazada para el usuario {UserId}: la sesión llegó a su duración máxima.", userId);
            return null;
        }

        User user;
        bool mustChangePassword;
        var connection = dbContext.Database.GetDbConnection();
        await dbContext.Database.OpenConnectionAsync(cancellationToken);
        try
        {
            await using var command = CreateCommand(connection);
            command.CommandText = """
                SELECT ID_USUARIO, USUARIO, NOMBRE_PERSONA, DOMINIO, CLAVE_SEGURA
                FROM USUARIOS
                WHERE ID_USUARIO = :userId
                  AND UPPER(ESTADO) = 'ACTIVO'
                  AND (FECHA_EXPIRACION IS NULL OR FECHA_EXPIRACION >= TRUNC(SYSDATE))
                """;
            AddParameter(command, "userId", userId);
            await using var reader = await command.ExecuteReaderAsync(cancellationToken);
            if (!await reader.ReadAsync(cancellationToken))
            {
                logger.LogWarning("Renovación de sesión rechazada para el usuario {UserId}: no existe, está inactivo o expirado.", userId);
                return null;
            }

            user = new User
            {
                UserId = Convert.ToInt32(reader.GetValue(reader.GetOrdinal("ID_USUARIO"))),
                UserName = ReadString(reader, "USUARIO"),
                FullName = ReadString(reader, "NOMBRE_PERSONA"),
            };
            var domain = Convert.ToInt32(reader.GetValue(reader.GetOrdinal("DOMINIO")));
            mustChangePassword = domain == 0 && ReadString(reader, "CLAVE_SEGURA") == "0";
        }
        finally
        {
            await dbContext.Database.CloseConnectionAsync();
        }

        try
        {
            await areaService.GetAlcance(userId, cancellationToken);
        }
        catch (UnauthorizedAccessException)
        {
            logger.LogWarning("Renovación de sesión rechazada para el usuario {UserId}: ya no tiene nivel en permisos.", userId);
            return null;
        }

        return GenerateToken(user, mustChangePassword, inicio);
    }

    private TimeSpan MaxSession => TimeSpan.FromHours(Math.Max(1, configuration.GetValue("Jwt:MaxSessionHours", 10)));

    // La sesión empezó en el pasado (un reloj adelantado no la extiende) y no superó la duración máxima.
    internal static bool SesionVigente(DateTimeOffset inicio, DateTimeOffset ahora, TimeSpan maxima) =>
        inicio <= ahora && ahora - inicio < maxima;

    private static DbCommand CreateCommand(DbConnection connection)
    {
        var command = connection.CreateCommand();
        if (command is OracleCommand oracleCommand) oracleCommand.BindByName = true;
        return command;
    }

    private static void AddParameter(DbCommand command, string name, string value)
    {
        var parameter = command.CreateParameter();
        parameter.ParameterName = name;
        parameter.DbType = DbType.String;
        parameter.Size = 256;
        parameter.Value = value;
        command.Parameters.Add(parameter);
    }

    private static void AddParameter(DbCommand command, string name, int value)
    {
        var parameter = command.CreateParameter();
        parameter.ParameterName = name;
        parameter.DbType = DbType.Int32;
        parameter.Value = value;
        command.Parameters.Add(parameter);
    }

    // sessionStart es el inicio de sesión: se conserva al renovar para aplicar la duración máxima.
    private string GenerateToken(User user, bool mustChangePassword, DateTimeOffset sessionStart)
    {
        var key = configuration["Jwt:Key"]
            ?? throw new InvalidOperationException("Falta configurar Jwt:Key.");
        var expiresInMinutes = configuration.GetValue("Jwt:ExpirationMinutes", 35);
        var claims = new[]
        {
            new Claim(JwtRegisteredClaimNames.Sub, user.UserId.ToString()),
            new Claim(JwtRegisteredClaimNames.UniqueName, user.UserName),
            new Claim(ClaimTypes.Name, user.UserName),
            // Nombre de la persona para mostrarlo en el encabezado al recargar la página.
            new Claim("full_name", string.IsNullOrWhiteSpace(user.FullName) ? user.UserName : user.FullName),
            new Claim("must_change_password", mustChangePassword ? "true" : "false"),
            new Claim(SessionStartClaim, sessionStart.ToUnixTimeSeconds().ToString(CultureInfo.InvariantCulture),
                ClaimValueTypes.Integer64),
        };
        var credentials = new SigningCredentials(
            new SymmetricSecurityKey(Encoding.UTF8.GetBytes(key)),
            SecurityAlgorithms.HmacSha256);
        var token = new JwtSecurityToken(
            issuer: configuration["Jwt:Issuer"],
            audience: configuration["Jwt:Audience"],
            claims: claims,
            expires: DateTime.UtcNow.AddMinutes(expiresInMinutes),
            signingCredentials: credentials);

        return new JwtSecurityTokenHandler().WriteToken(token);
    }

    private static string ReadString(DbDataReader reader, string column)
    {
        var ordinal = reader.GetOrdinal(column);
        return reader.IsDBNull(ordinal) ? string.Empty : Convert.ToString(reader.GetValue(ordinal)) ?? string.Empty;
    }

    private sealed record Credenciales(User User, bool MustChangePassword);
}
