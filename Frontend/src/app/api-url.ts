import { isDevMode } from '@angular/core';

// En desarrollo, ng serve reenvía /api a la API local (proxy.conf.json); publicado, la API es la
// aplicación /ApiControlPermisos del mismo servidor IIS.
const API_BASE_PATH = isDevMode() ? 'api/' : '/ApiControlPermisos/api/';

export function apiUrl(path: string): string {
  const apiBaseUrl = new URL(API_BASE_PATH, document.baseURI);
  return new URL(path.replace(/^\/+/, ''), apiBaseUrl).pathname;
}
