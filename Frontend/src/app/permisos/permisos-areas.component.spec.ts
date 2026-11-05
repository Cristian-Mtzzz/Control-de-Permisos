import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import {
  actualizar, boton, botones, campo, clic, elegir, empleados, enviar, errorApi, escribir, jefes, llamada, opcionesDe, sesion,
  sinLlamadas, textoDe,
} from '../testing/ui';
import { PermisoJefe, PermisoSesion } from './permisos.models';
import { PermisosAreasComponent } from './permisos-areas.component';

// Sección de administración: departamentos (solo el general), áreas y usuarios, con cada
// ventana, validación y respuesta de la API.
describe('Sección de departamentos, áreas y usuarios', () => {
  let fixture: ComponentFixture<PermisosAreasComponent>;
  let http: HttpTestingController;
  let cambios: number;
  const raiz = (): HTMLElement => fixture.nativeElement as HTMLElement;
  const texto = (): string => textoDe(fixture);
  const modal = (): HTMLElement => campo(raiz(), '.workshop-modal');
  const formulario = (): HTMLFormElement => campo(modal(), 'form');
  const alerta = (): string => raiz().querySelector('[role="alert"]')?.textContent?.trim() ?? '';
  const ok = { status: 204, statusText: 'No Content' };

  async function iniciar(datos: PermisoSesion, usuarios: PermisoJefe[] = jefes): Promise<void> {
    TestBed.configureTestingModule({
      imports: [PermisosAreasComponent],
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    http = TestBed.inject(HttpTestingController);
    fixture = TestBed.createComponent(PermisosAreasComponent);
    fixture.componentRef.setInput('sesion', datos);
    fixture.componentRef.setInput('empleados', empleados);
    cambios = 0;
    fixture.componentInstance.changed.subscribe(() => cambios++);
    await actualizar(fixture);
    llamada(http, 'GET', '/permisos/jefes').flush(usuarios);
    await actualizar(fixture);
  }

  // Tras guardar: recarga los usuarios y avisa al panel.
  async function recargaTrasGuardar(): Promise<void> {
    llamada(http, 'GET', '/permisos/jefes').flush(jefes);
    await actualizar(fixture);
  }

  const filaDe = (tabla: number, nombre: string): HTMLTableRowElement => {
    const fila = Array.from(raiz().querySelectorAll<HTMLTableElement>('table.resumen-table')[tabla].querySelectorAll('tbody tr'))
      .find((item) => item.textContent!.includes(nombre));
    if (!fila) throw new Error(`No se ve la fila de ${nombre}.`);
    return fila as HTMLTableRowElement;
  };

  afterEach(() => {
    try {
      http?.verify();
    } finally {
      TestBed.resetTestingModule();
    }
  });

  it('si no se pueden cargar los usuarios lo dice', async () => {
    TestBed.configureTestingModule({ imports: [PermisosAreasComponent], providers: [provideHttpClient(), provideHttpClientTesting()] });
    http = TestBed.inject(HttpTestingController);
    fixture = TestBed.createComponent(PermisosAreasComponent);
    fixture.componentRef.setInput('sesion', sesion('ADMIN'));
    fixture.componentRef.setInput('empleados', empleados);
    await actualizar(fixture);
    errorApi(llamada(http, 'GET', '/permisos/jefes'), 503, 'La base de datos no está disponible temporalmente.');
    await actualizar(fixture);
    expect(alerta()).toBe('La base de datos no está disponible temporalmente.');
    expect(texto()).toContain('Todavía no hay usuarios registrados.');
  });

  describe('administrador general', () => {
    beforeEach(async () => iniciar(sesion('ADMIN')));

    it('muestra departamentos, áreas y usuarios con sus acciones según el tipo de cuenta', async () => {
      expect(texto()).toContain('INFORMATICA');
      expect(texto()).toContain('07:00 a 15:00');
      expect(filaDe(1, 'ANTIGUA').textContent).toContain('INACTIVO');
      expect(botones(filaDe(1, 'ANTIGUA'), 'Activar')).toHaveLength(1);
      // Local propia: editar y restablecer; dominio: sin restablecer; inventario: editar acceso y quitar.
      expect(botones(filaDe(2, 'JEFE SOPORTE'), /^(Editar|Restablecer contraseña)$/)).toHaveLength(2);
      expect(botones(filaDe(2, 'JEFE DOMINIO'), 'Restablecer contraseña')).toHaveLength(0);
      expect(botones(filaDe(2, 'JEFE NOMINA'), /^(Editar acceso|Quitar acceso)$/)).toHaveLength(2);
      expect(filaDe(2, 'JEFE NOMINA').textContent).toContain('Cuenta de inventario');
      expect(filaDe(2, 'JEFE DOMINIO').textContent).toContain('Dominio BA');
      expect(filaDe(2, 'ADMINISTRADOR').textContent).toContain('Todos los departamentos');
    });

    it('agregar departamento: filtros, error y éxito', async () => {
      await clic(fixture, boton(raiz(), 'Agregar departamento'));
      llamada(http, 'GET', '/permisos/departamentos/disponibles').flush([
        { IdDepartamento: 30, Nombre: 'CONTABILIDAD', Empleados: 5, IdEdificio: 1, NombreEdificio: 'CENTRAL', IdRegional: 1, NombreRegional: 'CENTRO' },
        { IdDepartamento: 31, Nombre: 'ALMACEN', Empleados: 3, IdEdificio: 2, NombreEdificio: 'BODEGA', IdRegional: 2, NombreRegional: 'NORTE' },
      ]);
      await actualizar(fixture);
      expect(texto()).toContain('2 departamento(s) disponibles');
      expect(boton(modal(), 'Agregar').disabled).toBe(true);

      await elegir(fixture, campo(modal(), '#departamento-nuevo'), 'ALMACEN');
      // Una regional que no tiene el departamento elegido lo quita.
      await elegir(fixture, campo(modal(), '#departamento-regional'), 'CENTRO');
      expect(texto()).toContain('1 departamento(s) disponibles');
      expect(boton(modal(), 'Agregar').disabled).toBe(true);
      await elegir(fixture, campo(modal(), '#departamento-nuevo'), 'CONTABILIDAD');

      await enviar(fixture, formulario());
      const agregar = llamada(http, 'POST', '/permisos/departamentos');
      expect(agregar.request.body).toEqual({ IdDepartamento: 30 });
      errorApi(agregar, 400, 'El departamento ya usa el control de permisos.');
      await actualizar(fixture);
      expect(alerta()).toBe('El departamento ya usa el control de permisos.');

      await enviar(fixture, formulario());
      llamada(http, 'POST', '/permisos/departamentos').flush(null, ok);
      await actualizar(fixture);
      expect(raiz().querySelector('.workshop-modal')).toBeNull();
      expect(texto()).toContain('CONTABILIDAD ya usa el control de permisos.');
      expect(cambios).toBe(1);
      await recargaTrasGuardar();
    });

    it('si no se pueden cargar los departamentos disponibles lo dice en la ventana', async () => {
      await clic(fixture, boton(raiz(), 'Agregar departamento'));
      errorApi(llamada(http, 'GET', '/permisos/departamentos/disponibles'), 0);
      await actualizar(fixture);
      expect(alerta()).toBe('No se pudieron cargar los departamentos.');
      await clic(fixture, boton(modal(), 'Cerrar ventana'));
      expect(raiz().querySelector('.workshop-modal')).toBeNull();
    });

    it('desactivar un departamento con áreas activas muestra el motivo de la API', async () => {
      await clic(fixture, boton(filaDe(0, 'INFORMATICA'), 'Desactivar'));
      const desactivar = llamada(http, 'PUT', '/permisos/departamentos/10');
      expect(desactivar.request.body).toEqual({ Estado: 'INACTIVO' });
      errorApi(desactivar, 400, 'El departamento tiene 2 área(s) activa(s) y 0 administrador(es).');
      await actualizar(fixture);
      expect(alerta()).toContain('2 área(s) activa(s)');
      expect(cambios).toBe(0);
    });

    it('nueva área: valida nombre y departamento, y crea en mayúsculas', async () => {
      await clic(fixture, boton(raiz(), 'Nueva área'));
      await enviar(fixture, formulario());
      expect(alerta()).toBe('Escribe el nombre del área.');

      await escribir(fixture, campo(modal(), '#area-nombre'), 'redes');
      expect(campo<HTMLInputElement>(modal(), '#area-nombre').value).toBe('REDES');
      await enviar(fixture, formulario());
      expect(alerta()).toBe('Selecciona el departamento del área.');
      sinLlamadas(http, 'POST', '/permisos/areas');

      await elegir(fixture, campo(modal(), '#area-departamento'), 'INFORMATICA');
      await enviar(fixture, formulario());
      const crear = llamada(http, 'POST', '/permisos/areas');
      expect(crear.request.body).toEqual({ Nombre: 'REDES', Estado: null, IdDepartamento: 10 });
      errorApi(crear, 400, 'Ya existe un área con ese nombre en el departamento.');
      await actualizar(fixture);
      expect(alerta()).toBe('Ya existe un área con ese nombre en el departamento.');

      await enviar(fixture, formulario());
      llamada(http, 'POST', '/permisos/areas').flush(null, ok);
      await actualizar(fixture);
      expect(texto()).toContain('Área creada.');
      await recargaTrasGuardar();
    });

    it('renombrar conserva el estado; desactivar con personal muestra el motivo; activar', async () => {
      await clic(fixture, boton(filaDe(1, 'SOPORTE'), 'Renombrar'));
      expect(campo<HTMLInputElement>(modal(), '#area-nombre').value).toBe('SOPORTE');
      expect(modal().querySelector('#area-departamento')).toBeNull();
      await escribir(fixture, campo(modal(), '#area-nombre'), 'SOPORTE TECNICO');
      await enviar(fixture, formulario());
      const renombrar = llamada(http, 'PUT', '/permisos/areas/100');
      expect(renombrar.request.body).toEqual({ Nombre: 'SOPORTE TECNICO', Estado: 'ACTIVO', IdDepartamento: 10 });
      renombrar.flush(null, ok);
      await actualizar(fixture);
      expect(texto()).toContain('Área actualizada.');
      await recargaTrasGuardar();

      await clic(fixture, boton(filaDe(1, 'SOPORTE'), 'Desactivar'));
      errorApi(llamada(http, 'PUT', '/permisos/areas/100'), 400, 'El área tiene 1 empleado(s) y 1 jefe(s) activo(s).');
      await actualizar(fixture);
      expect(alerta()).toContain('El área tiene 1 empleado(s)');

      await clic(fixture, boton(filaDe(1, 'ANTIGUA'), 'Activar'));
      const activar = llamada(http, 'PUT', '/permisos/areas/102');
      expect(activar.request.body).toEqual({ Nombre: 'ANTIGUA', Estado: 'ACTIVO', IdDepartamento: null });
      activar.flush(null, ok);
      await actualizar(fixture);
      expect(texto()).toContain('Área ANTIGUA activada.');
      await recargaTrasGuardar();
    });

    it('nuevo usuario: valida cada paso, avisa si es de otro departamento y crea', async () => {
      await clic(fixture, boton(raiz(), 'Nuevo usuario'));
      // El general no puede crear otro administrador general.
      expect(opcionesDe(campo(modal(), '#jefe-nivel'))).not.toContain('Administrador general');
      await enviar(fixture, formulario());
      expect(alerta()).toBe('Selecciona al empleado.');

      await elegir(fixture, campo(modal(), '#jefe-area-filtro'), 'Sin área');
      expect(opcionesDe(campo(modal(), '#jefe-empleado'))).toEqual(['Selecciona al empleado', 'PEDRO SIN AREA']);
      await elegir(fixture, campo(modal(), '#jefe-area-filtro'), 'Todas las áreas');
      await elegir(fixture, campo(modal(), '#jefe-empleado'), 'ANA LOPEZ');
      await enviar(fixture, formulario());
      expect(alerta()).toBe('Escribe el usuario.');

      await escribir(fixture, campo(modal(), '#jefe-usuario'), '  ana.lopez ');
      // Se propone su departamento y su área.
      expect(campo<HTMLSelectElement>(modal(), '#jefe-area').selectedOptions[0].textContent!.trim()).toBe('SOPORTE');
      await elegir(fixture, campo(modal(), '#jefe-departamento'), 'RECURSOS HUMANOS');
      expect(texto()).toContain('ANA LOPEZ es empleado de INFORMATICA; con este nivel verá al personal de RECURSOS HUMANOS.');
      await enviar(fixture, formulario());
      expect(alerta()).toBe('Selecciona el departamento y el área del jefe.');

      await elegir(fixture, campo(modal(), '#jefe-area'), 'NOMINA');
      await elegir(fixture, campo(modal(), '#jefe-cuenta'), 'Usuario de dominio');
      await elegir(fixture, campo(modal(), '#jefe-dominio'), 'HRN');
      await enviar(fixture, formulario());
      const crear = llamada(http, 'POST', '/permisos/jefes');
      expect(crear.request.body).toEqual({
        Usuario: 'ana.lopez', NombrePersona: 'ANA LOPEZ', Nivel: 'JEFE', IdDepartamento: null, IdArea: 200,
        Dominio: 1, DominioP: 'HRN', Estado: null,
      });
      errorApi(crear, 400, 'Ya existe un usuario con ese nombre.');
      await actualizar(fixture);
      expect(alerta()).toBe('Ya existe un usuario con ese nombre.');

      await enviar(fixture, formulario());
      llamada(http, 'POST', '/permisos/jefes').flush(null, ok);
      await actualizar(fixture);
      expect(texto()).toContain('Usuario creado. Entra con su usuario de dominio ana.lopez y su contraseña de dominio.');
      await recargaTrasGuardar();
    });

    it('nuevo administrador de departamento y nuevo usuario de consulta', async () => {
      await clic(fixture, boton(raiz(), 'Nuevo usuario'));
      await elegir(fixture, campo(modal(), '#jefe-empleado'), 'LUIS PAZ');
      await escribir(fixture, campo(modal(), '#jefe-usuario'), 'luis.paz');
      await elegir(fixture, campo(modal(), '#jefe-nivel'), 'Administrador de departamento');
      expect(texto()).toContain('Ve su departamento y administra sus áreas');
      await elegir(fixture, campo(modal(), '#jefe-departamento'), 'Selecciona el departamento');
      await enviar(fixture, formulario());
      expect(alerta()).toBe('Selecciona el departamento que administra.');
      await elegir(fixture, campo(modal(), '#jefe-departamento'), 'INFORMATICA');
      await enviar(fixture, formulario());
      expect(llamada(http, 'POST', '/permisos/jefes').request.body).toMatchObject({ Nivel: 'ADMIN_DEPTO', IdDepartamento: 10, IdArea: null });
    });

    it('editar usuario local: estado, paso a local y su aviso', async () => {
      await clic(fixture, boton(filaDe(2, 'JEFE DOMINIO'), 'Editar'));
      expect(texto()).toContain('EDITAR USUARIO');
      expect(modal().querySelector('#jefe-empleado')).toBeNull();
      await elegir(fixture, campo(modal(), '#jefe-cuenta'), 'Usuario local');
      await elegir(fixture, campo(modal(), '#jefe-estado'), 'Inactivo');
      await enviar(fixture, formulario());
      const guardar = llamada(http, 'PUT', '/permisos/jefes/52');
      expect(guardar.request.body).toMatchObject({ Dominio: 0, Estado: 'INACTIVO', IdArea: 101 });
      guardar.flush(null, ok);
      await actualizar(fixture);
      expect(texto()).toContain('Ahora es local: entra con BA\\jefe.dominio y la contraseña 1234');
      await recargaTrasGuardar();
    });

    it('el administrador general se edita conservando su nivel', async () => {
      await clic(fixture, boton(filaDe(2, 'ADMINISTRADOR'), 'Editar'));
      expect(opcionesDe(campo(modal(), '#jefe-nivel'))).toContain('Administrador general');
      await enviar(fixture, formulario());
      const guardar = llamada(http, 'PUT', '/permisos/jefes/50');
      expect(guardar.request.body).toMatchObject({ Nivel: 'ADMIN', IdArea: null, IdDepartamento: null });
      errorApi(guardar, 400, 'No puedes cambiar tu propio nivel de acceso ni desactivar tu usuario.');
      await actualizar(fixture);
      expect(alerta()).toContain('No puedes cambiar tu propio nivel');
    });

    it('restablecer contraseña: error y éxito', async () => {
      await clic(fixture, boton(filaDe(2, 'JEFE SOPORTE'), 'Restablecer contraseña'));
      errorApi(llamada(http, 'PUT', '/permisos/jefes/51/reset-password'), 404,
        'Solo se restablece la contraseña de cuentas locales propias del control de permisos que administras.');
      await actualizar(fixture);
      expect(alerta()).toContain('Solo se restablece la contraseña');

      await clic(fixture, boton(filaDe(2, 'JEFE SOPORTE'), 'Restablecer contraseña'));
      llamada(http, 'PUT', '/permisos/jefes/51/reset-password').flush(null, ok);
      await actualizar(fixture);
      expect(texto()).toContain('La contraseña de JEFE SOPORTE quedó en 1234');
      await recargaTrasGuardar();
    });

    it('cuenta de inventario: editar su acceso y quitarlo', async () => {
      await clic(fixture, boton(filaDe(2, 'JEFE NOMINA'), 'Editar acceso'));
      expect(texto()).toContain('CUENTA DE INVENTARIO');
      expect(texto()).toContain('Cuenta: inventario.rrhh');
      await elegir(fixture, campo(modal(), '#acceso-nivel'), 'Consulta');
      await enviar(fixture, formulario());
      const guardar = llamada(http, 'PUT', '/permisos/jefes/53');
      expect(guardar.request.body).toMatchObject({ Nivel: 'CONSULTA', IdArea: null, IdDepartamento: null });
      guardar.flush(null, ok);
      await actualizar(fixture);
      expect(texto()).toContain('Acceso actualizado.');
      await recargaTrasGuardar();

      await clic(fixture, boton(filaDe(2, 'JEFE NOMINA'), 'Quitar acceso'));
      errorApi(llamada(http, 'DELETE', '/permisos/jefes/53/acceso'), 0);
      await actualizar(fixture);
      expect(alerta()).toBe('No se pudieron guardar los cambios.');
      await clic(fixture, boton(filaDe(2, 'JEFE NOMINA'), 'Quitar acceso'));
      llamada(http, 'DELETE', '/permisos/jefes/53/acceso').flush(null, ok);
      await actualizar(fixture);
      expect(texto()).toContain('JEFE NOMINA ya no tiene acceso al control de permisos.');
      await recargaTrasGuardar();
    });

    it('dar acceso a una cuenta de inventario: elegir cuenta y nivel', async () => {
      await clic(fixture, boton(raiz(), 'Dar acceso a usuario de inventario'));
      llamada(http, 'GET', '/permisos/usuarios-inventario').flush([
        { IdUsuario: 70, Usuario: 'carlos.inv', NombrePersona: 'CARLOS INVENTARIO' },
      ]);
      await actualizar(fixture);
      await enviar(fixture, formulario());
      expect(alerta()).toBe('Selecciona la cuenta de inventario.');

      await elegir(fixture, campo(modal(), '#acceso-usuario'), 'CARLOS INVENTARIO');
      await enviar(fixture, formulario());
      expect(alerta()).toBe('Selecciona el departamento y el área del jefe.');

      await elegir(fixture, campo(modal(), '#acceso-departamento'), 'INFORMATICA');
      await elegir(fixture, campo(modal(), '#acceso-area'), 'DESARROLLO');
      await enviar(fixture, formulario());
      const guardar = llamada(http, 'PUT', '/permisos/jefes/70');
      expect(guardar.request.body).toMatchObject({ Usuario: 'carlos.inv', NombrePersona: 'CARLOS INVENTARIO', Nivel: 'JEFE', IdArea: 101 });
      guardar.flush(null, ok);
      await actualizar(fixture);
      expect(texto()).toContain('CARLOS INVENTARIO ya puede entrar al control de permisos con su misma cuenta.');
      await recargaTrasGuardar();
    });

    it('si no se pueden cargar las cuentas de inventario lo dice', async () => {
      await clic(fixture, boton(raiz(), 'Dar acceso a usuario de inventario'));
      errorApi(llamada(http, 'GET', '/permisos/usuarios-inventario'), 500);
      await actualizar(fixture);
      expect(alerta()).toBe('No se pudieron cargar las cuentas de inventario.');
    });
  });

  describe('administrador de departamento', () => {
    beforeEach(async () => iniciar(sesion('ADMIN_DEPTO')));

    it('no maneja departamentos y solo administra a los jefes de su departamento', async () => {
      expect(botones(raiz(), 'Agregar departamento')).toHaveLength(0);
      expect(texto()).toContain('Jefes de área');
      expect(botones(filaDe(1, 'JEFE SOPORTE'), 'Editar')).toHaveLength(1);
      expect(filaDe(1, 'ADMIN RRHH').textContent).toContain('Solo el administrador general');
      expect(filaDe(1, 'JEFE NOMINA').textContent).toContain('Solo el administrador general');
    });

    it('nueva área va a su departamento sin elegirlo', async () => {
      await clic(fixture, boton(raiz(), 'Nueva área'));
      expect(modal().querySelector('#area-departamento')).toBeNull();
      expect(texto()).toContain('INFORMATICA');
      await escribir(fixture, campo(modal(), '#area-nombre'), 'redes');
      await enviar(fixture, formulario());
      expect(llamada(http, 'POST', '/permisos/areas').request.body).toEqual({ Nombre: 'REDES', Estado: null, IdDepartamento: 10 });
    });

    it('solo nombra jefes', async () => {
      await clic(fixture, boton(raiz(), 'Nuevo usuario'));
      expect(modal().querySelector('#jefe-nivel')).toBeNull();
      expect(texto()).toContain('Departamento');
    });

    it('dar acceso: busca la cuenta por su usuario exacto', async () => {
      await clic(fixture, boton(raiz(), 'Dar acceso a usuario de inventario'));
      sinLlamadas(http, 'GET', '/permisos/usuarios-inventario');
      await clic(fixture, boton(modal(), 'Buscar'));
      expect(alerta()).toBe('Escribe el usuario de la cuenta de inventario.');

      await escribir(fixture, campo(modal(), '#acceso-busqueda'), 'no.existe');
      await clic(fixture, boton(modal(), 'Buscar'));
      const buscar = llamada(http, 'GET', '/permisos/usuarios-inventario');
      expect(buscar.request.params.get('usuario')).toBe('no.existe');
      buscar.flush([]);
      await actualizar(fixture);
      expect(alerta()).toBe('No hay una cuenta de inventario activa sin acceso a permisos con ese usuario.');

      await escribir(fixture, campo(modal(), '#acceso-busqueda'), 'carlos.inv');
      await clic(fixture, boton(modal(), 'Buscar'));
      errorApi(llamada(http, 'GET', '/permisos/usuarios-inventario'), 400, 'Escribe el usuario de la cuenta de inventario.');
      await actualizar(fixture);
      expect(alerta()).toBe('Escribe el usuario de la cuenta de inventario.');

      await clic(fixture, boton(modal(), 'Buscar'));
      llamada(http, 'GET', '/permisos/usuarios-inventario').flush([{ IdUsuario: 70, Usuario: 'carlos.inv', NombrePersona: 'CARLOS INVENTARIO' }]);
      await actualizar(fixture);
      expect(texto()).toContain('Cuenta: CARLOS INVENTARIO · carlos.inv');
      await elegir(fixture, campo(modal(), '#acceso-area'), 'SOPORTE');
      await enviar(fixture, formulario());
      expect(llamada(http, 'PUT', '/permisos/jefes/70').request.body).toMatchObject({ Nivel: 'JEFE', IdArea: 100 });
    });
  });
});
