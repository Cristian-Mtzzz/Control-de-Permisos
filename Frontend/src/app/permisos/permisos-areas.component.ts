import { ChangeDetectorRef, Component, inject, input, output } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Observable, finalize } from 'rxjs';
import { AuthService } from '../auth/auth.service';
import { apiErrorMessage } from '../shared/api-response';
import { SearchableSelectDirective } from '../shared/searchable-select.directive';
import { MayusculasDirective } from '../shared/mayusculas.directive';
import {
  PERMISO_DOMINIOS, PERMISO_NIVELES, PermisoArea, PermisoDepartamento, PermisoDepartamentoDisponible, PermisoEmpleado,
  PermisoJefe, PermisoNivel, PermisoSesion, SavePermisoJefeRequest, nivelLabel,
} from './permisos.models';
import { PermisosService } from './permisos.service';
import { OpcionFiltro, edificiosDe, filtrarDisponibles, regionalesDe } from './departamentos-disponibles';

type AreasWindow = 'none' | 'departamento' | 'area' | 'jefe' | 'eliminar';

// Los usuarios nuevos son locales por defecto: entran con 1234 y se les pide cambiarla. Uno de
// dominio entra con su contraseña de Active Directory, así que debe existir allá.
const emptyJefe = (): SavePermisoJefeRequest => ({
  Usuario: '', NombrePersona: '', Nivel: 'JEFE', IdDepartamento: null, IdArea: null, Dominio: 0, DominioP: 'BA', Estado: null,
  IdEmpleado: null,
});

@Component({
  selector: 'app-permisos-areas',
  imports: [FormsModule, SearchableSelectDirective, MayusculasDirective],
  templateUrl: './permisos-areas.component.html',
})
// Administración del Control de permisos. El administrador general maneja los departamentos
// que usan el sistema, sus áreas y todos los usuarios con cualquier nivel; el administrador de
// departamento, las áreas de su departamento y sus jefes.
export class PermisosAreasComponent {
  private readonly permisosService = inject(PermisosService);
  private readonly changeDetector = inject(ChangeDetectorRef);
  private readonly authService = inject(AuthService);

  readonly sesion = input.required<PermisoSesion>();
  // Empleados visibles: al crear un jefe se elige de aquí para tomar su nombre.
  readonly empleados = input.required<PermisoEmpleado[]>();
  // Avisa al panel para que recargue la sesión (departamentos, áreas y conteos).
  readonly changed = output<void>();

  readonly dominios = PERMISO_DOMINIOS;
  readonly nivelLabel = nivelLabel;
  jefes: PermisoJefe[] = [];
  activeWindow: AreasWindow = 'none';
  isSaving = false;
  message = '';
  errorMessage = '';

  departamentosDisponibles: PermisoDepartamentoDisponible[] = [];
  nuevoDepartamentoId = 0;
  // Filtros de "Agregar departamento" (0 = todos).
  regionalFiltro = 0;
  edificioFiltro = 0;

  editingAreaId: number | null = null;
  areaNombre = '';
  areaDepartamentoId: number | null = null;

  editingJefeId: number | null = null;
  jefeForm: SavePermisoJefeRequest = emptyJefe();
  jefeEmpleadoId = 0;
  jefeAEliminar: PermisoJefe | null = null;

  constructor() {
    this.loadJefes();
  }

  // Administrador general: maneja departamentos y asigna cualquier nivel.
  get esAdmin(): boolean { return this.sesion().Nivel === 'ADMIN'; }

  get variosDepartamentos(): boolean { return this.sesion().Departamentos.length > 1; }

  get departamentosActivos(): PermisoDepartamento[] {
    return this.sesion().Departamentos.filter((departamento) => departamento.Estado === 'ACTIVO');
  }

  get areasActivas(): PermisoArea[] { return this.sesion().Areas.filter((area) => area.Estado === 'ACTIVO'); }

  // El jefe de departamento solo nombra jefes de área; el administrador general, cualquier nivel
  // (también otros administradores generales: el sistema lo administran varias personas).
  get niveles(): { value: PermisoNivel; label: string }[] {
    if (!this.esAdmin) return PERMISO_NIVELES.filter((nivel) => nivel.value !== 'ADMIN' && nivel.value !== 'ADMIN_DEPTO');
    return PERMISO_NIVELES;
  }

