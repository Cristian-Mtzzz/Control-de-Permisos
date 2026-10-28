namespace ControlPermisos.Api.Infrastructure;

// Cabeceras de seguridad para todas las respuestas de la API. Se agregan al iniciar la
// respuesta para que también las lleven los errores que arma ApiExceptionHandler.
public static class SecurityHeaders
{
    public static IApplicationBuilder UseSecurityHeaders(this IApplicationBuilder app) => app.Use(async (context, next) =>
    {
        // Swagger UI es una página con scripts y estilos propios; el resto de la API solo devuelve JSON.
        var isSwagger = context.Request.Path.StartsWithSegments("/swagger");
        context.Response.OnStarting(() =>
        {
            var headers = context.Response.Headers;
            headers.XContentTypeOptions = "nosniff";
            headers.XFrameOptions = "DENY";
            headers["Referrer-Policy"] = "no-referrer";
            headers["Permissions-Policy"] = "camera=(), microphone=(), geolocation=()";
            if (!isSwagger)
            {
                headers.ContentSecurityPolicy = "default-src 'none'; frame-ancestors 'none'";
                // Las respuestas traen tokens y datos de empleados: que el navegador no las guarde.
                headers.CacheControl = "no-store";
            }
            return Task.CompletedTask;
        });
        await next();
    });
}
