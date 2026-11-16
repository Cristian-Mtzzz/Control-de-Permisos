import { Component, computed, inject, output } from '@angular/core';
import { AuthService } from '../auth/auth.service';
import { nivelLabel } from '../permisos/permisos.models';

@Component({
  selector: 'app-sidebar',
  templateUrl: './app-sidebar.component.html',
  styleUrl: './app-sidebar.component.css',
})
// Barra lateral: logo, las secciones (las pone la pantalla que la usa) y, abajo, el usuario en
// sesión con su nivel y las acciones Refrescar / Cerrar sesión.
export class AppSidebarComponent {
  private readonly authService = inject(AuthService);

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
