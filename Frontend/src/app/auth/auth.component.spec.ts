import { NgZone } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { Router, provideRouter } from '@angular/router';
import {
  actualizar, almacenamientoEnMemoria, boton, campo, clic, enviar, errorApi, escribir, llamada, rutasDePrueba, sinLlamadas, textoDe,
} from '../testing/ui';
import { AuthComponent } from './auth.component';
import { ChangePasswordComponent } from './change-password.component';
import { AUTH_TOKEN_KEY, AuthService } from './auth.service';

// Token con los claims que lee el frontend; la firma no se valida en el navegador.
function token(claims: Record<string, unknown>): string {
  const base64 = (valor: unknown) => btoa(JSON.stringify(valor)).replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
  return `${base64({ alg: 'HS256', typ: 'JWT' })}.${base64(claims)}.firma`;
}

const claims = (debeCambiar: boolean) => ({
  sub: '7', unique_name: 'ana.lopez', full_name: 'ANA LOPEZ', must_change_password: String(debeCambiar),
  exp: Math.floor(Date.now() / 1000) + 60 * 60, iat: Math.floor(Date.now() / 1000),
});

describe('Inicio de sesión', () => {
  let fixture: ComponentFixture<AuthComponent>;
  let http: HttpTestingController;
  const raiz = (): HTMLElement => fixture.nativeElement as HTMLElement;
  const formulario = (): HTMLFormElement => campo(raiz(), 'form');
  const alerta = (): string => raiz().querySelector('[role="alert"]')?.textContent?.trim() ?? '';

  beforeEach(async () => {
    vi.stubGlobal('localStorage', almacenamientoEnMemoria());
    TestBed.configureTestingModule({
      imports: [AuthComponent],
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter(rutasDePrueba)],
    });
    http = TestBed.inject(HttpTestingController);
    fixture = TestBed.createComponent(AuthComponent);
    await actualizar(fixture);
  });

  afterEach(() => {
    try {
      http.verify();
    } finally {
      TestBed.resetTestingModule();
      vi.unstubAllGlobals();
    }
  });

  async function llenar(usuario: string, clave: string): Promise<void> {
    await escribir(fixture, campo(raiz(), '#userName'), usuario);
    await escribir(fixture, campo(raiz(), '#password'), clave);
  }

  it('sin usuario ni contraseña no llama a la API y marca los dos campos', async () => {
    await enviar(fixture, formulario());
    expect(textoDe(fixture)).toContain('Ingresa tu nombre de usuario.');
    expect(textoDe(fixture)).toContain('Ingresa tu contraseña.');
    sinLlamadas(http, 'POST', '/auth/login');

    await escribir(fixture, campo(raiz(), '#userName'), 'ana');
    await enviar(fixture, formulario());
    expect(textoDe(fixture)).not.toContain('Ingresa tu nombre de usuario.');
    sinLlamadas(http, 'POST', '/auth/login');
  });

  it('Ver / Ocultar muestra y oculta la contraseña', async () => {
    const clave = campo<HTMLInputElement>(raiz(), '#password');
    expect(clave.type).toBe('password');
    await clic(fixture, boton(raiz(), 'Ver'));
    expect(clave.type).toBe('text');
    await clic(fixture, boton(raiz(), 'Ocultar'));
    expect(clave.type).toBe('password');
  });

  it.each([
    [401, 'El usuario o la contraseña no son correctos, o tu usuario no tiene acceso al Control de permisos.',
      'El usuario o la contraseña no son correctos, o tu usuario no tiene acceso al Control de permisos.'],
    [401, undefined, 'El usuario o la contraseña no son correctos, o tu usuario no tiene acceso al Control de permisos.'],
    [429, 'Demasiados intentos fallidos. Intenta de nuevo en 5 minutos.', 'Demasiados intentos fallidos. Intenta de nuevo en 5 minutos.'],
    [503, 'El servicio de autenticación no está disponible temporalmente.', 'No fue posible conectar con el servicio. Intenta nuevamente.'],
    [500, undefined, 'No fue posible conectar con el servicio. Intenta nuevamente.'],
    [0, undefined, 'No fue posible conectar con el servicio. Intenta nuevamente.'],
  ])('respuesta %s: muestra el motivo, no guarda sesión y deja volver a intentar', async (status, mensaje, esperado) => {
    await llenar('ana.lopez', 'mala');
    await enviar(fixture, formulario());
    const login = llamada(http, 'POST', '/auth/login');
    expect(login.request.body).toEqual({ UserName: 'ana.lopez', Password: 'mala' });
    expect(boton(raiz(), /Validando/).disabled).toBe(true);
    errorApi(login, status, mensaje);
    await actualizar(fixture);

    expect(alerta()).toBe(esperado);
    expect(localStorage.getItem(AUTH_TOKEN_KEY)).toBeNull();
    expect(boton(raiz(), /Ingresar/).disabled).toBe(false);
  });

  it.each([
    [false, '/permisos'],
    [true, '/change-password'],
  ])('login correcto (debe cambiar la contraseña: %s) lleva a %s', async (debeCambiar, destino) => {
    const router = TestBed.inject(Router);
    await llenar('ana.lopez', 'buena');
    await enviar(fixture, formulario());
    llamada(http, 'POST', '/auth/login').flush({
      Token: token(claims(debeCambiar)),
      User: { UserId: 7, UserName: 'ana.lopez', FullName: 'ANA LOPEZ', Nivel: 'JEFE' },
      MustChangePassword: debeCambiar,
    });
    await actualizar(fixture);

    await vi.waitFor(() => expect(router.url).toBe(destino));
    expect(localStorage.getItem(AUTH_TOKEN_KEY)).not.toBeNull();
    expect(TestBed.inject(AuthService).currentUser()?.FullName).toBe('ANA LOPEZ');
  });
});

