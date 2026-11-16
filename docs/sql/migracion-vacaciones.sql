-- =====================================================================================
-- Control de permisos - Vacaciones
--
-- Las vacaciones se guardan en PERMISO_SOLICITUD con TIPO = 'VAC': un rango de fechas con sus
-- días hábiles, MOTIVO = 'VACACIONES' y la fecha de solicitud que indica quien las registra.
-- Chocan con los permisos del empleado (no puede tener un permiso dentro de sus vacaciones),
-- pero no cuentan en los límites de permisos. Se anulan igual que un permiso.
--
-- Solo cambia la restricción del tipo para admitir 'VAC'.
-- =====================================================================================

ALTER TABLE PERMISO_SOLICITUD DROP CONSTRAINT CK_PERMISO_SOLICITUD_TIPO;

ALTER TABLE PERMISO_SOLICITUD ADD CONSTRAINT CK_PERMISO_SOLICITUD_TIPO CHECK (TIPO IN ('DIA', 'HORA', 'VAC'));
