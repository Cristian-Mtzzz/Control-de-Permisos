import { ChangeDetectorRef, Component, inject, input, output } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Observable, finalize } from 'rxjs';
import { apiErrorMessage } from '../shared/api-response';
import { SearchableSelectDirective } from '../shared/searchable-select.directive';
import { PagePipe, TablePageSizeComponent, TablePaginatorComponent } from '../shared/table-paginator';
import { PermisoArea, PermisoEmpleado, PermisoSesion } from './permisos.models';
import { PermisosService } from './permisos.service';

// Filtro de área del administrador: 0 = todas, -1 = sin área, otro valor = esa área.
const SIN_AREA = -1;

@Component({
  selector: 'app-permisos-personal',
  imports: [FormsModule, SearchableSelectDirective, PagePipe, TablePageSizeComponent, TablePaginatorComponent],
  templateUrl: './permisos-personal.component.html',
  styleUrls: ['../shared/panel.css', './permisos.component.css'],
})
// Personal de cada área. El jefe ve a su gente, agrega empleados de su departamento que todavía
// no tienen área y quita a quien sale; los administradores ven a todos los de su alcance y los
// mueven entre las áreas del departamento de cada empleado.
export class PermisosPersonalComponent {
  private readonly permisosService = inject(PermisosService);
  private readonly changeDetector = inject(ChangeDetectorRef);

  readonly sesion = input.required<PermisoSesion>();
  readonly empleados = input.required<PermisoEmpleado[]>();
  // Avisa al panel para que vuelva a cargar empleados y conteos de las áreas.
  readonly changed = output<void>();

  readonly sinArea = SIN_AREA;
  searchTerm = '';
  // Filtro de departamento del administrador general (0 = todos).
  deptoFilter = 0;
  areaFilter = 0;
  page = 1;
  pageSize = 25;
  nuevoEmpleadoId = 0;
  isSaving = false;
  message = '';
  errorMessage = '';

  // Administrador general o de departamento (la consulta no entra a esta sección).
  get administra(): boolean { return this.sesion().Nivel !== 'JEFE'; }

  get variosDepartamentos(): boolean { return this.sesion().Departamentos.length > 1; }

  // Áreas del filtro: las del departamento elegido (o todas).
  get areasFiltro(): PermisoArea[] {
    const areas = this.sesion().Areas;
    return this.deptoFilter > 0 ? areas.filter((area) => area.IdDepartamento === this.deptoFilter) : areas;
  }

  // Un empleado solo puede ir a áreas activas de su propio departamento.
  areasDe(empleado: PermisoEmpleado): PermisoArea[] {
    return this.sesion().Areas.filter((area) => area.Estado === 'ACTIVO' && area.IdDepartamento === empleado.IdDepartamento);
  }

  departamentoNombre(idDepartamento: number): string {
    return this.sesion().Departamentos.find((departamento) => departamento.IdDepartamento === idDepartamento)?.Nombre ?? '-';
  }

  get miPersonal(): PermisoEmpleado[] {
    return this.empleados().filter((empleado) => empleado.IdArea === this.sesion().IdArea);
  }

  get disponibles(): PermisoEmpleado[] {
    return this.empleados().filter((empleado) => empleado.IdArea === null);
  }

  // Lista del administrador con búsqueda y filtros de departamento y área.
  get filtrados(): PermisoEmpleado[] {
    const term = this.searchTerm.trim().toUpperCase();
    return this.empleados().filter((empleado) =>
      (this.deptoFilter === 0 || empleado.IdDepartamento === this.deptoFilter)
      && (this.areaFilter === 0
        || (this.areaFilter === SIN_AREA ? empleado.IdArea === null : empleado.IdArea === this.areaFilter))
      && (!term || empleado.NombreCompleto.toUpperCase().includes(term) || (empleado.NoPago ?? '').includes(term)));
  }

  updateFilter(): void {
    this.page = 1;
  }

  updateDepto(): void {
    if (this.areaFilter > 0 && !this.areasFiltro.some((area) => area.IdArea === this.areaFilter)) this.areaFilter = 0;
    this.updateFilter();
  }

  agregar(): void {
    const idArea = this.sesion().IdArea;
    if (this.nuevoEmpleadoId <= 0 || idArea === null) {
      this.errorMessage = 'Selecciona el empleado que quieres agregar.';
      return;
    }
    const nombre = this.empleados().find((empleado) => empleado.IdEmpleado === this.nuevoEmpleadoId)?.NombreCompleto;
    this.run(this.permisosService.asignarArea(this.nuevoEmpleadoId, idArea), `${nombre} se agregó a tu área.`);
    this.nuevoEmpleadoId = 0;
  }

  quitar(empleado: PermisoEmpleado): void {
    this.run(this.permisosService.quitarArea(empleado.IdEmpleado), `${empleado.NombreCompleto} salió del área.`);
  }

  // Cambio de área desde la tabla del administrador; "Sin área" lo saca de la que tenía.
  cambiarArea(empleado: PermisoEmpleado, idArea: number): void {
    if (idArea === (empleado.IdArea ?? 0)) return;
    const area = this.sesion().Areas.find((item) => item.IdArea === idArea)?.Nombre;
    this.run(
      idArea === 0 ? this.permisosService.quitarArea(empleado.IdEmpleado) : this.permisosService.asignarArea(empleado.IdEmpleado, idArea),
      idArea === 0 ? `${empleado.NombreCompleto} quedó sin área.` : `${empleado.NombreCompleto} pasó al área ${area}.`);
  }

  // Tras guardar (o fallar) se recarga la lista, para que el selector muestre lo que quedó en la base.
  private run(request: Observable<void>, success: string): void {
    this.message = '';
    this.errorMessage = '';
    this.isSaving = true;
    request.pipe(
      finalize(() => { this.isSaving = false; this.changed.emit(); this.changeDetector.markForCheck(); })
    ).subscribe({
      next: () => { this.message = success; },
      error: (error) => { this.errorMessage = apiErrorMessage(error, 'No se pudo actualizar el personal.'); },
    });
  }
}