describe('Cambio de la contraseña inicial', () => {
  let fixture: ComponentFixture<ChangePasswordComponent>;
  let http: HttpTestingController;
  const raiz = (): HTMLElement => fixture.nativeElement as HTMLElement;
  const alerta = (): string => raiz().querySelector('[role="alert"]')?.textContent?.trim() ?? '';

  beforeEach(async () => {
    vi.stubGlobal('localStorage', almacenamientoEnMemoria());
    localStorage.setItem(AUTH_TOKEN_KEY, token(claims(true)));
    TestBed.configureTestingModule({
      imports: [ChangePasswordComponent],
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter(rutasDePrueba)],
    });
    http = TestBed.inject(HttpTestingController);
    fixture = TestBed.createComponent(ChangePasswordComponent);
    await actualizar(fixture);
  });

  afterEach(() => {
    try {
      http.verify();
    } finally {
      TestBed.resetTestingModule();
      vi.unstubAllGlobals();
    }
  });

  async function llenar(actual: string, nueva: string, confirmar: string): Promise<void> {
    await escribir(fixture, campo(raiz(), '#currentPassword'), actual);
    await escribir(fixture, campo(raiz(), '#newPassword'), nueva);
    await escribir(fixture, campo(raiz(), '#confirmPassword'), confirmar);
    await enviar(fixture, campo(raiz(), 'form'));
  }

  it.each([
    ['', 'nueva123', 'nueva123', 'Escribe tu contraseña actual.'],
    ['1234', '123', '123', 'La nueva contraseña debe tener al menos 6 caracteres.'],
    ['1234', 'nueva123', 'nueva124', 'Las contraseñas nuevas no coinciden.'],
    ['nueva123', 'nueva123', 'nueva123', 'La nueva contraseña debe ser distinta de la actual.'],
  ])('actual "%s", nueva "%s", confirmar "%s": %s', async (actual, nueva, confirmar, esperado) => {
    await llenar(actual, nueva, confirmar);
    expect(alerta()).toBe(esperado);
    sinLlamadas(http, 'POST', '/auth/change-initial-password');
  });

  it('muestra el error de la API y, al cambiarla, cierra la sesión y vuelve al login', async () => {
    const router = TestBed.inject(Router);
    await llenar('1234', 'nueva123', 'nueva123');
    let cambio = llamada(http, 'POST', '/auth/change-initial-password');
    expect(cambio.request.body).toEqual({ CurrentPassword: '1234', NewPassword: 'nueva123' });
    errorApi(cambio, 400, 'La contraseña actual no es válida o ya fue actualizada.');
    await actualizar(fixture);
    expect(alerta()).toBe('La contraseña actual no es válida o ya fue actualizada.');

    await enviar(fixture, campo(raiz(), 'form'));
    cambio = llamada(http, 'POST', '/auth/change-initial-password');
    errorApi(cambio, 0);
    await actualizar(fixture);
    expect(alerta()).toBe('No se pudo actualizar la contraseña.');

    await enviar(fixture, campo(raiz(), 'form'));
    llamada(http, 'POST', '/auth/change-initial-password').flush(null, { status: 204, statusText: 'No Content' });
    await actualizar(fixture);
    await vi.waitFor(() => expect(router.url).toBe('/login?clave=actualizada'));
    expect(localStorage.getItem(AUTH_TOKEN_KEY)).toBeNull();
  });
});

// La actividad se registra fuera de Angular; al vencer la sesión hay que volver a Angular para
// que la pantalla pase al login.
describe('Sesión vencida por inactividad', () => {
  afterEach(() => {
    TestBed.resetTestingModule();
    vi.unstubAllGlobals();
  });

  it('cierra la sesión y lleva al login dentro de Angular', async () => {
    vi.stubGlobal('localStorage', almacenamientoEnMemoria());
    localStorage.setItem(AUTH_TOKEN_KEY, token(claims(false)));
    localStorage.setItem('control_permisos_last_activity', String(Date.now() - 31 * 60 * 1000));
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter(rutasDePrueba)] });
    const router = TestBed.inject(Router);
    const zona = TestBed.inject(NgZone);
    const navegar = vi.spyOn(router, 'navigateByUrl');
    const dentroDeAngular: boolean[] = [];
    navegar.mockImplementation(() => {
      dentroDeAngular.push(NgZone.isInAngularZone());
      return Promise.resolve(true);
    });

    // Se crea fuera de Angular, como el temporizador que dispara la actividad.
    const auth = zona.runOutsideAngular(() => TestBed.inject(AuthService));

    expect(auth.currentUser()).toBeNull();
    expect(localStorage.getItem(AUTH_TOKEN_KEY)).toBeNull();
    expect(navegar).toHaveBeenCalledWith('/login');
    expect(dentroDeAngular).toEqual([true]);
  });
});
