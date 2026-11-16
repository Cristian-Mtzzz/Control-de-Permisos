-- =====================================================================================
-- Control de permisos - Descripción de tablas y columnas en la base (COMMENT ON)
--
-- Documenta en Oracle las tablas propias del sistema: se consultan con
--   SELECT * FROM USER_TAB_COMMENTS WHERE TABLE_NAME LIKE 'PERMISO%' OR TABLE_NAME = 'USUARIOS_PERMISOS';
--   SELECT * FROM USER_COL_COMMENTS WHERE TABLE_NAME = 'PERMISO_SOLICITUD';
-- Las tablas del inventario que el sistema solo lee (EMPLEADOS_IHSS, DEPARTAMENTO_IHSS, EDIFICIO,
-- REGIONAL y LOGIN_CONFIG) ya tienen sus comentarios y no se tocan aquí.
-- Se puede volver a ejecutar: cada COMMENT reemplaza al anterior. Detalle en docs/base-de-datos.md.
-- =====================================================================================

-- PERMISO_PARAMETRO -------------------------------------------------------------------
COMMENT ON TABLE PERMISO_PARAMETRO IS 'Control de permisos: parámetros generales (jornada laboral y límites de permisos). Valen para todos los departamentos salvo los que tengan su propio valor en PERMISO_PARAMETRO_DEPTO. La API los lee en cada consulta: un cambio con COMMIT se aplica sin reiniciarla.';
COMMENT ON COLUMN PERMISO_PARAMETRO.CLAVE IS 'Nombre del parámetro (llave primaria): HORA_INICIO_JORNADA, HORA_FIN_JORNADA, MAX_DIAS_POR_PERMISO, MAX_HORAS_POR_PERMISO, MAX_HORAS_POR_MES, MAX_DIAS_POR_MES o MAX_DIAS_POR_ANIO.';
COMMENT ON COLUMN PERMISO_PARAMETRO.VALOR IS 'Valor: hora HH:mm para la jornada; número (punto decimal) para los límites. Vacío = sin límite. Un valor mal escrito no se puede guardar (CK_PERMISO_PARAMETRO_VALOR).';
COMMENT ON COLUMN PERMISO_PARAMETRO.DESCRIPCION IS 'Explicación del parámetro para quien lo modifica.';

-- PERMISO_PARAMETRO_DEPTO -------------------------------------------------------------
COMMENT ON TABLE PERMISO_PARAMETRO_DEPTO IS 'Control de permisos: valores propios de un departamento que reemplazan al general de PERMISO_PARAMETRO (por ejemplo otra jornada). Una fila con VALOR vacío quita ese límite solo en ese departamento.';
COMMENT ON COLUMN PERMISO_PARAMETRO_DEPTO.DEPARTAMENTO_IHSS_ID IS 'Departamento al que aplica (llave foránea a PERMISO_DEPARTAMENTO). Parte de la llave primaria.';
COMMENT ON COLUMN PERMISO_PARAMETRO_DEPTO.CLAVE IS 'Parámetro que reemplaza (llave foránea a PERMISO_PARAMETRO.CLAVE). Parte de la llave primaria.';
COMMENT ON COLUMN PERMISO_PARAMETRO_DEPTO.VALOR IS 'Valor para ese departamento, con el mismo formato que PERMISO_PARAMETRO.VALOR. Vacío = sin límite en ese departamento.';

-- PERMISO_DEPARTAMENTO ----------------------------------------------------------------
COMMENT ON TABLE PERMISO_DEPARTAMENTO IS 'Control de permisos: departamentos de DEPARTAMENTO_IHSS que usan el sistema. Los agrega o desactiva el administrador general desde Mantenimiento. Solo sus empleados aparecen en el sistema.';
COMMENT ON COLUMN PERMISO_DEPARTAMENTO.DEPARTAMENTO_IHSS_ID IS 'Departamento (llave primaria y foránea a DEPARTAMENTO_IHSS.DEPARTAMENTO_IHSS_ID).';
COMMENT ON COLUMN PERMISO_DEPARTAMENTO.ESTADO IS 'ACTIVO o INACTIVO. Solo se desactiva sin áreas activas ni administradores; inactivo, sus empleados dejan de aparecer y no se registran permisos.';

-- PERMISO_FERIADO ---------------------------------------------------------------------
COMMENT ON TABLE PERMISO_FERIADO IS 'Control de permisos: feriados. No cuentan como días hábiles en permisos por día ni en vacaciones, y no admiten permisos por hora. Los sábados y domingos se excluyen siempre, sin registrarlos aquí. Se mantiene directamente en la base.';
COMMENT ON COLUMN PERMISO_FERIADO.FECHA IS 'Día feriado. Única por departamento (UX_PERMISO_FERIADO).';
COMMENT ON COLUMN PERMISO_FERIADO.DESCRIPCION IS 'Motivo del feriado (por ejemplo, Navidad).';
COMMENT ON COLUMN PERMISO_FERIADO.DEPARTAMENTO_IHSS_ID IS 'Departamento al que aplica (llave foránea a PERMISO_DEPARTAMENTO). Vacío = feriado para todos los departamentos.';