  // Áreas activas de un departamento (ninguna si no hay departamento).
  areasDe(idDepartamento: number | null): PermisoArea[] {
    return idDepartamento ? this.areasActivas.filter((area) => area.IdDepartamento === idDepartamento) : [];
  }

  // Departamento (de los habilitados en el sistema) y área: al crear buscan al empleado (siempre
  // se piden); al editar solo se piden los que usa el nivel.
  get pideDepartamento(): boolean {
    return this.editingJefeId === null || this.jefeForm.Nivel !== 'ADMIN';
  }

  get pideArea(): boolean { return this.editingJefeId === null || this.jefeForm.Nivel === 'JEFE'; }

  get areasJefe(): PermisoArea[] { return this.areasDe(this.jefeForm.IdDepartamento); }

  // Empleados del departamento elegido (o de todos). Con un área, su personal y el del
  // departamento que todavía no tiene área.
  get empleadosJefe(): PermisoEmpleado[] {
    const { IdDepartamento, IdArea } = this.jefeForm;
    return this.empleados().filter((empleado) =>
      (!IdDepartamento || empleado.IdDepartamento === IdDepartamento)
      && (!IdArea || empleado.IdArea === IdArea || empleado.IdArea === null));
  }

  // Cada cambio quita lo que ya no está en su lista: el área y el empleado.
  cambiarDepartamentoJefe(): void {
    if (this.jefeForm.IdArea !== null && !this.areasJefe.some((area) => area.IdArea === this.jefeForm.IdArea)) {
      this.jefeForm.IdArea = null;
    }
    this.cambiarAreaJefe();
  }

  cambiarAreaJefe(): void {
    if (this.jefeEmpleadoId !== 0 && !this.empleadosJefe.some((empleado) => empleado.IdEmpleado === this.jefeEmpleadoId)) {
      this.selectJefeEmpleado(0);
    }
  }

  // Lo mismo que valida la API: el general administra a todos; el de departamento, a los jefes
  // de las áreas de su departamento (y a los usuarios que todavía no tienen nivel).
  puedeAdministrar(jefe: PermisoJefe): boolean {
    if (this.esAdmin) return true;
    if (jefe.Nivel === '') return true;
    return (jefe.Nivel === 'JEFE' || jefe.Nivel === 'SECRETARIA' || jefe.Nivel === 'USUARIO')
      && jefe.IdDepartamento === this.sesion().IdDepartamento;
  }

  // Nadie se elimina a sí mismo: en su fila no sale el botón (la API también lo rechaza).
  esUsuarioActual(jefe: PermisoJefe): boolean {
    return jefe.Usuario.trim().toLowerCase() === this.authService.currentUser()?.UserName.toLowerCase();
  }

  departamentoNombre(idDepartamento: number | null): string {
    return this.sesion().Departamentos.find((departamento) => departamento.IdDepartamento === idDepartamento)?.Nombre ?? '-';
  }

  loadJefes(): void {
    this.permisosService.getJefes().subscribe({
      next: (jefes) => { this.jefes = jefes; this.changeDetector.markForCheck(); },
      error: (error) => {
        this.errorMessage = apiErrorMessage(error, 'No se pudieron cargar los usuarios.');
        this.changeDetector.markForCheck();
      },
    });
  }

  // ---- Departamentos -------------------------------------------------------------------

  get regionales(): OpcionFiltro[] { return regionalesDe(this.departamentosDisponibles); }

  // En orden: sin regional no hay edificios, y sin edificio no hay departamentos.
  get edificios(): OpcionFiltro[] {
    return this.regionalFiltro === 0 ? [] : edificiosDe(this.departamentosDisponibles, this.regionalFiltro);
  }

  get departamentosFiltrados(): PermisoDepartamentoDisponible[] {
    return this.edificioFiltro === 0 ? [] : filtrarDisponibles(this.departamentosDisponibles, this.regionalFiltro, this.edificioFiltro);
  }

