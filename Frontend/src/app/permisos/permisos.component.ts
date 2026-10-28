import { ChangeDetectorRef, Component, DestroyRef, inject } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { Observable, finalize, firstValueFrom } from 'rxjs';
import { AuthService } from '../auth/auth.service';
import { AppHeaderComponent } from '../shared/app-header.component';
import { apiErrorMessage } from '../shared/api-response';
import { SearchableSelectDirective } from '../shared/searchable-select.directive';
import { MayusculasDirective } from '../shared/mayusculas.directive';
import { PagePipe, TablePageSizeComponent, TablePaginatorComponent } from '../shared/table-paginator';
import {
  JORNADA_POR_DEFECTO, PERMISO_TIPOS, Permiso, PermisoArea, PermisoDepartamento, PermisoEmpleado, PermisoJornada,
  PermisoSesion, PermisoTipo, SavePermisoDiaRequest, SavePermisoHoraRequest,
} from './permisos.models';
import { PermisosService } from './permisos.service';
import { PermisoReportFilters, emptyPermisoReportFilters, exportPermisosReport, filterPermisosForReport, tipoLabel } from './permisos-report';
import {
  ConsumoEmpleado, PERMISO_ESTADOS, PermisoEstadoVista, ResumenEmpleado, apiDay, consumoEmpleado, consumoTexto, dayKey,
  estadoVista, formatDay, formatMinutes, formatNumber, isActive, minutesBetween, monthRange, overlaps, weekRange,
  weekdaysBetween,
} from './permisos-resumen';
import { PermisosPersonalComponent } from './permisos-personal.component';
import { PermisosAreasComponent } from './permisos-areas.component';
import { imprimirConstancia } from './permisos-constancia';

// 'permiso': un solo formulario; el tipo elegido decide qué datos se piden.
// 'historial': todos los permisos de un empleado con sus totales.
type PermisoWindow = 'none' | 'permiso' | 'anular' | 'report' | 'historial';
type PermisoTab = 'panel' | 'personal' | 'areas';

const today = (): string => dayKey(new Date());
// El panel carga los permisos que terminan desde el 1 de enero del año anterior: alcanza para los
// indicadores y los totales del mes y del año. Los anteriores se piden al filtrar por fecha, y el
// historial de un empleado y el reporte los traen completos de la API.
const inicioCarga = (): string => `${new Date().getFullYear() - 1}-01-01`;
const emptyDia = (): SavePermisoDiaRequest => ({
  IdEmpleado: 0, Motivo: '', FechaInicio: '', FechaFin: '', FechaSolicitud: today(),
});
const emptyHora = (): SavePermisoHoraRequest => ({
  IdEmpleado: 0, Motivo: '', Fecha: '', HoraSalida: '', HoraEntrada: '',
});

@Component({
  selector: 'app-permisos',
  imports: [
    FormsModule, AppHeaderComponent, SearchableSelectDirective, MayusculasDirective, PagePipe, TablePageSizeComponent, TablePaginatorComponent,
    PermisosPersonalComponent, PermisosAreasComponent,
  ],
  templateUrl: './permisos.component.html',
  // Reusa los estilos del taller (tarjeta, tabla, modales y botones) para que se vea igual
  // que el resto del sistema; permisos.component.css solo agrega lo propio de esta pantalla.
  styleUrls: ['../shared/panel.css', './permisos.component.css'],
})
// Control de permisos (/permisos). Es un sistema aparte del inventario, organizado por
// departamento y área: el jefe ve su área, el administrador de departamento su departamento
// (con filtro de área), y el administrador general y la consulta todo (con filtro de
// departamento y área). La consulta solo ve y exporta.
export class PermisosComponent {
  private readonly permisosService = inject(PermisosService);
  private readonly authService = inject(AuthService);
  private readonly router = inject(Router);
  private readonly changeDetector = inject(ChangeDetectorRef);

  sesion: PermisoSesion | null = null;
  tab: PermisoTab = 'panel';
  // Filtros de quien ve más de un área (0 = todos). El jefe siempre ve solo la suya.
  deptoFilter = 0;
  areaFilter = 0;

