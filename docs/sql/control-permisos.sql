-- =====================================================================================
-- Control de permisos - Instalación en un esquema nuevo
--
-- Crea las tablas PERMISO_*, la de usuarios del sistema (USUARIOS_PERMISOS) y un
-- administrador inicial. Deja la base igual que la de producción, que llegó a este estado con
-- varios scripts de migración (el último, migracion-usuarios-permisos.sql).
--
-- Requisitos: el esquema ya tiene las tablas del inventario que el sistema comparte. Las
-- columnas que usa la API son (USUARIOS del inventario ya no se usa):
--   EMPLEADOS_IHSS    (EMPLEADOS_IHSS_ID, NOMBRE_EMPLEADO, NPAGO, DEPARTAMENTO_IHSS_ID, ESTADO 1/0)
--   DEPARTAMENTO_IHSS (DEPARTAMENTO_IHSS_ID, DEPARTAMENTO_IHSS_DESC, EDIFICIO_ID, REGIONA_ID)
--   EDIFICIO          (EDIFICIO_ID, EDIFICIO_DESCRIPCION, REGIONA_ID)
--   REGIONAL          (REGIONA_ID, DESCRIPCION)  - filtros de "Agregar departamento".
--   LOGIN_CONFIG      (CLAVE, VALOR) - opcional: sin ella se usan los límites de appsettings.json.
--
-- Cada CREATE/ALTER se confirma solo en Oracle: si un paso falla, corregir y seguir desde ahí.
-- =====================================================================================

-- -------------------------------------------------------------------------------------
-- 1. Parámetros generales (jornada y límites). VALOR vacío (NULL) = sin límite.
-- -------------------------------------------------------------------------------------
CREATE TABLE PERMISO_PARAMETRO (
    CLAVE        VARCHAR2(50)  NOT NULL,
    VALOR        VARCHAR2(200),
    DESCRIPCION  VARCHAR2(300),
    CONSTRAINT PK_PERMISO_PARAMETRO PRIMARY KEY (CLAVE),
    -- Horas HH:mm y límites numéricos (punto decimal): un valor mal escrito no se puede guardar.
    CONSTRAINT CK_PERMISO_PARAMETRO_VALOR CHECK (
        VALOR IS NULL
        OR (CLAVE IN ('HORA_INICIO_JORNADA', 'HORA_FIN_JORNADA') AND REGEXP_LIKE(VALOR, '^([01]?[0-9]|2[0-3]):[0-5][0-9]$'))
        OR (CLAVE NOT IN ('HORA_INICIO_JORNADA', 'HORA_FIN_JORNADA') AND REGEXP_LIKE(VALOR, '^[0-9]+(\.[0-9]+)?$')))
);

INSERT INTO PERMISO_PARAMETRO (CLAVE, VALOR, DESCRIPCION) VALUES
    ('HORA_INICIO_JORNADA', '08:00', 'Inicio de la jornada laboral (HH:mm, 24 horas)');
INSERT INTO PERMISO_PARAMETRO (CLAVE, VALOR, DESCRIPCION) VALUES
    ('HORA_FIN_JORNADA', '16:00', 'Fin de la jornada laboral (HH:mm, 24 horas). Una jornada completa equivale a 1 día');
INSERT INTO PERMISO_PARAMETRO (CLAVE, VALOR, DESCRIPCION) VALUES
    ('MAX_DIAS_POR_PERMISO', NULL, 'Máximo de días hábiles en un solo permiso por día. Vacío = sin límite');
INSERT INTO PERMISO_PARAMETRO (CLAVE, VALOR, DESCRIPCION) VALUES
    ('MAX_HORAS_POR_PERMISO', NULL, 'Máximo de horas en un solo permiso por hora (admite decimales: 1.5). Vacío = sin límite');
INSERT INTO PERMISO_PARAMETRO (CLAVE, VALOR, DESCRIPCION) VALUES
    ('MAX_HORAS_POR_MES', NULL, 'Máximo de horas de permiso por hora que un empleado puede usar en un mes. Vacío = sin límite');
INSERT INTO PERMISO_PARAMETRO (CLAVE, VALOR, DESCRIPCION) VALUES
    ('MAX_DIAS_POR_ANIO', NULL, 'Máximo de días por empleado en el año; suma días y horas (jornada completa = 1 día). Vacío = sin límite');
