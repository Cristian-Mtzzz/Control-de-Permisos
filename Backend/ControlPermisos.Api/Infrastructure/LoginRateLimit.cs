using Microsoft.AspNetCore.Mvc;
using ControlPermisos.Api.Services;

namespace ControlPermisos.Api.Infrastructure;

// Protección del inicio de sesión contra fuerza bruta. Los límites salen de la tabla
// LOGIN_CONFIG (LoginLimitsProvider) y los contadores los lleva LoginAttemptLimiter.
public static class LoginRateLimit
{
    public static IServiceCollection AddLoginProtection(this IServiceCollection services)
    {
        services.AddMemoryCache();
        services.AddSingleton<LoginAttemptLimiter>();
        services.AddSingleton<LoginLimitsProvider>();
        return services;
    }

    public static ObjectResult TooManyAttempts(TimeSpan remaining)
    {
        var minutes = Math.Max(1, (int)Math.Ceiling(remaining.TotalMinutes));
        return TooManyRequests($"Demasiados intentos fallidos. Intenta de nuevo en {minutes} {(minutes == 1 ? "minuto" : "minutos")}.");
    }

    public static ObjectResult TooManyAttemptsFromIp() =>
        TooManyRequests("Demasiados intentos de inicio de sesión desde este equipo. Espera un minuto e intenta de nuevo.");

    private static ObjectResult TooManyRequests(string message) =>
        new(new { Message = message }) { StatusCode = StatusCodes.Status429TooManyRequests };
}
