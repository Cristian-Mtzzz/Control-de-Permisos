import { HttpInterceptorFn } from '@angular/common/http';
import { AUTH_TOKEN_KEY } from './auth.service';

// Adjunta el JWT a las peticiones cuando hay sesión; así los servicios llaman a la API sin
// construir encabezados.
export const authInterceptor: HttpInterceptorFn = (request, next) => {
  const token = localStorage.getItem(AUTH_TOKEN_KEY);
  return token ? next(request.clone({ setHeaders: { Authorization: `Bearer ${token}` } })) : next(request);
};
