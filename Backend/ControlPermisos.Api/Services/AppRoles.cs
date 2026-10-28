namespace ControlPermisos.Api.Services;

// Rol (USUARIOS.ROL) de las cuentas creadas para este sistema. El acceso no depende del rol sino
// del perfil (nivel, departamento o área), así que una cuenta del inventario también puede entrar
// con su mismo usuario; esas cuentas se siguen administrando en el inventario.
public static class AppRoles
{
    public const string Permisos = "Permisos";
}