-- Tope mensual: 2 días (16 horas con jornada de 8 h) por empleado en cada mes.
INSERT INTO PERMISO_PARAMETRO (CLAVE, VALOR, DESCRIPCION) VALUES
    ('MAX_DIAS_POR_MES', '2', 'Máximo de días de permiso por empleado en un mes; suma días y horas (jornada completa = 1 día). Vacío = sin límite');

-- -------------------------------------------------------------------------------------
-- 2. Departamentos que usan el sistema. Después se agregan o desactivan desde la pantalla
--    "Departamentos, áreas y jefes" del administrador general.
-- -------------------------------------------------------------------------------------
CREATE TABLE PERMISO_DEPARTAMENTO (
    DEPARTAMENTO_IHSS_ID  NUMBER        NOT NULL,
    ESTADO                VARCHAR2(10)  DEFAULT 'ACTIVO' NOT NULL,
    CONSTRAINT PK_PERMISO_DEPARTAMENTO PRIMARY KEY (DEPARTAMENTO_IHSS_ID),
    CONSTRAINT FK_PERMISO_DEPTO_IHSS FOREIGN KEY (DEPARTAMENTO_IHSS_ID)
        REFERENCES DEPARTAMENTO_IHSS (DEPARTAMENTO_IHSS_ID),
    CONSTRAINT CK_PERMISO_DEPTO_ESTADO CHECK (ESTADO IN ('ACTIVO', 'INACTIVO'))
);

-- -------------------------------------------------------------------------------------
-- 3. Parámetros propios de un departamento: reemplazan al general (VALOR vacío = sin límite
--    en ese departamento). Ejemplo, otra jornada para el departamento 146:
--      INSERT INTO PERMISO_PARAMETRO_DEPTO (DEPARTAMENTO_IHSS_ID, CLAVE, VALOR) VALUES (146, 'HORA_INICIO_JORNADA', '07:00');
--      INSERT INTO PERMISO_PARAMETRO_DEPTO (DEPARTAMENTO_IHSS_ID, CLAVE, VALOR) VALUES (146, 'HORA_FIN_JORNADA', '15:00');
-- -------------------------------------------------------------------------------------
CREATE TABLE PERMISO_PARAMETRO_DEPTO (
    DEPARTAMENTO_IHSS_ID  NUMBER         NOT NULL,
    CLAVE                 VARCHAR2(50)   NOT NULL,
    VALOR                 VARCHAR2(200),
    CONSTRAINT PK_PERMISO_PARAMETRO_DEPTO PRIMARY KEY (DEPARTAMENTO_IHSS_ID, CLAVE),
    CONSTRAINT FK_PERMISO_PARAM_DEPTO_DEPTO FOREIGN KEY (DEPARTAMENTO_IHSS_ID)
        REFERENCES PERMISO_DEPARTAMENTO (DEPARTAMENTO_IHSS_ID),
    CONSTRAINT FK_PERMISO_PARAM_DEPTO_CLAVE FOREIGN KEY (CLAVE)
        REFERENCES PERMISO_PARAMETRO (CLAVE),
    CONSTRAINT CK_PERMISO_PARAM_DEPTO_VALOR CHECK (
        VALOR IS NULL
        OR (CLAVE IN ('HORA_INICIO_JORNADA', 'HORA_FIN_JORNADA') AND REGEXP_LIKE(VALOR, '^([01]?[0-9]|2[0-3]):[0-5][0-9]$'))
        OR (CLAVE NOT IN ('HORA_INICIO_JORNADA', 'HORA_FIN_JORNADA') AND REGEXP_LIKE(VALOR, '^[0-9]+(\.[0-9]+)?$')))
);

-- -------------------------------------------------------------------------------------
-- 4. Feriados: no cuentan como días hábiles ni admiten permisos por hora. Los fines de semana
--    se excluyen siempre. DEPARTAMENTO_IHSS_ID vacío = aplica a todos los departamentos.
--      INSERT INTO PERMISO_FERIADO (FECHA, DESCRIPCION) VALUES (DATE '2026-12-25', 'Navidad');
-- -------------------------------------------------------------------------------------
CREATE TABLE PERMISO_FERIADO (
    FECHA                 DATE          NOT NULL,
    DESCRIPCION           VARCHAR2(200),
    DEPARTAMENTO_IHSS_ID  NUMBER,
    CONSTRAINT FK_PERMISO_FERIADO_DEPTO FOREIGN KEY (DEPARTAMENTO_IHSS_ID)
        REFERENCES PERMISO_DEPARTAMENTO (DEPARTAMENTO_IHSS_ID)
);
CREATE INDEX IX_PERMISO_FERIADO_DEPTO ON PERMISO_FERIADO (DEPARTAMENTO_IHSS_ID);
CREATE UNIQUE INDEX UX_PERMISO_FERIADO ON PERMISO_FERIADO (FECHA, NVL(DEPARTAMENTO_IHSS_ID, 0));

