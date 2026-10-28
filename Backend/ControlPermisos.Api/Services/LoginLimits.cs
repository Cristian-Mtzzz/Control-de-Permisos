using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Caching.Memory;
using Oracle.ManagedDataAccess.Client;
using ControlPermisos.Api.Data;

namespace ControlPermisos.Api.Services;

// Límites de intentos de inicio de sesión.
public sealed record LoginLimits(int MaxFailedAttemptsPerUser, int LockoutMinutes, int AttemptsPerMinutePerIp)
{
    public TimeSpan Lockout => TimeSpan.FromMinutes(LockoutMinutes);
}

// Lee los límites de la tabla LOGIN_CONFIG (la misma que usa el inventario). Se guardan un
// minuto en memoria, así un cambio en la tabla se aplica solo, sin reiniciar la API. Si la tabla
// no existe o un valor no es mayor que cero, se usa el de appsettings.json (sección Security).
public sealed class LoginLimitsProvider(
    IServiceScopeFactory scopeFactory,
    IMemoryCache cache,
    IConfiguration configuration,
    ILogger<LoginLimitsProvider> logger)
{
    internal const string CacheKey = "login-limits";
    private static readonly TimeSpan CacheDuration = TimeSpan.FromMinutes(1);

    public async Task<LoginLimits> GetAsync(CancellationToken cancellationToken)
    {
        if (cache.TryGetValue(CacheKey, out LoginLimits? cached) && cached is not null) return cached;
        var limits = await LoadAsync(cancellationToken);
        cache.Set(CacheKey, limits, CacheDuration);
        return limits;
    }

    private async Task<LoginLimits> LoadAsync(CancellationToken cancellationToken)
    {
        var defaults = new LoginLimits(
            configuration.GetValue("Security:LoginMaxFailedAttempts", 5),
            configuration.GetValue("Security:LoginLockoutMinutes", 5),
            configuration.GetValue("Security:LoginRequestsPerMinutePerIp", 10));

        using var scope = scopeFactory.CreateScope();
        var dbContext = scope.ServiceProvider.GetRequiredService<PermisosDbContext>();
        await dbContext.Database.OpenConnectionAsync(cancellationToken);
        try
        {
            await using var command = dbContext.Database.GetDbConnection().CreateCommand();
            command.CommandText = "SELECT CLAVE, VALOR FROM LOGIN_CONFIG";
            var values = new Dictionary<string, int>(StringComparer.OrdinalIgnoreCase);
            await using (var reader = await command.ExecuteReaderAsync(cancellationToken))
            {
                while (await reader.ReadAsync(cancellationToken))
                {
                    if (!reader.IsDBNull(0) && !reader.IsDBNull(1))
                    {
                        values[reader.GetString(0).Trim()] = Convert.ToInt32(reader.GetValue(1));
                    }
                }
            }

            int Pick(string key, int fallback) => values.TryGetValue(key, out var value) && value > 0 ? value : fallback;
            return new LoginLimits(
                Pick("MAX_INTENTOS_USUARIO", defaults.MaxFailedAttemptsPerUser),
                Pick("MINUTOS_BLOQUEO", defaults.LockoutMinutes),
                Pick("MAX_INTENTOS_IP_MINUTO", defaults.AttemptsPerMinutePerIp));
        }
        catch (OracleException exception) when (exception.Number == 942)
        {
            logger.LogWarning("No existe la tabla LOGIN_CONFIG; se usan los límites de appsettings.json (Security).");
            return defaults;
        }
        finally
        {
            await dbContext.Database.CloseConnectionAsync();
        }
    }
}