  permisos: Permiso[] = [];
  // Fecha (yyyy-mm-dd) desde la que están cargados los permisos de la pantalla.
  cargadoDesde = inicioCarga();
  // Número de la última carga pedida: una respuesta anterior que llegue tarde se descarta.
  private permisosRequest = 0;
  empleados: PermisoEmpleado[] = [];

  isLoading = false;
  isSaving = false;
  isExporting = false;
  message = '';
  errorMessage = '';

  // Filtros de la tabla de permisos.
  searchTerm = '';
  tipoFilter = '';
  // '' = todos. Activo, finalizado o anulado según estadoVista.
  estadoFilter: PermisoEstadoVista | '' = '';
  // Rango de fechas yyyy-mm-dd: entra todo permiso que toque algún día del rango. Vacío = sin límite.
  fechaDesde = '';
  fechaHasta = '';
  permisoPage = 1;
  permisoPageSize = 10;

  readonly tipos = PERMISO_TIPOS;
  readonly estados = PERMISO_ESTADOS;

  // Hora actual para marcar los permisos que ya terminaron; se actualiza cada 30 segundos.
  now = new Date();

  activeWindow: PermisoWindow = 'none';
  editingId: number | null = null;
  selectedPermiso: Permiso | null = null;
  formTipo: PermisoTipo = 'DIA';
  historialEmpleadoId = 0;
  // Historial completo del empleado traído de la API; null mientras llega.
  historialLista: Permiso[] | null = null;
  diaForm: SavePermisoDiaRequest = emptyDia();
  horaForm: SavePermisoHoraRequest = emptyHora();
  reportFilters: PermisoReportFilters = emptyPermisoReportFilters();

  readonly formatDay = formatDay;
  readonly formatMinutes = formatMinutes;
  readonly formatNumber = formatNumber;
  readonly consumoTexto = consumoTexto;
  readonly tipoLabel = tipoLabel;

  constructor() {
    this.loadAll();
    const timer = setInterval(() => {
      this.now = new Date();
      this.changeDetector.markForCheck();
    }, 30_000);
    inject(DestroyRef).onDestroy(() => clearInterval(timer));
  }

  // Estado que se muestra: el permiso activo cuyo fin ya pasó se ve como finalizado.
  estado(permiso: Permiso): PermisoEstadoVista {
    return estadoVista(permiso, this.now, this.jornada(permiso.IdDepartamento).HoraFinJornada);
  }

  // Para el reporte: el mismo estado de la tabla.
  private readonly estadoDe = (permiso: Permiso): PermisoEstadoVista => this.estado(permiso);
  // Jornada del departamento de cada permiso, para convertir horas en días.
  private readonly minutosDe = (permiso: Permiso): number => this.jornada(permiso.IdDepartamento).MinutosJornada;

  // ---- Nivel y alcance -----------------------------------------------------------------

  get nivel(): string { return this.sesion?.Nivel ?? ''; }
  // Administrador general: además de todo, maneja los departamentos.
  get esAdmin(): boolean { return this.nivel === 'ADMIN'; }
  // Ve más de un área: necesita filtros y la columna de área.
  get veVarias(): boolean { return this.nivel !== '' && this.nivel !== 'JEFE'; }
  // Ve todos los departamentos (general y consulta).
  get veTodo(): boolean { return this.nivel === 'ADMIN' || this.nivel === 'CONSULTA'; }
  get administra(): boolean { return this.nivel === 'ADMIN' || this.nivel === 'ADMIN_DEPTO'; }
  get soloLectura(): boolean { return this.nivel === 'CONSULTA'; }
  // Más de un departamento a la vista: se muestran su filtro y su columna.
  get variosDepartamentos(): boolean { return (this.sesion?.Departamentos.length ?? 0) > 1; }
  get muestraDepartamento(): boolean { return this.veTodo && this.variosDepartamentos && this.deptoFilter === 0; }
  // Columnas de la tabla de permisos, para el mensaje de tabla vacía.
  get columnas(): number { return 13 + (this.veVarias ? 1 : 0) + (this.muestraDepartamento ? 1 : 0); }

