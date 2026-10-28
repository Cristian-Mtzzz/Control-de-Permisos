import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Injectable, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { EMPTY, Observable, catchError, finalize, tap } from 'rxjs';
import { apiUrl } from '../api-url';
import { PermisoNivel } from '../permisos/permisos.models';
import { AuthUser, LoginRequest, LoginResponse } from './auth.models';

const SESSION_IDLE_TIMEOUT_MS = 30 * 60 * 1000;
const TOKEN_REFRESH_MARGIN_MS = 2 * 60 * 1000;

const API_AUTH_URL = apiUrl('auth');
// Claves propias: si el inventario se publica en el mismo servidor comparte el localStorage, y
// cada sistema debe conservar su propia sesión.
export const AUTH_TOKEN_KEY = 'control_permisos_token';
const LAST_ACTIVITY_KEY = 'control_permisos_last_activity';

// Sesión del navegador: guarda el JWT, expone el usuario actual, cierra la sesión tras 30
// minutos sin actividad y renueva el token antes de que venza mientras el usuario trabaja.
@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly httpClient = inject(HttpClient);
  private readonly router = inject(Router);
  private inactivityTimer: ReturnType<typeof setTimeout> | null = null;
  private tokenRefreshInFlight = false;

  readonly currentUser = signal<AuthUser | null>(this.readUserFromToken());

  constructor() {
    if (this.currentUser()) {
      const lastActivity = this.getLastActivityTimestamp();
      this.scheduleInactivityExpiry(lastActivity);
      this.refreshTokenIfNeeded(lastActivity);
    } else if (this.getToken()) {
      this.logout();
    }
  }

  login(loginRequest: LoginRequest): Observable<LoginResponse> {
    return this.httpClient.post<LoginResponse>(`${API_AUTH_URL}/login`, loginRequest).pipe(
      tap((response) => this.storeSession(response)),
    );
  }

  changeInitialPassword(currentPassword: string, newPassword: string): Observable<void> {
    return this.httpClient.post<void>(`${API_AUTH_URL}/change-initial-password`, {
      CurrentPassword: currentPassword,
      NewPassword: newPassword,
    });
  }

  // La pantalla de permisos informa el nivel vigente que trae la sesión de la API.
  setNivel(nivel: PermisoNivel): void {
    const user = this.currentUser();
    if (user && user.Nivel !== nivel) this.currentUser.set({ ...user, Nivel: nivel });
  }

  logout(): void {
    if (this.inactivityTimer !== null) {
      clearTimeout(this.inactivityTimer);
      this.inactivityTimer = null;
    }
    localStorage.removeItem(AUTH_TOKEN_KEY);
    localStorage.removeItem(LAST_ACTIVITY_KEY);
    this.currentUser.set(null);
  }

  isAuthenticated(): boolean {
    return this.getToken() !== null && this.currentUser() !== null;
  }

  // El token de quien todavía tiene la contraseña inicial solo sirve para cambiarla.
  mustChangePassword(): boolean {
    return this.readTokenClaims()?.['must_change_password'] === 'true';
  }

  getToken(): string | null {
    const token = localStorage.getItem(AUTH_TOKEN_KEY);
    return token && token.trim().length > 0 ? token : null;
  }

  recordActivity(): void {
    if (!this.isAuthenticated()) return;
    const lastActivity = Date.now();
    localStorage.setItem(LAST_ACTIVITY_KEY, String(lastActivity));
    this.scheduleInactivityExpiry(lastActivity);
    this.refreshTokenIfNeeded(lastActivity);
  }

  // Otra pestaña cerró sesión o registró actividad.
  handleStorageChange(key: string | null, value: string | null): void {
    if (key === AUTH_TOKEN_KEY && value === null && this.currentUser()) {
      this.expireSession();
      return;
    }
    if (key !== LAST_ACTIVITY_KEY || value === null || !this.isAuthenticated()) return;

    const lastActivity = Number(value);
    if (Number.isFinite(lastActivity) && lastActivity > 0) {
      this.scheduleInactivityExpiry(lastActivity);
      this.refreshTokenIfNeeded(lastActivity);
    }
  }

  private storeSession(response: LoginResponse): void {
    localStorage.setItem(AUTH_TOKEN_KEY, response.Token);
    this.currentUser.set(response.User);
    const lastActivity = Date.now();
    localStorage.setItem(LAST_ACTIVITY_KEY, String(lastActivity));
    this.scheduleInactivityExpiry(lastActivity);
  }

  // Al recargar la página el usuario se reconstruye desde los claims del token vigente.
  private readUserFromToken(): AuthUser | null {
    const claims = this.readTokenClaims();
    if (!claims) return null;
    const expiresAt = Number(claims['exp']);
    if (!Number.isFinite(expiresAt) || expiresAt * 1000 <= Date.now()) return null;

    const userName = String(claims['unique_name'] ?? claims['name'] ?? '').trim();
    const userId = Number(claims['sub']);
    if (!userName || !Number.isInteger(userId)) return null;
    return {
      UserId: userId,
      UserName: userName,
      FullName: String(claims['full_name'] ?? '').trim() || userName,
      Nivel: null,
    };
  }

  private scheduleInactivityExpiry(lastActivity: number): void {
    if (this.inactivityTimer !== null) clearTimeout(this.inactivityTimer);
    const remainingTime = lastActivity + SESSION_IDLE_TIMEOUT_MS - Date.now();
    if (remainingTime <= 0) {
      this.expireSession();
      return;
    }
    this.inactivityTimer = setTimeout(() => this.expireSession(), remainingTime);
  }

  private getLastActivityTimestamp(): number {
    const storedActivity = Number(localStorage.getItem(LAST_ACTIVITY_KEY));
    if (Number.isFinite(storedActivity) && storedActivity > 0) return storedActivity;
    const issuedAt = Number(this.readTokenClaims()?.['iat']);
    return Number.isFinite(issuedAt) && issuedAt > 0 ? issuedAt * 1000 : Date.now();
  }

  // Renueva el token si vencería antes de que se cumpla el tiempo de inactividad.
  private refreshTokenIfNeeded(lastActivity: number): void {
    const expiresAt = Number(this.readTokenClaims()?.['exp']);
    if (!Number.isFinite(expiresAt)
      || expiresAt * 1000 - (lastActivity + SESSION_IDLE_TIMEOUT_MS) > TOKEN_REFRESH_MARGIN_MS
      || this.tokenRefreshInFlight) return;

    this.tokenRefreshInFlight = true;
    this.httpClient.post<{ Token?: string }>(`${API_AUTH_URL}/refresh`, {}).pipe(
      tap((response) => {
        if (response.Token) localStorage.setItem(AUTH_TOKEN_KEY, response.Token);
        else this.expireSession();
      }),
      catchError((error: HttpErrorResponse) => {
        if (error.status === 401) this.expireSession();
        return EMPTY;
      }),
      finalize(() => this.tokenRefreshInFlight = false),
    ).subscribe();
  }

  private readTokenClaims(): Record<string, unknown> | null {
    try {
      const payloadSegment = this.getToken()?.split('.')[1];
      if (!payloadSegment) return null;
      const base64 = payloadSegment.replace(/-/g, '+').replace(/_/g, '/');
      const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, '=');
      const payloadBytes = Uint8Array.from(atob(padded), (character) => character.charCodeAt(0));
      return JSON.parse(new TextDecoder().decode(payloadBytes)) as Record<string, unknown>;
    } catch {
      return null;
    }
  }

  private expireSession(): void {
    this.logout();
    void this.router.navigateByUrl('/login');
  }
}
