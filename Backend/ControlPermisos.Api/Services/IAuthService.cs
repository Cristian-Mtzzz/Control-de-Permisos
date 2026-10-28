using ControlPermisos.Api.Models;

namespace ControlPermisos.Api.Services;

// Contrato de autenticación para facilitar la inyección y las pruebas.
public interface IAuthService
{
    // null: credenciales inválidas. UnauthorizedAccessException: credenciales correctas pero sin
    // un nivel vigente en el Control de permisos (el controlador responde igual en los dos casos).
    Task<LoginResponseDto?> AuthenticateUser(LoginRequestDto loginRequest, CancellationToken cancellationToken);
    // Devuelve null si el usuario ya no está activo, vigente o sin acceso a permisos, o si la
    // sesión (sessionStart, el inicio de sesión del token) llegó a su duración máxima.
    Task<string?> RefreshToken(int userId, DateTimeOffset? sessionStart, CancellationToken cancellationToken);
    Task<bool> ChangeInitialPassword(int userId, ChangePasswordDto request, CancellationToken cancellationToken);
}
