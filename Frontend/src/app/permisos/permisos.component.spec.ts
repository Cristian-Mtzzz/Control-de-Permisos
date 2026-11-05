import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { Router, provideRouter } from '@angular/router';
import { AuthService } from '../auth/auth.service';
import {
  actualizar, boton, botones, campo, clic, dia, elegir, empleados, enviar, errorApi, escribir, llamada, opcionesDe,
  permiso, permisos, proximoDiaHabil, proximoSabado, rutasDePrueba, sesion, sinLlamadas, textoDe,
} from '../testing/ui';
import { Permiso, PermisoEmpleado, PermisoSesion } from './permisos.models';
import { PermisosComponent } from './permisos.component';

// Pantalla de permisos completa con la API simulada: cada botón, filtro y ventana, y lo que el
// usuario ve cuando la API responde bien o con cada tipo de error.
describe('Pantalla de permisos', () => {
  let fixture: ComponentFixture<PermisosComponent>;
  let http: HttpTestingController;
  let auth: { currentUser: ReturnType<typeof signal>; setNivel: ReturnType<typeof vi.fn>; logout: ReturnType<typeof vi.fn> };
  const raiz = (): HTMLElement => fixture.nativeElement as HTMLElement;
  const texto = (): string => textoDe(fixture);
  const inicioCarga = `${new Date().getFullYear() - 1}-01-01`;

  async function iniciar(
    nivel: PermisoSesion['Nivel'],
    datos: { sesion?: PermisoSesion; permisos?: Permiso[]; empleados?: PermisoEmpleado[] } = {},
  ): Promise<void> {
    auth = {
      currentUser: signal({ UserId: 50, UserName: 'admin.permisos', FullName: 'ADMINISTRADOR', Nivel: null }),
      setNivel: vi.fn(),
      logout: vi.fn(),
    };
    TestBed.configureTestingModule({
      imports: [PermisosComponent],
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter(rutasDePrueba), { provide: AuthService, useValue: auth }],
    });
    http = TestBed.inject(HttpTestingController);
    fixture = TestBed.createComponent(PermisosComponent);
    await actualizar(fixture);
    llamada(http, 'GET', '/permisos/sesion').flush(datos.sesion ?? sesion(nivel));
    await actualizar(fixture);
    const carga = llamada(http, 'GET', '/permisos');
    expect(carga.request.params.get('desde')).toBe(inicioCarga);
    carga.flush(datos.permisos ?? permisos);
    llamada(http, 'GET', '/permisos/empleados').flush(datos.empleados ?? empleados);
    await actualizar(fixture);
  }

  const filas = (): HTMLTableRowElement[] =>
    Array.from(raiz().querySelectorAll<HTMLTableRowElement>('table.permisos-table tbody tr'));
  const idsVisibles = (): string[] => filas().map((fila) => fila.cells[0].textContent!.trim());
  const fila = (id: number): HTMLTableRowElement => {
    const encontrada = filas().find((item) => item.cells[0].textContent!.trim() === String(id));
    if (!encontrada) throw new Error(`No se ve el permiso #${id}.`);
    return encontrada;
  };
  const estadoDe = (id: number): string => fila(id).querySelector('.estado-badge')!.textContent!.trim();
  const modal = (): HTMLElement => campo(raiz(), '.workshop-modal');
  const formularioModal = (): HTMLFormElement => campo(modal(), 'form');
  const alerta = (): string => raiz().querySelector('[role="alert"]')?.textContent?.trim() ?? '';

  beforeEach(() => {
    URL.createObjectURL = vi.fn(() => 'blob:reporte');
    URL.revokeObjectURL = vi.fn();
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
  });

  // Ninguna llamada a la API queda sin responder ni se hace una que no se esperaba.
  afterEach(() => {
    vi.restoreAllMocks();
    try {
      http?.verify();
    } finally {
      TestBed.resetTestingModule();
    }
  });

  // ---- Carga y niveles ------------------------------------------------------------------

  describe('carga según el nivel', () => {
    it('administrador general: pestañas, filtros, indicadores y estados', async () => {
      await iniciar('ADMIN');

      expect(auth.setNivel).toHaveBeenCalledWith('ADMIN');
      expect(botones(raiz(), /^(Permisos|Personal|Departamentos, áreas y jefes)$/)).toHaveLength(3);
      expect(raiz().querySelector('select[name="deptoFilter"]')).not.toBeNull();
      expect(raiz().querySelector('select[name="areaFilter"]')).not.toBeNull();
      expect(idsVisibles()).toEqual(['1', '2', '3', '4', '5']);
      expect([1, 2, 3, 4, 5].map(estadoDe)).toEqual(['ACTIVO', 'ACTIVO', 'FINALIZADO', 'ANULADO', 'FINALIZADO']);
      // Hoy: el vigente y el sin área (activo en la base, ya terminado según su jornada).
      const hoy = campo<HTMLElement>(raiz(), '.permisos-hoy');
      expect(hoy.textContent).toContain('ANA LOPEZ');
      expect(hoy.textContent).toContain('PEDRO SIN AREA');
      expect(campo<HTMLElement>(raiz(), '.kpi-primary .kpi-value').textContent!.trim()).toBe('2');
      expect(texto()).toContain('DEPARTAMENTO');
    });

    it('usa la jornada que manda la API: un permiso sin área ya terminado no se puede editar ni anular', async () => {
      await iniciar('ADMIN');

      // Sin HoraFinJornada se habría usado la del primer departamento (16:00) y antes de esa
      // hora se vería activo, con Editar y Anular, aunque la API ya no deja modificarlo.
      expect(estadoDe(5)).toBe('FINALIZADO');
      expect(botones(fila(5), 'Editar')).toHaveLength(0);
      expect(fila(5).textContent).toContain('Finalizado');
      expect(botones(fila(1), 'Editar')).toHaveLength(1);
      expect(botones(fila(1), 'Anular')).toHaveLength(1);
      expect(fila(3).textContent).toContain('Finalizado');
      expect(fila(4).textContent).toContain('Anulado');
    });

    it('consulta: solo ve y exporta', async () => {
      await iniciar('CONSULTA');

      expect(botones(raiz(), 'Nuevo permiso')).toHaveLength(0);
      expect(botones(raiz(), /Personal/)).toHaveLength(0);
      expect(botones(raiz(), /áreas y jefes/)).toHaveLength(0);
      expect(botones(raiz(), 'Editar')).toHaveLength(0);
      expect(botones(raiz(), 'Anular')).toHaveLength(0);
      expect(botones(raiz(), 'Exportar reporte')).toHaveLength(1);
      expect(texto()).toContain('SOLO CONSULTA');
    });

    it('jefe: solo su área, sin filtros, y no modifica lo de otra área', async () => {
      await iniciar('JEFE');

      expect(raiz().querySelector('.area-filter-bar')).toBeNull();
      expect(botones(raiz(), 'Mi personal')).toHaveLength(1);
      expect(botones(raiz(), /áreas y jefes/)).toHaveLength(0);
      expect(texto()).toContain('Permisos del área de SOPORTE');
      expect(botones(fila(1), 'Editar')).toHaveLength(1);
      expect(botones(fila(2), 'Editar')).toHaveLength(0);
      expect(fila(2).textContent).toContain('Área DESARROLLO');
    });

    it('administrador de departamento: filtro de área sin filtro de departamento', async () => {
      await iniciar('ADMIN_DEPTO');

      expect(raiz().querySelector('select[name="deptoFilter"]')).toBeNull();
      expect(opcionesDe(campo(raiz(), 'select[name="areaFilter"]'))).toEqual(['Todas las áreas', 'SOPORTE', 'DESARROLLO', 'ANTIGUA']);
      expect(botones(raiz(), 'Áreas y jefes')).toHaveLength(1);
      // El permiso de otro departamento que llegó (su personal) no lo modifica.
      expect(botones(fila(3), 'Editar')).toHaveLength(0);
    });

    it('muestra el aviso de un parámetro mal escrito en la base', async () => {
      const conAviso = sesion('ADMIN');
      conAviso.Departamentos = [{ ...conAviso.Departamentos[0], AvisoParametros: 'HORA_FIN_JORNADA debe tener el formato HH:mm.' }];
      await iniciar('ADMIN', { sesion: conAviso });

      expect(texto()).toContain('INFORMATICA: HORA_FIN_JORNADA debe tener el formato HH:mm.');
    });

    it.each([
      [403, 'Tu usuario no tiene un área ni un departamento activo.', 'Tu usuario no tiene un área ni un departamento activo.'],
      [503, 'La base de datos no está disponible temporalmente.', 'La base de datos no está disponible temporalmente.'],
      [0, undefined, 'No se pudo cargar tu información de permisos.'],
    ])('si la sesión falla con %s muestra el motivo y no pide nada más', async (status, mensaje, esperado) => {
      auth = { currentUser: signal(null), setNivel: vi.fn(), logout: vi.fn() };
      TestBed.configureTestingModule({
        imports: [PermisosComponent],
        providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter(rutasDePrueba), { provide: AuthService, useValue: auth }],
      });
      http = TestBed.inject(HttpTestingController);
      fixture = TestBed.createComponent(PermisosComponent);
      await actualizar(fixture);
      errorApi(llamada(http, 'GET', '/permisos/sesion'), status, mensaje);
      await actualizar(fixture);

      expect(alerta()).toBe(esperado);
      expect(raiz().querySelector('table.permisos-table')).toBeNull();
      sinLlamadas(http, 'GET', '/permisos/empleados');
    });

    it('si fallan los permisos o los empleados lo dice sin dejar la pantalla cargando', async () => {
      auth = { currentUser: signal(null), setNivel: vi.fn(), logout: vi.fn() };
      TestBed.configureTestingModule({
        imports: [PermisosComponent],
        providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter(rutasDePrueba), { provide: AuthService, useValue: auth }],
      });
      http = TestBed.inject(HttpTestingController);
      fixture = TestBed.createComponent(PermisosComponent);
      await actualizar(fixture);
      llamada(http, 'GET', '/permisos/sesion').flush(sesion('ADMIN'));
      await actualizar(fixture);
      errorApi(llamada(http, 'GET', '/permisos'), 500, 'Ocurrió un error inesperado.');
      errorApi(llamada(http, 'GET', '/permisos/empleados'), 0);
      await actualizar(fixture);

      expect(alerta()).toBe('No se pudieron cargar los empleados.');
      expect(texto()).not.toContain('Cargando permisos...');
      expect(texto()).toContain('No hay permisos que coincidan.');
    });
  });

  // ---- Filtros y tabla ------------------------------------------------------------------

  describe('filtros de la tabla', () => {
    beforeEach(async () => iniciar('ADMIN'));

    it.each([
      ['maria', ['3']],
      ['1002', ['2']],
      ['4', ['4']],
      ['vacaciones', ['3']],
      ['nadie', []],
    ])('buscar "%s"', async (busqueda, esperados) => {
      await escribir(fixture, campo(raiz(), 'input[name="permisoSearch"]'), busqueda);

      if (esperados.length === 0) expect(texto()).toContain('No hay permisos que coincidan.');
      else expect(idsVisibles()).toEqual(esperados);
    });

    it('por tipo y por estado, y sus combinaciones', async () => {
      const tipo = campo<HTMLSelectElement>(raiz(), 'select[name="tipoFilter"]');
      const estado = campo<HTMLSelectElement>(raiz(), 'select[name="estadoFilter"]');

      await elegir(fixture, tipo, 'Por hora');
      expect(idsVisibles()).toEqual(['2']);
      await elegir(fixture, estado, 'Finalizados');
      expect(texto()).toContain('No hay permisos que coincidan.');
      await elegir(fixture, tipo, 'Por día');
      expect(idsVisibles()).toEqual(['3', '5']);
      await elegir(fixture, estado, 'Anulados');
      expect(idsVisibles()).toEqual(['4']);
      await elegir(fixture, estado, 'Activos');
      expect(idsVisibles()).toEqual(['1']);
      await elegir(fixture, tipo, 'Todos los tipos');
      await elegir(fixture, estado, 'Todos los estados');
      expect(idsVisibles()).toHaveLength(5);
    });

    it('por departamento y área: cambiar de departamento quita el área que ya no le corresponde', async () => {
      const depto = campo<HTMLSelectElement>(raiz(), 'select[name="deptoFilter"]');
      const area = campo<HTMLSelectElement>(raiz(), 'select[name="areaFilter"]');

      await elegir(fixture, area, 'SOPORTE');
      expect(idsVisibles()).toEqual(['1', '4']);
      expect(texto()).toContain('Permisos del área de SOPORTE');
      await elegir(fixture, depto, 'RECURSOS HUMANOS');
      expect(opcionesDe(area)).toEqual(['Todas las áreas', 'NOMINA']);
      expect(idsVisibles()).toEqual(['3']);
      // Con un departamento elegido ya no hace falta la columna de departamento.
      expect(Array.from(raiz().querySelectorAll('table.permisos-table th')).map((th) => th.textContent!.trim()))
        .not.toContain('DEPARTAMENTO');
      expect(campo<HTMLElement>(raiz(), '.kpi-primary .kpi-value').textContent!.trim()).toBe('0');
    });

    it('fechas: un "desde" anterior a lo cargado pide a la API lo que falta; "Quitar fechas" las limpia', async () => {
      const desde = campo<HTMLInputElement>(raiz(), 'input[name="fechaDesde"]');
      const hasta = campo<HTMLInputElement>(raiz(), 'input[name="fechaHasta"]');

      await escribir(fixture, hasta, dia(-1));
      expect(idsVisibles()).toEqual(['3']);
      await escribir(fixture, desde, '2020-01-01');
      const anteriores = llamada(http, 'GET', '/permisos');
      expect(anteriores.request.params.get('desde')).toBe('2020-01-01');
      anteriores.flush([...permisos, permiso({ IdPermiso: 9, FechaInicio: '2020-05-04T00:00:00', FechaFin: '2020-05-04T00:00:00' })]);
      await actualizar(fixture);
      expect(idsVisibles()).toEqual(['3', '9']);

      await clic(fixture, boton(raiz(), 'Quitar fechas'));
      expect(desde.value).toBe('');
      expect(idsVisibles()).toHaveLength(6);
      expect(botones(raiz(), 'Quitar fechas')).toHaveLength(0);
    });

    it('si falla la carga de permisos anteriores conserva los que ya tenía', async () => {
      await escribir(fixture, campo(raiz(), 'input[name="fechaDesde"]'), '2020-01-01');
      errorApi(llamada(http, 'GET', '/permisos'), 503, 'La base de datos no está disponible temporalmente.');
      await actualizar(fixture);

      expect(alerta()).toBe('La base de datos no está disponible temporalmente.');
      expect(idsVisibles()).toHaveLength(5);
    });
  });

  it('paginación: tamaño de página y botones', async () => {
    const muchos = Array.from({ length: 25 }, (_, index) => permiso({ IdPermiso: 100 + index }));
    await iniciar('ADMIN', { permisos: muchos });

    expect(filas()).toHaveLength(10);
    expect(texto()).toContain('1–10 de 25 registros');
    await clic(fixture, boton(raiz(), 'Siguiente'));
    expect(texto()).toContain('11–20 de 25 registros');
    await clic(fixture, boton(raiz(), 'Última página'));
    expect(filas()).toHaveLength(5);
    expect(boton(raiz(), 'Siguiente').disabled).toBe(true);
    await clic(fixture, boton(raiz(), 'Primera página'));
    expect(boton(raiz(), 'Anterior').disabled).toBe(true);
    await elegir(fixture, campo(raiz(), 'app-table-page-size select'), '25');
    expect(filas()).toHaveLength(25);
    // Un filtro que deja menos registros vuelve a la primera página.
    await escribir(fixture, campo(raiz(), 'input[name="permisoSearch"]'), '124');
    expect(idsVisibles()).toEqual(['124']);
  });

  // ---- Registrar ------------------------------------------------------------------------

  describe('registrar un permiso por día', () => {
    beforeEach(async () => {
      await iniciar('ADMIN');
      await clic(fixture, boton(raiz(), 'Nuevo permiso'));
    });

    it('valida cada dato antes de llamar a la API', async () => {
      expect(texto()).toContain('Registrar permiso');
      await enviar(fixture, formularioModal());
      expect(alerta()).toBe('Selecciona el empleado y escribe el motivo del permiso.');

      await elegir(fixture, campo(modal(), '#permiso-empleado'), 'ANA LOPEZ');
      await escribir(fixture, campo(modal(), '#permiso-motivo'), 'cita medica');
      expect(campo<HTMLTextAreaElement>(modal(), '#permiso-motivo').value).toBe('CITA MEDICA');
      expect(texto()).toContain('Este mes:');
      await enviar(fixture, formularioModal());
      expect(alerta()).toBe('Indica la fecha inicial y la fecha final.');

      await escribir(fixture, campo(modal(), '#dia-inicio'), dia(3));
      // La fecha final acompaña a la inicial.
      expect(campo<HTMLInputElement>(modal(), '#dia-fin').value).toBe(dia(3));
      await escribir(fixture, campo(modal(), '#dia-fin'), dia(1));
      await enviar(fixture, formularioModal());
      expect(alerta()).toBe('La fecha final no puede ser anterior a la fecha inicial.');

      await escribir(fixture, campo(modal(), '#dia-fin'), dia(4));
      await escribir(fixture, campo(modal(), '#permiso-solicitud'), dia(1));
      await enviar(fixture, formularioModal());
      expect(alerta()).toBe('La fecha de solicitud no puede ser posterior a hoy.');

      await escribir(fixture, campo(modal(), '#permiso-solicitud'), '');
      await enviar(fixture, formularioModal());
      expect(alerta()).toBe('Indica la fecha en que se hizo la solicitud.');
      sinLlamadas(http, 'POST', '/permisos/dia');
    });

    it('muestra cada error de la API dentro de la ventana y al final lo registra', async () => {
      await elegir(fixture, campo(modal(), '#permiso-empleado'), 'ANA LOPEZ');
      await escribir(fixture, campo(modal(), '#permiso-motivo'), 'Cita');
      await escribir(fixture, campo(modal(), '#dia-inicio'), dia(3));
      await escribir(fixture, campo(modal(), '#dia-fin'), dia(4));

      const casos: [number, string | undefined, string][] = [
        [400, 'El empleado ya tiene un permiso por día que se cruza con este permiso.', 'El empleado ya tiene un permiso por día que se cruza con este permiso.'],
        [403, 'Tu usuario es de consulta: puede ver y exportar, pero no modificar.', 'Tu usuario es de consulta: puede ver y exportar, pero no modificar.'],
        [409, 'Otro usuario está modificando estos datos. Intenta de nuevo en unos segundos.', 'Otro usuario está modificando estos datos. Intenta de nuevo en unos segundos.'],
        [500, undefined, 'No se pudo guardar el permiso.'],
        [0, undefined, 'No se pudo guardar el permiso.'],
      ];
      for (const [status, mensaje, esperado] of casos) {
        await enviar(fixture, formularioModal());
        const guardar = llamada(http, 'POST', '/permisos/dia');
        expect(boton(modal(), 'Guardando...').disabled).toBe(true);
        expect(guardar.request.body).toEqual({
          IdEmpleado: 1, Motivo: 'CITA', FechaInicio: dia(3), FechaFin: dia(4), FechaSolicitud: dia(),
        });
        errorApi(guardar, status, mensaje);
        await actualizar(fixture);
        expect(alerta()).toBe(esperado);
        expect(boton(modal(), 'Registrar permiso').disabled).toBe(false);
      }

      await enviar(fixture, formularioModal());
      llamada(http, 'POST', '/permisos/dia').flush(null, { status: 204, statusText: 'No Content' });
      await actualizar(fixture);
      expect(raiz().querySelector('.workshop-modal')).toBeNull();
      expect(texto()).toContain('Permiso registrado.');
      llamada(http, 'GET', '/permisos').flush(permisos);
      await actualizar(fixture);
    });

    it('la vista previa cuenta solo días hábiles', async () => {
      await escribir(fixture, campo(modal(), '#dia-inicio'), proximoSabado());
      expect(texto()).toContain('El rango no tiene días hábiles.');
      const sabado = proximoSabado();
      const [anio, mes, diaMes] = sabado.split('-').map(Number);
      const lunes = new Date(anio, mes - 1, diaMes + 2);
      const lunesTexto = `${lunes.getFullYear()}-${String(lunes.getMonth() + 1).padStart(2, '0')}-${String(lunes.getDate()).padStart(2, '0')}`;
      await escribir(fixture, campo(modal(), '#dia-fin'), lunesTexto);
      expect(texto()).toContain('1 día hábil');
    });

    it('la × cierra la ventana sin guardar', async () => {
      await clic(fixture, boton(modal(), 'Cerrar ventana'));
      expect(raiz().querySelector('.workshop-modal')).toBeNull();
      sinLlamadas(http, 'POST', '/permisos/dia');
    });
  });

  describe('registrar un permiso por hora', () => {
    beforeEach(async () => {
      await iniciar('ADMIN');
      await clic(fixture, boton(raiz(), 'Nuevo permiso'));
      await elegir(fixture, campo(modal(), '#permiso-empleado'), 'LUIS PAZ');
      await escribir(fixture, campo(modal(), '#permiso-motivo'), 'banco');
      await clic(fixture, boton(modal(), 'Por hora'));
    });

    it('al cambiar de tipo conserva el empleado y el motivo', async () => {
      expect(boton(modal(), 'Por hora').getAttribute('aria-checked')).toBe('true');
      expect(campo<HTMLTextAreaElement>(modal(), '#permiso-motivo').value).toBe('BANCO');
      expect(campo<HTMLSelectElement>(modal(), '#permiso-empleado').selectedOptions[0].textContent).toContain('LUIS PAZ');
      expect(texto()).toContain('Jornada laboral: 08:00 a 16:00.');
    });

    it('valida día hábil, jornada y orden de las horas', async () => {
      await enviar(fixture, formularioModal());
      expect(alerta()).toBe('Indica la fecha, la hora de salida y la hora de entrada.');

      await escribir(fixture, campo(modal(), '#hora-fecha'), proximoSabado());
      await escribir(fixture, campo(modal(), '#hora-salida'), '09:00');
      await escribir(fixture, campo(modal(), '#hora-entrada'), '10:00');
      await enviar(fixture, formularioModal());
      expect(alerta()).toBe('La fecha del permiso no es un día hábil.');

      await escribir(fixture, campo(modal(), '#hora-fecha'), proximoDiaHabil());
      await escribir(fixture, campo(modal(), '#hora-salida'), '07:00');
      await enviar(fixture, formularioModal());
      expect(alerta()).toBe('Las horas deben estar dentro de la jornada laboral, de 08:00 a 16:00.');

      await escribir(fixture, campo(modal(), '#hora-salida'), '15:00');
      await escribir(fixture, campo(modal(), '#hora-entrada'), '17:00');
      await enviar(fixture, formularioModal());
      expect(alerta()).toBe('Las horas deben estar dentro de la jornada laboral, de 08:00 a 16:00.');

      await escribir(fixture, campo(modal(), '#hora-salida'), '11:00');
      await escribir(fixture, campo(modal(), '#hora-entrada'), '10:00');
      await enviar(fixture, formularioModal());
      expect(alerta()).toBe('La hora de entrada debe ser posterior a la hora de salida.');
      sinLlamadas(http, 'POST', '/permisos/hora');
    });

    it('registra con la duración calculada y la jornada del departamento del empleado', async () => {
      await escribir(fixture, campo(modal(), '#hora-fecha'), proximoDiaHabil());
      await escribir(fixture, campo(modal(), '#hora-salida'), '13:30');
      await escribir(fixture, campo(modal(), '#hora-entrada'), '15:00');
      expect(texto()).toContain('Duración: 1 h 30 min');

      await enviar(fixture, formularioModal());
      const guardar = llamada(http, 'POST', '/permisos/hora');
      expect(guardar.request.body).toEqual({
        IdEmpleado: 2, Motivo: 'BANCO', Fecha: proximoDiaHabil(), HoraSalida: '13:30', HoraEntrada: '15:00', FechaSolicitud: dia(),
      });
      guardar.flush(null, { status: 204, statusText: 'No Content' });
      await actualizar(fixture);
      expect(texto()).toContain('Permiso registrado.');
      llamada(http, 'GET', '/permisos').flush(permisos);
    });

    it('un empleado de otro departamento usa la jornada de ese departamento', async () => {
      await elegir(fixture, campo(modal(), '#permiso-empleado'), 'MARIA RUIZ');
      expect(texto()).toContain('Jornada laboral: 07:00 a 15:00.');
      await escribir(fixture, campo(modal(), '#hora-fecha'), proximoDiaHabil());
      await escribir(fixture, campo(modal(), '#hora-salida'), '14:00');
      await escribir(fixture, campo(modal(), '#hora-entrada'), '15:30');
      await enviar(fixture, formularioModal());
      expect(alerta()).toBe('Las horas deben estar dentro de la jornada laboral, de 07:00 a 15:00.');
    });
  });

  // ---- Editar y anular ------------------------------------------------------------------

  describe('editar', () => {
    beforeEach(async () => iniciar('ADMIN'));

    it('abre con los datos del permiso y guarda con PUT; si ya no existe lo dice', async () => {
      await clic(fixture, boton(fila(1), 'Editar'));
      expect(texto()).toContain('EDITAR PERMISO #1');
      expect(campo<HTMLTextAreaElement>(modal(), '#permiso-motivo').value).toBe('CITA MEDICA');
      expect(campo<HTMLInputElement>(modal(), '#dia-fin').value).toBe(dia(2));
      expect(texto()).toContain('Sin contar este permiso.');

      await enviar(fixture, formularioModal());
      const guardar = llamada(http, 'PUT', '/permisos/dia/1');
      errorApi(guardar, 404, 'No se encontró el permiso indicado.');
      await actualizar(fixture);
      expect(alerta()).toBe('No se encontró el permiso indicado.');

      await enviar(fixture, formularioModal());
      errorApi(llamada(http, 'PUT', '/permisos/dia/1'), 400, 'El permiso ya finalizó y no se puede editar.');
      await actualizar(fixture);
      expect(alerta()).toBe('El permiso ya finalizó y no se puede editar.');

      await enviar(fixture, formularioModal());
      llamada(http, 'PUT', '/permisos/dia/1').flush(null, { status: 204, statusText: 'No Content' });
      await actualizar(fixture);
      expect(texto()).toContain('Permiso actualizado.');
      llamada(http, 'GET', '/permisos').flush(permisos);
    });

    it('un permiso por hora se puede pasar a por día: usa su fecha y guarda en /dia', async () => {
      await clic(fixture, boton(fila(2), 'Editar'));
      expect(campo<HTMLInputElement>(modal(), '#hora-salida').value).toBe('09:00');
      await clic(fixture, boton(modal(), 'Por día'));
      expect(campo<HTMLInputElement>(modal(), '#dia-inicio').value).toBe(proximoDiaHabil());

      await enviar(fixture, formularioModal());
      const guardar = llamada(http, 'PUT', '/permisos/dia/2');
      expect(guardar.request.body).toMatchObject({ IdEmpleado: 2, Motivo: 'TRAMITE BANCARIO', FechaInicio: proximoDiaHabil() });
      guardar.flush(null, { status: 204, statusText: 'No Content' });
      await actualizar(fixture);
      llamada(http, 'GET', '/permisos').flush(permisos);
    });
  });

  describe('anular', () => {
    beforeEach(async () => iniciar('ADMIN'));

    it('Cancelar no anula; confirmar muestra los errores y después anula', async () => {
      await clic(fixture, boton(fila(1), 'Anular'));
      expect(texto()).toContain('Anular permiso #1');
      await clic(fixture, boton(modal(), 'Cancelar'));
      expect(raiz().querySelector('.workshop-modal')).toBeNull();
      sinLlamadas(http, 'PUT', '/permisos/1/anular');

      await clic(fixture, boton(fila(1), 'Anular'));
      await enviar(fixture, formularioModal());
      expect(boton(modal(), 'Anulando...').disabled).toBe(true);
      errorApi(llamada(http, 'PUT', '/permisos/1/anular'), 400, 'El permiso está anulado y ya no se puede anular.');
      await actualizar(fixture);
      expect(alerta()).toBe('El permiso está anulado y ya no se puede anular.');

      await enviar(fixture, formularioModal());
      errorApi(llamada(http, 'PUT', '/permisos/1/anular'), 0);
      await actualizar(fixture);
      expect(alerta()).toBe('No se pudo anular el permiso.');

      await enviar(fixture, formularioModal());
      llamada(http, 'PUT', '/permisos/1/anular').flush(null, { status: 204, statusText: 'No Content' });
      await actualizar(fixture);
      expect(texto()).toContain('Permiso anulado.');
      llamada(http, 'GET', '/permisos').flush(permisos.map((item) => item.IdPermiso === 1 ? { ...item, Estado: 'ANULADO' as const } : item));
      await actualizar(fixture);
      expect(estadoDe(1)).toBe('ANULADO');
    });
  });

  // ---- Historial ------------------------------------------------------------------------

  describe('historial del empleado', () => {
    beforeEach(async () => iniciar('ADMIN'));

    it('trae el historial completo de la API', async () => {
      await clic(fixture, boton(fila(1), 'ANA LOPEZ'));
      expect(texto()).toContain('HISTORIAL DEL EMPLEADO');
      expect(texto()).toContain('Cargando el historial completo...');
      const pedido = llamada(http, 'GET', '/permisos');
      expect(pedido.request.params.get('idEmpleado')).toBe('1');
      pedido.flush([permisos[0], permisos[3], permiso({ IdPermiso: 7, FechaInicio: '2019-02-01T00:00:00', FechaFin: '2019-02-01T00:00:00' })]);
      await actualizar(fixture);

      expect(texto()).not.toContain('Cargando el historial completo...');
      expect(modal().querySelectorAll('tbody tr')).toHaveLength(3);
      expect(texto()).toContain('Todo el historial');
      expect(texto()).toContain('No. de pago 1001');
      await clic(fixture, boton(modal(), 'Cerrar ventana'));
      expect(raiz().querySelector('.workshop-modal')).toBeNull();
    });

    it('si la API falla se queda con los permisos ya cargados y avisa', async () => {
      await clic(fixture, boton(fila(1), 'ANA LOPEZ'));
      errorApi(llamada(http, 'GET', '/permisos'), 500);
      await actualizar(fixture);

      expect(alerta()).toBe('No se pudo cargar el historial completo del empleado.');
      expect(modal().querySelectorAll('tbody tr')).toHaveLength(2);
    });
  });

  // ---- Reporte --------------------------------------------------------------------------

  describe('reporte de Excel', () => {
    beforeEach(async () => {
      await iniciar('ADMIN');
      await clic(fixture, boton(raiz(), 'Exportar reporte'));
    });

    const exportar = (): HTMLButtonElement => boton(modal(), 'Exportar a Excel');

    it('pide el rango completo y valida el orden de las fechas', async () => {
      expect(exportar().disabled).toBe(true);
      expect(texto()).toContain('Elige la fecha "desde" y la fecha "hasta" para exportar el reporte.');

      await escribir(fixture, campo(modal(), '#report-from'), dia(5));
      await escribir(fixture, campo(modal(), '#report-to'), dia(1));
      expect(texto()).toContain('La fecha "desde" no puede ser posterior a la fecha "hasta".');
      expect(exportar().disabled).toBe(true);

      await escribir(fixture, campo(modal(), '#report-from'), dia());
      await escribir(fixture, campo(modal(), '#report-to'), dia(30));
      expect(texto()).toContain('permiso(s) cumplen los filtros.');
      await escribir(fixture, campo(modal(), '#report-from'), '2020-01-01');
      expect(texto()).toContain('Incluye permisos anteriores');
      expect(exportar().disabled).toBe(false);
    });

    it('al seleccionar empleados exige marcar alguno; marcar y quitar todos', async () => {
      await escribir(fixture, campo(modal(), '#report-from'), dia(-30));
      await escribir(fixture, campo(modal(), '#report-to'), dia(30));
      const seleccionar = Array.from(modal().querySelectorAll<HTMLInputElement>('input[type="radio"]'))[1];
      await clic(fixture, seleccionar);

      await enviar(fixture, formularioModal());
      expect(alerta()).toBe('Marca al menos un empleado o elige "Todos".');
      sinLlamadas(http, 'GET', '/permisos');

      await clic(fixture, boton(modal(), 'Seleccionar todos'));
      expect(texto()).toContain('3 seleccionado(s)');
      await clic(fixture, boton(modal(), 'Quitar selección'));
      expect(texto()).toContain('0 seleccionado(s)');
      await escribir(fixture, campo(modal(), 'input[name="reportBusqueda"]'), 'luis');
      expect(modal().querySelectorAll('.report-empleados-lista input[type="checkbox"]')).toHaveLength(1);
      await escribir(fixture, campo(modal(), 'input[name="reportBusqueda"]'), 'zzz');
      expect(texto()).toContain('No hay empleados que coincidan.');
    });

    it('envía desde, hasta y el empleado a la API; muestra el error y luego descarga', async () => {
      await escribir(fixture, campo(modal(), '#report-from'), dia(-30));
      await escribir(fixture, campo(modal(), '#report-to'), dia(30));
      await clic(fixture, Array.from(modal().querySelectorAll<HTMLInputElement>('input[type="radio"]'))[1]);
      const casilla = modal().querySelector<HTMLInputElement>('.report-empleados-lista input[type="checkbox"]')!;
      casilla.checked = true;
      casilla.dispatchEvent(new Event('change'));
      await actualizar(fixture);

      await enviar(fixture, formularioModal());
      let pedido = llamada(http, 'GET', '/permisos');
      expect(pedido.request.params.get('desde')).toBe(dia(-30));
      expect(pedido.request.params.get('hasta')).toBe(dia(30));
      expect(pedido.request.params.get('idEmpleado')).toBe('1');
      errorApi(pedido, 400, 'La fecha "desde" no puede ser posterior a la fecha "hasta".');
      await actualizar(fixture);
      await vi.waitFor(() => expect(alerta()).toBe('La fecha "desde" no puede ser posterior a la fecha "hasta".'));

      await enviar(fixture, formularioModal());
      pedido = llamada(http, 'GET', '/permisos');
      pedido.flush([permisos[0], permisos[3]]);
      await vi.waitFor(() => {
        fixture.detectChanges();
        expect(texto()).toContain('Reporte de permisos exportado: 2 permisos.');
      }, { timeout: 15_000 });
      expect(URL.createObjectURL).toHaveBeenCalled();
    }, 20_000);

    it('"Todos" no manda empleado y la × cierra', async () => {
      await escribir(fixture, campo(modal(), '#report-from'), dia(-30));
      await escribir(fixture, campo(modal(), '#report-to'), dia(30));
      await enviar(fixture, formularioModal());
      const pedido = llamada(http, 'GET', '/permisos');
      expect(pedido.request.params.has('idEmpleado')).toBe(false);
      errorApi(pedido, 0);
      await vi.waitFor(() => {
        fixture.detectChanges();
        expect(alerta()).toBe('No se pudieron cargar los permisos para el reporte.');
      });
      await clic(fixture, boton(modal(), 'Cerrar ventana'));
      expect(raiz().querySelector('.workshop-modal')).toBeNull();
    });
  });

  // ---- Encabezado y pestañas ------------------------------------------------------------

  it('Refrescar vuelve a cargar todo y Cerrar sesión sale al login', async () => {
    await iniciar('ADMIN');
    await clic(fixture, boton(raiz(), 'Refrescar'));
    llamada(http, 'GET', '/permisos/sesion').flush(sesion('ADMIN'));
    await actualizar(fixture);
    llamada(http, 'GET', '/permisos').flush(permisos);
    llamada(http, 'GET', '/permisos/empleados').flush(empleados);
    await actualizar(fixture);

    const router = TestBed.inject(Router);
    await clic(fixture, boton(raiz(), 'Cerrar sesión'));
    expect(auth.logout).toHaveBeenCalled();
    await vi.waitFor(() => expect(router.url).toBe('/login'));
  });

  it('las pestañas cambian de sección y limpian los mensajes', async () => {
    await iniciar('ADMIN');
    await clic(fixture, boton(raiz(), 'Departamentos, áreas y jefes'));
    llamada(http, 'GET', '/permisos/jefes').flush([]);
    await actualizar(fixture);
    expect(texto()).toContain('Departamentos');
    expect(raiz().querySelector('table.permisos-table')).toBeNull();

    await clic(fixture, boton(raiz(), 'Personal'));
    expect(texto()).toContain('Empleados por área');
    await clic(fixture, boton(raiz(), 'Permisos'));
    expect(raiz().querySelector('table.permisos-table')).not.toBeNull();
  });

  it('al cambiar el personal se recargan los empleados y la sesión', async () => {
    await iniciar('ADMIN');
    await clic(fixture, boton(raiz(), 'Personal'));
    await elegir(fixture, campo(raiz(), 'select[aria-label="Área de PEDRO SIN AREA"]'), 'SOPORTE');
    llamada(http, 'PUT', '/permisos/personal/4').flush(null, { status: 204, statusText: 'No Content' });
    await actualizar(fixture);

    expect(texto()).toContain('PEDRO SIN AREA pasó al área SOPORTE.');
    llamada(http, 'GET', '/permisos/empleados').flush(empleados);
    llamada(http, 'GET', '/permisos/sesion').flush(sesion('ADMIN'));
    await actualizar(fixture);
  });
});