  // Al cambiar un filtro se quitan el edificio y el departamento elegidos si ya no están en la lista.
  cambiarFiltroDepartamento(): void {
    if (this.edificioFiltro !== 0 && !this.edificios.some((edificio) => edificio.Id === this.edificioFiltro)) {
      this.edificioFiltro = 0;
    }
    if (!this.departamentosFiltrados.some((departamento) => departamento.IdDepartamento === this.nuevoDepartamentoId)) {
      this.nuevoDepartamentoId = 0;
    }
  }

  openDepartamentoWindow(): void {
    this.clearMessages();
    this.nuevoDepartamentoId = 0;
    this.regionalFiltro = 0;
    this.edificioFiltro = 0;
    this.permisosService.getDepartamentosDisponibles().subscribe({
      next: (departamentos) => { this.departamentosDisponibles = departamentos; this.changeDetector.markForCheck(); },
      error: (error) => {
        this.errorMessage = apiErrorMessage(error, 'No se pudieron cargar los departamentos.');
        this.changeDetector.markForCheck();
      },
    });
    this.activeWindow = 'departamento';
  }

  agregarDepartamento(): void {
    this.clearMessages();
    const departamento = this.departamentosDisponibles.find((item) => item.IdDepartamento === this.nuevoDepartamentoId);
    if (!departamento) {
      this.errorMessage = 'Selecciona el departamento.';
      return;
    }
    this.run(this.permisosService.agregarDepartamento(departamento.IdDepartamento),
      `${departamento.Nombre} ya usa el control de permisos. Crea sus áreas y nombra a su administrador.`, true);
  }

  // La API rechaza desactivar un departamento con áreas activas o administradores.
  toggleDepartamento(departamento: PermisoDepartamento): void {
    this.clearMessages();
    const estado = departamento.Estado === 'ACTIVO' ? 'INACTIVO' : 'ACTIVO';
    this.run(this.permisosService.saveDepartamentoEstado(departamento.IdDepartamento, estado),
      estado === 'ACTIVO' ? `${departamento.Nombre} activado.` : `${departamento.Nombre} desactivado.`, false);
  }

  // ---- Áreas ---------------------------------------------------------------------------

  openAreaWindow(area: PermisoArea | null = null): void {
    this.clearMessages();
    this.editingAreaId = area?.IdArea ?? null;
    this.areaNombre = area?.Nombre ?? '';
    const unico = this.departamentosActivos.length === 1 ? this.departamentosActivos[0].IdDepartamento : null;
    this.areaDepartamentoId = area?.IdDepartamento ?? unico;
    this.activeWindow = 'area';
  }

  saveArea(): void {
    this.clearMessages();
    if (!this.areaNombre.trim()) {
      this.errorMessage = 'Escribe el nombre del área.';
      return;
    }
    const editing = this.editingAreaId !== null;
    if (!editing && this.esAdmin && !this.areaDepartamentoId) {
      this.errorMessage = 'Selecciona el departamento del área.';
      return;
    }
    const estado = this.sesion().Areas.find((area) => area.IdArea === this.editingAreaId)?.Estado ?? null;
    this.run(this.permisosService.saveArea(this.editingAreaId, this.areaNombre.trim().toLocaleUpperCase('es'), estado, this.areaDepartamentoId),
      editing ? 'Área actualizada.' : 'Área creada.', true);
  }

  // La API rechaza desactivar un área que todavía tiene personal o jefe activo.
  toggleArea(area: PermisoArea): void {
    this.clearMessages();
    const estado = area.Estado === 'ACTIVO' ? 'INACTIVO' : 'ACTIVO';
    this.run(this.permisosService.saveArea(area.IdArea, area.Nombre, estado, null),
      estado === 'ACTIVO' ? `Área ${area.Nombre} activada.` : `Área ${area.Nombre} desactivada.`, false);
  }

  // ---- Usuarios ------------------------------------------------------------------------