  // Editar y anular, como lo valida la API: solo los permisos registrados en el alcance del
  // usuario. El jefe y el de departamento también ven los que su personal tiene de otra área o
  // de antes (cuentan para sus choques y límites), pero no los modifican.
  puedeModificar(permiso: Permiso): boolean {
    if (this.soloLectura || !isActive(permiso)) return false;
    if (this.veTodo) return true;
    if (this.nivel === 'JEFE') return permiso.IdArea !== null && permiso.IdArea === this.sesion?.IdArea;
    return permiso.IdDepartamento !== null && permiso.IdDepartamento === this.sesion?.IdDepartamento;
  }

  // Departamentos con un parámetro mal escrito en la base: se avisa en lugar de dejar la pantalla sin cargar.
  get avisosParametros(): string[] {
    return (this.sesion?.Departamentos ?? [])
      .filter((departamento) => departamento.AvisoParametros)
      .map((departamento) => `${departamento.Nombre}: ${departamento.AvisoParametros}`);
  }

  // Tope de la fecha de solicitud: no puede ser una fecha que todavía no llega.
  get hoy(): string { return today(); }

  get moduleName(): string {
    switch (this.nivel) {
      case 'ADMIN': return 'Administración general';
      case 'CONSULTA': return 'Consulta';
      case 'ADMIN_DEPTO': return this.sesion?.NombreDepartamento ?? 'Administración de departamento';
      case 'JEFE': return `Área de ${this.sesion?.NombreArea}`;
      default: return 'Control de permisos';
    }
  }

  // Encabezado de la página: el departamento a la vista (o "Todos los departamentos").
  get departamentoTitulo(): string {
    if (!this.veTodo) return this.sesion?.NombreDepartamento ?? '';
    return this.departamentoNombre(this.deptoFilter) ?? (this.variosDepartamentos ? 'Todos los departamentos' : this.sesion?.Departamentos[0]?.Nombre ?? '');
  }

  get titulo(): string {
    if (this.nivel === 'JEFE') return `Permisos del área de ${this.sesion?.NombreArea}`;
    return this.areaFilter > 0 ? `Permisos del área de ${this.areaNombre(this.areaFilter)}` : 'Control de permisos';
  }

  // Áreas del filtro: las del departamento elegido (o todas las visibles).
  get areasFiltro(): PermisoArea[] {
    const areas = this.sesion?.Areas ?? [];
    return this.deptoFilter > 0 ? areas.filter((area) => area.IdDepartamento === this.deptoFilter) : areas;
  }

  updateDepto(): void {
    if (this.areaFilter > 0 && !this.areasFiltro.some((area) => area.IdArea === this.areaFilter)) this.areaFilter = 0;
    this.updateFilter();
  }

  // Departamento y área de la pantalla para el reporte; vacío = todo.
  get alcanceNombre(): string {
    if (this.nivel === 'JEFE') return `${this.sesion?.NombreDepartamento} · Área: ${this.sesion?.NombreArea}`;
    const departamento = this.veTodo ? this.departamentoNombre(this.deptoFilter) : this.sesion?.NombreDepartamento;
    const area = this.areaFilter > 0 ? `Área: ${this.areaNombre(this.areaFilter)}` : 'Todas las áreas';
    return departamento ? `${departamento} · ${area}` : (this.areaFilter > 0 ? area : '');
  }

  jornada(idDepartamento: number | null | undefined): PermisoJornada {
    return this.sesion?.Departamentos.find((departamento) => departamento.IdDepartamento === idDepartamento)
      ?? this.sesion?.Departamentos[0]
      ?? JORNADA_POR_DEFECTO;
  }

  private departamentoNombre(idDepartamento: number): string | undefined {
    return this.sesion?.Departamentos.find((departamento: PermisoDepartamento) => departamento.IdDepartamento === idDepartamento)?.Nombre;
  }

  private areaNombre(idArea: number): string | undefined {
    return this.sesion?.Areas.find((area) => area.IdArea === idArea)?.Nombre;
  }

  private departamentoEmpleado(idEmpleado: number): number | undefined {
    return this.empleados.find((empleado) => empleado.IdEmpleado === idEmpleado)?.IdDepartamento;
  }

  // ---- Indicadores ---------------------------------------------------------------------

  private get enAlcance(): Permiso[] { return this.filtrarAlcance(this.permisos); }

