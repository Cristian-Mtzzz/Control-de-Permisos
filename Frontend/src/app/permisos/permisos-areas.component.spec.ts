import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import {
  actualizar, boton, botones, campo, clic, elegir, empleados, enviar, errorApi, escribir, jefes, llamada, opcionesDe, sesion,
  sinLlamadas, textoDe,
} from '../testing/ui';
import { AuthService } from '../auth/auth.service';
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
  // Sesión del administrador general (admin.permisos, el usuario 50 de la lista).
  const proveedores = () => [
    provideHttpClient(), provideHttpClientTesting(),
    { provide: AuthService, useValue: { currentUser: signal({ UserId: 50, UserName: 'admin.permisos', FullName: 'ADMINISTRADOR', Nivel: 'ADMIN' }) } },
  ];

  async function iniciar(datos: PermisoSesion, usuarios: PermisoJefe[] = jefes): Promise<void> {
    TestBed.configureTestingModule({
      imports: [PermisosAreasComponent],
      providers: proveedores(),
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
    TestBed.configureTestingModule({ imports: [PermisosAreasComponent], providers: proveedores() });
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
      // Local: editar, eliminar y restablecer; dominio: sin restablecer. Ya no se da acceso a cuentas de inventario.
      expect(botones(filaDe(2, 'JEFE SOPORTE'), /^(Editar|Eliminar|Restablecer contraseña)$/)).toHaveLength(3);
      expect(botones(filaDe(2, 'JEFE DOMINIO'), 'Restablecer contraseña')).toHaveLength(0);
      expect(filaDe(2, 'JEFE NOMINA').textContent).toContain('Local');
      expect(filaDe(2, 'JEFE DOMINIO').textContent).toContain('Dominio BA');
      expect(botones(raiz(), /inventario/)).toHaveLength(0);
      expect(texto()).not.toContain('inventario');
      expect(filaDe(2, 'ADMINISTRADOR').textContent).toContain('Todos los departamentos');
    });

    it('las acciones de las tablas son íconos con su nombre en un globo y para lectores de pantalla', async () => {
      const acciones = (fila: HTMLElement): (string | null)[] =>
        Array.from(fila.querySelectorAll('button')).map((accion) => accion.getAttribute('data-tip'));
      expect(acciones(filaDe(0, 'INFORMATICA'))).toEqual(['Desactivar']);
      expect(acciones(filaDe(1, 'SOPORTE'))).toEqual(['Editar', 'Desactivar']);
      expect(acciones(filaDe(1, 'ANTIGUA'))).toEqual(['Editar', 'Activar']);
      expect(acciones(filaDe(2, 'JEFE SOPORTE'))).toEqual(['Editar', 'Eliminar', 'Restablecer contraseña']);
      for (const accion of Array.from(filaDe(2, 'JEFE SOPORTE').querySelectorAll('button'))) {
        expect(accion.classList).toContain('icon-button');
        expect(accion.querySelector('svg')).not.toBeNull();
        expect(accion.querySelector('.sr-only')!.textContent!.trim()).toBe(accion.getAttribute('data-tip'));
      }
    });

    it('los botones de crear se habilitan solo con el formulario completo', async () => {
      // Nueva área: nombre y departamento.
      await clic(fixture, boton(raiz(), 'Nueva área'));
      const guardarArea = (): HTMLButtonElement => boton(modal(), 'Guardar');
      expect(guardarArea().disabled).toBe(true);
      await escribir(fixture, campo(modal(), '#area-nombre'), 'redes');
      expect(guardarArea().disabled).toBe(true);
      await elegir(fixture, campo(modal(), '#area-departamento'), 'INFORMATICA');
      expect(guardarArea().disabled).toBe(false);
      await clic(fixture, boton(modal(), 'Cerrar ventana'));

      // Nuevo usuario: departamento, área, empleado y usuario.
      await clic(fixture, boton(raiz(), 'Nuevo usuario'));
      const crear = (): HTMLButtonElement => boton(modal(), 'Crear usuario');
      expect(crear().disabled).toBe(true);
      await elegir(fixture, campo(modal(), '#jefe-departamento'), 'INFORMATICA');
      await elegir(fixture, campo(modal(), '#jefe-area'), 'SOPORTE');
      await elegir(fixture, campo(modal(), '#jefe-empleado'), 'ANA LOPEZ');
      expect(crear().disabled).toBe(true);
      await escribir(fixture, campo(modal(), '#jefe-usuario'), 'ana.lopez');
      expect(crear().disabled).toBe(false);
      // Un usuario en blanco no cuenta.
      await escribir(fixture, campo(modal(), '#jefe-usuario'), ' ');
      expect(crear().disabled).toBe(true);
    });

    it('agregar departamento: regional, edificio y departamento en orden, error y éxito', async () => {
      await clic(fixture, boton(raiz(), 'Agregar departamento'));
      llamada(http, 'GET', '/permisos/departamentos/disponibles').flush([
        { IdDepartamento: 30, Nombre: 'CONTABILIDAD', Empleados: 5, IdEdificio: 1, NombreEdificio: 'CENTRAL', IdRegional: 1, NombreRegional: 'CENTRO' },
        { IdDepartamento: 31, Nombre: 'ALMACEN', Empleados: 3, IdEdificio: 2, NombreEdificio: 'BODEGA', IdRegional: 2, NombreRegional: 'NORTE' },
        { IdDepartamento: 32, Nombre: 'COMPRAS', Empleados: 2, IdEdificio: 3, NombreEdificio: 'ANEXO', IdRegional: 1, NombreRegional: 'CENTRO' },
        { IdDepartamento: 33, Nombre: 'SIN UBICAR', Empleados: 1, IdEdificio: null, NombreEdificio: null, IdRegional: null, NombreRegional: null },
      ]);
      await actualizar(fixture);
      const select = (id: string): HTMLSelectElement => campo<HTMLSelectElement>(modal(), id);
      // Al abrir solo se puede elegir la regional.
      expect(opcionesDe(select('#departamento-regional'))).toEqual(['Selecciona la regional', 'CENTRO', 'NORTE', 'Sin regional']);
      expect(select('#departamento-edificio').disabled).toBe(true);
      expect(opcionesDe(select('#departamento-edificio'))).toEqual(['Primero elige la regional']);
      expect(select('#departamento-nuevo').disabled).toBe(true);
      expect(opcionesDe(select('#departamento-nuevo'))).toEqual(['Primero elige el edificio']);
      expect(boton(modal(), 'Agregar').disabled).toBe(true);

      // La regional habilita solo sus edificios; el edificio, solo sus departamentos.
      await elegir(fixture, select('#departamento-regional'), 'CENTRO');
      expect(select('#departamento-edificio').disabled).toBe(false);
      expect(opcionesDe(select('#departamento-edificio'))).toEqual(['Selecciona el edificio', 'ANEXO', 'CENTRAL']);
      expect(select('#departamento-nuevo').disabled).toBe(true);
      await elegir(fixture, select('#departamento-edificio'), 'CENTRAL');
      expect(select('#departamento-nuevo').disabled).toBe(false);
      expect(opcionesDe(select('#departamento-nuevo'))).toEqual(['Selecciona el departamento', 'CONTABILIDAD']);
      expect(texto()).toContain('1 departamento(s) disponibles en este edificio.');

      // Otra regional quita el edificio y el departamento elegidos.
      await elegir(fixture, select('#departamento-nuevo'), 'CONTABILIDAD');
      await elegir(fixture, select('#departamento-regional'), 'NORTE');
      expect(select('#departamento-nuevo').disabled).toBe(true);
      expect(boton(modal(), 'Agregar').disabled).toBe(true);

      // Un departamento sin regional ni edificio también se puede agregar.
      await elegir(fixture, select('#departamento-regional'), 'Sin regional');
      expect(opcionesDe(select('#departamento-edificio'))).toEqual(['Selecciona el edificio', 'Sin edificio']);
      await elegir(fixture, select('#departamento-edificio'), 'Sin edificio');
      expect(opcionesDe(select('#departamento-nuevo'))).toEqual(['Selecciona el departamento', 'SIN UBICAR']);

      await elegir(fixture, select('#departamento-regional'), 'CENTRO');
      await elegir(fixture, select('#departamento-edificio'), 'CENTRAL');
      await elegir(fixture, select('#departamento-nuevo'), 'CONTABILIDAD');

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

    it('editar conserva el estado; desactivar con personal muestra el motivo; activar', async () => {
      await clic(fixture, boton(filaDe(1, 'SOPORTE'), 'Editar'));
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

    it('nuevo usuario: orden del formulario, filtros en cascada, validaciones y alta', async () => {
      await clic(fixture, boton(raiz(), 'Nuevo usuario'));
      const seleccionado = (id: string): string => campo<HTMLSelectElement>(modal(), id).selectedOptions[0].textContent!.trim();
      // Los campos del formulario (sin los cuadros de búsqueda de las listas largas).
      expect(Array.from(modal().querySelectorAll('select[id^="jefe-"], input[id^="jefe-"]')).map((item) => item.id)).toEqual([
        'jefe-cuenta', 'jefe-dominio', 'jefe-nivel', 'jefe-departamento', 'jefe-area', 'jefe-empleado', 'jefe-usuario',
      ]);
      // El dominio solo se elige en la cuenta de dominio.
      expect(campo<HTMLSelectElement>(modal(), '#jefe-dominio').disabled).toBe(true);
      await elegir(fixture, campo(modal(), '#jefe-cuenta'), 'Usuario de dominio');
      expect(campo<HTMLSelectElement>(modal(), '#jefe-dominio').disabled).toBe(false);
      await elegir(fixture, campo(modal(), '#jefe-cuenta'), 'Usuario local');
      expect(campo<HTMLSelectElement>(modal(), '#jefe-dominio').disabled).toBe(true);
      // El general puede crear otros administradores generales.
      expect(opcionesDe(campo(modal(), '#jefe-nivel'))).toContain('Administrador general');
      await enviar(fixture, formulario());
      expect(alerta()).toBe('Selecciona el departamento y el área del jefe.');

      // Solo los departamentos habilitados en el sistema; el departamento deja solo su personal.
      expect(opcionesDe(campo(modal(), '#jefe-departamento'))).toEqual(['Selecciona el departamento', 'INFORMATICA', 'RECURSOS HUMANOS']);
      await elegir(fixture, campo(modal(), '#jefe-departamento'), 'RECURSOS HUMANOS');
      expect(opcionesDe(campo(modal(), '#jefe-empleado'))).toEqual(['Selecciona al empleado', 'MARIA RUIZ']);

      // Con un área se ven su personal y el del departamento sin área.
      await elegir(fixture, campo(modal(), '#jefe-departamento'), 'INFORMATICA');
      expect(opcionesDe(campo(modal(), '#jefe-empleado'))).toEqual(['Selecciona al empleado', 'ANA LOPEZ', 'LUIS PAZ', 'PEDRO SIN AREA']);
      await elegir(fixture, campo(modal(), '#jefe-area'), 'SOPORTE');
      expect(opcionesDe(campo(modal(), '#jefe-empleado'))).toEqual(['Selecciona al empleado', 'ANA LOPEZ', 'PEDRO SIN AREA']);
      await enviar(fixture, formulario());
      expect(alerta()).toBe('Selecciona al empleado.');

      await elegir(fixture, campo(modal(), '#jefe-empleado'), 'ANA LOPEZ');
      await enviar(fixture, formulario());
      expect(alerta()).toBe('Escribe el usuario.');
      // Otra área quita al empleado que ya no está en la lista.
      await elegir(fixture, campo(modal(), '#jefe-area'), 'DESARROLLO');
      expect(seleccionado('#jefe-empleado')).toBe('Selecciona al empleado');
      await elegir(fixture, campo(modal(), '#jefe-area'), 'SOPORTE');
      await elegir(fixture, campo(modal(), '#jefe-empleado'), 'ANA LOPEZ');

      await escribir(fixture, campo(modal(), '#jefe-usuario'), '  ana.lopez ');
      await elegir(fixture, campo(modal(), '#jefe-cuenta'), 'Usuario de dominio');
      await elegir(fixture, campo(modal(), '#jefe-dominio'), 'HRN');
      await enviar(fixture, formulario());
      const crear = llamada(http, 'POST', '/permisos/jefes');
      expect(crear.request.body).toEqual({
        Usuario: 'ana.lopez', NombrePersona: 'ANA LOPEZ', Nivel: 'JEFE', IdDepartamento: null, IdArea: 100,
        Dominio: 1, DominioP: 'HRN', Estado: null, IdEmpleado: null,
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

    it('nuevo jefe de departamento; la consulta ya no se ofrece', async () => {
      await clic(fixture, boton(raiz(), 'Nuevo usuario'));
      expect(opcionesDe(campo(modal(), '#jefe-nivel')))
        .toEqual(['Usuario (empleado)', 'Jefe de área', 'Secretaría de departamento', 'Jefe de departamento', 'Administrador general']);
      // Sin departamento ni área elegidos, el empleado los completa.
      await elegir(fixture, campo(modal(), '#jefe-empleado'), 'LUIS PAZ');
      expect(campo<HTMLSelectElement>(modal(), '#jefe-departamento').selectedOptions[0].textContent!.trim()).toBe('INFORMATICA');
      expect(campo<HTMLSelectElement>(modal(), '#jefe-area').selectedOptions[0].textContent!.trim()).toBe('DESARROLLO');
      await escribir(fixture, campo(modal(), '#jefe-usuario'), 'luis.paz');
      await elegir(fixture, campo(modal(), '#jefe-nivel'), 'Jefe de departamento');
      expect(texto()).toContain('Ve su departamento y administra sus áreas');
      await elegir(fixture, campo(modal(), '#jefe-departamento'), 'Selecciona el departamento');
      await enviar(fixture, formulario());
      expect(alerta()).toBe('Selecciona el departamento que administra.');
      await elegir(fixture, campo(modal(), '#jefe-departamento'), 'INFORMATICA');
      await enviar(fixture, formulario());
      expect(llamada(http, 'POST', '/permisos/jefes').request.body).toMatchObject({ Nivel: 'ADMIN_DEPTO', IdDepartamento: 10, IdArea: null });
    });

    it('nuevo administrador general: sin departamento ni área', async () => {
      await clic(fixture, boton(raiz(), 'Nuevo usuario'));
      await elegir(fixture, campo(modal(), '#jefe-empleado'), 'LUIS PAZ');
      await escribir(fixture, campo(modal(), '#jefe-usuario'), 'luis.paz');
      await elegir(fixture, campo(modal(), '#jefe-nivel'), 'Administrador general');
      expect(texto()).toContain('Ve todos los departamentos y administra departamentos, áreas y usuarios.');
      expect(texto()).toContain('El departamento y el área solo sirven para buscar al empleado.');
      await enviar(fixture, formulario());
      expect(llamada(http, 'POST', '/permisos/jefes').request.body).toMatchObject({ Nivel: 'ADMIN', IdDepartamento: null, IdArea: null });
    });

    it('editar usuario local: estado, paso a local y su aviso', async () => {
      await clic(fixture, boton(filaDe(2, 'JEFE DOMINIO'), 'Editar'));
      expect(texto()).toContain('Editar usuario');
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

    it('eliminar un usuario pide confirmación; cancelar no llama a la API', async () => {
      // En la fila propia no se ofrece eliminar.
      expect(botones(filaDe(2, 'ADMINISTRADOR'), 'Eliminar')).toHaveLength(0);
      expect(botones(filaDe(2, 'ADMINISTRADOR'), 'Editar')).toHaveLength(1);

      await clic(fixture, boton(filaDe(2, 'JEFE SOPORTE'), 'Eliminar'));
      expect(modal().textContent).toContain('Eliminar usuario');
      expect(modal().textContent).toContain('JEFE SOPORTE');
      await clic(fixture, boton(modal(), 'Cancelar'));
      expect(raiz().querySelector('.workshop-modal')).toBeNull();
      http.expectNone((request) => request.method === 'DELETE');

      await clic(fixture, boton(filaDe(2, 'JEFE NOMINA'), 'Eliminar'));
      await enviar(fixture, formulario());
      errorApi(llamada(http, 'DELETE', '/permisos/jefes/53'), 404, 'No se encontró el usuario indicado o no lo administras.');
      await actualizar(fixture);
      expect(alerta()).toContain('no lo administras');
      await clic(fixture, boton(modal(), 'Cerrar ventana'));

      await clic(fixture, boton(filaDe(2, 'JEFE SOPORTE'), 'Eliminar'));
      await enviar(fixture, formulario());
      llamada(http, 'DELETE', '/permisos/jefes/51').flush(null, ok);
      await actualizar(fixture);
      expect(raiz().querySelector('.workshop-modal')).toBeNull();
      expect(texto()).toMatch(/Usuario \S+ eliminado\./);
      await recargaTrasGuardar();
    });

    it('editar un usuario: cambia su nivel a jefe de departamento', async () => {
      await clic(fixture, boton(filaDe(2, 'JEFE NOMINA'), 'Editar'));
      expect(campo<HTMLInputElement>(modal(), '#jefe-usuario').value).toBe('jefe.nomina');
      await elegir(fixture, campo(modal(), '#jefe-nivel'), 'Jefe de departamento');
      await elegir(fixture, campo(modal(), '#jefe-departamento'), 'INFORMATICA');
      await enviar(fixture, formulario());
      const guardar = llamada(http, 'PUT', '/permisos/jefes/53');
      expect(guardar.request.body).toMatchObject({ Usuario: 'jefe.nomina', Nivel: 'ADMIN_DEPTO', IdArea: null, IdDepartamento: 10 });
      guardar.flush(null, ok);
      await actualizar(fixture);
      expect(texto()).toContain('Usuario actualizado.');
      await recargaTrasGuardar();
    });
  });

  describe('administrador de departamento', () => {
    beforeEach(async () => iniciar(sesion('ADMIN_DEPTO')));

    it('no maneja departamentos y solo administra a los jefes de su departamento', async () => {
      expect(botones(raiz(), 'Agregar departamento')).toHaveLength(0);
      expect(texto()).toContain('Usuarios de mi departamento');
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

    it('nombra jefes de sus áreas y la secretaría de su departamento', async () => {
      await clic(fixture, boton(raiz(), 'Nuevo usuario'));
      expect(opcionesDe(campo(modal(), '#jefe-nivel')))
        .toEqual(['Usuario (empleado)', 'Jefe de área', 'Secretaría de departamento']);
      // Con un solo departamento ya va en el suyo.
      expect(campo<HTMLSelectElement>(modal(), '#jefe-departamento').selectedOptions[0].textContent!.trim()).toBe('INFORMATICA');

      await elegir(fixture, campo(modal(), '#jefe-empleado'), 'LUIS PAZ');
      await escribir(fixture, campo(modal(), '#jefe-usuario'), 'luis.paz');
      await elegir(fixture, campo(modal(), '#jefe-nivel'), 'Secretaría de departamento');
      expect(texto()).toContain('Ve todas las áreas de su departamento y saca sus reportes y memorandos');
      await enviar(fixture, formulario());
      // El área solo sirvió para buscar al empleado: la secretaría va al departamento.
      expect(llamada(http, 'POST', '/permisos/jefes').request.body)
        .toMatchObject({ Nivel: 'SECRETARIA', IdDepartamento: 10, IdArea: null });
    });

  });
});
