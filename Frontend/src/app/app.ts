import { Component, inject } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { fromEvent, merge, throttleTime } from 'rxjs';
import { AuthService } from './auth/auth.service';

@Component({
  imports: [RouterOutlet],
  selector: 'app-root',
  styleUrl: './app.css',
  templateUrl: './app.html',
})
// Componente raíz: aloja el outlet y vigila la actividad del usuario para mantener o cerrar la sesión.
export class App {
  private readonly authService = inject(AuthService);

  constructor() {
    fromEvent<StorageEvent>(window, 'storage').pipe(
      takeUntilDestroyed(),
    ).subscribe((event) => this.authService.handleStorageChange(event.key, event.newValue));

    merge(
      fromEvent(document, 'pointerdown'),
      fromEvent(document, 'pointermove'),
      fromEvent(document, 'keydown'),
      fromEvent(document, 'input'),
      fromEvent(document, 'touchstart'),
      fromEvent(document, 'wheel'),
    ).pipe(
      throttleTime(1000),
      takeUntilDestroyed(),
    ).subscribe(() => this.authService.recordActivity());
  }
}
