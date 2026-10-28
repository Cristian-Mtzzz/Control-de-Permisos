using Microsoft.Extensions.Caching.Memory;

namespace ControlPermisos.Api.Services;

// Frena la fuerza bruta en el inicio de sesión, con los límites de LOGIN_CONFIG:
// - por usuario: tras varios fallos seguidos lo bloquea unos minutos, sin importar desde qué
//   equipo lleguen, y así tampoco se termina bloqueando su cuenta de dominio en Active Directory;
// - por equipo (IP): un máximo de intentos por minuto, aunque cambie de usuario.
// Los contadores viven en memoria: reciclar el grupo de aplicaciones de la API los borra.
public sealed class LoginAttemptLimiter(IMemoryCache cache)
{
    // Tiempo que le falta al bloqueo, o null si el usuario puede intentar.
    public TimeSpan? GetRemainingLockout(string userName)
    {
        if (!cache.TryGetValue(UserKey(userName), out FailedAttempts? attempts) || attempts is null) return null;
        lock (attempts)
        {
            var remaining = attempts.LockedUntil - DateTimeOffset.UtcNow;
            return remaining > TimeSpan.Zero ? remaining : null;
        }
    }

    public void RegisterFailure(string userName, LoginLimits limits)
    {
        var window = limits.Lockout;
        // La ventana empieza con el primer fallo: los fallos se olvidan pasado ese tiempo.
        var attempts = cache.GetOrCreate(UserKey(userName), entry =>
        {
            entry.AbsoluteExpirationRelativeToNow = window;
            return new FailedAttempts();
        })!;
        lock (attempts)
        {
            attempts.Count++;
            if (attempts.Count >= limits.MaxFailedAttemptsPerUser)
            {
                attempts.LockedUntil = DateTimeOffset.UtcNow + window;
                // El bloqueo debe durar completo aunque la ventana original esté por vencer.
                cache.Set(UserKey(userName), attempts, window);
            }
        }
    }

    public void Reset(string userName) => cache.Remove(UserKey(userName));

    // Cuenta el intento de un equipo en su minuto actual; false si ya superó el límite.
    public bool TryRegisterIpAttempt(string ipAddress, LoginLimits limits)
    {
        var counter = cache.GetOrCreate($"login-ip:{ipAddress}", entry =>
        {
            entry.AbsoluteExpirationRelativeToNow = TimeSpan.FromMinutes(1);
            return new IpAttempts();
        })!;
        lock (counter)
        {
            counter.Count++;
            return counter.Count <= limits.AttemptsPerMinutePerIp;
        }
    }

    // "BA\Juan.Perez", "juan.perez@ihss.hn" y "Juan.Perez" cuentan como el mismo usuario.
    private static string UserKey(string userName) => $"login-failures:{AuthService.NormalizeDomainUserName(userName)}";

    private sealed class FailedAttempts
    {
        public int Count { get; set; }
        public DateTimeOffset LockedUntil { get; set; } = DateTimeOffset.MinValue;
    }

    private sealed class IpAttempts
    {
        public int Count { get; set; }
    }
}
