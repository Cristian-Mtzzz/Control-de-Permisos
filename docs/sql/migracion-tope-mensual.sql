-- =====================================================================================
-- Control de permisos - Tope mensual de permisos por empleado
--
-- Cada empleado puede usar hasta 2 días de permiso por mes calendario. Los días completos y
-- las horas suman juntos: una jornada completa equivale a 1 día (con jornada de 8 h, 2 días =
-- 16 horas). Si un permiso nuevo o editado pasa del tope, la API lo rechaza con "Permiso no
-- permitido porque se pasa del tiempo estipulado". Un permiso que cruza de mes cuenta en cada
-- mes sus días de ese mes.
--
-- Como los demás límites, se puede cambiar o quitar por departamento en PERMISO_PARAMETRO_DEPTO
-- (VALOR vacío = sin tope en ese departamento):
--   INSERT INTO PERMISO_PARAMETRO_DEPTO (DEPARTAMENTO_IHSS_ID, CLAVE, VALOR) VALUES (146, 'MAX_DIAS_POR_MES', '3');
-- =====================================================================================

INSERT INTO PERMISO_PARAMETRO (CLAVE, VALOR, DESCRIPCION)
SELECT 'MAX_DIAS_POR_MES', '2',
       'Máximo de días de permiso por empleado en un mes; suma días y horas (jornada completa = 1 día). Vacío = sin límite'
FROM DUAL
-- Si el script se vuelve a ejecutar, no duplica el parámetro.
WHERE NOT EXISTS (SELECT 1 FROM PERMISO_PARAMETRO WHERE CLAVE = 'MAX_DIAS_POR_MES');

COMMIT;