  // Permisos del departamento y el área elegidos en los filtros de la pantalla.
  private filtrarAlcance(permisos: Permiso[]): Permiso[] {
    return permisos.filter((permiso) =>
      (this.deptoFilter === 0 || permiso.IdDepartamento === this.deptoFilter)
      && (this.areaFilter === 0 || permiso.IdArea === this.areaFilter));
  }

  private get activos(): Permiso[] { return this.enAlcance.filter(isActive); }

  get totalActivos(): number { return this.activos.length; }

  // Permisos vigentes hoy: los por día que cubren la fecha y los por hora de hoy.
  get permisosHoy(): Permiso[] {
    const day = today();
    return this.activos.filter((permiso) => overlaps(permiso, day, day));
  }

  get permisosSemana(): number {
    const { desde, hasta } = weekRange(new Date());
    return this.activos.filter((permiso) => overlaps(permiso, desde, hasta)).length;
  }

  get permisosMes(): number {
    const { desde, hasta } = monthRange(new Date());
    return this.activos.filter((permiso) => overlaps(permiso, desde, hasta)).length;
  }

  // ---- Tabla ---------------------------------------------------------------------------

  get filteredPermisos(): Permiso[] {
    const term = this.searchTerm.trim().toUpperCase();
    return this.enAlcance.filter((permiso) =>
      (!this.tipoFilter || permiso.Tipo === this.tipoFilter)
      && (!this.estadoFilter || this.estado(permiso) === this.estadoFilter)
      && (!this.fechaDesde || apiDay(permiso.FechaFin) >= this.fechaDesde)
      && (!this.fechaHasta || apiDay(permiso.FechaInicio) <= this.fechaHasta)
      && (!term
        || permiso.Empleado.toUpperCase().includes(term)
        || permiso.Motivo.toUpperCase().includes(term)
        || (permiso.NoPago ?? '').includes(term)
        || String(permiso.IdPermiso) === term));
  }

  updateSearch(term: string): void {
    this.searchTerm = term;
    this.permisoPage = 1;
  }

  // Un "desde" anterior a lo cargado pide a la API los permisos que faltan.
  updateFilter(): void {
    this.permisoPage = 1;
    if (this.fechaDesde && this.fechaDesde < this.cargadoDesde) this.loadPermisos(this.fechaDesde);
  }

  get hayFiltroFechas(): boolean { return Boolean(this.fechaDesde || this.fechaHasta); }

  clearFechas(): void {
    this.fechaDesde = '';
    this.fechaHasta = '';
    this.permisoPage = 1;
  }

  // Abre el diálogo de impresión con la constancia del permiso para firmarla.
  imprimir(permiso: Permiso): void {
    imprimirConstancia(permiso);
  }

  // ---- Historial por empleado ----------------------------------------------------------

  // Mientras llega el historial completo se muestran los permisos ya cargados del empleado.
  openHistorial(idEmpleado: number): void {
    this.clearMessages();
    this.historialEmpleadoId = idEmpleado;
    this.historialLista = null;
    this.activeWindow = 'historial';
    this.permisosService.getPermisos({ idEmpleado }).subscribe({
      next: (permisos) => {
        if (this.historialEmpleadoId === idEmpleado) this.historialLista = permisos;
        this.changeDetector.markForCheck();
      },
      // Si falla, se queda con los permisos ya cargados para no dejar la ventana en "Cargando".
      error: (error) => {
        if (this.historialEmpleadoId === idEmpleado) {
          this.historialLista = this.permisos.filter((permiso) => permiso.IdEmpleado === idEmpleado);
        }
        this.errorMessage = apiErrorMessage(error, 'No se pudo cargar el historial completo del empleado.');
        this.changeDetector.markForCheck();
      },
    });
  }

  get historialCargando(): boolean { return this.activeWindow === 'historial' && this.historialLista === null; }

  // Todos los permisos del empleado que ve el usuario, del más reciente al más antiguo.
  get historialPermisos(): Permiso[] {
    return this.historialLista ?? this.permisos.filter((permiso) => permiso.IdEmpleado === this.historialEmpleadoId);
  }

