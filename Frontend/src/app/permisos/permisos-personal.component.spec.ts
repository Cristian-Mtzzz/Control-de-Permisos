import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import {
  actualizar, boton, campo, clic, elegir, empleados, enviar, errorApi, escribir, llamada, opcionesDe, sesion, sinLlamadas, textoDe,
} from '../testing/ui';
import { PermisoEmpleado, PermisoSesion } from './permisos.models';
import { PermisosPersonalComponent } from './permisos-personal.component';

// Sección Personal: el jefe agrega y quita a su gente; los administradores mueven a cualquiera
// de su alcance entre las áreas del departamento del empleado.
describe('Sección Personal', () => {
  let fixture: ComponentFixture<PermisosPersonalComponent>;
  let http: HttpTestingController;
  let cambios: number;
  const raiz = (): HTMLElement => fixture.nativeElement as HTMLElement;
  const texto = (): string => textoDe(fixture);
  const alerta = (): string => raiz().querySelector('[role="alert"]')?.textContent?.trim() ?? '';
  const filas = (): string[] => Array.from(raiz().querySelectorAll<HTMLTableRowElement>('tbody tr')).map((fila) => fila.cells[0].textContent!.trim());

  async function iniciar(datos: PermisoSesion, lista: PermisoEmpleado[] = empleados): Promise<void> {
    TestBed.configureTestingModule({
      imports: [PermisosPersonalComponent],
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    http = TestBed.inject(HttpTestingController);
    fixture = TestBed.createComponent(PermisosPersonalComponent);
    fixture.componentRef.setInput('sesion', datos);
    fixture.componentRef.setInput('empleados', lista);
    cambios = 0;
    fixture.componentInstance.changed.subscribe(() => cambios++);
    await actualizar(fixture);
  }

  afterEach(() => {
    try {
      http?.verify();
    } finally {
      TestBed.resetTestingModule();
    }
  });

  describe('jefe', () => {
    // El jefe recibe los de su área y los de su departamento sin área.
    beforeEach(async () => iniciar(sesion('JEFE'), [empleados[0], empleados[3]]));

    it('ve a su personal y solo puede agregar empleados sin área', async () => {
      expect(texto()).toContain('ÁREA DE SOPORTE');
      expect(texto()).toContain('Mi personal · 1');
      expect(filas()).toEqual(['ANA LOPEZ']);
      expect(opcionesDe(campo(raiz(), '#personal-nuevo'))).toEqual(['Selecciona un empleado sin área', 'PEDRO SIN AREA']);
      expect(boton(raiz(), 'Agregar').disabled).toBe(true);
    });

    it('agregar: error de la API y luego éxito; siempre avisa al panel para recargar', async () => {
      await elegir(fixture, campo(raiz(), '#personal-nuevo'), 'PEDRO SIN AREA');
      expect(boton(raiz(), 'Agregar').disabled).toBe(false);
      await enviar(fixture, campo(raiz(), 'form.personal-add'));
      const asignar = llamada(http, 'PUT', '/permisos/personal/4');
      expect(asignar.request.body).toEqual({ IdArea: 100 });
      errorApi(asignar, 400, 'El empleado ya pertenece al área DESARROLLO. Pide al administrador de tu departamento que lo mueva.');
      await actualizar(fixture);
      expect(alerta()).toContain('Pide al administrador de tu departamento que lo mueva.');
      expect(cambios).toBe(1);
      // El selector vuelve a "Selecciona": no se reenvía por accidente.
      expect(boton(raiz(), 'Agregar').disabled).toBe(true);

      await elegir(fixture, campo(raiz(), '#personal-nuevo'), 'PEDRO SIN AREA');
      await enviar(fixture, campo(raiz(), 'form.personal-add'));
      llamada(http, 'PUT', '/permisos/personal/4').flush(null, { status: 204, statusText: 'No Content' });
      await actualizar(fixture);
      expect(texto()).toContain('PEDRO SIN AREA se agregó a tu área.');
      expect(cambios).toBe(2);
    });

    it('quitar del área: 404 y sin conexión muestran el motivo; luego lo quita', async () => {
      await clic(fixture, boton(raiz(), 'Quitar del área'));
      errorApi(llamada(http, 'DELETE', '/permisos/personal/1'), 404, 'El empleado no pertenece a un área que administres.');
      await actualizar(fixture);
      expect(alerta()).toBe('El empleado no pertenece a un área que administres.');

      await clic(fixture, boton(raiz(), 'Quitar del área'));
      errorApi(llamada(http, 'DELETE', '/permisos/personal/1'), 0);
      await actualizar(fixture);
      expect(alerta()).toBe('No se pudo actualizar el personal.');

      await clic(fixture, boton(raiz(), 'Quitar del área'));
      expect(boton(raiz(), 'Quitar del área').disabled).toBe(true);
      llamada(http, 'DELETE', '/permisos/personal/1').flush(null, { status: 204, statusText: 'No Content' });
      await actualizar(fixture);
      expect(texto()).toContain('ANA LOPEZ salió del área.');
      expect(cambios).toBe(3);
    });

    it('sin personal muestra cómo agregarlo', async () => {
      fixture.componentRef.setInput('empleados', [empleados[3]]);
      await actualizar(fixture);
      expect(texto()).toContain('Todavía no tienes personal asignado.');
    });
  });

  describe('administrador general', () => {
    beforeEach(async () => iniciar(sesion('ADMIN')));

    const selectorDe = (nombre: string): HTMLSelectElement => campo(raiz(), `select[aria-label="Área de ${nombre}"]`);

    it('filtra por búsqueda, departamento, área y "Sin área"', async () => {
      expect(filas()).toEqual(['ANA LOPEZ', 'LUIS PAZ', 'MARIA RUIZ', 'PEDRO SIN AREA']);
      await escribir(fixture, campo(raiz(), 'input[name="personalSearch"]'), '2001');
      expect(filas()).toEqual(['MARIA RUIZ']);
      await escribir(fixture, campo(raiz(), 'input[name="personalSearch"]'), '');

      await elegir(fixture, campo(raiz(), 'select[name="personalArea"]'), 'Sin área');
      expect(filas()).toEqual(['PEDRO SIN AREA']);
      await elegir(fixture, campo(raiz(), 'select[name="personalArea"]'), 'DESARROLLO');
      expect(filas()).toEqual(['LUIS PAZ']);
      // Otro departamento: el área elegida ya no aplica y se quita.
      await elegir(fixture, campo(raiz(), 'select[name="personalDepto"]'), 'RECURSOS HUMANOS');
      expect(opcionesDe(campo(raiz(), 'select[name="personalArea"]'))).toEqual(['Todas las áreas', 'Sin área', 'NOMINA']);
      expect(filas()).toEqual(['MARIA RUIZ']);
      await escribir(fixture, campo(raiz(), 'input[name="personalSearch"]'), 'ana');
      expect(texto()).toContain('No hay empleados que coincidan.');
    });

    it('cada empleado solo puede ir a áreas activas de su departamento', async () => {
      expect(opcionesDe(selectorDe('ANA LOPEZ'))).toEqual(['Sin área', 'SOPORTE', 'DESARROLLO']);
      expect(opcionesDe(selectorDe('MARIA RUIZ'))).toEqual(['Sin área', 'NOMINA']);
    });

    it('mover de área y dejar sin área, con errores de la API', async () => {
      await elegir(fixture, selectorDe('ANA LOPEZ'), 'DESARROLLO');
      const mover = llamada(http, 'PUT', '/permisos/personal/1');
      expect(mover.request.body).toEqual({ IdArea: 101 });
      errorApi(mover, 409, 'Otro usuario está modificando estos datos. Intenta de nuevo en unos segundos.');
      await actualizar(fixture);
      expect(alerta()).toContain('Otro usuario está modificando estos datos.');

      await elegir(fixture, selectorDe('ANA LOPEZ'), 'DESARROLLO');
      llamada(http, 'PUT', '/permisos/personal/1').flush(null, { status: 204, statusText: 'No Content' });
      await actualizar(fixture);
      expect(texto()).toContain('ANA LOPEZ pasó al área DESARROLLO.');

      await elegir(fixture, selectorDe('LUIS PAZ'), 'Sin área');
      llamada(http, 'DELETE', '/permisos/personal/2').flush(null, { status: 204, statusText: 'No Content' });
      await actualizar(fixture);
      expect(texto()).toContain('LUIS PAZ quedó sin área.');
      expect(cambios).toBe(3);
    });

    it('elegir el área que ya tiene no llama a la API', async () => {
      await elegir(fixture, selectorDe('ANA LOPEZ'), 'SOPORTE');
      sinLlamadas(http, 'PUT', '/permisos/personal/1');
      expect(cambios).toBe(0);
    });
  });
});
