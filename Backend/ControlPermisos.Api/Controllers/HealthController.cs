using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using ControlPermisos.Api.Data;

namespace ControlPermisos.Api.Controllers;

[ApiController]
[Route("api/health")]
// Endpoint de diagnóstico usado para comprobar que Oracle responde.
public sealed class HealthController(
    PermisosDbContext dbContext,
    IWebHostEnvironment environment,
    ILogger<HealthController> logger) : ControllerBase
{
    [HttpGet]
    // Devuelve 200 si la conexión abre y 503 con detalle solo en desarrollo si falla.
    public async Task<IActionResult> CheckDatabase(CancellationToken cancellationToken)
    {
        try
        {
            await dbContext.Database.OpenConnectionAsync(cancellationToken);
            await dbContext.Database.CloseConnectionAsync();
            return Ok(new { Status = "ok", Database = "oracle" });
        }
        catch (Exception exception)
        {
            logger.LogError(exception, "No se pudo abrir la conexion con Oracle.");
            var response = new { Status = "error", Message = "No se pudo conectar con Oracle." };
            if (environment.IsDevelopment())
            {
                return StatusCode(StatusCodes.Status503ServiceUnavailable, new
                {
                    response.Status,
                    response.Message,
                    Detail = exception.Message,
                });
            }

            return StatusCode(StatusCodes.Status503ServiceUnavailable, response);
        }
    }
}