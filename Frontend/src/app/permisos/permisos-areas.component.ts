import { ChangeDetectorRef, Component, inject, input, output } from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Observable, finalize } from 'rxjs';
import { apiErrorMessage } from '../shared/api-response';
import { SearchableSelectDirective } from '../shared/searchable-select.directive';
import { MayusculasDirective } from '../shared/mayusculas.directive';
import {
  PERMISO_DOMINIOS, PERMISO_NIVELES, PermisoArea, PermisoDepartamento, PermisoDepartamentoDisponible, PermisoEmpleado,
  PermisoJefe, PermisoNivel, PermisoSesion, PermisoUsuarioInventario, SavePermisoJefeRequest, nivelLabel,
} from './permisos.models';
import { PermisosService } from './permisos.service';
import { OpcionFiltro, edificiosDe, filtrarDisponibles, regionalesDe } from './departamentos-disponibles';

// 'acceso': dar o cambiar el acceso de una cuenta de inventario (solo nivel, departamento y área).
type AreasWindow = 'none' | 'departamento' | 'area' | 'jefe' | 'acceso';

// Los usuarios nuevos son locales por defecto: entran con 1234 y se les pide cambiarla. Uno de
// dominio entra con su contraseña de Active Directory, así que debe existir allá.
const emptyJefe = (): SavePermisoJefeRequest => ({
  Usuario: '', NombrePersona: '', Nivel: 'JEFE', IdDepartamento: null, IdArea: null, Dominio: 0, DominioP: 'BA', Estado: null,
});

@Component({
  selector: 'app-permisos-areas',
  imports: [FormsModule, NgTemplateOutlet, SearchableSelectDirective, MayusculasDirective],
  templateUrl: './permisos-areas.component.html',
  styleUrls: ['../shared/panel.css', './permisos.component.css'],
})
// Administración del Control de permisos. El administrador general maneja los departamentos
// que usan el sistema, sus áreas y todos los usuarios con cualquier nivel; el administrador de
// departamento, las áreas de su departamento y sus jefes.
export class PermisosAreasComponent {
  private readonly permisosService = inject(PermisosService);
  private readonly changeDetector = inject(ChangeDetectorRef);

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
  // Filtros de la lista de empleados del usuario nuevo: departamento (0 = todos) y área
  // (0 = todas, -1 = sin área).
  jefeDeptoFiltro = 0;
  jefeAreaFiltro = 0;
  readonly sinArea = -1;
  // El usuario que se edita ya es administrador general: es el único que conserva ese nivel.
  private editandoAdmin = false;

  // Cuentas de inventario sin acceso, para "Dar acceso a usuario de inventario". El general
  // elige de la lista; el de departamento escribe el usuario exacto y se busca.
  usuariosInventario: PermisoUsuarioInventario[] = [];
  accesoUsuarioId = 0;
  accesoBusqueda = '';

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

  // El administrador de departamento solo nombra jefes; el general, cualquier nivel menos el
  // suyo: hay un solo administrador general y la API no deja asignarlo a nadie más.
  get niveles(): { value: PermisoNivel; label: string }[] {
    if (!this.esAdmin) return PERMISO_NIVELES.filter((nivel) => nivel.value === 'JEFE');
    return PERMISO_NIVELES.filter((nivel) => nivel.value !== 'ADMIN' || this.editandoAdmin);
  }

  // Áreas activas de un departamento (ninguna si no hay departamento).
  areasDe(idDepartamento: number | null): PermisoArea[] {
    return idDepartamento ? this.areasActivas.filter((area) => area.IdDepartamento === idDepartamento) : [];
  }

  // Áreas del filtro de empleados: las del departamento filtrado, o todas.
  get areasFiltroEmpleado(): PermisoArea[] {
    return this.jefeDeptoFiltro ? this.areasDe(this.jefeDeptoFiltro) : this.areasActivas;
  }

