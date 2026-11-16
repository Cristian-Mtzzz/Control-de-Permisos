# Base de datos del Control de Permisos

El sistema usa la base Oracle del inventario (esquema `TRANSACIONES_SOPORTE`). Ahí tiene **8 tablas
propias**, que crea [sql/control-permisos.sql](sql/control-permisos.sql), y **lee 5 tablas del
inventario** sin modificarlas. La tabla `USUARIOS` del inventario ya no se usa: los usuarios del sistema
están en `USUARIOS_PERMISOS`.

La descripción de cada tabla y columna propia también está en la base, en los comentarios de Oracle
([sql/comentarios-tablas.sql](sql/comentarios-tablas.sql)):

```sql
SELECT TABLE_NAME, COMMENTS FROM USER_TAB_COMMENTS
WHERE TABLE_NAME LIKE 'PERMISO%' OR TABLE_NAME = 'USUARIOS_PERMISOS';

SELECT COLUMN_NAME, COMMENTS FROM USER_COL_COMMENTS WHERE TABLE_NAME = 'PERMISO_SOLICITUD';
```

## Resumen

| Tabla | Qué guarda | Quién la llena |
| --- | --- | --- |
| [PERMISO_SOLICITUD](#permiso_solicitud) | Permisos por día, por hora y vacaciones | Secciones Permisos y Vacaciones |
| [PERMISO_DEPARTAMENTO](#permiso_departamento) | Departamentos que usan el sistema | Mantenimiento (administrador general) |
| [PERMISO_AREA](#permiso_area) | Áreas (jefaturas) de cada departamento | Mantenimiento |
| [PERMISO_AREA_EMPLEADO](#permiso_area_empleado) | Área de cada empleado | Personal |
| [USUARIOS_PERMISOS](#usuarios_permisos) | Usuarios del sistema y su nivel | Mantenimiento |
| [PERMISO_PARAMETRO](#permiso_parametro) | Jornada laboral y límites generales | Directo en la base |
| [PERMISO_PARAMETRO_DEPTO](#permiso_parametro_depto) | Jornada y límites propios de un departamento | Directo en la base |
| [PERMISO_FERIADO](#permiso_feriado) | Feriados | Directo en la base |
| [PERMISO_LOGO](#permiso_logo) | Logos del encabezado de los formatos de permiso | Directo en la base |
| [EMPLEADOS_IHSS](#tablas-del-inventario) | Empleados (solo se escribe `NPAGO`) | Inventario |
| [DEPARTAMENTO_IHSS](#tablas-del-inventario) | Departamentos de la institución (solo lectura) | Inventario |
| [EDIFICIO](#tablas-del-inventario), [REGIONAL](#tablas-del-inventario) | Edificios y regionales (solo lectura) | Inventario |
| [LOGIN_CONFIG](#tablas-del-inventario) | Límites de intentos de inicio de sesión (solo lectura) | Inventario |

Lo que se ajusta directo en la base (parámetros y feriados) se aplica con el `COMMIT`, sin reiniciar la API.

## Relaciones

```
DEPARTAMENTO_IHSS (inventario)
└── PERMISO_DEPARTAMENTO
    ├── PERMISO_AREA
    │   ├── PERMISO_AREA_EMPLEADO      un área por empleado
    │   ├── PERMISO_SOLICITUD          área del permiso al registrarlo
    │   └── USUARIOS_PERMISOS          jefe de área (ID_AREA_PERMISO)
    ├── USUARIOS_PERMISOS              jefe de departamento y su secretaría (ID_DEPTO_PERMISO)
    ├── PERMISO_PARAMETRO_DEPTO ──── PERMISO_PARAMETRO (CLAVE)
    └── PERMISO_FERIADO                feriados de ese departamento
```

Cada rama es una llave foránea: la tabla de abajo apunta a la de arriba. `ID_EMPLEADO` (en
`PERMISO_AREA_EMPLEADO` y `PERMISO_SOLICITUD`) apunta a `EMPLEADOS_IHSS.EMPLEADOS_IHSS_ID`, pero sin
llave foránea, porque esa tabla es del inventario.

## Tablas propias

### PERMISO_SOLICITUD

Permisos y vacaciones registrados, uno por fila. Es la tabla principal del sistema.

- **DIA:** un rango de días. Cuenta los días hábiles y suma en los límites de permisos.
- **HORA:** una franja de horas de un solo día, dentro de la jornada. Cuenta minutos.
- **VAC:** vacaciones. Cuentan días hábiles como el de día, pero no suman en los límites de permisos.
  Una solicitud con varios períodos guarda **una fila por período**, todas con la misma fecha de
  solicitud y en una sola transacción: si un período no se puede registrar, no se guarda ninguno.
  Después cada período se edita o se anula por separado.

Ningún registro activo de un empleado puede cruzarse con otro suyo, sea permiso o vacaciones.
Anular no borra: `ESTADO` pasa a `ANULADO` y el registro deja de contar en choques, límites y
totales. "Finalizado" no se guarda: la pantalla lo calcula cuando pasa el fin del permiso, y uno
finalizado ya no se edita ni se anula.

| Columna | Tipo | Descripción |
| --- | --- | --- |
| ID_PERMISO | NUMBER | Llave primaria. La API asigna el siguiente número con la tabla bloqueada. |
| TIPO | VARCHAR2(4) | `DIA`, `HORA` o `VAC`. Un permiso no pasa a vacaciones ni al revés. |
| ID_EMPLEADO | NUMBER | Empleado (`EMPLEADOS_IHSS.EMPLEADOS_IHSS_ID`). |
| MOTIVO | VARCHAR2(1000) | Motivo del permiso; en vacaciones siempre `VACACIONES`. |
| FECHA_INICIO | DATE | Primer día. En el de hora, el día del permiso. |
| FECHA_FIN | DATE | Último día, no antes del inicio. En el de hora, igual al inicio. |
| HORA_SALIDA | VARCHAR2(5) | Solo en el de hora: `HH:mm` en que sale. |
| HORA_ENTRADA | VARCHAR2(5) | Solo en el de hora: `HH:mm` en que regresa; ahí finaliza. |
| DIAS_HABILES | NUMBER | Días hábiles del rango, sin fines de semana ni feriados. 0 en el de hora. |
| MINUTOS | NUMBER | Duración del de hora. 0 en el de día y en vacaciones. |
| NO_PAGO | VARCHAR2(20) | No. de pago del permiso. El formulario lo carga de `EMPLEADOS_IHSS.NPAGO` al elegir el empleado (si no tiene, se escribe) y se guarda aquí, así el permiso conserva el número con que se registró aunque después cambie el del empleado. Vacío en vacaciones y en permisos anteriores a este campo. |
| LUGAR_SOLICITUD | VARCHAR2(200) | Solo en el permiso por día: lugar desde donde se solicita. Sale en "Lugar y Fecha" del formato impreso. |
| TELEFONO | VARCHAR2(20) | Solo en el permiso por día: teléfono donde localizar al empleado. Sale en "Donde localizarlo" del formato impreso. |
| FECHA_SOLICITUD | DATE | En permisos la pone el servidor al registrar y no cambia. En vacaciones se indica (hoy o antes). |
| ESTADO | VARCHAR2(10) | `ACTIVO` o `ANULADO`. |
| FECHA_REGISTRO | DATE | Fecha y hora del registro (`SYSDATE`). |
| ID_AREA | NUMBER | Área del empleado al registrarlo. Se conserva aunque el empleado cambie de área y decide quién puede editarlo. Vacía solo en permisos anteriores a las áreas. |

Restricciones: `CK_PERMISO_SOLICITUD_TIPO`, `CK_PERMISO_SOLICITUD_ESTADO`,
`CK_PERMISO_SOLICITUD_FECHAS` (`FECHA_FIN >= FECHA_INICIO`) y `FK_PERMISO_SOLICITUD_AREA`.
Índices por empleado y estado, `FECHA_INICIO`, `FECHA_FIN` (la pantalla carga lo que termina desde
una fecha) y área.

### PERMISO_DEPARTAMENTO

Departamentos de `DEPARTAMENTO_IHSS` que usan el sistema. Solo sus empleados aparecen en pantalla.

| Columna | Tipo | Descripción |
| --- | --- | --- |
| DEPARTAMENTO_IHSS_ID | NUMBER | Llave primaria y foránea a `DEPARTAMENTO_IHSS`. |
| ESTADO | VARCHAR2(10) | `ACTIVO` o `INACTIVO`. Solo se desactiva cuando no le quedan áreas activas ni administradores. |

### PERMISO_AREA

Áreas o jefaturas de cada departamento. Cada empleado pertenece a una y el jefe de área administra la suya.

| Columna | Tipo | Descripción |
| --- | --- | --- |
| ID_AREA | NUMBER | Llave primaria. |
| NOMBRE | VARCHAR2(100) | No se repite dentro del departamento (`UQ_PERMISO_AREA_NOMBRE`). |
| ESTADO | VARCHAR2(10) | `ACTIVO` o `INACTIVO`. Solo se desactiva cuando no tiene empleados ni jefes. |
| DEPARTAMENTO_IHSS_ID | NUMBER | Departamento (foránea a `PERMISO_DEPARTAMENTO`). |

### PERMISO_AREA_EMPLEADO

El área de cada empleado; un empleado tiene a lo sumo una. Se llena desde **Personal**. Un empleado
sin área no puede recibir permisos ni vacaciones. Si cambia de departamento en `EMPLEADOS_IHSS`, su
área deja de contar hasta que se le asigne una del departamento nuevo.

| Columna | Tipo | Descripción |
| --- | --- | --- |
| ID_EMPLEADO | NUMBER | Llave primaria; `EMPLEADOS_IHSS.EMPLEADOS_IHSS_ID`. |
| ID_AREA | NUMBER | Área actual (foránea a `PERMISO_AREA`). |

### PERMISO_LOGO

Los dos logos del encabezado de `Solicitud de permiso día` y `Permiso por horas`: cambian cada
período de gobierno y por eso están en la base. Sin fila para una clave, ese logo se imprime con el
que trae el sistema (`Frontend/public/impresion`). Cómo cargarlos: `docs/sql/migracion-logos.sql`.

| Columna | Tipo | Descripción |
| --- | --- | --- |
| CLAVE | VARCHAR2(20) | `IZQUIERDO` o `DERECHO`: el lugar que ocupa en el encabezado. Llave primaria. |
| TIPO_MIME | VARCHAR2(30) | `image/png` o `image/jpeg`. |
| NOMBRE_ARCHIVO | VARCHAR2(260) | Nombre del archivo cargado, solo para reconocerlo. |
| IMAGEN | BLOB | La imagen tal cual. |
| FECHA_ACTUALIZACION | DATE | Cuándo se cargó por última vez. |

### USUARIOS_PERMISOS

Usuarios que entran al sistema, aparte de los del inventario. Cada uno tiene un solo nivel
(`CK_USU_PERM_UN_NIVEL`):

| Nivel | Columna | Ve y administra |
| --- | --- | --- |
| Administrador general | `PERMISO_ADMIN = 1` | Todos los departamentos |
| Jefe de departamento | `ID_DEPTO_PERMISO` | Su departamento |
| Secretaría de departamento | `ID_DEPTO_PERMISO` + `PERMISO_SECRETARIA = 1` | Ve y exporta su departamento (reportes y memorandos); no registra ni administra |
| Jefe de área | `ID_AREA_PERMISO` | Su área |
| Usuario (empleado) | `ID_EMPLEADO_PERMISO` | Solo sus propios permisos y vacaciones: los registra e imprime, no los modifica después |

| Columna | Tipo | Descripción |
| --- | --- | --- |
| ID_USUARIO | NUMBER | Llave primaria. |
| USUARIO | VARCHAR2(150) | Con lo que entra. Único sin distinguir mayúsculas ni espacios. Con dominio, su cuenta de Active Directory. |
| NOMBRE_PERSONA | VARCHAR2(256) | Nombre de la persona. |
| PASSWORD_HASH | VARCHAR2(256) | Contraseña local en BCrypt. Las del formato anterior (`ORA_HASH`) se convierten al entrar. |
| DOMINIO | NUMBER | 1 = entra con Active Directory; 0 = usuario local. |
| DOMINIOP | VARCHAR2(20) | Dominio: `BA`, `HE`, `HRN` o `IVM`. |
| CLAVE_SEGURA | VARCHAR2(1) | `0` = tiene la contraseña inicial (1234) y debe cambiarla al entrar; `1` = ya la cambió. |
| ESTADO | VARCHAR2(10) | `ACTIVO` o `INACTIVO`; inactivo no entra. |
| FECHA_EXPIRACION | DATE | Último día en que puede entrar; vacía = sin vencimiento. |
| PERMISO_ADMIN | NUMBER | 1 = administrador general. |
| ID_DEPTO_PERMISO | NUMBER | Departamento del jefe de departamento o de su secretaría (foránea a `PERMISO_DEPARTAMENTO`). |
| ID_AREA_PERMISO | NUMBER | Área del jefe de área (foránea a `PERMISO_AREA`). |
| ID_EMPLEADO_PERMISO | NUMBER | Nivel USUARIO: empleado dueño de la cuenta (foránea a `EMPLEADOS_IHSS`); uno por empleado (`UX_USUARIOS_PERMISOS_EMPL`). |
| PERMISO_SECRETARIA | NUMBER | 1 = secretaría del departamento de `ID_DEPTO_PERMISO` (`CK_USU_PERM_SECRETARIA` exige que lo tenga). |
| FECHA_REGISTRO | DATE | Cuándo se creó. |

### PERMISO_PARAMETRO

Jornada laboral y límites generales. Valen para todos los departamentos, salvo los que tengan su
propio valor en `PERMISO_PARAMETRO_DEPTO`. Un `VALOR` vacío significa sin límite. Un valor mal escrito
no se puede guardar (`CK_PERMISO_PARAMETRO_VALOR`).

| CLAVE | Valor actual | Qué controla |
| --- | --- | --- |
| HORA_INICIO_JORNADA | 08:00 | Inicio de la jornada (`HH:mm`). Los permisos por hora no empiezan antes. |
| HORA_FIN_JORNADA | 16:00 | Fin de la jornada. Una jornada completa equivale a 1 día. |
| MAX_DIAS_POR_MES | 2 | Tope mensual por empleado; suma días y horas (2 días = 16 horas con jornada de 8 h). |
| MAX_DIAS_POR_PERMISO | vacío | Días hábiles máximos en un permiso por día. |
| MAX_HORAS_POR_PERMISO | vacío | Horas máximas en un permiso por hora (admite decimales). |
| MAX_HORAS_POR_MES | vacío | Horas de permisos por hora que un empleado puede usar al mes. |
| MAX_DIAS_POR_ANIO | vacío | Días por empleado en el año; suma días y horas. |

Columnas: `CLAVE` (llave primaria), `VALOR` y `DESCRIPCION`. Las vacaciones no tienen estos límites
ni suman en ellos.

### PERMISO_PARAMETRO_DEPTO

Reemplaza un parámetro general en un solo departamento. Por ejemplo, otra jornada:

```sql
INSERT INTO PERMISO_PARAMETRO_DEPTO (DEPARTAMENTO_IHSS_ID, CLAVE, VALOR) VALUES (146, 'HORA_INICIO_JORNADA', '07:00');
INSERT INTO PERMISO_PARAMETRO_DEPTO (DEPARTAMENTO_IHSS_ID, CLAVE, VALOR) VALUES (146, 'HORA_FIN_JORNADA', '15:00');
COMMIT;
```

Una fila con `VALOR` vacío quita ese límite solo en ese departamento. Columnas:
`DEPARTAMENTO_IHSS_ID` (foránea a `PERMISO_DEPARTAMENTO`), `CLAVE` (foránea a
`PERMISO_PARAMETRO`), que juntas forman la llave primaria, y `VALOR`.

### PERMISO_FERIADO

Días que no cuentan como hábiles en permisos por día ni en vacaciones, y en los que no se admiten
permisos por hora. Los sábados y domingos se excluyen siempre, sin registrarlos aquí.

```sql
INSERT INTO PERMISO_FERIADO (FECHA, DESCRIPCION) VALUES (DATE '2026-12-25', 'Navidad');
COMMIT;
```

| Columna | Tipo | Descripción |
| --- | --- | --- |
| FECHA | DATE | Día feriado; única por departamento (`UX_PERMISO_FERIADO`). |
| DESCRIPCION | VARCHAR2(200) | Motivo. |
| DEPARTAMENTO_IHSS_ID | NUMBER | Departamento al que aplica; vacío = todos. |

## Tablas del inventario

El sistema no crea estas tablas y solo las lee, con una excepción: la sección Personal escribe
`EMPLEADOS_IHSS.NPAGO` (el No. de pago del empleado). Sus comentarios en la base los mantiene el
inventario.

| Tabla | Columnas que lee | Para qué |
| --- | --- | --- |
| EMPLEADOS_IHSS | `EMPLEADOS_IHSS_ID`, `NOMBRE_EMPLEADO`, `NPAGO`, `DEPARTAMENTO_IHSS_ID`, `ESTADO` | Lista de empleados. `NPAGO` es el No. de pago que el formulario del permiso carga al elegir al empleado; es lo único que esta aplicación escribe en la tabla, desde la sección Personal (Enter guarda, vacío lo borra, y dos empleados activos no pueden tener el mismo). Solo aparecen los activos (`ESTADO = 1`) de departamentos habilitados, y solo a ellos se les registra. El departamento del empleado decide qué áreas le corresponden. |
| DEPARTAMENTO_IHSS | `DEPARTAMENTO_IHSS_ID`, `DEPARTAMENTO_IHSS_DESC`, `EDIFICIO_ID`, `REGIONA_ID` | Nombres de departamentos y la lista para "Agregar departamento". |
| EDIFICIO | `EDIFICIO_ID`, `EDIFICIO_DESCRIPCION`, `REGIONA_ID` | Filtro por edificio al agregar un departamento. |
| REGIONAL | `REGIONA_ID`, `DESCRIPCION` | Filtro por regional al agregar un departamento (la del departamento o, si no tiene, la de su edificio). |
| LOGIN_CONFIG | `CLAVE`, `VALOR` | Límites de inicio de sesión: `MAX_INTENTOS_USUARIO`, `MINUTOS_BLOQUEO` y `MAX_INTENTOS_IP_MINUTO`. Se releen cada minuto; sin la tabla se usan los de `appsettings.json`. |

## Qué tablas toca cada acción

| Acción en pantalla | Lee | Escribe |
| --- | --- | --- |
| Iniciar sesión | USUARIOS_PERMISOS, LOGIN_CONFIG | USUARIOS_PERMISOS (convierte la contraseña a BCrypt) |
| Ver el resumen o los registros | PERMISO_SOLICITUD, EMPLEADOS_IHSS, PERMISO_AREA, DEPARTAMENTO_IHSS, PERMISO_PARAMETRO(_DEPTO), PERMISO_FERIADO | — |
| Registrar, editar o anular un permiso o vacaciones | Las anteriores y PERMISO_AREA_EMPLEADO | PERMISO_SOLICITUD |
| Agregar o mover personal | EMPLEADOS_IHSS, PERMISO_AREA | PERMISO_AREA_EMPLEADO |
| Cambiar el No. de pago de un empleado (Personal) | EMPLEADOS_IHSS, PERMISO_DEPARTAMENTO, PERMISO_AREA_EMPLEADO, PERMISO_AREA | EMPLEADOS_IHSS (`NPAGO`) |
| Crear o editar áreas | PERMISO_AREA_EMPLEADO, USUARIOS_PERMISOS | PERMISO_AREA |
| Agregar o desactivar departamentos | DEPARTAMENTO_IHSS, EDIFICIO, REGIONAL | PERMISO_DEPARTAMENTO |
| Crear, editar, eliminar o restablecer usuarios | EMPLEADOS_IHSS | USUARIOS_PERMISOS |
