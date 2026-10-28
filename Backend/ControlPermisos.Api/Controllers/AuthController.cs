using System.Security.Claims;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Oracle.ManagedDataAccess.Client;
using ControlPermisos.Api.Infrastructure;
using ControlPermisos.Api.Models;
using ControlPermisos.Api.Services;

namespace ControlPermisos.Api.Controllers;

[ApiController]
[Route("api/auth")]
// Inicio de sesión, renovación del token y cambio de la contraseña inicial.
public sealed class AuthController(
    IAuthService authService,
    LoginAttemptLimiter loginAttempts,
    LoginLimitsProvider loginLimits,
    ILogger<AuthController> logger) : ControllerBase
{
    // Misma respuesta para credenciales incorrectas y para una cuenta sin acceso: así el login no
    // confirma que una contraseña es correcta. El motivo exacto queda en el log de la API.
    internal const string LoginRechazado =
        "El usuario o la contraseña no son correctos, o tu usuario no tiene acceso al Control de permisos.";

    [HttpPost("login")]
    [AllowAnonymous]
    // Valida las credenciales contra Oracle (o Active Directory) y exige un nivel vigente en el
    // Control de permisos. Los límites salen de LOGIN_CONFIG: intentos por minuto desde un equipo y
    // fallos seguidos por usuario. Un usuario bloqueado recibe 429 y ni siquiera se consulta
    // Active Directory, para no bloquear también su cuenta de dominio.
    public async Task<ActionResult<LoginResponseDto>> AuthenticateUser(
        LoginRequestDto loginRequest,
        CancellationToken cancellationToken)
    {
        try
        {
            var limits = await loginLimits.GetAsync(cancellationToken);
            var ipAddress = HttpContext.Connection.RemoteIpAddress?.ToString() ?? "desconocido";
            if (!loginAttempts.TryRegisterIpAttempt(ipAddress, limits))
            {
                logger.LogWarning("Demasiados intentos de login desde {IpAddress}.", ipAddress);
                return LoginRateLimit.TooManyAttemptsFromIp();
            }

            if (loginAttempts.GetRemainingLockout(loginRequest.UserName) is { } remaining)
            {
                logger.LogWarning("Login bloqueado temporalmente para {UserName} por intentos fallidos.", loginRequest.UserName);
                return LoginRateLimit.TooManyAttempts(remaining);
            }

            var loginResponse = await authService.AuthenticateUser(loginRequest, cancellationToken);
            if (loginResponse is null)
            {
                loginAttempts.RegisterFailure(loginRequest.UserName, limits);
                return Unauthorized(new { Message = LoginRechazado });
            }

            loginAttempts.Reset(loginRequest.UserName);
            return Ok(loginResponse);
        }
        catch (UnauthorizedAccessException denied)
        {
            // Credenciales correctas, pero la cuenta no tiene nivel en el Control de permisos. Cuenta
            // como un fallo más: si reiniciara el contador, el bloqueo también delataría la contraseña.
            var limits = await loginLimits.GetAsync(cancellationToken);
            loginAttempts.RegisterFailure(loginRequest.UserName, limits);
            logger.LogWarning("Login de {UserName} sin acceso al Control de permisos: {Motivo}", loginRequest.UserName, denied.Message);
            return Unauthorized(new { Message = LoginRechazado });
        }
        catch (OracleException exception)
        {
            logger.LogError(exception, "No se pudo consultar Oracle durante el inicio de sesión.");
            return StatusCode(
                StatusCodes.Status503ServiceUnavailable,
                new { Message = "El servicio de autenticación no está disponible temporalmente." });
        }
    }

    [HttpPost("refresh")]
    [Authorize(Policy = "PasswordChange")]
    // El token nuevo se arma con los datos actuales de USUARIOS, no con los del token anterior;
    // solo el inicio de sesión pasa de uno a otro, para la duración máxima de la sesión.
    public async Task<ActionResult> RefreshSession(CancellationToken cancellationToken)
    {
        if (CurrentUserId() is not { } userId) return Unauthorized();
        var token = await authService.RefreshToken(userId, SessionStart(), cancellationToken);
        return token is null
            ? Unauthorized(new { Message = "Tu sesión terminó o tu usuario ya no tiene acceso. Vuelve a iniciar sesión." })
            : Ok(new { Token = token });
    }

    [HttpPost("change-initial-password")]
    [Authorize(Policy = "PasswordChange")]
    public async Task<IActionResult> ChangeInitialPassword(
        ChangePasswordDto request,
        CancellationToken cancellationToken)
    {
        if (CurrentUserId() is not { } userId) return Unauthorized();
        if (request.NewPassword == request.CurrentPassword)
        {
            return BadRequest(new { Message = "La nueva contraseña debe ser distinta de la actual." });
        }
        var changed = await authService.ChangeInitialPassword(userId, request, cancellationToken);
        return changed
            ? NoContent()
            : BadRequest(new { Message = "La contraseña actual no es válida o ya fue actualizada." });
    }

    // Un token anterior a este claim no lo trae: esa sesión ya no se renueva y pide iniciar sesión.
    private DateTimeOffset? SessionStart() =>
        long.TryParse(User.FindFirstValue(AuthService.SessionStartClaim), out var seconds)
            ? DateTimeOffset.FromUnixTimeSeconds(seconds)
            : null;

    private int? CurrentUserId() =>
        int.TryParse(User.FindFirstValue("sub") ?? User.FindFirstValue(ClaimTypes.NameIdentifier), out var userId)
            ? userId
            : null;
}
