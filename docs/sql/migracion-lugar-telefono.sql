-- =====================================================================================
-- Control de permisos - Lugar y teléfono del permiso por día
--
-- El formato de impresión del permiso por día ("Solicitud de permiso día") pide el teléfono
-- donde localizar al empleado y el lugar desde donde se solicita. Los escribe quien registra el
-- permiso. El lugar se guarda en LUGAR_SOLICITUD, que ya existía sin uso; el teléfono, en una
-- columna nueva. Los permisos por hora, las vacaciones y los registrados antes quedan sin ellos.
-- Se ejecuta una sola vez; la API anterior sigue funcionando con la columna agregada.
-- =====================================================================================

ALTER TABLE PERMISO_SOLICITUD ADD (TELEFONO VARCHAR2(20 CHAR));

COMMENT ON COLUMN PERMISO_SOLICITUD.TELEFONO IS 'Solo en el permiso por día: número de teléfono donde localizar al empleado (el "Donde localizarlo" del formato impreso). Lo escribe quien registra el permiso.';
COMMENT ON COLUMN PERMISO_SOLICITUD.LUGAR_SOLICITUD IS 'Solo en el permiso por día: lugar desde donde se solicita (el "Lugar y Fecha" del formato impreso, junto a la fecha de solicitud). Lo escribe quien registra el permiso.';