-- -------------------------------------------------------------------------------------
-- 5. Áreas (jefaturas) de cada departamento. El nombre solo se repite entre departamentos.
-- -------------------------------------------------------------------------------------
CREATE TABLE PERMISO_AREA (
    ID_AREA               NUMBER(10)    NOT NULL,
    NOMBRE                VARCHAR2(100 CHAR) NOT NULL,
    ESTADO                VARCHAR2(10)  DEFAULT 'ACTIVO' NOT NULL,
    DEPARTAMENTO_IHSS_ID  NUMBER        NOT NULL,
    CONSTRAINT PK_PERMISO_AREA PRIMARY KEY (ID_AREA),
    CONSTRAINT UQ_PERMISO_AREA_NOMBRE UNIQUE (DEPARTAMENTO_IHSS_ID, NOMBRE),
    CONSTRAINT CK_PERMISO_AREA_ESTADO CHECK (ESTADO IN ('ACTIVO', 'INACTIVO')),
    CONSTRAINT FK_PERMISO_AREA_DEPTO FOREIGN KEY (DEPARTAMENTO_IHSS_ID)
        REFERENCES PERMISO_DEPARTAMENTO (DEPARTAMENTO_IHSS_ID)
);
CREATE INDEX IX_PERMISO_AREA_DEPTO ON PERMISO_AREA (DEPARTAMENTO_IHSS_ID);

-- -------------------------------------------------------------------------------------
-- 6. Área de cada empleado (una por empleado). La llenan los jefes desde "Personal".
--    ID_EMPLEADO corresponde a EMPLEADOS_IHSS.EMPLEADOS_IHSS_ID.
-- -------------------------------------------------------------------------------------
CREATE TABLE PERMISO_AREA_EMPLEADO (
    ID_EMPLEADO  NUMBER(10) NOT NULL,
    ID_AREA      NUMBER(10) NOT NULL,
    CONSTRAINT PK_PERMISO_AREA_EMPLEADO PRIMARY KEY (ID_EMPLEADO),
    CONSTRAINT FK_PERMISO_AREA_EMPLEADO_AREA FOREIGN KEY (ID_AREA) REFERENCES PERMISO_AREA (ID_AREA)
);
CREATE INDEX IX_PERMISO_AREA_EMPLEADO_AREA ON PERMISO_AREA_EMPLEADO (ID_AREA);