  get historialEmpleado(): { Nombre: string; NoPago: string | null; Area: string | null; Departamento: string | null } {
    const empleado = this.empleados.find((item) => item.IdEmpleado === this.historialEmpleadoId);
    const ultimo = this.historialPermisos[0];
    return {
      Nombre: empleado?.NombreCompleto ?? ultimo?.Empleado ?? '',
      NoPago: empleado?.NoPago ?? ultimo?.NoPago ?? null,
      Area: empleado?.NombreArea ?? ultimo?.NombreArea ?? null,
      Departamento: (empleado ? this.departamentoNombre(empleado.IdDepartamento) : undefined) ?? ultimo?.NombreDepartamento ?? null,
    };
  }

  // Jornada del departamento del empleado del historial.
  get historialJornada(): PermisoJornada {
    return this.jornada(this.departamentoEmpleado(this.historialEmpleadoId) ?? this.historialPermisos[0]?.IdDepartamento);
  }

  get historialPeriodos(): { label: string; valor: ResumenEmpleado }[] {
    const consumo = consumoEmpleado(this.historialPermisos, this.historialEmpleadoId, this.now, this.minutosDe);
    return [
      { label: 'Este mes', valor: consumo.Mes },
      { label: 'Este año', valor: consumo.Anio },
      { label: 'Todo el historial', valor: consumo.Todo },
    ];
  }

  display(value: string | null): string { return value?.trim() ? value : '-'; }

  // Rango del permiso para la franja "Hoy": "hasta el 29/10/2026" o "10:00 a 12:00".
  hoyDetalle(permiso: Permiso): string {
    if (permiso.Tipo === 'HORA') return `${permiso.HoraSalida} a ${permiso.HoraEntrada}`;
    return apiDay(permiso.FechaFin) === today() ? 'todo el día' : `hasta el ${formatDay(permiso.FechaFin)}`;
  }

  // ---- Carga ---------------------------------------------------------------------------

  // Primero la sesión (nivel, departamentos con su jornada y áreas): si el usuario no tiene un
  // nivel vigente, la API lo dice y no se carga lo demás.
  private loadAll(): void {
    this.isLoading = true;
    this.permisosService.getSesion().subscribe({
      next: (sesion) => {
        this.sesion = sesion;
        this.authService.setNivel(sesion.Nivel);
        if (!this.administra && this.tab === 'areas') this.tab = 'panel';
        if (this.soloLectura && this.tab === 'personal') this.tab = 'panel';
        this.loadPermisos();
        this.loadEmpleados();
      },
      error: (error) => {
        this.isLoading = false;
        this.errorMessage = apiErrorMessage(error, 'No se pudo cargar tu información de permisos.');
        this.changeDetector.markForCheck();
      },
    });
  }

  // Carga los permisos que terminan desde la fecha indicada (por defecto, lo ya cargado).
  loadPermisos(desde = this.cargadoDesde): void {
    const request = ++this.permisosRequest;
    this.isLoading = true;
    this.permisosService.getPermisos({ desde }).pipe(
      finalize(() => {
        if (request === this.permisosRequest) this.isLoading = false;
        this.changeDetector.markForCheck();
      })
    ).subscribe({
      next: (permisos) => {
        if (request !== this.permisosRequest) return;
        this.permisos = permisos;
        this.cargadoDesde = desde;
      },
      error: (error) => { this.errorMessage = apiErrorMessage(error, 'No se pudieron cargar los permisos.'); },
    });
  }

  // Los errores conservan el mensaje de la API: si falta un parámetro en la base, el
  // motivo se ve en pantalla en lugar de dejar el selector vacío.
  loadEmpleados(): void {
    this.permisosService.getEmpleados().subscribe({
      next: (empleados) => { this.empleados = empleados; this.changeDetector.markForCheck(); },
      error: (error) => {
        this.errorMessage = apiErrorMessage(error, 'No se pudieron cargar los empleados.');
        this.changeDetector.markForCheck();
      },
    });
  }

  // Al cambiar áreas o jefes cambian los conteos y los nombres de la sesión.
  reloadSesion(): void {
    this.permisosService.getSesion().subscribe({
      next: (sesion) => {
        this.sesion = sesion;
        this.authService.setNivel(sesion.Nivel);
        this.changeDetector.markForCheck();
      },
      error: (error) => {
        this.errorMessage = apiErrorMessage(error, 'No se pudo actualizar la información de áreas.');
        this.changeDetector.markForCheck();
      },
    });
  }

