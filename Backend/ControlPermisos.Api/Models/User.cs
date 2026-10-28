namespace ControlPermisos.Api.Models;

// Datos de USUARIOS que se usan al iniciar sesión y para los claims del JWT.
public sealed class User
{
    public int UserId { get; set; }
    public string UserName { get; set; } = string.Empty;
    public string FullName { get; set; } = string.Empty;
    public string PasswordHash { get; set; } = string.Empty;
}