  // Empleados para el usuario nuevo, filtrados por su departamento y su área.
  get empleadosJefe(): PermisoEmpleado[] {
    return this.empleados().filter((empleado) =>
      (this.jefeDeptoFiltro === 0 || empleado.IdDepartamento === this.jefeDeptoFiltro)
      && (this.jefeAreaFiltro === 0
        || (this.jefeAreaFiltro === this.sinArea ? empleado.IdArea === null : empleado.IdArea === this.jefeAreaFiltro)));
  }

  // Al cambiar un filtro se quitan el área filtrada y el empleado elegido si ya no están en la lista.
  cambiarFiltroEmpleado(): void {
    if (this.jefeAreaFiltro > 0 && !this.areasFiltroEmpleado.some((area) => area.IdArea === this.jefeAreaFiltro)) {
      this.jefeAreaFiltro = 0;
    }
    if (!this.empleadosJefe.some((empleado) => empleado.IdEmpleado === this.jefeEmpleadoId)) this.selectJefeEmpleado(0);
  }

  // El jefe se asigna primero a un departamento y después a una de sus áreas: es lo que define
  // qué personal ve (el de ese departamento).
  get areasJefe(): PermisoArea[] { return this.areasDe(this.jefeForm.IdDepartamento); }

  cambiarDepartamentoJefe(): void {
    if (this.jefeForm.IdArea !== null && !this.areasJefe.some((area) => area.IdArea === this.jefeForm.IdArea)) {
      this.jefeForm.IdArea = null;
    }
  }

  // Aviso si el empleado elegido es de otro departamento que el que se le asigna.
  get avisoDepartamento(): string | null {
    const empleado = this.empleados().find((item) => item.IdEmpleado === this.jefeEmpleadoId);
    const idDepartamento = this.jefeForm.IdDepartamento;
    if (!empleado || !idDepartamento || empleado.IdDepartamento === idDepartamento) return null;
    if (this.jefeForm.Nivel !== 'JEFE' && this.jefeForm.Nivel !== 'ADMIN_DEPTO') return null;
    return `${empleado.NombreCompleto} es empleado de ${this.departamentoNombre(empleado.IdDepartamento)}; `
      + `con este nivel verá al personal de ${this.departamentoNombre(idDepartamento)}.`;
  }

  // Lo mismo que valida la API: el general administra a todos; el de departamento, a los jefes
  // de las áreas de su departamento (y a las cuentas que todavía no tienen nivel).
  puedeAdministrar(jefe: PermisoJefe): boolean {
    if (this.esAdmin) return true;
    return jefe.Nivel === '' || (jefe.Nivel === 'JEFE' && jefe.IdDepartamento === this.sesion().IdDepartamento);
  }

  departamentoNombre(idDepartamento: number | null): string {
    return this.sesion().Departamentos.find((departamento) => departamento.IdDepartamento === idDepartamento)?.Nombre ?? '-';
  }