-- -------------------------------------------------------------------------------------
-- 7. Permisos y vacaciones registrados.
--    DIA:  FECHA_INICIO..FECHA_FIN, DIAS_HABILES calculado por la API, MINUTOS = 0.
--    HORA: FECHA_INICIO = FECHA_FIN, HORA_SALIDA y HORA_ENTRADA en HH:mm, MINUTOS calculado.
--    VAC:  vacaciones, como DIA, con MOTIVO = 'VACACIONES' y la FECHA_SOLICITUD indicada; chocan
--          con los permisos, pero no cuentan en sus límites.
--    Anular no borra: ESTADO pasa a ANULADO y el permiso deja de contar.
--    ID_AREA es el área del empleado al registrarlo: el historial se queda en esa área.
--    NO_PAGO es el No. de pago del permiso (el formulario lo carga de EMPLEADOS_IHSS.NPAGO);
--    vacío en las vacaciones.
--    LUGAR_SOLICITUD y TELEFONO: lugar desde donde se solicita y teléfono donde localizar al
--    empleado, solo en el permiso por día (los pide su formato de impresión).
-- -------------------------------------------------------------------------------------
CREATE TABLE PERMISO_SOLICITUD (
    ID_PERMISO       NUMBER(10)     NOT NULL,
    TIPO             VARCHAR2(4)    NOT NULL,
    ID_EMPLEADO      NUMBER(10)     NOT NULL,
    MOTIVO           VARCHAR2(1000 CHAR) NOT NULL,
    FECHA_INICIO     DATE           NOT NULL,
    FECHA_FIN        DATE           NOT NULL,
    HORA_SALIDA      VARCHAR2(5),
    HORA_ENTRADA     VARCHAR2(5),
    DIAS_HABILES     NUMBER(5)      DEFAULT 0 NOT NULL,
    MINUTOS          NUMBER(5)      DEFAULT 0 NOT NULL,
    NO_PAGO          VARCHAR2(20 CHAR),
    LUGAR_SOLICITUD  VARCHAR2(200),
    TELEFONO         VARCHAR2(20 CHAR),
    FECHA_SOLICITUD  DATE,
    ESTADO           VARCHAR2(10)   DEFAULT 'ACTIVO' NOT NULL,
    FECHA_REGISTRO   DATE           DEFAULT SYSDATE NOT NULL,
    ID_AREA          NUMBER(10),
    CONSTRAINT PK_PERMISO_SOLICITUD PRIMARY KEY (ID_PERMISO),
    CONSTRAINT CK_PERMISO_SOLICITUD_TIPO CHECK (TIPO IN ('DIA', 'HORA', 'VAC')),
    CONSTRAINT CK_PERMISO_SOLICITUD_ESTADO CHECK (ESTADO IN ('ACTIVO', 'ANULADO')),
    CONSTRAINT CK_PERMISO_SOLICITUD_FECHAS CHECK (FECHA_FIN >= FECHA_INICIO),
    CONSTRAINT FK_PERMISO_SOLICITUD_AREA FOREIGN KEY (ID_AREA) REFERENCES PERMISO_AREA (ID_AREA)
);
CREATE INDEX IX_PERMISO_SOLICITUD_EMPLEADO ON PERMISO_SOLICITUD (ID_EMPLEADO, ESTADO);
CREATE INDEX IX_PERMISO_SOLICITUD_FECHA ON PERMISO_SOLICITUD (FECHA_INICIO);
-- La pantalla pide los permisos que terminan desde una fecha (FECHA_FIN >= :desde).
CREATE INDEX IX_PERMISO_SOLICITUD_FECHA_FIN ON PERMISO_SOLICITUD (FECHA_FIN);
CREATE INDEX IX_PERMISO_SOLICITUD_AREA ON PERMISO_SOLICITUD (ID_AREA);

-- -------------------------------------------------------------------------------------
-- 8. Usuarios del Control de permisos, aparte de USUARIOS del inventario (un solo nivel por usuario):
--      PERMISO_ADMIN = 1   -> administrador general (todos los departamentos).
--      ID_DEPTO_PERMISO    -> jefe (administrador) de ese departamento, o su secretaría cuando
--                             PERMISO_SECRETARIA = 1 (ve y exporta ese departamento, no registra).
--      ID_AREA_PERMISO     -> jefe de esa área.
--      ID_EMPLEADO_PERMISO -> ese empleado: ve y registra solo sus propios permisos.
--    DOMINIO = 1: entra con su cuenta de Active Directory (DOMINIOP); 0: usuario local.
--    CLAVE_SEGURA = '0': usuario local con la contraseña inicial, debe cambiarla al entrar.
-- -------------------------------------------------------------------------------------
CREATE TABLE USUARIOS_PERMISOS (
    ID_USUARIO        NUMBER(10)     NOT NULL,
    USUARIO           VARCHAR2(150)  NOT NULL,
    NOMBRE_PERSONA    VARCHAR2(256),
    PASSWORD_HASH     VARCHAR2(256)  NOT NULL,
    DOMINIO           NUMBER(1)      DEFAULT 0 NOT NULL,
    DOMINIOP          VARCHAR2(20),
    CLAVE_SEGURA      VARCHAR2(1)    DEFAULT '0' NOT NULL,
    ESTADO            VARCHAR2(10)   DEFAULT 'ACTIVO' NOT NULL,
    FECHA_EXPIRACION  DATE,
    PERMISO_ADMIN     NUMBER(1)      DEFAULT 0 NOT NULL,
    ID_DEPTO_PERMISO  NUMBER,
    ID_AREA_PERMISO   NUMBER(10),
    PERMISO_SECRETARIA NUMBER(1)     DEFAULT 0 NOT NULL,
    ID_EMPLEADO_PERMISO NUMBER,
    FECHA_REGISTRO    DATE           DEFAULT SYSDATE NOT NULL,
    CONSTRAINT PK_USUARIOS_PERMISOS PRIMARY KEY (ID_USUARIO),
    CONSTRAINT CK_USU_PERM_DOMINIO CHECK (DOMINIO IN (0, 1)),
    CONSTRAINT CK_USU_PERM_CLAVE CHECK (CLAVE_SEGURA IN ('0', '1')),
    CONSTRAINT CK_USU_PERM_ESTADO CHECK (ESTADO IN ('ACTIVO', 'INACTIVO')),
    CONSTRAINT CK_USU_PERM_ADMIN CHECK (PERMISO_ADMIN IN (0, 1)),
    CONSTRAINT CK_USU_PERM_UN_NIVEL CHECK (
        PERMISO_ADMIN
        + CASE WHEN ID_DEPTO_PERMISO IS NULL THEN 0 ELSE 1 END
        + CASE WHEN ID_AREA_PERMISO IS NULL THEN 0 ELSE 1 END
        + CASE WHEN ID_EMPLEADO_PERMISO IS NULL THEN 0 ELSE 1 END <= 1),
    -- La secretaría es la de su departamento: sin departamento no hay a quién pertenecer.
    CONSTRAINT CK_USU_PERM_SECRETARIA CHECK (
        PERMISO_SECRETARIA IN (0, 1) AND (PERMISO_SECRETARIA = 0 OR ID_DEPTO_PERMISO IS NOT NULL)),
    CONSTRAINT FK_USU_PERM_DEPTO FOREIGN KEY (ID_DEPTO_PERMISO)
        REFERENCES PERMISO_DEPARTAMENTO (DEPARTAMENTO_IHSS_ID),
    CONSTRAINT FK_USU_PERM_AREA FOREIGN KEY (ID_AREA_PERMISO)
        REFERENCES PERMISO_AREA (ID_AREA),
    CONSTRAINT FK_USU_PERM_EMPLEADO FOREIGN KEY (ID_EMPLEADO_PERMISO)
        REFERENCES EMPLEADOS_IHSS (EMPLEADOS_IHSS_ID)
);
-- El login busca por el usuario sin distinguir mayúsculas ni espacios: no se puede repetir.
CREATE UNIQUE INDEX UX_USUARIOS_PERMISOS_USUARIO ON USUARIOS_PERMISOS (LOWER(TRIM(USUARIO)));
-- Índices de las llaves foráneas: sin ellos, cambiar un área o un departamento bloquea la tabla.
CREATE INDEX IX_USUARIOS_PERMISOS_DEPTO ON USUARIOS_PERMISOS (ID_DEPTO_PERMISO);
CREATE INDEX IX_USUARIOS_PERMISOS_AREA ON USUARIOS_PERMISOS (ID_AREA_PERMISO);
-- Un empleado tiene una sola cuenta; este índice es además el de su llave foránea.
CREATE UNIQUE INDEX UX_USUARIOS_PERMISOS_EMPL ON USUARIOS_PERMISOS (ID_EMPLEADO_PERMISO);

