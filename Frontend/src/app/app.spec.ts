import { NgZone } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { App } from './app';
import { AuthService } from './auth/auth.service';
import { rutasDePrueba } from './testing/ui';

// La actividad del usuario se escucha fuera de Angular para no recalcular la pantalla con cada
// movimiento del mouse; aun así debe registrarse (como máximo una vez por segundo).
describe('Actividad del usuario', () => {
  afterEach(() => TestBed.resetTestingModule());

  it('registra la actividad con el mouse y el teclado, sin repetir dentro del mismo segundo', async () => {
    const recordActivity = vi.fn();
    const handleStorageChange = vi.fn();
    TestBed.configureTestingModule({
      imports: [App],
      providers: [provideRouter(rutasDePrueba), { provide: AuthService, useValue: { recordActivity, handleStorageChange } }],
    });
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();

    document.dispatchEvent(new Event('pointermove'));
    document.dispatchEvent(new Event('pointermove'));
    document.dispatchEvent(new Event('keydown'));
    expect(recordActivity).toHaveBeenCalledTimes(1);

    await new Promise((resolve) => setTimeout(resolve, 1100));
    document.dispatchEvent(new Event('keydown'));
    expect(recordActivity).toHaveBeenCalledTimes(2);

    window.dispatchEvent(new StorageEvent('storage', { key: 'control_permisos_token', newValue: null }));
    expect(handleStorageChange).toHaveBeenCalledWith('control_permisos_token', null);

    // Fuera de Angular: el evento no dispara una detección de cambios de toda la pantalla.
    const dentroDeAngular: boolean[] = [];
    recordActivity.mockImplementation(() => dentroDeAngular.push(NgZone.isInAngularZone()));
    await new Promise((resolve) => setTimeout(resolve, 1100));
    TestBed.inject(NgZone).run(() => document.dispatchEvent(new Event('pointermove')));
    expect(dentroDeAngular).toEqual([false]);
    recordActivity.mockReset();
    recordActivity.mockImplementation(() => undefined);

    // Al destruir la aplicación deja de escuchar.
    fixture.destroy();
    await new Promise((resolve) => setTimeout(resolve, 1100));
    document.dispatchEvent(new Event('pointermove'));
    expect(recordActivity).not.toHaveBeenCalled();
  });
});
