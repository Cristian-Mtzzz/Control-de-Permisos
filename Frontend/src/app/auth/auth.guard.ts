import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AuthService } from './auth.service';

// El nivel de cada usuario lo valida la API en cada solicitud; aquí basta con tener sesión. Quien
// todavía tiene la contraseña inicial va primero a cambiarla: la API rechaza todo lo demás.
export const authGuard: CanActivateFn = () => {
  const authService = inject(AuthService);
  if (!authService.isAuthenticated()) {
    authService.logout();
    return inject(Router).createUrlTree(['/login']);
  }
  return authService.mustChangePassword() ? inject(Router).createUrlTree(['/change-password']) : true;
};

// El cambio de la contraseña inicial necesita sesión y solo aplica a quien todavía la tiene.
export const changePasswordGuard: CanActivateFn = () => {
  const authService = inject(AuthService);
  if (!authService.isAuthenticated()) return inject(Router).createUrlTree(['/login']);
  return authService.mustChangePassword() ? true : inject(Router).createUrlTree(['/permisos']);
};

// Entrar al login cierra la sesión anterior.
export const loginGuard: CanActivateFn = () => {
  inject(AuthService).logout();
  return true;
};
