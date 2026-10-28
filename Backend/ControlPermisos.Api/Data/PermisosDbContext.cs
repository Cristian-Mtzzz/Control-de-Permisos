using Microsoft.EntityFrameworkCore;

namespace ControlPermisos.Api.Data;

// Contexto EF Core. No mapea entidades: solo administra la conexión a Oracle que comparten
// los servicios que ejecutan SQL directo (OracleRepository y AuthService). La base es la misma
// del inventario: USUARIOS, EMPLEADOS_IHSS, DEPARTAMENTO_IHSS y las tablas PERMISO_*.
public sealed class PermisosDbContext(DbContextOptions<PermisosDbContext> options) : DbContext(options);
