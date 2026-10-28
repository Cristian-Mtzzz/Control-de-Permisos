import { Routes } from '@angular/router';
import { AuthComponent } from './auth/auth.component';
import { authGuard, changePasswordGuard, loginGuard } from './auth/auth.guard';

// Navegación del Control de permisos: login, cambio de la contraseña inicial y el panel. Lo que
// cada usuario ve dentro del panel depende de su nivel, que valida la API.
export const routes: Routes = [
  { path: '', pathMatch: 'full', redirectTo: 'permisos' },
  { path: 'login', component: AuthComponent, canActivate: [loginGuard] },
  {
    path: 'change-password',
    canActivate: [changePasswordGuard],
    loadComponent: () => import('./auth/change-password.component').then((module) => module.ChangePasswordComponent),
  },
  {
    path: 'permisos',
    canActivate: [authGuard],
    loadComponent: () => import('./permisos/permisos.component').then((module) => module.PermisosComponent),
  },
  { path: '**', redirectTo: 'permisos' },
];