  onPersonalChanged(): void {
    this.loadEmpleados();
    this.reloadSesion();
  }

  // ---- Formularios ---------------------------------------------------------------------

  openNewWindow(): void {
    this.clearMessages();
    this.editingId = null;
    this.formTipo = 'DIA';
    this.diaForm = emptyDia();
    this.horaForm = emptyHora();
    this.activeWindow = 'permiso';
  }

  // Al editar también se puede cambiar el tipo: el otro formulario empieza con la misma fecha.
  openEditWindow(permiso: Permiso): void {
    if (!this.puedeModificar(permiso)) return;
    this.clearMessages();
    this.editingId = permiso.IdPermiso;
    this.formTipo = permiso.Tipo;
    this.diaForm = permiso.Tipo !== 'DIA' ? emptyDia() : {
      IdEmpleado: permiso.IdEmpleado,
      Motivo: permiso.Motivo,
      FechaInicio: apiDay(permiso.FechaInicio),
      FechaFin: apiDay(permiso.FechaFin),
      FechaSolicitud: apiDay(permiso.FechaSolicitud) || today(),
    };
    this.horaForm = permiso.Tipo !== 'HORA' ? emptyHora() : {
      IdEmpleado: permiso.IdEmpleado,
      Motivo: permiso.Motivo,
      Fecha: apiDay(permiso.FechaInicio),
      HoraSalida: permiso.HoraSalida ?? '',
      HoraEntrada: permiso.HoraEntrada ?? '',
    };
    this.activeWindow = 'permiso';
  }

  // Empleado y motivo son comunes: se guardan en el formulario del tipo elegido.
  get comunForm(): { IdEmpleado: number; Motivo: string } {
    return this.formTipo === 'DIA' ? this.diaForm : this.horaForm;
  }

  // Al cambiar de tipo se conservan el empleado, el motivo y la fecha ya escritos: la fecha del
  // permiso por hora pasa a ser el rango del de día, y la primera fecha del de día, la del de hora.
  changeTipo(tipo: PermisoTipo): void {
    if (tipo === this.formTipo) return;
    const { IdEmpleado, Motivo } = this.comunForm;
    if (tipo === 'DIA' && this.horaForm.Fecha && !this.diaForm.FechaInicio) {
      this.diaForm.FechaInicio = this.horaForm.Fecha;
      this.diaForm.FechaFin = this.horaForm.Fecha;
    }
    if (tipo === 'HORA' && this.diaForm.FechaInicio && !this.horaForm.Fecha) this.horaForm.Fecha = this.diaForm.FechaInicio;
    this.formTipo = tipo;
    Object.assign(this.comunForm, { IdEmpleado, Motivo });
    this.errorMessage = '';
  }

  savePermiso(): void {
    if (this.formTipo === 'DIA') this.saveDia();
    else this.saveHora();
  }

  openAnularWindow(permiso: Permiso): void {
    if (!this.puedeModificar(permiso)) return;
    this.clearMessages();
    this.selectedPermiso = permiso;
    this.activeWindow = 'anular';
  }

  // Al elegir la fecha inicial, la final la acompaña si estaba vacía o quedó antes.
  syncFechaFin(): void {
    if (!this.diaForm.FechaFin || this.diaForm.FechaFin < this.diaForm.FechaInicio) {
      this.diaForm.FechaFin = this.diaForm.FechaInicio;
    }
  }

  // Vista previa: días hábiles del rango con los feriados del departamento del empleado.
  get diaPreview(): number {
    return weekdaysBetween(this.diaForm.FechaInicio, this.diaForm.FechaFin, this.jornadaForm.Feriados);
  }

  get horaPreview(): number { return minutesBetween(this.horaForm.HoraSalida, this.horaForm.HoraEntrada); }

  // Jornada del departamento del empleado elegido; sin empleado, la del departamento a la vista.
  get jornadaForm(): PermisoJornada {
    const idEmpleado = this.comunForm.IdEmpleado;
    const permiso = this.permisos.find((item) => item.IdPermiso === this.editingId);
    return this.jornada(this.departamentoEmpleado(idEmpleado)
      ?? (permiso?.IdEmpleado === idEmpleado ? permiso.IdDepartamento : null)
      ?? (this.deptoFilter || this.sesion?.IdDepartamento));
  }

