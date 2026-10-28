import { Component, inject, signal } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { EMPTY, catchError, finalize } from 'rxjs';
import { apiErrorMessage } from '../shared/api-response';
import { AuthService } from './auth.service';

@Component({
  selector: 'app-auth',
  imports: [ReactiveFormsModule],
  templateUrl: './auth.component.html',
  styleUrl: './auth.component.css',
})
// Inicio de sesión: valida el formulario, muestra el motivo si la API rechaza la entrada y lleva
// al cambio de contraseña inicial o al panel de permisos.
export class AuthComponent {
  private readonly formBuilder = inject(FormBuilder);
  private readonly authService = inject(AuthService);
  private readonly router = inject(Router);

  // El largo de la contraseña no se valida aquí: la inicial es 1234 y la de dominio la decide Active Directory.
  readonly loginForm = this.formBuilder.nonNullable.group({
    userName: ['', [Validators.required]],
    password: ['', [Validators.required]],
  });
  readonly isLoading = signal(false);
  readonly errorMessage = signal('');
  // Aviso al volver del cambio de la contraseña inicial.
  readonly infoMessage = signal(inject(ActivatedRoute).snapshot.queryParamMap.get('clave') === 'actualizada'
    ? 'Tu contraseña se actualizó. Inicia sesión con la nueva.'
    : '');
  showPassword = false;

  submitLogin(): void {
    if (this.loginForm.invalid) {
      this.loginForm.markAllAsTouched();
      return;
    }
    this.isLoading.set(true);
    this.errorMessage.set('');
    this.infoMessage.set('');
    const { userName, password } = this.loginForm.getRawValue();

    this.authService.login({ UserName: userName, Password: password }).pipe(
      catchError((error: HttpErrorResponse) => {
        // 401: credenciales incorrectas o cuenta sin nivel en el Control de permisos (la API no
        // distingue los dos casos para no confirmar contraseñas). 429: demasiados intentos.
        this.errorMessage.set(error.status === 401
          ? apiErrorMessage(error, 'El usuario o la contraseña no son correctos, o tu usuario no tiene acceso al Control de permisos.')
          : error.status === 429
            ? apiErrorMessage(error, 'Demasiados intentos fallidos. Espera unos minutos e intenta de nuevo.')
            : 'No fue posible conectar con el servicio. Intenta nuevamente.');
        return EMPTY;
      }),
      finalize(() => this.isLoading.set(false)),
    ).subscribe((response) =>
      void this.router.navigateByUrl(response.MustChangePassword ? '/change-password' : '/permisos'));
  }
}
