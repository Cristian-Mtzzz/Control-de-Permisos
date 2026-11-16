import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { Router, provideRouter } from '@angular/router';
import { AuthService } from '../auth/auth.service';
import {
  actualizar, almacenamientoEnMemoria, boton, botones, campo, clic, dia, elegir, empleados, enviar, errorApi, escribir, llamada, opcionesDe,
  permiso, permisos, proximoDiaHabil, proximoSabado, rutasDePrueba, sesion, sinLlamadas, textoDe,
} from '../testing/ui';
import { Permiso, PermisoEmpleado, PermisoSesion } from './permisos.models';
import { PermisosComponent } from './permisos.component';
import { dayKey, formatDay, weekRange } from './permisos-resumen';

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
    datos: {
      sesion?: PermisoSesion; permisos?: Permiso[]; empleados?: PermisoEmpleado[]; enResumen?: boolean;
      // Departamento (si hay filtro de departamento) y área que se eligen arriba al entrar.
      filtro?: [departamento: string | null, area: string];
    } = {},
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
    if (datos.filtro) await filtrar(...datos.filtro);
    // La pantalla abre en el resumen; la mayoría de las pruebas trabajan sobre el registro.
    if (!datos.enResumen) await clic(fixture, boton(raiz(), 'Permisos'));
  }

  async function filtrar(departamento: string | null, area: string): Promise<void> {
    if (departamento) await elegir(fixture, campo(raiz(), 'select[name="deptoFilter"]'), departamento);
    await elegir(fixture, campo(raiz(), 'select[name="areaFilter"]'), area);
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
    it('administrador general: con "Ninguno" no ve nada ni registra; al elegir departamento y área, solo eso', async () => {
      await iniciar('ADMIN');

      expect(auth.setNivel).toHaveBeenCalledWith('ADMIN');
      expect(botones(raiz(), /^(Resumen|Permisos|Personal|Mantenimiento)$/)).toHaveLength(4);
      const depto = campo<HTMLSelectElement>(raiz(), 'select[name="deptoFilter"]');
      const area = campo<HTMLSelectElement>(raiz(), 'select[name="areaFilter"]');
      expect(depto.selectedOptions[0].textContent!.trim()).toBe('Ninguno');
      expect(area.selectedOptions[0].textContent!.trim()).toBe('Ninguna');
      expect(texto()).toContain('Elige un departamento y un área arriba para ver y registrar sus permisos.');
      expect(texto()).toContain('No hay permisos que coincidan.');
      expect(boton(raiz(), 'Nuevo permiso').disabled).toBe(true);

      // Con el departamento todavía falta el área.
      await elegir(fixture, depto, 'INFORMATICA');
      expect(texto()).toContain('No hay permisos que coincidan.');
      expect(boton(raiz(), 'Nuevo permiso').disabled).toBe(true);
      await elegir(fixture, area, 'SOPORTE');
      expect(texto()).not.toContain('Elige un departamento y un área');
      expect(idsVisibles()).toEqual(['1', '4']);
      expect([1, 4].map(estadoDe)).toEqual(['ACTIVO', 'ANULADO']);
      expect(boton(raiz(), 'Nuevo permiso').disabled).toBe(false);
      // Con un departamento elegido ya no hace falta la columna de departamento.
      expect(Array.from(raiz().querySelectorAll('table.permisos-table th')).map((th) => th.textContent!.trim())).not.toContain('Departamento');

      // Hoy: solo el vigente del área.
      await clic(fixture, boton(raiz(), 'Resumen'));
      const hoy = campo<HTMLElement>(raiz(), '.permisos-hoy');
      expect(hoy.textContent).toContain('ANA LOPEZ');
      expect(hoy.textContent).not.toContain('PEDRO SIN AREA');
      expect(campo<HTMLElement>(raiz(), '.kpi-primary .kpi-value').textContent!.trim()).toBe('1');
    });

    it('usa la jornada que manda la API: un permiso sin área ya terminado no se puede editar ni anular', async () => {
      await iniciar('JEFE');

      // Sin HoraFinJornada se habría usado la del primer departamento (16:00) y antes de esa
      // hora se vería activo, con Editar y Anular, aunque la API ya no deja modificarlo.
      expect(estadoDe(5)).toBe('FINALIZADO');
      expect(botones(fila(5), 'Editar')).toHaveLength(0);
      expect(botones(fila(1), 'Editar')).toHaveLength(1);
      expect(botones(fila(1), 'Anular')).toHaveLength(1);
      expect(estadoDe(3)).toBe('FINALIZADO');
      // El finalizado solo deja imprimirlo: en acciones no queda ni texto ni botones de cambio.
      expect(botones(fila(3), /^(Editar|Anular)$/)).toHaveLength(0);
      expect(campo(fila(3), '.row-actions').textContent!.trim()).toBe('Imprimir');
      expect(fila(4).textContent).toContain('Anulado');
    });

    it('consulta (usuario antiguo): solo ve y exporta', async () => {
      await iniciar('CONSULTA');

      expect(botones(raiz(), 'Nuevo permiso')).toHaveLength(0);
      expect(botones(raiz(), /Personal/)).toHaveLength(0);
      expect(botones(raiz(), 'Mantenimiento')).toHaveLength(0);
      expect(botones(raiz(), 'Editar')).toHaveLength(0);
      expect(botones(raiz(), 'Anular')).toHaveLength(0);
      expect(botones(raiz(), 'Generar memorando')).toHaveLength(0);
      await clic(fixture, boton(raiz(), 'Resumen'));
      expect(botones(raiz(), 'Exportar reporte')).toHaveLength(1);
    });

    it('el reporte se exporta desde el resumen, no desde el registro, y pide departamento y área', async () => {
      await iniciar('ADMIN');

      expect(botones(raiz(), 'Nuevo permiso')).toHaveLength(1);
      expect(botones(raiz(), 'Exportar reporte')).toHaveLength(0);
      await clic(fixture, boton(raiz(), 'Resumen'));
      expect(boton(raiz(), 'Exportar reporte').disabled).toBe(true);
      await filtrar('INFORMATICA', 'SOPORTE');
      expect(boton(raiz(), 'Exportar reporte').disabled).toBe(false);
    });

    it('jefe: solo su área, sin filtros, y no modifica lo de otra área', async () => {
      await iniciar('JEFE');

      expect(raiz().querySelector('.area-filter-bar')).toBeNull();
      expect(botones(raiz(), 'Mi personal')).toHaveLength(1);
      expect(botones(raiz(), 'Mantenimiento')).toHaveLength(0);
      expect(texto()).toContain('Permisos del área de SOPORTE');
      expect(botones(fila(1), 'Editar')).toHaveLength(1);
      expect(botones(fila(2), 'Editar')).toHaveLength(0);
      expect(fila(2).textContent).toContain('Área DESARROLLO');
    });

    it('administrador de departamento: filtro de área sin filtro de departamento', async () => {
      await iniciar('ADMIN_DEPTO');

      expect(raiz().querySelector('select[name="deptoFilter"]')).toBeNull();
      expect(opcionesDe(campo(raiz(), 'select[name="areaFilter"]'))).toEqual(['Ninguna', 'Todas las áreas', 'SOPORTE', 'DESARROLLO', 'ANTIGUA']);
      expect(botones(raiz(), 'Mantenimiento')).toHaveLength(1);
      // Su departamento ya está: solo le falta el área.
      expect(texto()).toContain('Elige un área arriba para ver y registrar sus permisos.');
      expect(boton(raiz(), 'Nuevo permiso').disabled).toBe(true);
      await filtrar(null, 'DESARROLLO');
      expect(idsVisibles()).toEqual(['2']);
      expect(boton(raiz(), 'Nuevo permiso').disabled).toBe(false);
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
      expect(texto()).toContain('Nadie tiene permiso hoy.');
      await clic(fixture, boton(raiz(), 'Permisos'));
      expect(texto()).not.toContain('Cargando permisos...');
      expect(texto()).toContain('No hay permisos que coincidan.');
    });
  });

  // ---- Filtros y tabla ------------------------------------------------------------------

  describe('filtros de la tabla', () => {
    // El jefe ve todo lo que manda la API sin elegir departamento ni área.
    beforeEach(async () => iniciar('JEFE'));

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
      TestBed.resetTestingModule();
      await iniciar('ADMIN');
      const depto = campo<HTMLSelectElement>(raiz(), 'select[name="deptoFilter"]');
      const area = campo<HTMLSelectElement>(raiz(), 'select[name="areaFilter"]');

      await filtrar('INFORMATICA', 'SOPORTE');
      expect(idsVisibles()).toEqual(['1', '4']);
      expect(texto()).toContain('Permisos del área de SOPORTE');
      await elegir(fixture, depto, 'RECURSOS HUMANOS');
      expect(opcionesDe(area)).toEqual(['Ninguna', 'Todas las áreas', 'NOMINA']);
      expect(area.selectedOptions[0].textContent!.trim()).toBe('Ninguna');
      expect(texto()).toContain('No hay permisos que coincidan.');
      await elegir(fixture, area, 'NOMINA');
      expect(idsVisibles()).toEqual(['3']);
      // Los filtros de departamento y área también valen para el resumen.
      await clic(fixture, boton(raiz(), 'Resumen'));
      expect(campo<HTMLElement>(raiz(), '.kpi-primary .kpi-value').textContent!.trim()).toBe('0');
    });

    it('sin departamento no hay áreas; "Todas las áreas" junta las del departamento para la tabla, el formulario y el memo', async () => {
      TestBed.resetTestingModule();
      await iniciar('ADMIN');
      const depto = campo<HTMLSelectElement>(raiz(), 'select[name="deptoFilter"]');
      const area = campo<HTMLSelectElement>(raiz(), 'select[name="areaFilter"]');
      expect(opcionesDe(area)).toEqual(['Ninguna']);

      await elegir(fixture, depto, 'INFORMATICA');
      expect(opcionesDe(area)).toEqual(['Ninguna', 'Todas las áreas', 'SOPORTE', 'DESARROLLO', 'ANTIGUA']);
      await elegir(fixture, area, 'Todas las áreas');
      // Las de SOPORTE y DESARROLLO; no la de RECURSOS HUMANOS ni la que no tiene área.
      expect([...idsVisibles()].sort()).toEqual(['1', '2', '4']);
      expect(texto()).toContain('Permisos de todas las áreas');
      expect(texto()).not.toContain('Elige un departamento y un área');
      expect(boton(raiz(), 'Nuevo permiso').disabled).toBe(false);
      await clic(fixture, boton(raiz(), 'Nuevo permiso'));
      expect(opcionesDe(campo(modal(), 'select[name="permisoEmpleado"]'))).toEqual(expect.arrayContaining(['ANA LOPEZ', 'LUIS PAZ']));
      expect(opcionesDe(campo(modal(), 'select[name="permisoEmpleado"]'))).not.toContain('MARIA RUIZ');
      await clic(fixture, boton(modal(), 'Cerrar ventana'));

      // El memo también toma todas las áreas del departamento.
      await clic(fixture, boton(raiz(), 'Generar memorando'));
      const desdeMemo = campo<HTMLInputElement>(modal(), '#memo-desde').value;
      llamada(http, 'GET', '/permisos').flush([
        permiso({ IdPermiso: 31, FechaInicio: `${desdeMemo}T00:00:00`, FechaFin: `${desdeMemo}T00:00:00` }),
        permiso({ IdPermiso: 32, IdEmpleado: 2, Empleado: 'LUIS PAZ', IdArea: 101, NombreArea: 'DESARROLLO', FechaInicio: `${desdeMemo}T00:00:00`, FechaFin: `${desdeMemo}T00:00:00` }),
        permiso({ IdPermiso: 33, IdEmpleado: 3, Empleado: 'MARIA RUIZ', IdArea: 200, IdDepartamento: 20, FechaInicio: `${desdeMemo}T00:00:00`, FechaFin: `${desdeMemo}T00:00:00` }),
      ]);
      await actualizar(fixture);
      expect(texto()).toContain('2 de 2 permiso(s) marcados');
      await clic(fixture, boton(modal(), 'Cerrar ventana'));

      // Volver a "Ninguno" quita las áreas y la elección.
      await elegir(fixture, depto, 'Ninguno');
      expect(opcionesDe(area)).toEqual(['Ninguna']);
      expect(area.selectedOptions[0].textContent!.trim()).toBe('Ninguna');
      expect(texto()).toContain('No hay permisos que coincidan.');
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
    await iniciar('JEFE', { permisos: muchos });

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

  it('el empleado sin No. de pago registrado deja el campo vacío para escribirlo; al cambiar de empleado se recarga', async () => {
    await iniciar('ADMIN', {
      filtro: ['INFORMATICA', 'SOPORTE'],
      empleados: [...empleados, { IdEmpleado: 9, NombreCompleto: 'ZOE SIN PAGO', NoPago: '  ', IdDepartamento: 10, IdArea: 100, NombreArea: 'SOPORTE' }],
    });
    await clic(fixture, boton(raiz(), 'Nuevo permiso'));
    const noPago = (): HTMLInputElement => campo(modal(), '#permiso-nopago');
    const aviso = (): string => modal().querySelector('#permiso-nopago-aviso')?.textContent?.trim() ?? '';
    await elegir(fixture, campo(modal(), '#permiso-empleado'), 'ANA LOPEZ');
    expect(noPago().value).toBe('1001');
    // El de ANA no se queda puesto para otro empleado.
    await elegir(fixture, campo(modal(), '#permiso-empleado'), 'ZOE SIN PAGO');
    expect(noPago().value).toBe('');
    expect(aviso()).toBe('Este empleado no tiene No. de pago registrado: escríbelo.');
    await escribir(fixture, noPago(), '7788');
    expect(aviso()).toBe('Este empleado no tiene No. de pago registrado: escríbelo.');
    await elegir(fixture, campo(modal(), '#permiso-empleado'), 'ANA LOPEZ');
    expect(noPago().value).toBe('1001');
  });

  it('al editar un permiso sin No. de pago guardado toma el del empleado', async () => {
    await iniciar('ADMIN', {
      filtro: ['INFORMATICA', 'SOPORTE'],
      permisos: permisos.map((item) => item.IdPermiso === 1 ? { ...item, NoPago: null } : item),
    });
    await clic(fixture, boton(fila(1), 'Editar'));
    expect(campo<HTMLInputElement>(modal(), '#permiso-nopago').value).toBe('1001');
  });

  describe('registrar un permiso por día', () => {
    beforeEach(async () => {
      await iniciar('ADMIN', { filtro: ['INFORMATICA', 'SOPORTE'] });
      await clic(fixture, boton(raiz(), 'Nuevo permiso'));
    });

    it('solo los empleados del área elegida; fecha de solicitud del sistema; "Registrar" bloqueado hasta completar', async () => {
      expect(opcionesDe(campo(modal(), '#permiso-empleado'))).toEqual(['Selecciona el empleado', 'ANA LOPEZ']);
      const solicitud = campo<HTMLInputElement>(modal(), '#permiso-solicitud');
      expect(solicitud.disabled).toBe(true);
      expect(solicitud.value).toBe(dia());
      const registrar = (): HTMLButtonElement => boton(modal(), 'Registrar permiso');
      expect(registrar().disabled).toBe(true);
      await elegir(fixture, campo(modal(), '#permiso-empleado'), 'ANA LOPEZ');
      await escribir(fixture, campo(modal(), '#permiso-nopago'), '1001');
      await escribir(fixture, campo(modal(), '#permiso-motivo'), 'cita');
      expect(registrar().disabled).toBe(true);
      await escribir(fixture, campo(modal(), '#dia-inicio'), dia(3));
      expect(registrar().disabled).toBe(true);
      await escribir(fixture, campo(modal(), '#dia-telefono'), '9988-7766');
      expect(registrar().disabled).toBe(true);
      await escribir(fixture, campo(modal(), '#dia-lugar'), 'Tegucigalpa');
      expect(registrar().disabled).toBe(false);
      // El tipo elegido se marca (en azul).
      expect(boton(modal(), 'Por día').classList).toContain('selected');
      expect(boton(modal(), 'Por hora').classList).not.toContain('selected');
    });

    it('orden: empleado, No. de pago, motivo, salida, regreso y solicitud; el No. de pago se carga del empleado', async () => {
      const ids = Array.from(modal().querySelectorAll('form [id]'))
        .map((elemento) => elemento.id)
        .filter((id) => /^(permiso|dia|hora)-/.test(id) && id !== 'permiso-tipo-label');
      expect(ids).toEqual(['permiso-empleado', 'permiso-nopago', 'permiso-motivo', 'dia-inicio', 'dia-fin', 'dia-telefono', 'dia-lugar', 'permiso-solicitud']);
      const noPago = (): HTMLInputElement => campo(modal(), '#permiso-nopago');
      const aviso = (): string => modal().querySelector('#permiso-nopago-aviso')?.textContent?.trim() ?? '';
      const registrar = (): HTMLButtonElement => boton(modal(), 'Registrar permiso');

      // Al elegir el empleado se carga el suyo (ANA LOPEZ tiene 1001 en EMPLEADOS_IHSS).
      expect(aviso()).toBe('');
      await elegir(fixture, campo(modal(), '#permiso-empleado'), 'ANA LOPEZ');
      expect(noPago().value).toBe('1001');
      expect(aviso()).toBe('Tomado del registro del empleado.');
      await escribir(fixture, campo(modal(), '#permiso-motivo'), 'cita');
      await escribir(fixture, campo(modal(), '#dia-inicio'), dia(3));
      await escribir(fixture, campo(modal(), '#dia-telefono'), '9988-7766');
      await escribir(fixture, campo(modal(), '#dia-lugar'), ' Tegucigalpa ');
      expect(registrar().disabled).toBe(false);

      // Si se borra, no deja registrar.
      await escribir(fixture, noPago(), '');
      expect(registrar().disabled).toBe(true);
      await enviar(fixture, formularioModal());
      expect(alerta()).toBe('Escribe el No. de pago.');

      // Se puede corregir; se conserva al cambiar de tipo; por hora, el regreso va antes de la solicitud.
      await escribir(fixture, noPago(), ' 55-0042 ');
      expect(aviso()).toBe('');
      expect(registrar().disabled).toBe(false);
      await clic(fixture, boton(modal(), 'Por hora'));
      expect(noPago().value).toBe(' 55-0042 ');
      expect(campo<HTMLLabelElement>(modal(), 'label[for="hora-entrada"]').textContent!.trim()).toBe('Hora de regreso');
      const idsHora = Array.from(modal().querySelectorAll('form [id]')).map((elemento) => elemento.id)
        .filter((id) => /^(hora|permiso-solicitud)/.test(id));
      expect(idsHora).toEqual(['hora-fecha', 'hora-salida', 'hora-entrada', 'permiso-solicitud']);

      // Se envía tal como se escribió (sin los espacios de los extremos), aunque no sea el del empleado.
      await clic(fixture, boton(modal(), 'Por día'));
      await enviar(fixture, formularioModal());
      const alta = llamada(http, 'POST', '/permisos/dia');
      expect(alta.request.body).toEqual({
        IdEmpleado: 1, NoPago: '55-0042', Motivo: 'CITA', FechaInicio: dia(3), FechaFin: dia(3), Telefono: '9988-7766', Lugar: 'Tegucigalpa',
      });
    });

    it('valida cada dato antes de llamar a la API', async () => {
      expect(texto()).toContain('Registrar permiso');
      await enviar(fixture, formularioModal());
      expect(alerta()).toBe('Selecciona el empleado.');

      await elegir(fixture, campo(modal(), '#permiso-empleado'), 'ANA LOPEZ');
      await escribir(fixture, campo(modal(), '#permiso-nopago'), ' ');
      await enviar(fixture, formularioModal());
      expect(alerta()).toBe('Escribe el No. de pago.');
      await escribir(fixture, campo(modal(), '#permiso-nopago'), '1001');
      await enviar(fixture, formularioModal());
      expect(alerta()).toBe('Escribe el motivo del permiso.');
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

      await escribir(fixture, campo(modal(), '#dia-fin'), dia(3));
      await enviar(fixture, formularioModal());
      expect(alerta()).toBe('Escribe el número de teléfono donde localizar al empleado.');
      for (const malo of ['99-88', '9988 77AB']) {
        await escribir(fixture, campo(modal(), '#dia-telefono'), malo);
        await enviar(fixture, formularioModal());
        expect(alerta()).toBe('El número de teléfono no es válido: usa solo números (al menos 7), espacios, guiones, paréntesis o +.');
      }
      await escribir(fixture, campo(modal(), '#dia-telefono'), '+504 9988-7766');
      await enviar(fixture, formularioModal());
      expect(alerta()).toBe('Escribe el lugar.');
      sinLlamadas(http, 'POST', '/permisos/dia');
    });

    it('muestra cada error de la API dentro de la ventana y al final lo registra', async () => {
      await elegir(fixture, campo(modal(), '#permiso-empleado'), 'ANA LOPEZ');
      await escribir(fixture, campo(modal(), '#permiso-nopago'), '1001');
      await escribir(fixture, campo(modal(), '#permiso-motivo'), 'Cita');
      await escribir(fixture, campo(modal(), '#dia-inicio'), dia(3));
      await escribir(fixture, campo(modal(), '#dia-fin'), dia(4));
      await escribir(fixture, campo(modal(), '#dia-telefono'), '9988-7766');
      await escribir(fixture, campo(modal(), '#dia-lugar'), 'Tegucigalpa');

      const casos: [number, string | undefined, string][] = [
        [400, 'El empleado ya tiene un permiso por día que se cruza con este permiso.', 'El empleado ya tiene un permiso por día que se cruza con este permiso.'],
        [400, 'Permiso no permitido porque se pasa del tiempo estipulado: el máximo es 2 días (16 horas) al mes.',
          'Permiso no permitido porque se pasa del tiempo estipulado: el máximo es 2 días (16 horas) al mes.'],
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
          IdEmpleado: 1, NoPago: '1001', Motivo: 'CITA', FechaInicio: dia(3), FechaFin: dia(4), Telefono: '9988-7766', Lugar: 'Tegucigalpa',
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
      await iniciar('ADMIN', { filtro: ['INFORMATICA', 'DESARROLLO'] });
      await clic(fixture, boton(raiz(), 'Nuevo permiso'));
      await elegir(fixture, campo(modal(), '#permiso-empleado'), 'LUIS PAZ');
      await escribir(fixture, campo(modal(), '#permiso-nopago'), '1002');
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
      expect(alerta()).toBe('Indica la fecha, la hora de salida y la hora de regreso.');

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
      expect(alerta()).toBe('La hora de regreso debe ser posterior a la hora de salida.');
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
        IdEmpleado: 2, NoPago: '1002', Motivo: 'BANCO', Fecha: proximoDiaHabil(), HoraSalida: '13:30', HoraEntrada: '15:00',
      });
      guardar.flush(null, { status: 204, statusText: 'No Content' });
      await actualizar(fixture);
      expect(texto()).toContain('Permiso registrado.');
      llamada(http, 'GET', '/permisos').flush(permisos);
    });

    it('un empleado de otro departamento usa la jornada de ese departamento', async () => {
      await clic(fixture, boton(modal(), 'Cerrar ventana'));
      await filtrar('RECURSOS HUMANOS', 'NOMINA');
      await clic(fixture, boton(raiz(), 'Nuevo permiso'));
      await clic(fixture, boton(modal(), 'Por hora'));
      await elegir(fixture, campo(modal(), '#permiso-empleado'), 'MARIA RUIZ');
      await escribir(fixture, campo(modal(), '#permiso-nopago'), '2001');
      await escribir(fixture, campo(modal(), '#permiso-motivo'), 'banco');
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
    it('abre con los datos del permiso y guarda con PUT; si ya no existe lo dice', async () => {
      await iniciar('ADMIN', { filtro: ['INFORMATICA', 'SOPORTE'] });
      await clic(fixture, boton(fila(1), 'Editar'));
      expect(texto()).toContain('Editar permiso #1');
      // La fecha de solicitud es la que ya tiene y no se cambia.
      expect(campo<HTMLInputElement>(modal(), '#permiso-solicitud').value).toBe(dia());
      expect(campo<HTMLInputElement>(modal(), '#permiso-solicitud').disabled).toBe(true);
      expect(campo<HTMLTextAreaElement>(modal(), '#permiso-motivo').value).toBe('CITA MEDICA');
      expect(campo<HTMLInputElement>(modal(), '#dia-fin').value).toBe(dia(2));
      expect(texto()).toContain('Sin contar este permiso.');
      expect(campo<HTMLInputElement>(modal(), '#dia-telefono').value).toBe('');
      await enviar(fixture, formularioModal());
      expect(alerta()).toBe('Escribe el número de teléfono donde localizar al empleado.');
      await escribir(fixture, campo(modal(), '#dia-telefono'), '2239-9999');
      await escribir(fixture, campo(modal(), '#dia-lugar'), 'Tegucigalpa');

      await enviar(fixture, formularioModal());
      const guardar = llamada(http, 'PUT', '/permisos/dia/1');
      expect(guardar.request.body).toMatchObject({ NoPago: '1001', Telefono: '2239-9999', Lugar: 'Tegucigalpa' });
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
      await iniciar('ADMIN', { filtro: ['INFORMATICA', 'DESARROLLO'] });
      await clic(fixture, boton(fila(2), 'Editar'));
      expect(campo<HTMLInputElement>(modal(), '#hora-salida').value).toBe('09:00');
      await clic(fixture, boton(modal(), 'Por día'));
      expect(campo<HTMLInputElement>(modal(), '#dia-inicio').value).toBe(proximoDiaHabil());
      await escribir(fixture, campo(modal(), '#dia-telefono'), '9988-7766');
      await escribir(fixture, campo(modal(), '#dia-lugar'), 'Tegucigalpa');

      await enviar(fixture, formularioModal());
      const guardar = llamada(http, 'PUT', '/permisos/dia/2');
      expect(guardar.request.body).toMatchObject({
        IdEmpleado: 2, Motivo: 'TRAMITE BANCARIO', FechaInicio: proximoDiaHabil(), Telefono: '9988-7766', Lugar: 'Tegucigalpa',
      });
      guardar.flush(null, { status: 204, statusText: 'No Content' });
      await actualizar(fixture);
      llamada(http, 'GET', '/permisos').flush(permisos);
    });
  });

  describe('imprimir', () => {
    afterEach(() => document.querySelectorAll('iframe').forEach((marco) => marco.remove()));

    it('cada permiso no anulado se imprime en su formato, lleno con sus datos', async () => {
      await iniciar('ADMIN', { filtro: ['INFORMATICA', 'SOPORTE'] });
      expect(botones(fila(1), /^Imprimir$/)).toHaveLength(1);
      expect(botones(fila(4), /^Imprimir$/)).toHaveLength(0);
      // Las acciones son botones de ícono; lo que hacen se lee al pasar el cursor.
      const tips = Array.from(fila(1).querySelectorAll('button.icon-button')).map((b) => [b.getAttribute('data-tip'), b.querySelector('svg') !== null]);
      expect(tips).toEqual([['Imprimir el permiso', true], ['Editar el permiso', true], ['Anular el permiso', true]]);
      await clic(fixture, boton(fila(1), 'Imprimir'));
      // Los logos del encabezado salen de la base; sin ninguno subido se imprimen los del sistema.
      llamada(http, 'GET', '/permisos/logos').flush([]);
      await actualizar(fixture);
      const marco = document.querySelector('iframe')!;
      const contenido = marco.contentDocument!.body.textContent!.replace(/\s+/g, ' ');
      expect(contenido).toContain('SOLICITUD DE PERMISO DÍA');
      expect(contenido).toContain('Nombre del empleado: ANA LOPEZ');
      expect(contenido).toContain('Motivo del permiso: CITA MEDICA');
      expect(marco.contentDocument!.querySelectorAll('.copia')).toHaveLength(1);
    });
  });

  describe('memorando', () => {
    beforeEach(() => vi.stubGlobal('localStorage', almacenamientoEnMemoria()));
    afterEach(() => vi.unstubAllGlobals());

    it('lista los permisos del mes anterior del área, pide el encabezado y descarga el PDF', async () => {
      const membrete = vi.fn(async () => new Response(new Uint8Array([0xff, 0xd8, 0xff, 0xd9])));
      vi.stubGlobal('fetch', membrete);
      await iniciar('ADMIN', { filtro: ['INFORMATICA', 'SOPORTE'] });
      const hoy = new Date();
      const desde = dayKey(new Date(hoy.getFullYear(), hoy.getMonth() - 1, 1));
      const hasta = dayKey(new Date(hoy.getFullYear(), hoy.getMonth(), 0));

      await clic(fixture, boton(raiz(), 'Generar memorando'));
      expect(texto()).toContain('Cargando permisos...');
      const pedido = llamada(http, 'GET', '/permisos');
      expect(pedido.request.params.get('desde')).toBe(desde);
      expect(pedido.request.params.get('hasta')).toBe(hasta);
      pedido.flush([
        permiso({ IdPermiso: 11, NoPago: null, FechaInicio: `${desde}T00:00:00`, FechaFin: `${desde}T00:00:00` }),
        permiso({ IdPermiso: 12, Tipo: 'HORA', FechaInicio: `${hasta}T00:00:00`, FechaFin: `${hasta}T00:00:00`, HoraSalida: '10:00', HoraEntrada: '15:30', DiasHabiles: 0 }),
        permiso({ IdPermiso: 13, Estado: 'ANULADO', FechaInicio: `${desde}T00:00:00`, FechaFin: `${desde}T00:00:00` }),
        permiso({ IdPermiso: 14, IdArea: 101, FechaInicio: `${desde}T00:00:00`, FechaFin: `${desde}T00:00:00` }),
      ]);
      await actualizar(fixture);
      expect(modal().querySelectorAll('.report-empleados-lista input[type="checkbox"]')).toHaveLength(2);
      expect(texto()).toContain('2 de 2 permiso(s) marcados');
      expect(texto()).toContain('10:00-15:30');
      expect(boton(modal(), 'Generar PDF').disabled).toBe(true);

      await escribir(fixture, campo(modal(), '#memo-numero'), '2732');
      await escribir(fixture, campo(modal(), '#memo-siglas'), 'gtic');
      expect(texto()).toContain(`MEMORANDO No. 2732-GTIC-IHSS-${hoy.getFullYear()}`);
      await escribir(fixture, campo(modal(), '#memo-para'), 'Lic. Elda Sanchez');
      await escribir(fixture, campo(modal(), '#memo-de'), 'Ing. Dilcia Elvir');
      expect(boton(modal(), 'Generar PDF').disabled).toBe(false);

      // Sin ninguno marcado no se genera; con uno, solo ese va en la tabla.
      const casillas = Array.from(modal().querySelectorAll<HTMLInputElement>('.report-empleados-lista input[type="checkbox"]'));
      for (const casilla of casillas) { casilla.checked = false; casilla.dispatchEvent(new Event('change')); }
      await actualizar(fixture);
      expect(boton(modal(), 'Generar PDF').getAttribute('title')).toBe('Marca al menos un permiso para el memorando.');
      casillas[1].checked = true;
      casillas[1].dispatchEvent(new Event('change'));
      await actualizar(fixture);

      await enviar(fixture, formularioModal());
      await vi.waitFor(() => {
        fixture.detectChanges();
        expect(texto()).toContain(`Memorando 2732-GTIC-IHSS-${hoy.getFullYear()} generado en PDF: 1 permiso(s).`);
      });
      expect(String(membrete.mock.calls[0])).toContain('impresion/membrete-memo.jpg');
      const archivo = vi.mocked(URL.createObjectURL).mock.calls[0][0] as Blob;
      expect(archivo.type).toBe('application/pdf');
      const contenido = Array.from(new Uint8Array(await archivo.arrayBuffer()), (byte) => String.fromCharCode(byte)).join('');
      expect(contenido).toContain('(Ana Lopez)');
      expect(contenido).toContain('(1001)');
      expect(contenido).toContain(`(${desde.slice(8)}/${desde.slice(5, 7)}/${desde.slice(0, 4)})`);
      expect(contenido).not.toContain('(10:00-15:30)');

      // Después de generarlo, el siguiente empieza en blanco y no queda nada guardado en el navegador.
      expect(localStorage.length).toBe(0);
      await clic(fixture, boton(raiz(), 'Generar memorando'));
      expect(texto()).not.toContain('Saldrán sin No. de pago');
      llamada(http, 'GET', '/permisos').flush([
        permiso({ IdPermiso: 21, IdEmpleado: 9, Empleado: 'ZOE SIN PAGO', NoPago: null, FechaInicio: `${desde}T00:00:00`, FechaFin: `${desde}T00:00:00` }),
      ]);
      await actualizar(fixture);
      for (const id of ['#memo-numero', '#memo-siglas', '#memo-para', '#memo-de']) {
        expect(campo<HTMLInputElement>(modal(), id).value).toBe('');
      }
      expect(campo<HTMLInputElement>(modal(), '#memo-asunto').value).toBe('REMISION DE PERMISO');
      expect(texto()).toContain('Saldrán sin No. de pago: ZOE SIN PAGO.');

      // Cerrar con la × también borra lo escrito.
      await escribir(fixture, campo(modal(), '#memo-numero'), '9999');
      await escribir(fixture, campo(modal(), '#memo-para'), 'Alguien');
      await clic(fixture, boton(modal(), 'Cerrar ventana'));
      await clic(fixture, boton(raiz(), 'Generar memorando'));
      llamada(http, 'GET', '/permisos').flush([]);
      await actualizar(fixture);
      expect(campo<HTMLInputElement>(modal(), '#memo-numero').value).toBe('');
      expect(campo<HTMLInputElement>(modal(), '#memo-para').value).toBe('');

      // Un rango sin permisos lo dice; desde después de hasta, avisa sin pedir nada a la API.
      await escribir(fixture, campo(modal(), '#memo-desde'), hasta);
      llamada(http, 'GET', '/permisos').flush([]);
      await actualizar(fixture);
      expect(texto()).toContain('No hay permisos por día ni por horas en ese rango.');
      await escribir(fixture, campo(modal(), '#memo-hasta'), desde);
      sinLlamadas(http, 'GET', '/permisos');
      expect(texto()).toContain('La fecha "desde" no puede ser posterior a la fecha "hasta".');
    });
  });

  describe('memorando de vacaciones', () => {
    beforeEach(() => vi.stubGlobal('localStorage', almacenamientoEnMemoria()));
    afterEach(() => vi.unstubAllGlobals());

    // Las vacaciones del empleado; la 31 está anulada y la 32 es un permiso (no debe salir).
    const vac = (id: number, desde: string, hasta: string, dias: number, solicitud: string, extra: Partial<Permiso> = {}) =>
      permiso({ IdPermiso: id, Tipo: 'VAC', FechaInicio: `${desde}T00:00:00`, FechaFin: `${hasta}T00:00:00`, DiasHabiles: dias,
        FechaSolicitud: `${solicitud}T00:00:00`, NoPago: null, ...extra });
    const historialDeAna = () => [
      vac(41, '2026-12-01', '2026-12-09', 7, '2026-11-10'),
      vac(40, '2026-11-16', '2026-11-30', 11, '2026-11-10'),
      vac(30, '2026-03-02', '2026-03-06', 5, '2026-02-20'),
      vac(31, '2026-04-06', '2026-04-08', 3, '2026-11-10', { Estado: 'ANULADO' }),
      permiso({ IdPermiso: 32, Motivo: 'CITA MEDICA' }),
    ];

    it('se genera desde el período en el historial: marca ese, pide los paréntesis y descarga el PDF', async () => {
      vi.stubGlobal('fetch', vi.fn(async () => new Response(new Uint8Array([0xff, 0xd8, 0xff, 0xd9]))));
      await iniciar('ADMIN', { filtro: ['INFORMATICA', 'SOPORTE'], permisos: [...permisos, vac(40, '2026-11-16', '2026-11-30', 11, '2026-11-10')] });
      await clic(fixture, boton(raiz(), 'Vacaciones'));
      // En Vacaciones ya no hay botón de memorando en la barra: se entra por el empleado.
      expect(botones(raiz(), 'Generar memorando')).toHaveLength(0);

      await clic(fixture, boton(raiz(), 'ANA LOPEZ'));
      llamada(http, 'GET', '/permisos').flush(historialDeAna());
      await actualizar(fixture);
      // El historial de vacaciones no mezcla permisos: solo las tres vacaciones del empleado.
      expect(texto()).toContain('Vacaciones del empleado');
      expect(Array.from(modal().querySelectorAll<HTMLTableRowElement>('tbody tr')).map((f) => f.cells[0].textContent!.trim())).toEqual(['41', '40', '30', '31']);
      expect(modal().textContent).not.toContain('CITA MEDICA');
      expect(modal().textContent).toContain('días hábiles de vacaciones');
      // La anulada no se puede remitir.
      const filaVac = (id: number) => Array.from(modal().querySelectorAll<HTMLTableRowElement>('tbody tr'))
        .find((f) => f.cells[0].textContent!.trim() === String(id))!;
      expect(botones(filaVac(31), 'Generar memorando')).toHaveLength(0);
      expect(filaVac(31).textContent).toContain('Anuladas');

      await clic(fixture, boton(filaVac(40), 'Generar memorando'));
      expect(texto()).toContain('Generar memorando de vacaciones');
      expect(campo<HTMLInputElement>(modal(), '#memo-asunto').value).toBe('REMISION SOLICITUD DE VACACIONES');
      expect(modal().querySelector('#memo-texto')).toBeNull();
      expect(campo<HTMLSelectElement>(modal(), '#memo-empleado').selectedOptions[0].textContent!.trim()).toBe('ANA LOPEZ');
      expect(texto()).toContain('Cargando vacaciones...');
      const pedido = llamada(http, 'GET', '/permisos');
      expect(pedido.request.params.get('idEmpleado')).toBe('1');
      pedido.flush(historialDeAna());
      await actualizar(fixture);

      const periodos = Array.from(modal().querySelectorAll<HTMLElement>('.memo-periodo'));
      expect(periodos.map((p) => p.textContent!.replace(/\s+/g, ' ').trim())).toEqual([
        'Del 2 al 6 de marzo del 2026 · 5 días hábiles',
        'Del 16 al 30 de noviembre del 2026 · 11 días hábiles',
        'Del 1 al 9 de diciembre del 2026 · 7 días hábiles',
      ]);
      // Solo viene marcado aquel desde el que se abrió.
      expect(periodos.map((p) => p.querySelector<HTMLInputElement>('input[type="checkbox"]')!.checked)).toEqual([false, true, false]);
      expect(texto()).toContain('ONCE (11) días de vacaciones de Ana Lopez con pago No.1001');

      // Se puede agregar otro período de la misma solicitud.
      const casilla = periodos[2].querySelector<HTMLInputElement>('input[type="checkbox"]')!;
      casilla.checked = true;
      casilla.dispatchEvent(new Event('change'));
      await actualizar(fixture);
      expect(texto()).toContain('DIECIOCHO (18) días de vacaciones de Ana Lopez con pago No.1001');

      await escribir(fixture, campo(modal(), '#memo-numero'), '2836');
      await escribir(fixture, campo(modal(), '#memo-siglas'), 'GTIC');
      await escribir(fixture, campo(modal(), '#memo-para'), 'Lic. Elda Sanchez');
      await escribir(fixture, campo(modal(), '#memo-de'), 'Ing. Dilcia Elvir');
      expect(boton(modal(), 'Generar PDF').getAttribute('title')).toBe('Escribe en cada período lo que va entre paréntesis (ej. 2024-2025).');
      const parentesis = () => Array.from(modal().querySelectorAll<HTMLInputElement>('.memo-periodo input[type="text"]'));
      expect(parentesis()).toHaveLength(2);
      await escribir(fixture, parentesis()[0], '2024-2025');
      await escribir(fixture, parentesis()[1], '2025-2026');
      expect(boton(modal(), 'Generar PDF').disabled).toBe(false);

      await enviar(fixture, formularioModal());
      await vi.waitFor(() => {
        fixture.detectChanges();
        expect(texto()).toContain(`Memorando 2836-GTIC-IHSS-${new Date().getFullYear()} de vacaciones generado en PDF: 18 días de Ana Lopez.`);
      });
      const archivo = vi.mocked(URL.createObjectURL).mock.calls.at(-1)![0] as Blob;
      const contenido = Array.from(new Uint8Array(await archivo.arrayBuffer()), (byte) => String.fromCharCode(byte)).join('');
      for (const parte of ['(DIECIOCHO)', '(\\(18\\))', '(Ana)', '(Lopez)', '(1001)', '(REMISION SOLICITUD DE VACACIONES)',
        '(Del 16 al 30 de noviembre del 2026, inclusive \\(2024-2025\\))', '(Del 1 al 9 de diciembre del 2026, inclusive \\(2025-2026\\))']) {
        expect(contenido).toContain(parte);
      }
      expect(contenido).not.toContain('marzo');

      // Al volver a entrar, el encabezado empieza en blanco (solo queda el empleado de la fila).
      await clic(fixture, boton(raiz(), 'ANA LOPEZ'));
      llamada(http, 'GET', '/permisos').flush(historialDeAna());
      await actualizar(fixture);
      const fila40 = Array.from(modal().querySelectorAll<HTMLTableRowElement>('tbody tr'))
        .find((f) => f.cells[0].textContent!.trim() === '40')!;
      await clic(fixture, boton(fila40, 'Generar memorando'));
      llamada(http, 'GET', '/permisos').flush(historialDeAna());
      await actualizar(fixture);
      expect(campo<HTMLInputElement>(modal(), '#memo-numero').value).toBe('');
      expect(campo<HTMLInputElement>(modal(), '#memo-para').value).toBe('');
      expect(Array.from(modal().querySelectorAll<HTMLInputElement>('.memo-periodo input[type="text"]')).map((i) => i.value)).toEqual(['']);
    });

    it('el jefe de área genera los memorandos de su gente', async () => {
      await iniciar('JEFE', { permisos: [...permisos, vac(40, '2026-11-16', '2026-11-30', 11, '2026-11-10')] });
      expect(botones(raiz(), 'Generar memorando')).toHaveLength(1);

      await clic(fixture, boton(raiz(), 'Vacaciones'));
      expect(botones(raiz(), 'Generar memorando')).toHaveLength(0);
      await clic(fixture, boton(raiz(), 'ANA LOPEZ'));
      llamada(http, 'GET', '/permisos').flush(historialDeAna());
      await actualizar(fixture);
      expect(botones(modal(), 'Generar memorando')).toHaveLength(3);
    });

    it('la secretaría ve su departamento, genera memorandos y no registra', async () => {
      await iniciar('SECRETARIA', {
        filtro: [null, 'Todas las áreas'], permisos: [...permisos, vac(40, '2026-11-16', '2026-11-30', 11, '2026-11-10')],
      });

      // El nivel se lee en la barra lateral: la barra superior no lo repite.
      expect(texto()).not.toContain('Solo consulta');
      // Ve y exporta, pero no registra ni administra.
      expect(botones(raiz(), 'Nuevo permiso')).toHaveLength(0);
      expect(botones(raiz(), /^(Personal|Mantenimiento)$/)).toHaveLength(0);
      expect(botones(raiz(), 'Editar')).toHaveLength(0);
      expect(botones(raiz(), 'Anular')).toHaveLength(0);
      // Las áreas del departamento, sin filtro de departamento.
      expect(raiz().querySelector('select[name="deptoFilter"]')).toBeNull();
      expect(opcionesDe(campo(raiz(), 'select[name="areaFilter"]'))).toEqual(['Ninguna', 'Todas las áreas', 'SOPORTE', 'DESARROLLO', 'ANTIGUA']);
      expect([...idsVisibles()].sort()).toEqual(['1', '2', '4']);
      expect(botones(raiz(), 'Generar memorando')).toHaveLength(1);
      await clic(fixture, boton(raiz(), 'Resumen'));
      expect(botones(raiz(), 'Exportar reporte')).toHaveLength(1);

      await clic(fixture, boton(raiz(), 'Vacaciones'));
      await clic(fixture, boton(raiz(), 'ANA LOPEZ'));
      llamada(http, 'GET', '/permisos').flush(historialDeAna());
      await actualizar(fixture);
      expect(botones(modal(), 'Generar memorando')).toHaveLength(3);
    });

    it('el empleado solo ve y registra lo suyo: imprime, no modifica y no genera memorandos', async () => {
      const sesionEmpleado = { ...sesion('USUARIO'), IdEmpleado: 1 };
      await iniciar('USUARIO', {
        sesion: sesionEmpleado,
        // La API solo le manda sus permisos y su ficha.
        permisos: [permisos[0], vac(40, '2026-11-16', '2026-11-30', 11, '2026-11-10')],
        empleados: [empleados[0]],
      });

      // Sin filtros ni columna de área: todo lo que ve es suyo.
      expect(raiz().querySelector('select[name="deptoFilter"]')).toBeNull();
      expect(raiz().querySelector('select[name="areaFilter"]')).toBeNull();
      expect(botones(raiz(), /^(Personal|Mi personal|Mantenimiento)$/)).toHaveLength(0);
      expect(idsVisibles()).toEqual(['1']);

      // Registra, imprime, pero no edita ni anula.
      expect(botones(raiz(), 'Nuevo permiso')).toHaveLength(1);
      expect(botones(fila(1), 'Imprimir')).toHaveLength(1);
      expect(botones(fila(1), 'Editar')).toHaveLength(0);
      expect(botones(fila(1), 'Anular')).toHaveLength(0);
      expect(botones(raiz(), 'Generar memorando')).toHaveLength(0);
      await clic(fixture, boton(raiz(), 'Resumen'));
      expect(botones(raiz(), 'Exportar reporte')).toHaveLength(0);

      // El formulario viene con su propia ficha y no ofrece a nadie más.
      await clic(fixture, boton(raiz(), 'Permisos'));
      await clic(fixture, boton(raiz(), 'Nuevo permiso'));
      const empleado = campo<HTMLSelectElement>(modal(), 'select[name="permisoEmpleado"]');
      expect(empleado.selectedOptions[0].textContent!.trim()).toBe('ANA LOPEZ');
      expect(opcionesDe(empleado)).toEqual(['Selecciona el empleado', 'ANA LOPEZ']);
      await clic(fixture, boton(modal(), 'Cerrar ventana'));

      // En sus vacaciones tampoco hay memorando ni acciones.
      await clic(fixture, boton(raiz(), 'Vacaciones'));
      expect(botones(raiz(), 'Registrar vacaciones')).toHaveLength(1);
      await clic(fixture, boton(raiz(), 'ANA LOPEZ'));
      llamada(http, 'GET', '/permisos').flush(historialDeAna());
      await actualizar(fixture);
      expect(botones(modal(), 'Generar memorando')).toHaveLength(0);
      expect(Array.from(modal().querySelectorAll('thead th')).map((th) => th.textContent!.trim())).not.toContain('Acciones');
    });

    it('la consulta no genera memorandos', async () => {
      await iniciar('CONSULTA', {
        filtro: ['INFORMATICA', 'SOPORTE'], permisos: [...permisos, vac(40, '2026-11-16', '2026-11-30', 11, '2026-11-10')],
      });
      expect(botones(raiz(), 'Generar memorando')).toHaveLength(0);

      await clic(fixture, boton(raiz(), 'Vacaciones'));
      expect(botones(raiz(), 'Generar memorando')).toHaveLength(0);
      await clic(fixture, boton(raiz(), 'ANA LOPEZ'));
      llamada(http, 'GET', '/permisos').flush(historialDeAna());
      await actualizar(fixture);
      expect(botones(modal(), 'Generar memorando')).toHaveLength(0);
      expect(Array.from(modal().querySelectorAll('thead th')).map((th) => th.textContent!.trim())).not.toContain('Acciones');
    });

    it('en permisos el historial no mezcla las vacaciones ni ofrece su memorando', async () => {
      await iniciar('ADMIN', { filtro: ['INFORMATICA', 'SOPORTE'] });
      await clic(fixture, boton(fila(1), 'ANA LOPEZ'));
      llamada(http, 'GET', '/permisos').flush(historialDeAna());
      await actualizar(fixture);

      expect(texto()).toContain('Historial del empleado');
      expect(Array.from(modal().querySelectorAll<HTMLTableRowElement>('tbody tr')).map((f) => f.cells[0].textContent!.trim())).toEqual(['32']);
      expect(modal().textContent).toContain('CITA MEDICA');
      expect(botones(modal(), 'Generar memorando')).toHaveLength(0);
    });
  });

  describe('anular', () => {
    beforeEach(async () => iniciar('ADMIN', { filtro: ['INFORMATICA', 'SOPORTE'] }));

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
    beforeEach(async () => iniciar('ADMIN', { filtro: ['INFORMATICA', 'SOPORTE'] }));

    it('trae el historial completo de la API', async () => {
      await clic(fixture, boton(fila(1), 'ANA LOPEZ'));
      expect(texto()).toContain('Historial del empleado');
      expect(texto()).toContain('Cargando el historial completo...');
      const pedido = llamada(http, 'GET', '/permisos');
      expect(pedido.request.params.get('idEmpleado')).toBe('1');
      pedido.flush([permisos[0], permisos[3], permiso({ IdPermiso: 7, FechaInicio: '2019-02-01T00:00:00', FechaFin: '2019-02-01T00:00:00' })]);
      await actualizar(fixture);

      expect(texto()).not.toContain('Cargando el historial completo...');
      expect(modal().querySelectorAll('tbody tr')).toHaveLength(3);
      expect(texto()).toContain('Todo el historial');
      // El No. de pago es de cada permiso: el encabezado del empleado no lo muestra.
      expect(modal().textContent).not.toContain('No. de pago');
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
      await iniciar('ADMIN', { enResumen: true, filtro: ['INFORMATICA', 'SOPORTE'] });
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

      // Los empleados del área elegida arriba.
      await clic(fixture, boton(modal(), 'Seleccionar todos'));
      expect(texto()).toContain('1 seleccionado(s)');
      await clic(fixture, boton(modal(), 'Quitar selección'));
      expect(texto()).toContain('0 seleccionado(s)');
      await escribir(fixture, campo(modal(), 'input[name="reportBusqueda"]'), 'ana');
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
    await clic(fixture, boton(raiz(), 'Mantenimiento'));
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

  // ---- Resumen --------------------------------------------------------------------------

  describe('resumen', () => {
    const pestana = (id: 'hoy' | 'semana' | 'mes' | 'activos'): HTMLButtonElement => campo(raiz(), `#vista-${id}`);
    const total = (id: 'hoy' | 'semana' | 'mes' | 'activos'): number => Number(pestana(id).querySelector('.kpi-value')!.textContent);

    it('abre en Hoy y cada pestaña muestra el detalle de su total', async () => {
      await iniciar('JEFE', { enResumen: true });

      expect(raiz().querySelector('table.permisos-table')).toBeNull();
      expect(pestana('hoy').getAttribute('aria-selected')).toBe('true');
      const filasHoy = Array.from(raiz().querySelectorAll<HTMLElement>('.timeline-row'));
      expect(filasHoy).toHaveLength(total('hoy'));
      // El sin área (#5) ya terminó según su jornada: no cuenta como vigente.
      expect(filasHoy.map((filaHoy) => filaHoy.querySelector('strong')!.textContent)).toEqual(['ANA LOPEZ']);
      // El jefe tiene una sola área: no se repite en cada fila.
      expect(filasHoy[0].textContent).toContain(`hasta el ${formatDay(dia(2))}`);
      // Lo registrado por estado: 1 y 2 activos, 3 y 5 finalizados, 4 anulado.
      expect(Array.from(raiz().querySelectorAll('.registro-totales dd')).map((dd) => dd.textContent)).toEqual(['2', '2', '1']);

      await clic(fixture, pestana('semana'));
      expect(pestana('semana').getAttribute('aria-selected')).toBe('true');
      expect(pestana('hoy').getAttribute('aria-selected')).toBe('false');
      expect(raiz().querySelectorAll('.semana-row:not(.semana-head)')).toHaveLength(total('semana'));
      expect(raiz().querySelectorAll('.semana-head .semana-dia')).toHaveLength(7);
      expect(texto()).toContain('3 días hábiles');

      await clic(fixture, pestana('mes'));
      expect(raiz().querySelectorAll('.mes-lista li')).toHaveLength(total('mes'));
      // El jefe lo ve por empleado: ANA LOPEZ tiene el 1 (el 4 está anulado).
      expect(Array.from(raiz().querySelectorAll('.ranking-nombre')).map((nombre) => nombre.textContent)).toContain('ANA LOPEZ');
      // La lista del mes es de activos: el de PEDRO ya terminó (el ranking sí lo cuenta en el mes).
      expect(campo<HTMLElement>(raiz(), '.mes-lista').textContent).not.toContain('PEDRO SIN AREA');

      // Activos: los que no terminan, de cualquier fecha (el 2 es del próximo día hábil).
      await clic(fixture, pestana('activos'));
      const activos = Array.from(raiz().querySelectorAll('.mes-lista li strong')).map((nombre) => nombre.textContent);
      expect(activos).toEqual(['ANA LOPEZ', 'LUIS PAZ']);
      expect(total('activos')).toBe(2);
    });

    it('sin permisos activos lo dice aunque haya finalizados y anulados', async () => {
      await iniciar('JEFE', { enResumen: true, permisos: [permisos[2], permisos[3], permisos[4]] });
      expect([total('hoy'), total('semana'), total('mes'), total('activos')]).toEqual([0, 0, 0, 0]);
      await clic(fixture, pestana('activos'));
      expect(texto()).toContain('No hay permisos activos: todo lo registrado ya finalizó o está anulado.');
      expect(Array.from(raiz().querySelectorAll('.registro-totales dd')).map((dd) => dd.textContent)).toEqual(['0', '2', '1']);
    });

    it('la franja de hoy ubica el permiso por hora entre su salida y su entrada', async () => {
      // A las 08:30, para que el permiso de 10:00 a 12:00 siga activo a cualquier hora que corra la prueba.
      const manana = new Date();
      manana.setHours(8, 30, 0, 0);
      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(manana);
      onTestFinished(() => { vi.useRealTimers(); });
      await iniciar('JEFE', {
        enResumen: true,
        permisos: [
          permiso({ IdPermiso: 1, FechaFin: `${dia(2)}T00:00:00`, DiasHabiles: 3 }),
          permiso({
            IdPermiso: 7, Tipo: 'HORA', IdEmpleado: 2, Empleado: 'LUIS PAZ', HoraSalida: '10:00', HoraEntrada: '12:00',
            DiasHabiles: 0, Minutos: 120, IdArea: 101, NombreArea: 'DESARROLLO',
          }),
        ],
      });

      // Jornada de INFORMATICA, de 08:00 a 16:00: una marca por hora.
      expect(Array.from(raiz().querySelectorAll('.timeline-axis span')).map((hora) => hora.textContent)).toEqual(
        ['08:00', '09:00', '10:00', '11:00', '12:00', '13:00', '14:00', '15:00', '16:00']);
      const barras = Array.from(raiz().querySelectorAll<HTMLElement>('.timeline-bar'));
      expect([barras[0].style.left, barras[0].style.width]).toEqual(['0%', '100%']);
      expect([barras[1].style.left, barras[1].style.width]).toEqual(['25%', '25%']);
      expect(barras[1].classList).toContain('hora');
      expect(barras[1].textContent!.trim()).toBe('10:00 a 12:00');
    });

    it('"Ver en el registro" abre el registro con los activos y las fechas de la pestaña', async () => {
      await iniciar('JEFE', { enResumen: true });
      await clic(fixture, pestana('semana'));
      await clic(fixture, boton(raiz(), 'Ver en el registro'));

      const { desde, hasta } = weekRange(new Date());
      expect(campo<HTMLInputElement>(raiz(), 'input[name="fechaDesde"]').value).toBe(desde);
      expect(campo<HTMLInputElement>(raiz(), 'input[name="fechaHasta"]').value).toBe(hasta);
      expect(campo<HTMLSelectElement>(raiz(), 'select[name="estadoFilter"]').value).toBe('ACTIVO');
      expect(idsVisibles()).toContain('1');
      expect(idsVisibles()).not.toContain('3');
      expect(idsVisibles()).not.toContain('5');
      expect(boton(raiz(), 'Permisos').getAttribute('aria-current')).toBe('page');
    });

    it('sin permisos lo dice; el resumen no registra (eso va en Permisos y Vacaciones)', async () => {
      await iniciar('JEFE', { enResumen: true, permisos: [] });
      expect(texto()).toContain('Nadie tiene permiso hoy.');
      expect(texto()).toContain('Todavía no hay permisos este mes.');
      expect(botones(raiz(), /registrar|nuevo permiso/i)).toHaveLength(0);
      expect(botones(raiz(), 'Exportar reporte')).toHaveLength(1);
      await clic(fixture, boton(raiz(), 'Permisos'));
      await clic(fixture, boton(raiz(), 'Nuevo permiso'));
      expect(texto()).toContain('Registrar permiso');
      await clic(fixture, boton(modal(), 'Cerrar ventana'));
    });

    it('el administrador sin departamento ni área ve el resumen vacío con el aviso', async () => {
      await iniciar('ADMIN', { enResumen: true });
      expect([total('hoy'), total('semana'), total('mes'), total('activos')]).toEqual([0, 0, 0, 0]);
      expect(texto()).toContain('Elige un departamento y un área arriba para ver sus permisos y vacaciones.');
      await filtrar('INFORMATICA', 'SOPORTE');
      expect(total('hoy')).toBe(1);
      // El mes por área: solo la elegida.
      await clic(fixture, pestana('mes'));
      expect(Array.from(raiz().querySelectorAll('.ranking-nombre')).map((nombre) => nombre.textContent)).toEqual(['SOPORTE']);
    });

    it('el jefe ve el mes por empleado y su área en el título', async () => {
      await iniciar('JEFE', { enResumen: true });
      expect(texto()).toContain('Permisos del área de SOPORTE');
      expect(texto()).toContain('Este mes por empleado');
      expect(Array.from(raiz().querySelectorAll('.ranking-nombre')).map((nombre) => nombre.textContent)).toContain('ANA LOPEZ');
    });
  });

  // ---- Vacaciones -----------------------------------------------------------------------

  describe('vacaciones', () => {
    const ok = { status: 204, statusText: 'No Content' };
    const vacacion = permiso({
      IdPermiso: 20, Tipo: 'VAC', Motivo: 'VACACIONES', FechaFin: `${dia(6)}T00:00:00`, DiasHabiles: 5,
      FechaSolicitud: `${dia(-3)}T00:00:00`,
    });
    const conVacaciones = [...permisos, vacacion];
    const pestanaVista = (id: 'hoy' | 'semana' | 'mes' | 'activos'): HTMLButtonElement => campo(raiz(), `#vista-${id}`);
    // Botón de la barra lateral (fuera del resumen no hay otro "Vacaciones").
    const abrirVacaciones = (): Promise<void> => clic(fixture, boton(raiz(), 'Vacaciones'));
    async function recargar(): Promise<void> {
      await actualizar(fixture);
      llamada(http, 'GET', '/permisos').flush(conVacaciones);
      await actualizar(fixture);
    }

    it('van en su propia sección, no en el registro de permisos', async () => {
      await iniciar('JEFE', { permisos: conVacaciones });
      expect(idsVisibles()).not.toContain('20');
      await abrirVacaciones();
      expect(texto()).toContain('Vacaciones del área de SOPORTE');
      expect(idsVisibles()).toEqual(['20']);
      const celdas = Array.from(fila(20).cells).map((celda) => celda.textContent!.trim());
      expect(celdas).toEqual(expect.arrayContaining([formatDay(dia()), formatDay(dia(6)), '5', formatDay(dia(-3))]));
      expect(botones(fila(20), /^(Editar|Anular)$/)).toHaveLength(2);
    });

    it('registrar: empleado, inicio, finalización y fecha de solicitud (hoy por defecto y nunca futura)', async () => {
      await iniciar('JEFE', { permisos: conVacaciones });
      await abrirVacaciones();
      await clic(fixture, boton(raiz(), 'Registrar vacaciones'));
      const registrar = (): HTMLButtonElement => boton(modal(), 'Registrar vacaciones');
      const solicitud = campo<HTMLInputElement>(modal(), '#vacacion-solicitud');
      expect(solicitud.value).toBe(dia());
      expect(solicitud.max).toBe(dia());
      expect(registrar().disabled).toBe(true);

      const inicio = proximoDiaHabil();
      await elegir(fixture, campo(modal(), '#vacacion-empleado'), 'ANA LOPEZ');
      await escribir(fixture, campo(modal(), '#vacacion-inicio'), inicio);
      // La finalización acompaña al inicio.
      expect(campo<HTMLInputElement>(modal(), '#vacacion-fin').value).toBe(inicio);
      expect(modal().textContent).toContain('1 día hábil de vacaciones');
      expect(registrar().disabled).toBe(false);

      await escribir(fixture, solicitud, dia(1));
      await enviar(fixture, formularioModal());
      expect(alerta()).toBe('La fecha de solicitud no puede ser futura.');
      sinLlamadas(http, 'POST', '/permisos/vacaciones');

      await escribir(fixture, solicitud, dia(-2));
      await enviar(fixture, formularioModal());
      const choque = llamada(http, 'POST', '/permisos/vacaciones');
      expect(choque.request.body).toEqual({ IdEmpleado: 1, FechaSolicitud: dia(-2), Periodos: [{ FechaInicio: inicio, FechaFin: inicio }] });
      errorApi(choque, 400, 'El empleado ya tiene un permiso por día que se cruza con estas vacaciones.');
      await actualizar(fixture);
      expect(alerta()).toBe('El empleado ya tiene un permiso por día que se cruza con estas vacaciones.');

      await enviar(fixture, formularioModal());
      llamada(http, 'POST', '/permisos/vacaciones').flush(null, ok);
      await recargar();
      expect(raiz().querySelector('.workshop-modal')).toBeNull();
      expect(texto()).toContain('Vacaciones registradas.');
    });

    it('una solicitud lleva varios períodos: "+" guarda el escrito y pide el siguiente', async () => {
      await iniciar('JEFE', { permisos: conVacaciones });
      await abrirVacaciones();
      await clic(fixture, boton(raiz(), 'Registrar vacaciones'));
      const agregar = (): HTMLButtonElement => campo(modal(), 'button[aria-label="Agregar otro período"]');
      const inicio = (): HTMLInputElement => campo(modal(), '#vacacion-inicio');
      const fin = (): HTMLInputElement => campo(modal(), '#vacacion-fin');
      const periodos = (): string[] => Array.from(modal().querySelectorAll('.vac-periodos li'))
        .map((li) => Array.from(li.children).map((parte) => parte.textContent!.trim()).join(' '));
      async function rango(desde: string, hasta: string): Promise<void> {
        await escribir(fixture, inicio(), desde);
        await escribir(fixture, fin(), hasta);
      }
      // Lunes de dentro de tres semanas: los días siguientes son hábiles y no chocan con nada.
      const lunes = (((8 - new Date().getDay()) % 7) || 7) + 14;
      await elegir(fixture, campo(modal(), '#vacacion-empleado'), 'ANA LOPEZ');

      await clic(fixture, agregar());
      expect(alerta()).toContain('antes de agregar otro');

      await rango(dia(lunes), dia(lunes + 1));
      await clic(fixture, agregar());
      expect([inicio().value, fin().value]).toEqual(['', '']);
      expect(periodos()).toEqual([`del ${formatDay(dia(lunes))} al ${formatDay(dia(lunes + 1))} 2 días hábiles Quitar`]);

      // Cruzado con el agregado o solo fin de semana: no entra y las fechas se quedan para corregirlas.
      await rango(dia(lunes + 1), dia(lunes + 2));
      await clic(fixture, agregar());
      expect(alerta()).toContain('se cruza con el del');
      expect(inicio().value).toBe(dia(lunes + 1));
      await rango(dia(lunes + 5), dia(lunes + 6));
      await clic(fixture, agregar());
      expect(alerta()).toContain('no tiene días hábiles');
      expect(periodos()).toHaveLength(1);

      await rango(dia(lunes + 7), dia(lunes + 9));
      await clic(fixture, agregar());
      expect(alerta()).toBe('');
      // El tercero queda escrito sin "+": también se envía.
      await rango(dia(lunes + 14), dia(lunes + 14));
      expect(modal().textContent!.replace(/\s+/g, ' ')).toContain('Total de la solicitud: 6 días hábiles en 3 períodos.');

      // Quitar uno lo saca de la solicitud.
      await clic(fixture, campo(modal(), `button[aria-label="Quitar el período del ${formatDay(dia(lunes))} al ${formatDay(dia(lunes + 1))}"]`));
      expect(periodos()).toHaveLength(1);
      await rango(dia(lunes), dia(lunes));
      await clic(fixture, agregar());
      await rango(dia(lunes + 14), dia(lunes + 14));

      await enviar(fixture, formularioModal());
      const alta = llamada(http, 'POST', '/permisos/vacaciones');
      expect(alta.request.body).toEqual({
        IdEmpleado: 1, FechaSolicitud: dia(), Periodos: [
          { FechaInicio: dia(lunes), FechaFin: dia(lunes) },
          { FechaInicio: dia(lunes + 7), FechaFin: dia(lunes + 9) },
          { FechaInicio: dia(lunes + 14), FechaFin: dia(lunes + 14) },
        ],
      });
      alta.flush(null, ok);
      await recargar();
      expect(texto()).toContain('Vacaciones registradas: 3 períodos.');
    });

    it('al editar se cambia un solo período: sin "+"', async () => {
      await iniciar('JEFE', { permisos: conVacaciones });
      await abrirVacaciones();
      await clic(fixture, boton(fila(20), 'Editar'));
      expect(modal().querySelector('button[aria-label="Agregar otro período"]')).toBeNull();
      expect(modal().textContent).not.toContain('agregas otro período');
    });

    it('editar y anular', async () => {
      await iniciar('JEFE', { permisos: conVacaciones });
      await abrirVacaciones();
      await clic(fixture, boton(fila(20), 'Editar'));
      expect(texto()).toContain('Editar vacaciones #20');
      expect(campo<HTMLInputElement>(modal(), '#vacacion-solicitud').value).toBe(dia(-3));
      expect(campo<HTMLInputElement>(modal(), '#vacacion-fin').value).toBe(dia(6));
      await escribir(fixture, campo(modal(), '#vacacion-fin'), dia(7));
      await enviar(fixture, formularioModal());
      const editar = llamada(http, 'PUT', '/permisos/vacaciones/20');
      expect(editar.request.body).toEqual({ IdEmpleado: 1, FechaInicio: dia(), FechaFin: dia(7), FechaSolicitud: dia(-3) });
      editar.flush(null, ok);
      await recargar();
      expect(texto()).toContain('Vacaciones actualizadas.');

      await clic(fixture, boton(fila(20), 'Anular'));
      expect(modal().textContent).toContain('Anular vacaciones #20');
      await enviar(fixture, formularioModal());
      llamada(http, 'PUT', '/permisos/20/anular').flush(null, ok);
      await recargar();
      expect(texto()).toContain('Vacaciones anuladas.');
    });

    it('el resumen se filtra por permisos o vacaciones y lleva al registro de cada uno', async () => {
      await iniciar('JEFE', { permisos: conVacaciones, enResumen: true });
      // Total y leyenda de la pestaña "Hoy", separados por un espacio.
      const hoy = (): string =>
        Array.from(campo(raiz(), '#vista-hoy').children).map((parte) => parte.textContent!.trim()).join(' ');
      const tipo = (nombre: string): HTMLButtonElement => boton(campo(raiz(), '.resumen-tipo'), nombre);
      // Solo dos opciones, sin "Todos" ni etiqueta "Ver"; al entrar se ven los permisos.
      expect(botones(campo(raiz(), '.resumen-tipo'), /.+/).map((opcion) => opcion.textContent!.trim())).toEqual(['Permisos', 'Vacaciones']);
      expect(campo(raiz(), '.resumen-tipo').textContent).not.toContain('Ver');
      expect(tipo('Permisos').getAttribute('aria-checked')).toBe('true');
      expect(hoy()).toContain('1 empleado con permiso');
      expect(raiz().querySelector('.timeline-bar.vacaciones')).toBeNull();

      await clic(fixture, tipo('Vacaciones'));
      expect(hoy()).toContain('1 empleado de vacaciones');
      expect(raiz().querySelectorAll('.timeline-bar')).toHaveLength(1);
      expect(raiz().querySelector('.timeline-bar.vacaciones')).not.toBeNull();

      await clic(fixture, tipo('Permisos'));
      expect(hoy()).toContain('1 empleado con permiso');
      expect(raiz().querySelector('.timeline-bar.vacaciones')).toBeNull();

      await clic(fixture, tipo('Vacaciones'));
      await clic(fixture, boton(raiz(), 'Ver en el registro'));
      expect(texto()).toContain('Vacaciones del área de SOPORTE');
      expect(idsVisibles()).toEqual(['20']);
    });

    it('en vacaciones, el mes es un calendario con un color por empleado', async () => {
      const otra = permiso({
        IdPermiso: 21, Tipo: 'VAC', IdEmpleado: 2, Empleado: 'LUIS PAZ', Motivo: 'VACACIONES',
        FechaInicio: `${dia(1)}T00:00:00`, FechaFin: `${dia(3)}T00:00:00`, DiasHabiles: 3,
      });
      await iniciar('JEFE', { permisos: [...conVacaciones, otra], enResumen: true });
      await clic(fixture, boton(campo(raiz(), '.resumen-tipo'), 'Vacaciones'));
      await clic(fixture, pestanaVista('mes'));

      // Formato de calendario: de domingo a sábado, semanas completas, cada día del mes con su número.
      const ahora = new Date();
      const diasDelMes = new Date(ahora.getFullYear(), ahora.getMonth() + 1, 0).getDate();
      const calendario = campo<HTMLTableElement>(raiz(), 'table.calendario-mes');
      expect(Array.from(calendario.querySelectorAll('th')).map((th) => th.textContent!.trim()))
        .toEqual(['DOM.', 'LUN.', 'MAR.', 'MIÉ.', 'JUE.', 'VIE.', 'SÁB.']);
      expect(calendario.querySelectorAll('tbody td').length % 7).toBe(0);
      expect(calendario.querySelectorAll('.calendario-numero')).toHaveLength(diasDelMes);
      expect(calendario.querySelectorAll('td.fuera').length).toBe(calendario.querySelectorAll('tbody td').length - diasDelMes);
      const hoyCelda = campo(calendario, 'td.hoy');
      expect(hoyCelda.querySelector('.calendario-numero')!.textContent).toBe(String(ahora.getDate()));
      // Las vacaciones de ANA empiezan hoy: en un día hábil, su casilla ya la lleva.
      if (ahora.getDay() !== 0 && ahora.getDay() !== 6) expect(hoyCelda.textContent).toContain('ANA LOPEZ');
      expect(raiz().querySelector('.mes-lista')).toBeNull();

      // Ningún evento en fin de semana, y cada empleado con un solo color, distinto del de los demás.
      expect(calendario.querySelectorAll('td.fin .calendario-evento')).toHaveLength(0);
      const eventos = Array.from(calendario.querySelectorAll<HTMLElement>('.calendario-evento'));
      const colorPorEmpleado = new Map<string, Set<string>>();
      for (const evento of eventos) {
        const nombre = evento.textContent!.trim();
        colorPorEmpleado.set(nombre, (colorPorEmpleado.get(nombre) ?? new Set()).add(evento.style.backgroundColor));
      }
      expect([...colorPorEmpleado.values()].every((colores) => colores.size === 1)).toBe(true);
      const colores = new Set([...colorPorEmpleado.values()].map((colores) => [...colores][0]));
      expect(colores.size).toBe(colorPorEmpleado.size);

      // Debajo, quién es cada color, con sus fechas y días.
      const leyenda = Array.from(raiz().querySelectorAll('.calendario-leyenda li')).map((li) => li.textContent!.replace(/\s+/g, ' '));
      expect(leyenda.some((fila) => fila.includes('ANA LOPEZ') && fila.includes('5 días hábiles'))).toBe(true);

      // El mismo empleado conserva su color en la semana.
      await clic(fixture, pestanaVista('semana'));
      const semana = Array.from(raiz().querySelectorAll<HTMLElement>('.semana-bar'));
      const ana = semana.find((barra) => barra.closest('.semana-row')!.textContent!.includes('ANA LOPEZ'))!;
      expect(ana.style.backgroundColor).toBe(eventos.find((evento) => evento.textContent!.includes('ANA LOPEZ'))?.style.backgroundColor
        ?? ana.style.backgroundColor);
      expect(new Set(semana.map((barra) => barra.style.backgroundColor)).size).toBe(semana.length);

      // En permisos el mes sigue siendo la lista, con los colores del tipo.
      await clic(fixture, boton(campo(raiz(), '.resumen-tipo'), 'Permisos'));
      await clic(fixture, pestanaVista('mes'));
      expect(raiz().querySelector('.calendario-mes')).toBeNull();
      expect(raiz().querySelector('.mes-lista')).not.toBeNull();
    });
  });
});