  // Lo que ya lleva el empleado elegido, sin contar el permiso que se edita.
  get consumoForm(): ConsumoEmpleado | null {
    const idEmpleado = this.comunForm.IdEmpleado;
    if (idEmpleado <= 0) return null;
    return consumoEmpleado(this.permisos, idEmpleado, this.now, this.minutosDe, this.editingId);
  }

  // Empleados a los que se les puede registrar un permiso: los que tienen área, dentro de los
  // filtros de departamento y área de la pantalla (el jefe solo recibe los de su área). Al
  // editar se agrega el empleado del permiso aunque ya no esté en el área, para que el
  // selector lo muestre.
  get empleadosForm(): PermisoEmpleado[] {
    const areaId = this.nivel === 'JEFE' ? this.sesion?.IdArea ?? 0 : this.areaFilter;
    const disponibles = this.empleados.filter((empleado) =>
      empleado.IdArea !== null
      && (areaId === 0 || empleado.IdArea === areaId)
      && (this.deptoFilter === 0 || empleado.IdDepartamento === this.deptoFilter));
    const permiso = this.permisos.find((item) => item.IdPermiso === this.editingId);
    if (!permiso || disponibles.some((empleado) => empleado.IdEmpleado === permiso.IdEmpleado)) return disponibles;
    return [{
      IdEmpleado: permiso.IdEmpleado, NombreCompleto: permiso.Empleado, NoPago: permiso.NoPago,
      IdDepartamento: permiso.IdDepartamento ?? 0, IdArea: permiso.IdArea, NombreArea: permiso.NombreArea,
    }, ...disponibles];
  }

  // Quien ve varias áreas las ve junto al nombre (y el departamento si hay varios) para no
  // confundir empleados.
  empleadoLabel(empleado: PermisoEmpleado): string {
    if (!this.veVarias) return empleado.NombreCompleto;
    const partes: (string | null | undefined)[] = [empleado.NombreCompleto, empleado.NombreArea];
    if (this.variosDepartamentos && this.deptoFilter === 0) partes.push(this.departamentoNombre(empleado.IdDepartamento));
    return partes.filter(Boolean).join(' · ');
  }

  private saveDia(): void {
    this.clearMessages();
    const form = this.diaForm;
    if (form.IdEmpleado <= 0 || !form.Motivo.trim()) {
      this.errorMessage = 'Selecciona el empleado y escribe el motivo del permiso.';
      return;
    }
    if (!form.FechaInicio || !form.FechaFin) {
      this.errorMessage = 'Indica la fecha inicial y la fecha final.';
      return;
    }
    if (form.FechaFin < form.FechaInicio) {
      this.errorMessage = 'La fecha final no puede ser anterior a la fecha inicial.';
      return;
    }
    if (!form.FechaSolicitud) {
      this.errorMessage = 'Indica la fecha en que se hizo la solicitud.';
      return;
    }
    if (form.FechaSolicitud > today()) {
      this.errorMessage = 'La fecha de solicitud no puede ser posterior a hoy.';
      return;
    }

    this.save(this.permisosService.savePermisoDia(this.editingId, { ...form, Motivo: form.Motivo.trim().toLocaleUpperCase('es') }));
  }

  private saveHora(): void {
    this.clearMessages();
    const form = this.horaForm;
    const { HoraInicioJornada: inicio, HoraFinJornada: fin, Feriados: feriados } = this.jornadaForm;
    if (form.IdEmpleado <= 0 || !form.Motivo.trim()) {
      this.errorMessage = 'Selecciona el empleado y escribe el motivo del permiso.';
      return;
    }
    if (!form.Fecha || !form.HoraSalida || !form.HoraEntrada) {
      this.errorMessage = 'Indica la fecha, la hora de salida y la hora de entrada.';
      return;
    }
    if (weekdaysBetween(form.Fecha, form.Fecha, feriados) === 0) {
      this.errorMessage = 'La fecha del permiso no es un día hábil.';
      return;
    }
    if (form.HoraSalida < inicio || form.HoraEntrada > fin) {
      this.errorMessage = `Las horas deben estar dentro de la jornada laboral, de ${inicio} a ${fin}.`;
      return;
    }
    if (form.HoraEntrada <= form.HoraSalida) {
      this.errorMessage = 'La hora de entrada debe ser posterior a la hora de salida.';
      return;
    }

    this.save(this.permisosService.savePermisoHora(this.editingId, { ...form, Motivo: form.Motivo.trim().toLocaleUpperCase('es') }));
  }

