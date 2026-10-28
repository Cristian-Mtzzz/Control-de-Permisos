import { TestBed } from '@angular/core/testing';
import { Router, UrlTree, provideRouter } from '@angular/router';
import { AuthService } from './auth.service';
import { authGuard, changePasswordGuard } from './auth.guard';

// Quien todavía tiene la contraseña inicial solo puede estar en el cambio de contraseña.
describe('guardas de sesión', () => {
  function configurar(sesion: { autenticado: boolean; debeCambiar: boolean }): void {
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        {
          provide: AuthService,
          useValue: {
            isAuthenticated: () => sesion.autenticado,
            mustChangePassword: () => sesion.debeCambiar,
            logout: () => undefined,
          },
        },
      ],
    });
  }

  const destino = (resultado: unknown): string =>
    resultado instanceof UrlTree ? TestBed.inject(Router).serializeUrl(resultado) : String(resultado);

  const ejecutar = (guarda: typeof authGuard) =>
    TestBed.runInInjectionContext(() => guarda({} as never, {} as never));

  it('lleva al cambio de contraseña a quien todavía tiene la inicial', () => {
    configurar({ autenticado: true, debeCambiar: true });
    expect(destino(ejecutar(authGuard))).toBe('/change-password');
    expect(ejecutar(changePasswordGuard)).toBe(true);
  });

  it('deja entrar al panel a quien ya la cambió y no le muestra el cambio', () => {
    configurar({ autenticado: true, debeCambiar: false });
    expect(ejecutar(authGuard)).toBe(true);
    expect(destino(ejecutar(changePasswordGuard))).toBe('/permisos');
  });

  it('manda al login a quien no tiene sesión', () => {
    configurar({ autenticado: false, debeCambiar: false });
    expect(destino(ejecutar(authGuard))).toBe('/login');
    expect(destino(ejecutar(changePasswordGuard))).toBe('/login');
  });
});