-- PERMISO_AREA ------------------------------------------------------------------------
COMMENT ON TABLE PERMISO_AREA IS 'Control de permisos: áreas (jefaturas) dentro de cada departamento. Cada empleado pertenece a una y cada jefe de área administra la suya. Se crean, editan y desactivan desde Mantenimiento.';
COMMENT ON COLUMN PERMISO_AREA.ID_AREA IS 'Identificador del área (llave primaria). La API asigna el siguiente número.';
COMMENT ON COLUMN PERMISO_AREA.NOMBRE IS 'Nombre del área (la pantalla lo guarda en mayúsculas). No se repite dentro del mismo departamento (UQ_PERMISO_AREA_NOMBRE).';
COMMENT ON COLUMN PERMISO_AREA.ESTADO IS 'ACTIVO o INACTIVO. Solo se desactiva sin empleados ni jefes; inactiva no recibe empleados ni permisos nuevos.';
COMMENT ON COLUMN PERMISO_AREA.DEPARTAMENTO_IHSS_ID IS 'Departamento del área (llave foránea a PERMISO_DEPARTAMENTO).';

-- PERMISO_AREA_EMPLEADO ---------------------------------------------------------------
COMMENT ON TABLE PERMISO_AREA_EMPLEADO IS 'Control de permisos: área de cada empleado (una por empleado). La llenan los jefes y administradores desde Personal. Un empleado sin fila aquí no puede recibir permisos ni vacaciones.';
COMMENT ON COLUMN PERMISO_AREA_EMPLEADO.ID_EMPLEADO IS 'Empleado (llave primaria; corresponde a EMPLEADOS_IHSS.EMPLEADOS_IHSS_ID). Si el empleado cambia de departamento, esta área deja de contar hasta que se le asigne una del nuevo.';
COMMENT ON COLUMN PERMISO_AREA_EMPLEADO.ID_AREA IS 'Área actual del empleado (llave foránea a PERMISO_AREA).';

-- PERMISO_SOLICITUD -------------------------------------------------------------------
COMMENT ON TABLE PERMISO_SOLICITUD IS 'Control de permisos: permisos y vacaciones registrados, uno por fila. TIPO DIA = permiso por días, HORA = permiso por horas de un día, VAC = vacaciones (una solicitud con varios períodos guarda una fila por período). Anular no borra: ESTADO pasa a ANULADO y deja de contar en choques, límites y totales.';
COMMENT ON COLUMN PERMISO_SOLICITUD.ID_PERMISO IS 'Número del permiso o de las vacaciones (llave primaria). La API asigna el siguiente con la tabla bloqueada.';
COMMENT ON COLUMN PERMISO_SOLICITUD.TIPO IS 'DIA, HORA o VAC (CK_PERMISO_SOLICITUD_TIPO). Un permiso no pasa a vacaciones ni al revés.';
COMMENT ON COLUMN PERMISO_SOLICITUD.ID_EMPLEADO IS 'Empleado (corresponde a EMPLEADOS_IHSS.EMPLEADOS_IHSS_ID).';
COMMENT ON COLUMN PERMISO_SOLICITUD.MOTIVO IS 'Motivo del permiso, hasta 1000 caracteres (la pantalla lo guarda en mayúsculas). En las vacaciones es siempre VACACIONES.';
COMMENT ON COLUMN PERMISO_SOLICITUD.FECHA_INICIO IS 'Primer día del permiso o de las vacaciones. En el de hora, el día del permiso.';
COMMENT ON COLUMN PERMISO_SOLICITUD.FECHA_FIN IS 'Último día (no antes de FECHA_INICIO). En el de hora es igual a FECHA_INICIO.';
COMMENT ON COLUMN PERMISO_SOLICITUD.HORA_SALIDA IS 'Solo en el de hora: hora en que el empleado sale (HH:mm, dentro de la jornada).';
COMMENT ON COLUMN PERMISO_SOLICITUD.HORA_ENTRADA IS 'Solo en el de hora: hora en que regresa (HH:mm, después de la salida). Ahí finaliza el permiso.';
COMMENT ON COLUMN PERMISO_SOLICITUD.DIAS_HABILES IS 'Días hábiles del rango (sin fines de semana ni feriados), calculados por la API. 0 en el de hora.';
COMMENT ON COLUMN PERMISO_SOLICITUD.MINUTOS IS 'Duración del de hora en minutos, calculada por la API. 0 en el de día y en vacaciones.';
COMMENT ON COLUMN PERMISO_SOLICITUD.NO_PAGO IS 'No. de pago del permiso (hasta 20 caracteres). El formulario lo carga de EMPLEADOS_IHSS.NPAGO al elegir el empleado (o se escribe si no lo tiene) y queda guardado aquí. Vacío en las vacaciones y en los permisos registrados antes de pedirlo.';
COMMENT ON COLUMN PERMISO_SOLICITUD.LUGAR_SOLICITUD IS 'Solo en el permiso por día: lugar desde donde se solicita (el "Lugar y Fecha" del formato impreso, junto a la fecha de solicitud). Lo escribe quien registra el permiso.';
COMMENT ON COLUMN PERMISO_SOLICITUD.TELEFONO IS 'Solo en el permiso por día: número de teléfono donde localizar al empleado (el "Donde localizarlo" del formato impreso). Lo escribe quien registra el permiso.';
COMMENT ON COLUMN PERMISO_SOLICITUD.FECHA_SOLICITUD IS 'Día en que se pidió. En los permisos la pone el servidor al registrarlos y no cambia; en las vacaciones se indica (hoy o antes) y todos los períodos de una solicitud llevan la misma.';
COMMENT ON COLUMN PERMISO_SOLICITUD.ESTADO IS 'ACTIVO o ANULADO. Finalizado no se guarda: la pantalla lo calcula cuando pasa el fin del permiso.';
COMMENT ON COLUMN PERMISO_SOLICITUD.FECHA_REGISTRO IS 'Fecha y hora en que se registró (SYSDATE).';
COMMENT ON COLUMN PERMISO_SOLICITUD.ID_AREA IS 'Área del empleado al registrarlo (llave foránea a PERMISO_AREA). Se conserva aunque el empleado cambie de área: decide quién puede editarlo. Vacía solo en permisos anteriores a las áreas.';