  openJefeWindow(jefe: PermisoJefe | null = null): void {
    this.clearMessages();
    this.editingJefeId = jefe?.IdUsuario ?? null;
    this.jefeEmpleadoId = 0;
    // El nombre ya no se edita: una cuenta sin nombre en la base usa su usuario para poder guardarse.
    this.jefeForm = jefe === null ? this.nuevoJefe() : {
      Usuario: jefe.Usuario,
      NombrePersona: jefe.NombrePersona || jefe.Usuario,
      Nivel: jefe.Nivel || 'JEFE',
      IdDepartamento: this.departamentoDelNivel(jefe),
      IdArea: jefe.IdArea,
      Dominio: jefe.Dominio,
      DominioP: jefe.DominioP || 'BA',
      Estado: jefe.Estado,
      IdEmpleado: jefe.IdEmpleado,
    };
    this.activeWindow = 'jefe';
  }

  // El nombre del usuario es el del empleado elegido (no se escribe a mano). Si todavía no se
  // eligieron, se completan su departamento y su área.
  selectJefeEmpleado(idEmpleado: number): void {
    this.jefeEmpleadoId = idEmpleado;
    const empleado = this.empleados().find((item) => item.IdEmpleado === idEmpleado);
    this.jefeForm.NombrePersona = empleado?.NombreCompleto ?? '';
    // La cuenta de empleado queda atada a la ficha elegida.
    this.jefeForm.IdEmpleado = idEmpleado > 0 ? idEmpleado : null;
    if (!empleado) return;
    if (this.jefeForm.IdDepartamento === null
      && this.departamentosActivos.some((departamento) => departamento.IdDepartamento === empleado.IdDepartamento)) {
      this.jefeForm.IdDepartamento = empleado.IdDepartamento;
    }
    if (this.jefeForm.IdArea === null && this.areasJefe.some((area) => area.IdArea === empleado.IdArea)) {
      this.jefeForm.IdArea = empleado.IdArea;
    }
  }

  saveJefe(): void {
    this.clearMessages();
    const form = this.jefeForm;
    if (this.nivelIncompleto(form)) return;
    if (!form.NombrePersona.trim()) {
      this.errorMessage = 'Selecciona al empleado.';
      return;
    }
    if (!form.Usuario.trim()) {
      this.errorMessage = 'Escribe el usuario.';
      return;
    }
    const editing = this.editingJefeId !== null;
    // Pasar de dominio a local deja la contraseña en 1234 (lo hace la API): se avisa.
    const pasaALocal = editing && form.Dominio === 0
      && this.jefes.find((jefe) => jefe.IdUsuario === this.editingJefeId)?.Dominio === 1;
    const success = !editing ? this.createdMessage(form)
      : pasaALocal ? `Usuario actualizado. Ahora es local: entra con ${form.Usuario.trim()} y la contraseña 1234; se le pedirá cambiarla.`
        : 'Usuario actualizado.';
    this.run(this.permisosService.saveJefe(this.editingJefeId, this.limpiarNivel({
      ...form, Usuario: form.Usuario.trim(), NombrePersona: form.NombrePersona.trim(),
    })), success, true);
  }

  resetPassword(jefe: PermisoJefe): void {
    this.clearMessages();
    this.run(this.permisosService.resetJefePassword(jefe.IdUsuario),
      `La contraseña de ${jefe.NombrePersona} quedó en 1234; se le pedirá cambiarla al entrar.`, false);
  }

  // Eliminar pide confirmación. La API rechaza eliminar el propio usuario.
  openEliminarJefe(jefe: PermisoJefe): void {
    this.clearMessages();
    this.jefeAEliminar = jefe;
    this.activeWindow = 'eliminar';
  }

  confirmEliminarJefe(): void {
    const jefe = this.jefeAEliminar;
    if (!jefe) return;
    this.clearMessages();
    this.run(this.permisosService.deleteJefe(jefe.IdUsuario), `Usuario ${jefe.Usuario} eliminado.`, true);
  }

  tipoCuenta(jefe: PermisoJefe): string {
    return jefe.Dominio === 1 ? `Dominio ${jefe.DominioP}` : 'Local';
  }

  // Lo que ve cada usuario según su nivel: un área, un departamento o todo.
  alcanceJefe(jefe: PermisoJefe): string {
    if (jefe.Nivel === 'JEFE') {
      return this.esAdmin && this.variosDepartamentos ? `${jefe.NombreArea} · ${jefe.NombreDepartamento}` : jefe.NombreArea ?? '-';
    }
    if (jefe.Nivel === 'USUARIO') return jefe.NombreEmpleado ?? 'Sus propios permisos';
    if (jefe.Nivel === 'ADMIN_DEPTO' || jefe.Nivel === 'SECRETARIA') return jefe.NombreDepartamento ?? '-';
    return jefe.Nivel ? 'Todos los departamentos' : '-';
  }