  // Con varios departamentos, el área se muestra con el suyo para no confundir "Soporte" de uno y otro.
  areaLabel(area: PermisoArea): string {
    return this.esAdmin && this.variosDepartamentos ? `${area.Nombre} · ${this.departamentoNombre(area.IdDepartamento)}` : area.Nombre;
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

  get edificios(): OpcionFiltro[] { return edificiosDe(this.departamentosDisponibles, this.regionalFiltro); }

  get departamentosFiltrados(): PermisoDepartamentoDisponible[] {
    return filtrarDisponibles(this.departamentosDisponibles, this.regionalFiltro, this.edificioFiltro);
  }

  // Sin regional elegida, el edificio lleva la suya para distinguir edificios con el mismo nombre.
  edificioLabel(edificio: OpcionFiltro): string {
    return this.regionalFiltro === 0 && edificio.Detalle ? `${edificio.Nombre} · ${edificio.Detalle}` : edificio.Nombre;
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

  // Las cuentas de inventario solo cambian nivel, departamento y área; lo demás se edita en inventario.
  openJefeWindow(jefe: PermisoJefe | null = null): void {
    if (jefe && !jefe.SoloPermisos) {
      this.openAccesoWindow(jefe);
      return;
    }
    this.clearMessages();
    this.editingJefeId = jefe?.IdUsuario ?? null;
    this.editandoAdmin = jefe?.Nivel === 'ADMIN';
    this.jefeEmpleadoId = 0;
    this.jefeDeptoFiltro = 0;
    this.jefeAreaFiltro = 0;
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
    };
    this.activeWindow = 'jefe';
  }

  // El nombre del usuario es el del empleado elegido (no se escribe a mano). Se proponen su
  // departamento y su área para el nivel; se pueden cambiar.
  selectJefeEmpleado(idEmpleado: number): void {
    this.jefeEmpleadoId = idEmpleado;
    const empleado = this.empleados().find((item) => item.IdEmpleado === idEmpleado);
    this.jefeForm.NombrePersona = empleado?.NombreCompleto ?? '';
    if (empleado && this.departamentosActivos.some((departamento) => departamento.IdDepartamento === empleado.IdDepartamento)) {
      this.jefeForm.IdDepartamento = empleado.IdDepartamento;
      this.jefeForm.IdArea = empleado.IdArea;
    }
  }

  saveJefe(): void {
    this.clearMessages();
    const form = this.jefeForm;
    if (!form.NombrePersona.trim()) {
      this.errorMessage = 'Selecciona al empleado.';
      return;
    }
    if (!form.Usuario.trim()) {
      this.errorMessage = 'Escribe el usuario.';
      return;
    }
    if (this.nivelIncompleto(form)) return;
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

  // Sin jefe: dar acceso a una cuenta de inventario que no lo tiene. Con jefe: cambiar su acceso.
  openAccesoWindow(jefe: PermisoJefe | null = null): void {
    this.clearMessages();
    this.editingJefeId = jefe?.IdUsuario ?? null;
    this.editandoAdmin = jefe?.Nivel === 'ADMIN';
    this.jefeEmpleadoId = 0;
    this.accesoUsuarioId = 0;
    this.accesoBusqueda = '';
    this.usuariosInventario = [];
    this.jefeForm = jefe === null ? this.nuevoJefe() : {
      Usuario: jefe.Usuario, NombrePersona: jefe.NombrePersona || jefe.Usuario, Nivel: jefe.Nivel || 'JEFE',
      IdDepartamento: this.departamentoDelNivel(jefe), IdArea: jefe.IdArea,
      Dominio: jefe.Dominio, DominioP: jefe.DominioP || 'BA', Estado: null,
    };
    if (jefe === null && this.esAdmin) {
      this.permisosService.getUsuariosInventario().subscribe({
        next: (usuarios) => { this.usuariosInventario = usuarios; this.changeDetector.markForCheck(); },
        error: (error) => {
          this.errorMessage = apiErrorMessage(error, 'No se pudieron cargar las cuentas de inventario.');
          this.changeDetector.markForCheck();
        },
      });
    }
    this.activeWindow = 'acceso';
  }

  // Administrador de departamento: busca la cuenta de inventario por su usuario exacto.
  buscarCuentaInventario(): void {
    this.clearMessages();
    this.accesoUsuarioId = 0;
    this.usuariosInventario = [];
    if (!this.accesoBusqueda.trim()) {
      this.errorMessage = 'Escribe el usuario de la cuenta de inventario.';
      return;
    }
    this.permisosService.getUsuariosInventario(this.accesoBusqueda).subscribe({
      next: (usuarios) => {
        this.usuariosInventario = usuarios;
        this.accesoUsuarioId = usuarios[0]?.IdUsuario ?? 0;
        if (usuarios.length === 0) {
          this.errorMessage = 'No hay una cuenta de inventario activa sin acceso a permisos con ese usuario.';
        }
        this.changeDetector.markForCheck();
      },
      error: (error) => {
        this.errorMessage = apiErrorMessage(error, 'No se pudo buscar la cuenta de inventario.');
        this.changeDetector.markForCheck();
      },
    });
  }

  saveAcceso(): void {
    this.clearMessages();
    const idUsuario = this.editingJefeId ?? this.accesoUsuarioId;
    const usuario = this.usuariosInventario.find((item) => item.IdUsuario === this.accesoUsuarioId);
    if (idUsuario <= 0) {
      this.errorMessage = 'Selecciona la cuenta de inventario.';
      return;
    }
    if (this.nivelIncompleto(this.jefeForm)) return;
    // La API solo aplica nivel, departamento y área a una cuenta de inventario; el resto va para
    // cumplir el formato del formulario de usuarios.
    const request: SavePermisoJefeRequest = this.editingJefeId === null && usuario
      ? { ...this.jefeForm, Usuario: usuario.Usuario, NombrePersona: usuario.NombrePersona || usuario.Usuario }
      : this.jefeForm;
    const nombre = request.NombrePersona;
    this.run(this.permisosService.saveJefe(idUsuario, this.limpiarNivel(request)),
      this.editingJefeId === null ? `${nombre} ya puede entrar al control de permisos con su misma cuenta.` : 'Acceso actualizado.',
      true);
  }

  quitarAcceso(jefe: PermisoJefe): void {
    this.clearMessages();
    this.run(this.permisosService.quitarAcceso(jefe.IdUsuario),
      `${jefe.NombrePersona} ya no tiene acceso al control de permisos. Su cuenta de inventario sigue igual.`, false);
  }

  resetPassword(jefe: PermisoJefe): void {
    this.clearMessages();
    this.run(this.permisosService.resetJefePassword(jefe.IdUsuario),
      `La contraseña de ${jefe.NombrePersona} quedó en 1234; se le pedirá cambiarla al entrar.`, false);
  }

  tipoCuenta(jefe: PermisoJefe): string {
    if (!jefe.SoloPermisos) return 'Cuenta de inventario';
    return jefe.Dominio === 1 ? `Dominio ${jefe.DominioP}` : 'Local';
  }

  // Lo que ve cada usuario según su nivel: un área, un departamento o todo.
  alcanceJefe(jefe: PermisoJefe): string {
    if (jefe.Nivel === 'JEFE') {
      return this.esAdmin && this.variosDepartamentos ? `${jefe.NombreArea} · ${jefe.NombreDepartamento}` : jefe.NombreArea ?? '-';
    }
    if (jefe.Nivel === 'ADMIN_DEPTO') return jefe.NombreDepartamento ?? '-';
    return jefe.Nivel ? 'Todos los departamentos' : '-';
  }

  closeWindow(): void {
    this.activeWindow = 'none';
    this.editingAreaId = null;
    this.editingJefeId = null;
  }

  // Usuario nuevo; con un solo departamento a la vista (el administrador de departamento), ya va en él.
  private nuevoJefe(): SavePermisoJefeRequest {
    const unico = this.departamentosActivos.length === 1 ? this.departamentosActivos[0].IdDepartamento : null;
    return { ...emptyJefe(), IdDepartamento: unico };
  }

  // Departamento del formulario: el que administra o el del área del jefe (solo para elegir su
  // área; al guardar, limpiarNivel lo envía solo para el administrador de departamento).
  private departamentoDelNivel(jefe: PermisoJefe): number | null {
    return jefe.Nivel === 'ADMIN_DEPTO' || jefe.Nivel === 'JEFE' ? jefe.IdDepartamento : null;
  }

  private nivelIncompleto(form: SavePermisoJefeRequest): boolean {
    if (form.Nivel === 'JEFE' && !form.IdArea) this.errorMessage = 'Selecciona el departamento y el área del jefe.';
    else if (form.Nivel === 'ADMIN_DEPTO' && !form.IdDepartamento) this.errorMessage = 'Selecciona el departamento que administra.';
    return this.errorMessage !== '';
  }

  // Solo se envía el dato que corresponde al nivel elegido.
  private limpiarNivel(form: SavePermisoJefeRequest): SavePermisoJefeRequest {
    return {
      ...form,
      IdArea: form.Nivel === 'JEFE' ? form.IdArea : null,
      IdDepartamento: form.Nivel === 'ADMIN_DEPTO' ? form.IdDepartamento : null,
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
