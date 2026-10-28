# Control de Permisos

Sistema web para registrar y controlar los permisos de los empleados de una institución, organizados por departamento y área.

## Tecnologías

- **Backend:** ASP.NET Core 8 (API REST) con Oracle y autenticación JWT.
- **Frontend:** Angular.
- **Reportes:** archivos Excel generados en el navegador.

## Funciones

| Sección | Para qué sirve |
| --- | --- |
| **Permisos** | Permisos por día (días hábiles) y por hora (dentro de la jornada), con revisión de choques y límites, edición, anulación, indicadores del día, la semana y el mes, historial por empleado, constancia imprimible y reporte en Excel. |
| **Personal** | Empleados de cada área. Cada jefe agrega a su gente; los administradores la mueven entre áreas. |
| **Departamentos, áreas y jefes** | Departamentos que usan el sistema, sus áreas y los usuarios con su nivel de acceso. |

## Acceso

- Un solo nivel por usuario: administrador general, administrador de departamento, jefe de área o consulta (solo ve y exporta).
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

docs/sql/control-permisos.sql       Tablas del sistema para un esquema nuevo
```

## Ejecutar en local

### Requisitos

- SDK de .NET 8.
- Node 22.22+, 24.15+ o 26+ (lo exige Angular 22).
- Acceso a una base Oracle con las tablas que el sistema comparte con el inventario (`USUARIOS`,
  `EMPLEADOS_IHSS`, `DEPARTAMENTO_IHSS`, `EDIFICIO`, `REGIONAL` y, opcional, `LOGIN_CONFIG`) y las
  del Control de permisos.
  En un esquema nuevo, estas últimas se crean con [docs/sql/control-permisos.sql](docs/sql/control-permisos.sql),
  que también crea un administrador inicial.
- Un usuario en `USUARIOS` con nivel de acceso. Los usuarios locales entran desde cualquier equipo;
  los de dominio, solo desde un equipo Windows que alcance el directorio activo.

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
| Frontend | `cd Frontend`, `npm ci` la primera vez y `npm start` | http://localhost:4300 |

El frontend en desarrollo reenvía `/api` a la API local (`proxy.conf.json`).

### Pruebas

- API: `cd Backend` y `dotnet test`.
- Frontend: `cd Frontend` y `npx ng test --watch=false`.
