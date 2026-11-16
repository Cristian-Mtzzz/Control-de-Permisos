-- =====================================================================================
-- Control de permisos - No. de pago escrito en cada permiso
--
-- El formulario de permisos pide el No. de pago y se guarda en el permiso, aparte del de
-- EMPLEADOS_IHSS (no se toma de ahí ni se compara). Es obligatorio en los permisos nuevos y al
-- editar; los registrados antes y las vacaciones quedan sin él (NULL).
-- Se ejecuta una sola vez; la API anterior sigue funcionando con la columna agregada.
-- =====================================================================================

ALTER TABLE PERMISO_SOLICITUD ADD (NO_PAGO VARCHAR2(20 CHAR));

COMMENT ON COLUMN PERMISO_SOLICITUD.NO_PAGO IS 'No. de pago escrito en el formulario del permiso (hasta 20 caracteres). Es propio del permiso: no se toma de EMPLEADOS_IHSS. Vacío en las vacaciones y en los permisos registrados antes de pedirlo.';
