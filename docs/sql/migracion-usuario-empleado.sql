-- =====================================================================================
-- Control de permisos - Nivel de usuario (empleado)
--
-- Agrega el nivel USUARIO a USUARIOS_PERMISOS: la cuenta de un empleado, atada a su ficha
-- (ID_EMPLEADO_PERMISO). Registra y ve solo sus propios permisos y vacaciones, imprime sus
-- formatos y nada más: no modifica lo que ya guardó, no genera memorandos ni reportes, y no
-- entra a Personal ni a Mantenimiento.
--
-- Los usuarios que ya existen quedan con ID_EMPLEADO_PERMISO vacío, es decir como estaban.
-- Cada sentencia se confirma sola en Oracle: si un paso falla, corregir y seguir desde ahí.
-- =====================================================================================

-- 1. La columna y su llave foránea a la ficha del empleado.
ALTER TABLE USUARIOS_PERMISOS ADD (ID_EMPLEADO_PERMISO NUMBER);

ALTER TABLE USUARIOS_PERMISOS ADD CONSTRAINT FK_USU_PERM_EMPLEADO
    FOREIGN KEY (ID_EMPLEADO_PERMISO) REFERENCES EMPLEADOS_IHSS (EMPLEADOS_IHSS_ID);

-- 2. Un empleado no puede tener dos cuentas. Este índice también es el de la llave foránea
--    (sin uno, borrar un empleado bloquea la tabla): Oracle no admite dos sobre la misma columna.
CREATE UNIQUE INDEX UX_USUARIOS_PERMISOS_EMPL ON USUARIOS_PERMISOS (ID_EMPLEADO_PERMISO);

-- 3. Un solo nivel por usuario: el empleado entra en la misma cuenta que los demás niveles.
ALTER TABLE USUARIOS_PERMISOS DROP CONSTRAINT CK_USU_PERM_UN_NIVEL;

ALTER TABLE USUARIOS_PERMISOS ADD CONSTRAINT CK_USU_PERM_UN_NIVEL CHECK (
    PERMISO_ADMIN
    + CASE WHEN ID_DEPTO_PERMISO IS NULL THEN 0 ELSE 1 END
    + CASE WHEN ID_AREA_PERMISO IS NULL THEN 0 ELSE 1 END
    + CASE WHEN ID_EMPLEADO_PERMISO IS NULL THEN 0 ELSE 1 END <= 1);

-- 4. Comentario de la columna.
COMMENT ON COLUMN USUARIOS_PERMISOS.ID_EMPLEADO_PERMISO IS
    'Nivel USUARIO: empleado dueño de la cuenta (llave foránea a EMPLEADOS_IHSS). Solo ve y registra sus propios permisos y vacaciones.';

COMMIT;
