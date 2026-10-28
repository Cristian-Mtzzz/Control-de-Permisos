import { Component, inject, signal } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router } from '@angular/router';
import { EMPTY, catchError, finalize } from 'rxjs';
import { apiErrorMessage } from '../shared/api-response';
import { AuthService } from './auth.service';

// Cambio de la contraseña inicial (1234) de un usuario local. Al guardarla, la API marca la
// clave como segura (CLAVE_SEGURA = '1') y el usuario vuelve a entrar con la nueva.
@Component({
  selector: 'app-change-password',
  imports: [ReactiveFormsModule],
  templateUrl: './change-password.component.html',
  styleUrl: './change-password.component.css',
})
export class ChangePasswordComponent {
  private readonly formBuilder = inject(FormBuilder);
  private readonly authService = inject(AuthService);
  private readonly router = inject(Router);
  readonly form = this.formBuilder.nonNullable.group({
    currentPassword: ['', [Validators.required]],
    newPassword: ['', [Validators.required, Validators.minLength(6)]],
    confirmPassword: ['', [Validators.required]],
  });
  readonly isLoading = signal(false);
  readonly errorMessage = signal('');

  submit(): void {
    this.errorMessage.set('');
    const { currentPassword, newPassword, confirmPassword } = this.form.getRawValue();
    const error = this.form.controls.currentPassword.invalid ? 'Escribe tu contraseña actual.'
      : this.form.controls.newPassword.invalid ? 'La nueva contraseña debe tener al menos 6 caracteres.'
        : newPassword !== confirmPassword ? 'Las contraseñas nuevas no coinciden.'
          : newPassword === currentPassword ? 'La nueva contraseña debe ser distinta de la actual.'
            : '';
    if (error) {
      this.form.markAllAsTouched();
      this.errorMessage.set(error);
      return;
    }

    this.isLoading.set(true);
    this.authService.changeInitialPassword(currentPassword, newPassword).pipe(
      catchError((response: HttpErrorResponse) => {
        this.errorMessage.set(apiErrorMessage(response, 'No se pudo actualizar la contraseña.'));
        return EMPTY;
      }),
      finalize(() => this.isLoading.set(false)),
    ).subscribe(() => {
      // El token actual solo servía para este cambio: se entra de nuevo con la contraseña nueva.
      this.authService.logout();
      void this.router.navigate(['/login'], { queryParams: { clave: 'actualizada' } });
    });
  }
}
