namespace ControlPermisos.Api.Models;

// Respuesta pública del login: token JWT y perfil básico del usuario. Nivel es su nivel en el
// Control de permisos (PermisoValores.Nivel*); el detalle de su alcance lo da /api/permisos/sesion.
public sealed record LoginResponseDto(string Token, UserResponseDto User, bool MustChangePassword);

public sealed record UserResponseDto(int UserId, string UserName, string FullName, string Nivel);