  closeWindow(): void {
    this.activeWindow = 'none';
    this.editingAreaId = null;
    this.editingJefeId = null;
    this.jefeAEliminar = null;
  }

  // Usuario nuevo; con un solo departamento a la vista (el administrador de departamento), ya va en él.
  private nuevoJefe(): SavePermisoJefeRequest {
    const unico = this.departamentosActivos.length === 1 ? this.departamentosActivos[0].IdDepartamento : null;
    return { ...emptyJefe(), IdDepartamento: unico };
  }

  // Departamento del formulario: el que administra o el del área del jefe (solo para elegir su
  // área; al guardar, limpiarNivel lo envía solo para el jefe de departamento).
  private departamentoDelNivel(jefe: PermisoJefe): number | null {
    return jefe.Nivel !== 'ADMIN' ? jefe.IdDepartamento : null;
  }

  // Los botones de crear y guardar se habilitan con el formulario completo.
  get areaCompleta(): boolean {
    return Boolean(this.areaNombre.trim()) && (this.editingAreaId !== null || !this.esAdmin || Boolean(this.areaDepartamentoId));
  }

  get jefeCompleto(): boolean {
    const form = this.jefeForm;
    return Boolean(form.Usuario.trim() && form.NombrePersona.trim())
      && (form.Nivel !== 'JEFE' || Boolean(form.IdArea))
      && ((form.Nivel !== 'ADMIN_DEPTO' && form.Nivel !== 'SECRETARIA') || Boolean(form.IdDepartamento))
      && (form.Nivel !== 'USUARIO' || Boolean(form.IdEmpleado));
  }

  private nivelIncompleto(form: SavePermisoJefeRequest): boolean {
    if (form.Nivel === 'JEFE' && !form.IdArea) this.errorMessage = 'Selecciona el departamento y el área del jefe.';
    else if (form.Nivel === 'ADMIN_DEPTO' && !form.IdDepartamento) this.errorMessage = 'Selecciona el departamento que administra.';
    else if (form.Nivel === 'SECRETARIA' && !form.IdDepartamento) this.errorMessage = 'Selecciona el departamento de la secretaría.';
    else if (form.Nivel === 'USUARIO' && !form.IdEmpleado) this.errorMessage = 'Selecciona al empleado de la cuenta.';
    return this.errorMessage !== '';
  }

  // Solo se envía el dato que corresponde al nivel elegido.
  private limpiarNivel(form: SavePermisoJefeRequest): SavePermisoJefeRequest {
    return {
      ...form,
      IdArea: form.Nivel === 'JEFE' ? form.IdArea : null,
      IdDepartamento: form.Nivel === 'ADMIN_DEPTO' || form.Nivel === 'SECRETARIA' ? form.IdDepartamento : null,
      IdEmpleado: form.Nivel === 'USUARIO' ? form.IdEmpleado : null,
    };
  }

  private createdMessage(form: SavePermisoJefeRequest): string {
    return form.Dominio === 1
      ? `Usuario creado. Entra con su usuario de dominio ${form.Usuario.trim()} y su contraseña de dominio.`
      : `Usuario creado. Entra con el usuario ${form.Usuario.trim()} y la contraseña 1234; se le pedirá cambiarla.`;
  }

  // Tras guardar se recargan los usuarios y se avisa al panel para que actualice la sesión.
  private run(request: Observable<void>, success: string, closeOnSuccess: boolean): void {
    this.isSaving = true;
    request.pipe(
      finalize(() => { this.isSaving = false; this.changeDetector.markForCheck(); })
    ).subscribe({
      next: () => {
        if (closeOnSuccess) this.closeWindow();
        this.message = success;
        this.loadJefes();
        this.changed.emit();
      },
      error: (error) => { this.errorMessage = apiErrorMessage(error, 'No se pudieron guardar los cambios.'); },
    });
  }

  private clearMessages(): void {
    this.message = '';
    this.errorMessage = '';
  }
}