-- USUARIOS_PERMISOS -------------------------------------------------------------------
COMMENT ON TABLE USUARIOS_PERMISOS IS 'Control de permisos: usuarios que entran al sistema, aparte de USUARIOS del inventario. Cada uno tiene un solo nivel: administrador general (PERMISO_ADMIN = 1), jefe de departamento (ID_DEPTO_PERMISO) o jefe de área (ID_AREA_PERMISO). Se administran desde Mantenimiento.';
COMMENT ON COLUMN USUARIOS_PERMISOS.ID_USUARIO IS 'Identificador del usuario (llave primaria).';
COMMENT ON COLUMN USUARIOS_PERMISOS.USUARIO IS 'Nombre con que entra. Único sin distinguir mayúsculas ni espacios (UX_USUARIOS_PERMISOS_USUARIO). Con dominio es su cuenta de Active Directory.';
COMMENT ON COLUMN USUARIOS_PERMISOS.NOMBRE_PERSONA IS 'Nombre de la persona (normalmente el de EMPLEADOS_IHSS).';
COMMENT ON COLUMN USUARIOS_PERMISOS.PASSWORD_HASH IS 'Contraseña del usuario local en BCrypt. Las del formato anterior (ORA_HASH) se convierten a BCrypt al entrar. No se usa con DOMINIO = 1.';
COMMENT ON COLUMN USUARIOS_PERMISOS.DOMINIO IS '1 = entra con su cuenta de Active Directory (dominio en DOMINIOP); 0 = usuario local con contraseña propia.';
COMMENT ON COLUMN USUARIOS_PERMISOS.DOMINIOP IS 'Dominio de Active Directory: BA, HE, HRN o IVM.';
COMMENT ON COLUMN USUARIOS_PERMISOS.CLAVE_SEGURA IS '0 = usuario local con la contraseña inicial (1234): debe cambiarla al entrar; 1 = ya la cambió.';
COMMENT ON COLUMN USUARIOS_PERMISOS.ESTADO IS 'ACTIVO o INACTIVO. Inactivo no puede entrar.';
COMMENT ON COLUMN USUARIOS_PERMISOS.FECHA_EXPIRACION IS 'Último día en que puede entrar. Vacía = sin vencimiento.';
COMMENT ON COLUMN USUARIOS_PERMISOS.PERMISO_ADMIN IS '1 = administrador general: ve y administra todos los departamentos. Excluye los otros dos niveles (CK_USU_PERM_UN_NIVEL).';
COMMENT ON COLUMN USUARIOS_PERMISOS.ID_DEPTO_PERMISO IS 'Departamento del jefe de departamento o de su secretaría, según PERMISO_SECRETARIA (llave foránea a PERMISO_DEPARTAMENTO).';
COMMENT ON COLUMN USUARIOS_PERMISOS.ID_AREA_PERMISO IS 'Jefe de área: área que administra (llave foránea a PERMISO_AREA).';
COMMENT ON COLUMN USUARIOS_PERMISOS.ID_EMPLEADO_PERMISO IS 'Nivel USUARIO: empleado dueño de la cuenta (llave foránea a EMPLEADOS_IHSS). Solo ve y registra sus propios permisos y vacaciones.';
COMMENT ON COLUMN USUARIOS_PERMISOS.PERMISO_SECRETARIA IS '1 = secretaría del departamento de ID_DEPTO_PERMISO: ve y exporta todas sus áreas y genera los memorandos, no registra permisos ni administra. 0 = el nivel que indiquen las otras columnas.';
COMMENT ON COLUMN USUARIOS_PERMISOS.FECHA_REGISTRO IS 'Fecha y hora en que se creó el usuario.';
