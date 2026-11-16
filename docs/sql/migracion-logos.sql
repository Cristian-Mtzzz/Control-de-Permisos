-- =====================================================================================
-- Control de permisos - Logos de los formatos de impresión
--
-- Los dos logos del encabezado de "Solicitud de permiso día" y "Permiso por horas" cambian
-- cada período de gobierno. Con esta tabla se guardan en la base y se cambian con un INSERT,
-- sin tocar el código ni los archivos del servidor.
--
-- IZQUIERDO es el que va a la izquierda del encabezado (hoy el del IHSS) y DERECHO el de la
-- derecha (hoy el de Honduras). Mientras la tabla esté vacía, la impresión usa los logos que
-- vienen con el sistema (Frontend/public/impresion), así que nada deja de funcionar. Lo mismo
-- vale para cada clave por separado: se puede cambiar uno y dejar el otro.
--
-- Cómo cargar un logo (PNG o JPG; con fondo transparente se ve mejor):
--
--   1. En SQL Developer: abrir la tabla, pestaña Data, celda IMAGEN, el lápiz, "Cargar" y elegir
--      el archivo; TIPO_MIME se escribe a mano ('image/png' o 'image/jpeg') y se confirma.
--
--   2. Por SQL, con el archivo en una carpeta del servidor de base de datos:
--
--      CREATE OR REPLACE DIRECTORY LOGOS_DIR AS 'C:\logos';   -- una sola vez, como DBA
--
--      DELETE FROM PERMISO_LOGO WHERE CLAVE = 'IZQUIERDO';
--      INSERT INTO PERMISO_LOGO (CLAVE, TIPO_MIME, NOMBRE_ARCHIVO, IMAGEN, FECHA_ACTUALIZACION)
--      VALUES ('IZQUIERDO', 'image/png', 'logo-ihss.png', EMPTY_BLOB(), SYSDATE);
--
--      DECLARE
--          origen  BFILE := BFILENAME('LOGOS_DIR', 'logo-ihss.png');
--          destino BLOB;
--      BEGIN
--          SELECT IMAGEN INTO destino FROM PERMISO_LOGO WHERE CLAVE = 'IZQUIERDO' FOR UPDATE;
--          DBMS_LOB.FILEOPEN(origen);
--          DBMS_LOB.LOADFROMFILE(destino, origen, DBMS_LOB.GETLENGTH(origen));
--          DBMS_LOB.FILECLOSE(origen);
--          COMMIT;
--      END;
--      /
--
--   Para volver al logo que trae el sistema: DELETE FROM PERMISO_LOGO WHERE CLAVE = 'IZQUIERDO';
--   El cambio se ve en lo que se imprima después de volver a entrar al sistema.
--
-- Cada sentencia se confirma sola en Oracle: si un paso falla, corregir y seguir desde ahí.
-- =====================================================================================

CREATE TABLE PERMISO_LOGO (
    CLAVE                VARCHAR2(20)   NOT NULL,
    TIPO_MIME            VARCHAR2(30)   NOT NULL,
    NOMBRE_ARCHIVO       VARCHAR2(260),
    IMAGEN               BLOB           NOT NULL,
    FECHA_ACTUALIZACION  DATE           DEFAULT SYSDATE NOT NULL,
    CONSTRAINT PK_PERMISO_LOGO PRIMARY KEY (CLAVE),
    CONSTRAINT CK_PERMISO_LOGO_CLAVE CHECK (CLAVE IN ('IZQUIERDO', 'DERECHO')),
    -- Los formatos que el navegador imprime sin plugins.
    CONSTRAINT CK_PERMISO_LOGO_MIME CHECK (TIPO_MIME IN ('image/png', 'image/jpeg'))
);

COMMENT ON TABLE PERMISO_LOGO IS 'Logos del encabezado de los formatos de permiso; se cargan en esta tabla. Sin filas se usan los que trae el sistema.';
COMMENT ON COLUMN PERMISO_LOGO.CLAVE IS 'IZQUIERDO o DERECHO: el lugar que ocupa en el encabezado del formato.';
COMMENT ON COLUMN PERMISO_LOGO.TIPO_MIME IS 'image/png o image/jpeg.';
COMMENT ON COLUMN PERMISO_LOGO.NOMBRE_ARCHIVO IS 'Nombre del archivo que se subió, solo para reconocerlo.';
COMMENT ON COLUMN PERMISO_LOGO.IMAGEN IS 'La imagen tal cual.';
COMMENT ON COLUMN PERMISO_LOGO.FECHA_ACTUALIZACION IS 'Cuándo se subió por última vez.';

COMMIT;
