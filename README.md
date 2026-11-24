# Control de Permisos

Sistema web para registrar y controlar los permisos de los empleados de una institución, organizados por departamento y área.

## Tecnologías

- **Backend:** ASP.NET Core 8 (API REST) con Oracle y autenticación JWT.
- **Frontend:** Angular.
- **Reportes:** archivos Excel generados en el navegador.


## Acceso

- Los usuarios son propios del sistema (tabla `USUARIOS_PERMISOS`), aparte de los del inventario; se crean desde **Mantenimiento**.
- Un solo nivel por usuario: administrador general (puede haber varios; cada uno nombra a otros), jefe de departamento, secretaría de departamento (ve y exporta todas sus áreas y genera los reportes y memorandos, sin registrar), jefe de área o usuario (la cuenta de un empleado: registra y ve solo sus propios permisos y vacaciones y los imprime, sin modificarlos después ni generar memorandos o reportes). Nadie cambia su propio nivel ni se desactiva.
- Cada nivel ve y modifica solo lo de su alcance. La API lo valida en cada solicitud.
- Inicio de sesión con usuarios locales o de directorio activo.
- Contraseñas guardadas con BCrypt y cambio obligatorio de la contraseña inicial.
- Bloqueo temporal por intentos fallidos y cierre de sesión por inactividad.

## Estructura

```
Backend/ControlPermisos.Api/        API REST
├── Controllers/                    Endpoints HTTP
├── Services/                       Reglas de negocio y acceso a datos
├── Models/                         Objetos de entrada y salida
├── Data/                           Conexión a Oracle
└── Infrastructure/                 Manejo de errores, cabeceras de seguridad y límites de login
Backend/ControlPermisos.Api.Tests/  Pruebas de la API (no necesitan Oracle)

Frontend/src/app/                   Aplicación Angular
├── auth/                           Inicio de sesión y sesión
├── permisos/                       Permisos, personal, departamentos, áreas y usuarios
└── shared/                         Componentes y utilidades comunes

docs/base-de-datos.md               Qué guarda cada tabla, sus columnas y relaciones
docs/sql/control-permisos.sql       Tablas del sistema para un esquema nuevo
docs/sql/comentarios-tablas.sql     Descripción de tablas y columnas en la base (COMMENT ON)
docs/sql/migracion-usuarios-permisos.sql  Paso de los usuarios de USUARIOS a USUARIOS_PERMISOS
docs/sql/migracion-tope-mensual.sql       Tope de 2 días de permiso por empleado al mes
docs/sql/migracion-vacaciones.sql         Admite las vacaciones (tipo VAC) en PERMISO_SOLICITUD
docs/sql/migracion-no-pago.sql            No. de pago escrito en cada permiso (PERMISO_SOLICITUD.NO_PAGO)
docs/sql/migracion-lugar-telefono.sql     Lugar y teléfono del permiso por día (para su formato impreso)
```

## Ejecutar en local

### Requisitos

- SDK de .NET 8.
- Node 22.22+, 24.15+ o 26+ (lo exige Angular 22).

### Configuración

La API se configura en `Backend/ControlPermisos.Api/appsettings.json`: conexión a Oracle
(`ConnectionStrings:OracleConnection`), clave del JWT (`Jwt:Key`), direcciones de publicación y
límites del inicio de sesión. `appsettings.Development.json` se aplica encima al ejecutar en local;
hoy solo ajusta los logs, y ahí se puede reemplazar cualquier valor para desarrollo (por ejemplo,
otra base de datos).

### Levantar la aplicación

| Parte | Comandos | Dirección |
| --- | --- | --- |
| API | `cd Backend/ControlPermisos.Api` y `dotnet run` | http://localhost:5080 (Swagger en `/swagger`) |
| Frontend | `cd Frontend`, `npm ci` la primera vez y `npm start` | http://localhost:50307 |

El frontend en desarrollo reenvía `/api` a la API local (`proxy.conf.json`).

### Pruebas

- API: `cd Backend` y `dotnet test`.
- Frontend: `cd Frontend` y `npx ng test --watch=false`.
