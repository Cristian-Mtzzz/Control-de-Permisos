# Control de Permisos

Sistema web para registrar y controlar los permisos de los empleados de una institución, organizados por departamento y área.

## Tecnologías

- **Backend:** ASP.NET Core 8 (API REST) con Oracle y autenticación JWT.
- **Frontend:** Angular.
- **Reportes:** archivos Excel generados en el navegador.

## Funciones

Las secciones están en la barra lateral; cada usuario ve solo las de su nivel.

| Sección | Para qué sirve |
| --- | --- |
| **Resumen** | Quién tiene permiso o vacaciones hoy, esta semana y este mes, en pestañas con su total: la jornada de hoy como franja horaria, la semana de lunes a domingo y la lista del mes, con el mes agrupado por área (o por empleado, para el jefe). Se cambia entre permisos y vacaciones; desde aquí solo se exporta el reporte. |
| **Permisos** | Registro de permisos por día (días hábiles) y por hora (dentro de la jornada), con revisión de choques y límites (tope de 2 días, 16 horas, por empleado al mes), edición, anulación, historial por empleado y reporte en Excel. El formulario pide empleado, No. de pago (se carga del empleado al elegirlo, o se escribe si no lo tiene, y se guarda en el permiso), motivo, salida, regreso y fecha de solicitud (la del sistema); el de día pide además el teléfono donde localizar al empleado y el lugar. Cada permiso se imprime en el formato oficial (día u horas) desde el botón **Imprimir**; los dos logos de su encabezado salen de la tabla `PERMISO_LOGO` (se cargan en la base, ver `docs/sql/migracion-logos.sql`) y, mientras esté vacía, de `public/impresion`. **Generar memorando** arma el memo de remisión de permisos a Recursos Humanos en PDF, con el membrete del IHSS (`public/impresion/membrete-memo.jpg`): número, Para, De, asunto y fecha, y una tabla con nombre, No. de pago, fecha de salida, días (permiso por día) u horas (por hora, `10:00-15:30`) de los permisos marcados del rango; el PDF se arma en el navegador sin librerías (`memo-pdf.ts`) y el formulario no se guarda: empieza en blanco cada vez. En **Vacaciones**, el nombre del empleado abre sus vacaciones (el historial lista permisos o vacaciones según la sección, nunca mezclados) y cada período tiene su botón **Generar memorando**, que arma el memo de remisión de esa solicitud: los días hábiles de los períodos marcados en letras y número (`DIECIOCHO (18)`), nombre y No. de pago en negrita y subrayados, y una línea por período (`Del 16 al 30 de noviembre del 2026, inclusive (2024-2025)`, lo de entre paréntesis se escribe al crearlo). El administrador elige departamento y área para ver y registrar; sin departamento no se ofrecen áreas, y **Todas las áreas** junta las de ese departamento (también las que se agreguen después) en la tabla, el resumen, el reporte y el memorando. |
| **Vacaciones** | Registro de vacaciones por empleado: fecha de inicio, de finalización (cuenta días hábiles) y de solicitud (hoy o antes). Una solicitud puede llevar varios períodos (botón **+**); cada uno se guarda aparte y se edita o anula por separado. No cuentan en los límites de permisos, pero un empleado no puede tener un permiso dentro de sus vacaciones. |
| **Personal** | Empleados de cada área. Cada jefe agrega a su gente; los administradores la mueven entre áreas. El No. de pago de cada empleado se edita en la tabla y se guarda con Enter (es el que el formulario del permiso carga al elegirlo). |
| **Mantenimiento** | Departamentos que usan el sistema, sus áreas y los usuarios con su nivel de acceso (crear, editar, eliminar y restablecer contraseña). |

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
- Acceso a una base Oracle con las tablas que el sistema comparte con el inventario
  (`EMPLEADOS_IHSS`, `DEPARTAMENTO_IHSS`, `EDIFICIO`, `REGIONAL` y, opcional, `LOGIN_CONFIG`) y las
  del Control de permisos.
  En un esquema nuevo, estas últimas se crean con [docs/sql/control-permisos.sql](docs/sql/control-permisos.sql),
  que también crea un administrador inicial.
- Un usuario en `USUARIOS_PERMISOS` con nivel de acceso. Los usuarios locales entran desde cualquier equipo;
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
| Frontend | `cd Frontend`, `npm ci` la primera vez y `npm start` | http://localhost:50307 |

El frontend en desarrollo reenvía `/api` a la API local (`proxy.conf.json`).

### Pruebas

- API: `cd Backend` y `dotnet test`.
- Frontend: `cd Frontend` y `npx ng test --watch=false`.
