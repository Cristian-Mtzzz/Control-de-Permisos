import { HttpClient } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { Observable, map } from 'rxjs';
import { apiUrl } from '../api-url';
import { toPascalCase } from '../shared/api-response';
import {
  Permiso, PermisoDepartamentoDisponible, PermisoEmpleado, PermisoJefe, PermisoSesion, PermisoUsuarioInventario,
  SavePermisoDiaRequest, SavePermisoHoraRequest, SavePermisoJefeRequest,
} from './permisos.models';

const API_PERMISOS_URL = apiUrl('permisos');

// Cliente HTTP del Control de permisos. El alcance de cada usuario lo aplica la API: cada uno
// recibe y modifica solo lo de su área o departamento, y la consulta no modifica nada.
@Injectable({ providedIn: 'root' })
export class PermisosService {
  constructor(private readonly httpClient: HttpClient) { }

  getSesion(): Observable<PermisoSesion> {
    return this.httpClient.get<unknown>(`${API_PERMISOS_URL}/sesion`).pipe(map((body) => toPascalCase<PermisoSesion>(body)));
  }

  // desde (yyyy-mm-dd): los permisos que terminan ese día o después; idEmpleado: los de un
  // empleado. Sin filtros llega todo el historial del alcance.
  getPermisos(filtro: { desde?: string; idEmpleado?: number } = {}): Observable<Permiso[]> {
    const params: Record<string, string> = {};
    if (filtro.desde) params['desde'] = filtro.desde;
    if (filtro.idEmpleado) params['idEmpleado'] = String(filtro.idEmpleado);
    return this.httpClient.get<unknown>(API_PERMISOS_URL, { params }).pipe(map((body) => toPascalCase<Permiso[]>(body)));
  }

  // Empleados activos con su área; el jefe recibe los suyos y los de su departamento que no tienen área.
  getEmpleados(): Observable<PermisoEmpleado[]> {
    return this.httpClient.get<unknown>(`${API_PERMISOS_URL}/empleados`)
      .pipe(map((body) => toPascalCase<PermisoEmpleado[]>(body)));
  }

  // Los choques de fechas, los días hábiles, el área y los límites los valida la API.
  savePermisoDia(idPermiso: number | null, permiso: SavePermisoDiaRequest): Observable<void> {
    return idPermiso === null
      ? this.httpClient.post<void>(`${API_PERMISOS_URL}/dia`, permiso)
      : this.httpClient.put<void>(`${API_PERMISOS_URL}/dia/${idPermiso}`, permiso);
  }

  savePermisoHora(idPermiso: number | null, permiso: SavePermisoHoraRequest): Observable<void> {
    return idPermiso === null
      ? this.httpClient.post<void>(`${API_PERMISOS_URL}/hora`, permiso)
      : this.httpClient.put<void>(`${API_PERMISOS_URL}/hora/${idPermiso}`, permiso);
  }

  anularPermiso(idPermiso: number): Observable<void> {
    return this.httpClient.put<void>(`${API_PERMISOS_URL}/${idPermiso}/anular`, {});
  }

  asignarArea(idEmpleado: number, idArea: number): Observable<void> {
    return this.httpClient.put<void>(`${API_PERMISOS_URL}/personal/${idEmpleado}`, { IdArea: idArea });
  }

  quitarArea(idEmpleado: number): Observable<void> {
    return this.httpClient.delete<void>(`${API_PERMISOS_URL}/personal/${idEmpleado}`);
  }

  // ---- Departamentos (administrador general) -------------------------------------------

  getDepartamentosDisponibles(): Observable<PermisoDepartamentoDisponible[]> {
    return this.httpClient.get<unknown>(`${API_PERMISOS_URL}/departamentos/disponibles`)
      .pipe(map((body) => toPascalCase<PermisoDepartamentoDisponible[]>(body)));
  }

  agregarDepartamento(idDepartamento: number): Observable<void> {
    return this.httpClient.post<void>(`${API_PERMISOS_URL}/departamentos`, { IdDepartamento: idDepartamento });
  }

  saveDepartamentoEstado(idDepartamento: number, estado: string): Observable<void> {
    return this.httpClient.put<void>(`${API_PERMISOS_URL}/departamentos/${idDepartamento}`, { Estado: estado });
  }

  // ---- Administradores (cada uno en su alcance) ----------------------------------------

  // El departamento solo se usa al crear; el administrador de departamento siempre crea en el suyo.
  saveArea(idArea: number | null, nombre: string, estado: string | null, idDepartamento: number | null): Observable<void> {
    const body = { Nombre: nombre, Estado: estado, IdDepartamento: idDepartamento };
    return idArea === null
      ? this.httpClient.post<void>(`${API_PERMISOS_URL}/areas`, body)
      : this.httpClient.put<void>(`${API_PERMISOS_URL}/areas/${idArea}`, body);
  }

  getJefes(): Observable<PermisoJefe[]> {
    return this.httpClient.get<unknown>(`${API_PERMISOS_URL}/jefes`).pipe(map((body) => toPascalCase<PermisoJefe[]>(body)));
  }

  saveJefe(idUsuario: number | null, jefe: SavePermisoJefeRequest): Observable<void> {
    return idUsuario === null
      ? this.httpClient.post<void>(`${API_PERMISOS_URL}/jefes`, jefe)
      : this.httpClient.put<void>(`${API_PERMISOS_URL}/jefes/${idUsuario}`, jefe);
  }

  resetJefePassword(idUsuario: number): Observable<void> {
    return this.httpClient.put<void>(`${API_PERMISOS_URL}/jefes/${idUsuario}/reset-password`, {});
  }

  // El administrador general recibe todas; el de departamento indica el usuario exacto.
  getUsuariosInventario(usuario = ''): Observable<PermisoUsuarioInventario[]> {
    const params = usuario.trim() ? { usuario: usuario.trim() } : undefined;
    return this.httpClient.get<unknown>(`${API_PERMISOS_URL}/usuarios-inventario`, { params })
      .pipe(map((body) => toPascalCase<PermisoUsuarioInventario[]>(body)));
  }

  // Solo cuentas de inventario: les quita el área y la administración; en inventario siguen igual.
  quitarAcceso(idUsuario: number): Observable<void> {
    return this.httpClient.delete<void>(`${API_PERMISOS_URL}/jefes/${idUsuario}/acceso`);
  }
}
