import { PermisoNivel } from '../permisos/permisos.models';

// Datos que el formulario envía al endpoint de autenticación.
export interface LoginRequest {
  UserName: string;
  Password: string;
}

// Usuario en sesión. Nivel llega en el login; al recargar la página se toma de la sesión de
// permisos (/api/permisos/sesion), que es la fuente de verdad del alcance.
export interface AuthUser {
  UserId: number;
  UserName: string;
  FullName: string;
  Nivel: PermisoNivel | null;
}

// Respuesta del login: token JWT, usuario y si debe cambiar la contraseña inicial.
export interface LoginResponse {
  Token: string;
  User: AuthUser;
  MustChangePassword: boolean;
}
