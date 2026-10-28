import { Component, computed, inject, input, output } from '@angular/core';
import { AuthService } from '../auth/auth.service';
import { nivelLabel } from '../permisos/permisos.models';

@Component({
  selector: 'app-header',
  templateUrl: './app-header.component.html',
  styleUrl: './app-header.component.css',
})
// Barra superior: logo, nombre del sistema, sección actual, usuario en sesión con su nivel y las
// acciones Refrescar / Cerrar sesión.
export class AppHeaderComponent {
  private readonly authService = inject(AuthService);

  // Sección o alcance que se muestra junto al nombre del sistema.
  readonly moduleName = input.required<string>();
  readonly systemName = input('Control de Permisos');
  readonly refresh = output<void>();
  readonly logout = output<void>();

  readonly userName = computed(() => {
    const user = this.authService.currentUser();
    return user?.FullName?.trim() || user?.UserName || '';
  });
  readonly roleLabel = computed(() => {
    const nivel = this.authService.currentUser()?.Nivel;
    return nivel ? nivelLabel(nivel) : '';
  });
  readonly initials = computed(() => this.userName()
    .split(/[\s._-]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part.charAt(0).toUpperCase())
    .join(''));
}