COMMIT;

-- -------------------------------------------------------------------------------------
-- 9. Primer departamento y administrador general. Con él se crean las áreas, los jefes y los
--    demás usuarios desde la pantalla. Antes de ejecutar, cambiar:
--      :ID_DEPARTAMENTO  -> DEPARTAMENTO_IHSS_ID del departamento que empieza a usar el sistema.
--      'admin.permisos'  -> el usuario del administrador, y el nombre de la persona.
--    Entra con la contraseña inicial 1234 y el sistema le pide cambiarla (CLAVE_SEGURA = '0').
--    Se guarda en el formato anterior (ORA_HASH) y la API la convierte a BCrypt al entrar.
--    Para un usuario de directorio activo: DOMINIO = 1 y DOMINIOP = su dominio (CLAVE_SEGURA se deja en
--    '0': si algún día pasa a local, entra con 1234 y debe cambiarla).
-- -------------------------------------------------------------------------------------
INSERT INTO PERMISO_DEPARTAMENTO (DEPARTAMENTO_IHSS_ID, ESTADO) VALUES (:ID_DEPARTAMENTO, 'ACTIVO');

INSERT INTO USUARIOS_PERMISOS
    (ID_USUARIO, USUARIO, NOMBRE_PERSONA, FECHA_EXPIRACION, ESTADO,
     PASSWORD_HASH, DOMINIOP, DOMINIO, CLAVE_SEGURA, PERMISO_ADMIN)
SELECT NVL(MAX(ID_USUARIO), 0) + 1, 'admin.permisos', 'Administrador de permisos', NULL, 'ACTIVO',
       ORA_HASH('1234', 4294967295) || ORA_HASH('admin.permisos', 4294967295),
       'BA', 0, '0', 1
FROM USUARIOS_PERMISOS
-- Si el script se vuelve a ejecutar, no duplica el usuario.
HAVING NOT EXISTS (SELECT 1 FROM USUARIOS_PERMISOS WHERE USUARIO = 'admin.permisos');

COMMIT;
