-- =====================================================================================
-- Control de permisos - Nivel de secretaría
--
-- Agrega el nivel SECRETARIA a USUARIOS_PERMISOS. La secretaría pertenece a un departamento
-- (ID_DEPTO_PERMISO, igual que su administrador) y se distingue con PERMISO_SECRETARIA = 1:
-- ve y exporta los permisos y las vacaciones de todas las áreas de ese departamento, saca sus
-- reportes y sus memorandos, pero no registra permisos ni administra áreas, jefes o personal.
--
-- Los usuarios que ya existen quedan con PERMISO_SECRETARIA = 0, es decir como estaban.
-- Cada sentencia se confirma sola en Oracle: si un paso falla, corregir y seguir desde ahí.
-- =====================================================================================

-- 1. La columna. DEFAULT 0 y NOT NULL: las filas que ya existen quedan como administradores
--    de departamento o jefes, sin cambios.
ALTER TABLE USUARIOS_PERMISOS ADD (PERMISO_SECRETARIA NUMBER(1) DEFAULT 0 NOT NULL);

-- 2. Solo 0 o 1, y solo la cuenta de un departamento puede ser su secretaría (si fuera de un
--    área o administrador general, el nivel quedaría sin departamento al que pertenecer).
ALTER TABLE USUARIOS_PERMISOS ADD CONSTRAINT CK_USU_PERM_SECRETARIA
    CHECK (PERMISO_SECRETARIA IN (0, 1) AND (PERMISO_SECRETARIA = 0 OR ID_DEPTO_PERMISO IS NOT NULL));

-- 3. Comentario de la columna.
COMMENT ON COLUMN USUARIOS_PERMISOS.PERMISO_SECRETARIA IS
    '1 = secretaría del departamento de ID_DEPTO_PERMISO: ve y exporta todas sus áreas y genera los memorandos, no registra permisos ni administra. 0 = el nivel que indiquen las otras columnas.';

COMMIT;
