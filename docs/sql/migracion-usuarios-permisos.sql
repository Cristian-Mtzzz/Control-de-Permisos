-- =====================================================================================
-- Control de permisos - Usuarios propios en USUARIOS_PERMISOS
--
-- Hasta ahora el sistema usaba USUARIOS, la tabla del inventario: sus cuentas propias tenían
-- ROL = 'Permisos' y a una cuenta de inventario se le podía "dar acceso". Desde esta versión
-- los usuarios del Control de permisos viven solo en USUARIOS_PERMISOS: el inicio de sesión,
-- el nivel de acceso y la administración de usuarios ya no leen ni escriben USUARIOS.
--
-- El script crea la tabla y copia a todos los usuarios que hoy tienen acceso (las cuentas
-- propias y las de inventario con un nivel), con el mismo ID, usuario, contraseña, dominio,
-- estado, vencimiento y nivel: cada uno sigue entrando igual que antes. Las cuentas de
-- inventario copiadas quedan independientes: un cambio de contraseña en el inventario ya no
-- aplica aquí (las de dominio siguen validándose contra Active Directory).
--
-- USUARIOS no se modifica. La limpieza del final es opcional y va comentada.
-- Cada CREATE se confirma solo en Oracle: si un paso falla, corregir y seguir desde ahí.
-- =====================================================================================

-- -------------------------------------------------------------------------------------
-- 1. Tabla de usuarios del Control de permisos (un solo nivel por usuario):
--      PERMISO_ADMIN = 1   -> administrador general (todos los departamentos).
--      ID_DEPTO_PERMISO    -> jefe (administrador) de ese departamento.
--      ID_AREA_PERMISO     -> jefe de esa área.
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
    FECHA_REGISTRO    DATE           DEFAULT SYSDATE NOT NULL,
    CONSTRAINT PK_USUARIOS_PERMISOS PRIMARY KEY (ID_USUARIO),
    CONSTRAINT CK_USU_PERM_DOMINIO CHECK (DOMINIO IN (0, 1)),
    CONSTRAINT CK_USU_PERM_CLAVE CHECK (CLAVE_SEGURA IN ('0', '1')),
    CONSTRAINT CK_USU_PERM_ESTADO CHECK (ESTADO IN ('ACTIVO', 'INACTIVO')),
    CONSTRAINT CK_USU_PERM_ADMIN CHECK (PERMISO_ADMIN IN (0, 1)),
    CONSTRAINT CK_USU_PERM_UN_NIVEL CHECK (
        PERMISO_ADMIN
        + CASE WHEN ID_DEPTO_PERMISO IS NULL THEN 0 ELSE 1 END
        + CASE WHEN ID_AREA_PERMISO IS NULL THEN 0 ELSE 1 END <= 1),
    CONSTRAINT FK_USU_PERM_DEPTO FOREIGN KEY (ID_DEPTO_PERMISO)
        REFERENCES PERMISO_DEPARTAMENTO (DEPARTAMENTO_IHSS_ID),
    CONSTRAINT FK_USU_PERM_AREA FOREIGN KEY (ID_AREA_PERMISO)
        REFERENCES PERMISO_AREA (ID_AREA)
);
-- El login busca por el usuario sin distinguir mayúsculas ni espacios: no se puede repetir.
CREATE UNIQUE INDEX UX_USUARIOS_PERMISOS_USUARIO ON USUARIOS_PERMISOS (LOWER(TRIM(USUARIO)));
-- Índices de las llaves foráneas: sin ellos, cambiar un área o un departamento bloquea la tabla.
CREATE INDEX IX_USUARIOS_PERMISOS_DEPTO ON USUARIOS_PERMISOS (ID_DEPTO_PERMISO);
CREATE INDEX IX_USUARIOS_PERMISOS_AREA ON USUARIOS_PERMISOS (ID_AREA_PERMISO);

-- -------------------------------------------------------------------------------------
-- 2. Copia de los usuarios con acceso: las cuentas propias (ROL = 'Permisos') y las de
--    inventario con algún nivel. La consulta ya no existe como nivel: si quedara alguna, se
--    copia sin nivel y el administrador le asigna uno.
-- -------------------------------------------------------------------------------------
INSERT INTO USUARIOS_PERMISOS
    (ID_USUARIO, USUARIO, NOMBRE_PERSONA, PASSWORD_HASH, DOMINIO, DOMINIOP, CLAVE_SEGURA, ESTADO,
     FECHA_EXPIRACION, PERMISO_ADMIN, ID_DEPTO_PERMISO, ID_AREA_PERMISO)
SELECT u.ID_USUARIO, TRIM(u.USUARIO), u.NOMBRE_PERSONA, u.PASSWORD_HASH,
       NVL(u.DOMINIO, 0), NVL(UPPER(TRIM(u.DOMINIOP)), 'BA'),
       CASE WHEN u.CLAVE_SEGURA = '1' THEN '1' ELSE '0' END,
       CASE WHEN UPPER(TRIM(u.ESTADO)) = 'ACTIVO' THEN 'ACTIVO' ELSE 'INACTIVO' END,
       u.FECHA_EXPIRACION,
       u.PERMISO_ADMIN,
       CASE WHEN u.PERMISO_ADMIN = 1 THEN NULL ELSE u.ID_DEPTO_PERMISO END,
       CASE WHEN u.PERMISO_ADMIN = 1 OR u.ID_DEPTO_PERMISO IS NOT NULL THEN NULL ELSE u.ID_AREA_PERMISO END
FROM USUARIOS u
WHERE u.ROL = 'Permisos'
   OR u.PERMISO_ADMIN = 1
   OR u.PERMISO_CONSULTA = 1
   OR u.ID_DEPTO_PERMISO IS NOT NULL
   OR u.ID_AREA_PERMISO IS NOT NULL;

COMMIT;

-- Revisión: deben salir los mismos usuarios con el mismo nivel.
--   SELECT ID_USUARIO, USUARIO, ESTADO, DOMINIO, PERMISO_ADMIN, ID_DEPTO_PERMISO, ID_AREA_PERMISO
--   FROM USUARIOS_PERMISOS ORDER BY ID_USUARIO;

-- -------------------------------------------------------------------------------------
-- 3. Limpieza opcional de USUARIOS, cuando la API nueva ya esté en uso y probada. Quita el
--    acceso a permisos de las cuentas de inventario y borra las cuentas propias de permisos
--    (el inventario no las usa). Las columnas PERMISO_* de USUARIOS pueden quedarse.
-- -------------------------------------------------------------------------------------
-- UPDATE USUARIOS SET PERMISO_ADMIN = 0, PERMISO_CONSULTA = 0, ID_DEPTO_PERMISO = NULL, ID_AREA_PERMISO = NULL
-- WHERE NVL(ROL, '-') <> 'Permisos';
-- DELETE FROM USUARIOS WHERE ROL = 'Permisos';
-- COMMIT;