  private save(request: Observable<void>): void {
    const editing = this.editingId !== null;
    this.isSaving = true;
    request.pipe(
      finalize(() => { this.isSaving = false; this.changeDetector.markForCheck(); })
    ).subscribe({
      next: () => {
        this.closeWindow();
        this.message = editing ? 'Permiso actualizado.' : 'Permiso registrado.';
        this.loadPermisos();
      },
      error: (error) => { this.errorMessage = apiErrorMessage(error, 'No se pudo guardar el permiso.'); },
    });
  }

  confirmAnular(): void {
    if (!this.selectedPermiso) return;
    this.clearMessages();
    this.isSaving = true;
    this.permisosService.anularPermiso(this.selectedPermiso.IdPermiso).pipe(
      finalize(() => { this.isSaving = false; this.changeDetector.markForCheck(); })
    ).subscribe({
      next: () => {
        this.closeWindow();
        this.message = 'Permiso anulado.';
        this.loadPermisos();
      },
      error: (error) => { this.errorMessage = apiErrorMessage(error, 'No se pudo anular el permiso.'); },
    });
  }

  // ---- Reporte -------------------------------------------------------------------------

  get reportCount(): number {
    return filterPermisosForReport(this.enAlcance, this.reportFilters, this.estadoDe).length;
  }

  // El conteo previo solo es exacto si el rango del reporte está dentro de lo cargado en pantalla.
  get reportCountExacto(): boolean {
    return Boolean(this.reportFilters.desde) && this.reportFilters.desde >= this.cargadoDesde;
  }

  openReportWindow(): void {
    this.clearMessages();
    this.reportFilters = emptyPermisoReportFilters();
    this.activeWindow = 'report';
  }

  // Pide a la API los permisos del rango (todo el historial si no hay "desde"), con datos al día,
  // aplica los filtros y descarga el Excel.
  async exportReport(): Promise<void> {
    this.clearMessages();
    if (this.reportFilters.desde && this.reportFilters.hasta && this.reportFilters.desde > this.reportFilters.hasta) {
      this.errorMessage = 'La fecha "desde" no puede ser posterior a la fecha "hasta".';
      return;
    }
    this.isExporting = true;
    try {
      const { desde, idEmpleado } = this.reportFilters;
      const delRango = await firstValueFrom(this.permisosService.getPermisos({ desde, idEmpleado }));
      const permisos = filterPermisosForReport(this.filtrarAlcance(delRango), this.reportFilters, this.estadoDe);
      const employee = this.empleados.find((item) => item.IdEmpleado === this.reportFilters.idEmpleado)?.NombreCompleto ?? '';
      await exportPermisosReport(permisos, this.reportFilters, employee, this.minutosDe, this.alcanceNombre, this.estadoDe);
      this.closeWindow();
      this.message = `Reporte de permisos exportado: ${permisos.length} permisos.`;
    } catch (error) {
      this.errorMessage = error instanceof HttpErrorResponse
        ? apiErrorMessage(error, 'No se pudieron cargar los permisos para el reporte.')
        : 'No se pudo generar el archivo de Excel.';
    } finally {
      this.isExporting = false;
      this.changeDetector.markForCheck();
    }
  }

  // ---- General -------------------------------------------------------------------------

  selectTab(tab: PermisoTab): void {
    this.clearMessages();
    this.tab = tab;
  }

  closeWindow(): void {
    this.activeWindow = 'none';
    this.editingId = null;
    this.selectedPermiso = null;
  }

  refreshPanel(): void {
    this.clearMessages();
    this.loadAll();
  }

  logout(): void {
    this.authService.logout();
    this.router.navigateByUrl('/login');
  }

  private clearMessages(): void {
    this.message = '';
    this.errorMessage = '';
  }
}
