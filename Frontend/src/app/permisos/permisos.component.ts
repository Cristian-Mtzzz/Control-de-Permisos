import { ChangeDetectorRef, Component, DestroyRef, inject } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { Observable, finalize, firstValueFrom } from 'rxjs';
import { AuthService } from '../auth/auth.service';
import { AppSidebarComponent } from '../shared/app-sidebar.component';
import { apiErrorMessage } from '../shared/api-response';
import { SearchableSelectDirective } from '../shared/searchable-select.directive';
import { MayusculasDirective } from '../shared/mayusculas.directive';
import { PagePipe, TablePageSizeComponent, TablePaginatorComponent } from '../shared/table-paginator';
import {
  JORNADA_POR_DEFECTO, PERMISO_TIPOS, PeriodoVacacion, Permiso, PermisoArea, PermisoDepartamento, PermisoEmpleado, PermisoJornada,
  PermisoSesion, PermisoTipo, SavePermisoDiaRequest, SavePermisoHoraRequest, SaveVacacionRequest, TIPO_VACACIONES,
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
import { LogosImpresion, imprimirPermiso, logosParaImpresion } from './permiso-impresion';
import {
  MEMO_ASUNTO, MEMO_ASUNTO_VACACIONES, MemoDatos, descargarMemo, descargarMemoVacaciones, diasEnLetras, emptyMemo, filaMemo,
  nombrePropio, numeroMemo, olvidarEncabezadoMemo, permisosParaMemo, rangoVacaciones,
} from './memo-pdf';

// 'permiso': un solo formulario; el tipo elegido decide qué datos se piden.
// 'historial': todos los permisos de un empleado con sus totales. 'vacacion': alta o edición de vacaciones.
// 'memo': memorando de remisión de permisos en PDF.
type PermisoWindow = 'none' | 'permiso' | 'vacacion' | 'anular' | 'report' | 'historial' | 'memo';
// Valor del filtro de área para "Todas las áreas" del departamento elegido.
const TODAS_AREAS = -1;
type PermisoTab ='resumen' | 'permisos' | 'vacaciones' | 'personal' | 'areas';
// Qué muestra el resumen: los permisos o las vacaciones.
export type ResumenTipo = 'permisos' | 'vacaciones';
// Pestañas del resumen: quién tiene permiso hoy, esta semana, este mes, y todos los que siguen activos.
type ResumenVista = 'hoy' | 'semana' | 'mes' | 'activos';

// Permiso ubicado en la franja de hoy (porcentajes del ancho de la jornada).
export interface FranjaHoy { permiso: Permiso; inicio: number; ancho: number; detalle: string }
// Permiso ubicado en la semana: columnas de lunes (1) a domingo (7), ambas incluidas.
export interface FranjaSemana { permiso: Permiso; desde: number; hasta: number; detalle: string }

const DIAS_SEMANA = ['lun', 'mar', 'mié', 'jue', 'vie', 'sáb', 'dom'];
// Encabezado del calendario del mes (de domingo a sábado, como getDay).
const DIAS_CALENDARIO = ['DOM.', 'LUN.', 'MAR.', 'MIÉ.', 'JUE.', 'VIE.', 'SÁB.'];
// Casilla del calendario del mes: numero null es un día de otro mes (casilla gris).
export interface CeldaMes { key: string; numero: number | null; finDeSemana: boolean; hoy: boolean; vacaciones: Permiso[] }
// Colores de las vacaciones en el resumen: uno por empleado (texto y fondo), en este orden.
const COLORES_VACACIONES: { texto: string; fondo: string }[] = [
  { texto: '#8a5a10', fondo: '#fbf0da' },
  { texto: '#2b5797', fondo: '#e6edf8' },
  { texto: '#1d7a4f', fondo: '#e3f3ea' },
  { texto: '#6b3fa0', fondo: '#efe8f8' },
  { texto: '#b0463a', fondo: '#fbe9e6' },
  { texto: '#1c7c6e', fondo: '#e1f2ef' },
  { texto: '#a13a72', fondo: '#f9e6f0' },
  { texto: '#4a5a70', fondo: '#e9edf2' },
];
const pad2 = (valor: number): string => String(valor).padStart(2, '0');
// Minutos desde la medianoche de una hora HH:mm.
const minutosDelDia = (hora: string | null | undefined): number => {
  const [h, m] = (hora ?? '').split(':').map(Number);
  return Number.isFinite(h) && Number.isFinite(m) ? h * 60 + m : NaN;
};

const today = (): string => dayKey(new Date());
// El panel carga los permisos que terminan desde el 1 de enero del año anterior: alcanza para los
// indicadores y los totales del mes y del año. Los anteriores se piden al filtrar por fecha, y el
// historial de un empleado y el reporte los traen completos de la API.
const inicioCarga = (): string => `${new Date().getFullYear() - 1}-01-01`;
const emptyDia = (): SavePermisoDiaRequest => ({ IdEmpleado: 0, NoPago: '', Motivo: '', FechaInicio: '', FechaFin: '', Telefono: '', Lugar: '' });
const emptyHora = (): SavePermisoHoraRequest => ({ IdEmpleado: 0, NoPago: '', Motivo: '', Fecha: '', HoraSalida: '', HoraEntrada: '' });
// La fecha de solicitud empieza en hoy y se puede cambiar a un día anterior.
const emptyVacacion = (): SaveVacacionRequest => ({ IdEmpleado: 0, FechaInicio: '', FechaFin: '', FechaSolicitud: today() });

// Último resultado de un cálculo y las dependencias con que se hizo. Los getters de la plantilla
// se evalúan en cada detección de cambios; así solo se recalculan cuando cambia alguna
// dependencia. Las listas (permisos, empleados, sesión) se reemplazan al cargar, nunca se mutan.
function memo<T>(calcular: () => T): (dependencias: readonly unknown[]) => T {
  let previas: readonly unknown[] | null = null;
  let valor!: T;
  return (dependencias) => {
    if (!previas || dependencias.some((dependencia, index) => !Object.is(dependencia, previas![index]))) {
      valor = calcular();
      previas = dependencias;
    }
    return valor;
  };
}

@Component({
  selector: 'app-permisos',
  imports: [
    FormsModule, AppSidebarComponent, SearchableSelectDirective, MayusculasDirective, PagePipe, TablePageSizeComponent, TablePaginatorComponent,
    PermisosPersonalComponent, PermisosAreasComponent,
  ],
  templateUrl: './permisos.component.html',
  // Botones, tablas, campos y ventanas vienen de styles.css (los comparten personal y áreas);
  // permisos.component.css solo agrega la distribución y el resumen de esta pantalla.
  styleUrl: './permisos.component.css',
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
  tab: PermisoTab = 'resumen';
  resumenVista: ResumenVista = 'hoy';
  resumenTipo: ResumenTipo = 'permisos';
  readonly resumenTipos: { value: ResumenTipo; label: string }[] = [
    { value: 'permisos', label: 'Permisos' },
    { value: 'vacaciones', label: 'Vacaciones' },
  ];
  // Filtros de quien ve más de un área (0 = ninguno: no se muestra nada hasta elegir departamento
  // y área). El jefe siempre ve solo la suya.
  deptoFilter = 0;
  // Área: 0 = ninguna, TODAS_AREAS = todas las del departamento elegido (las de hoy y las que se
  // agreguen), otro valor = esa área.
  areaFilter = 0;
  readonly todasAreas = TODAS_AREAS;

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

  // Filtros de la tabla de vacaciones (los mismos criterios que la de permisos).
  vacSearchTerm = '';
  vacEstadoFilter: PermisoEstadoVista | '' = '';
  vacDesde = '';
  vacHasta = '';
  vacPage = 1;
  vacPageSize = 10;

  readonly tipos = PERMISO_TIPOS;
  // Tipos del reporte: los de permiso y las vacaciones.
  readonly tiposReporte = [...PERMISO_TIPOS, TIPO_VACACIONES];
  readonly estados = PERMISO_ESTADOS;

  // Hora actual para marcar los permisos que ya terminaron; se actualiza cada 30 segundos.
  now = new Date();

  activeWindow: PermisoWindow = 'none';
  editingId: number | null = null;
  selectedPermiso: Permiso | null = null;
  formTipo: PermisoTipo = 'DIA';
  historialEmpleadoId = 0;
  // Qué lista el historial: lo mismo que la sección desde donde se abrió.
  historialTipo: 'permisos' | 'vacaciones' = 'permisos';
  // Historial completo del empleado traído de la API; null mientras llega.
  historialLista: Permiso[] | null = null;
  diaForm: SavePermisoDiaRequest = emptyDia();
  horaForm: SavePermisoHoraRequest = emptyHora();
  vacacionForm: SaveVacacionRequest = emptyVacacion();
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

  // Estado que se muestra: el permiso activo cuyo fin ya pasó se ve como finalizado. El cierre de
  // la jornada lo manda la API con cada permiso (el mismo con que valida editar y anular); se
  // guarda por permiso hasta que cambia la hora o la sesión.
  estado(permiso: Permiso): PermisoEstadoVista {
    if (this.estadosCacheHora !== this.now || this.estadosCacheSesion !== this.sesion) {
      this.estadosCache = new WeakMap();
      this.estadosCacheHora = this.now;
      this.estadosCacheSesion = this.sesion;
    }
    let estado = this.estadosCache.get(permiso);
    if (estado === undefined) {
      estado = estadoVista(permiso, this.now, permiso.HoraFinJornada ?? this.jornada(permiso.IdDepartamento).HoraFinJornada);
      this.estadosCache.set(permiso, estado);
    }
    return estado;
  }

  private estadosCache = new WeakMap<Permiso, PermisoEstadoVista>();
  private estadosCacheHora: Date | null = null;
  private estadosCacheSesion: PermisoSesion | null = null;

  // Para el reporte: el mismo estado de la tabla.
  private readonly estadoDe = (permiso: Permiso): PermisoEstadoVista => this.estado(permiso);
  // Jornada del departamento de cada permiso, para convertir horas en días.
  private readonly minutosDe = (permiso: Permiso): number => this.jornada(permiso.IdDepartamento).MinutosJornada;

  // ---- Nivel y alcance -----------------------------------------------------------------

  get nivel(): string { return this.sesion?.Nivel ?? ''; }
  // Administrador general: además de todo, maneja los departamentos.
  get esAdmin(): boolean { return this.nivel === 'ADMIN'; }
  // Ve más de un área: necesita filtros y la columna de área. El empleado solo ve lo suyo.
  get veVarias(): boolean { return this.nivel !== '' && this.nivel !== 'JEFE' && !this.esEmpleado; }
  // Ve todos los departamentos (general y consulta).
  get veTodo(): boolean { return this.nivel === 'ADMIN' || this.nivel === 'CONSULTA'; }
  get administra(): boolean { return this.nivel === 'ADMIN' || this.nivel === 'ADMIN_DEPTO'; }
  // Ve y exporta, pero no registra: la consulta (todo) y la secretaría (su departamento).
  get soloLectura(): boolean { return this.nivel === 'CONSULTA' || this.esSecretaria; }
  get esSecretaria(): boolean { return this.nivel === 'SECRETARIA'; }
  // Empleado: registra y ve solo lo suyo, lo imprime, y nada más.
  get esEmpleado(): boolean { return this.nivel === 'USUARIO'; }
  // Edita y anula lo ya registrado: todos los que registran menos el empleado.
  get modificaRegistros(): boolean { return !this.soloLectura && !this.esEmpleado; }
  // Personal y el No. de pago: lo mismo que modificar, y la sección es de quien ve varias áreas.
  get manejaPersonal(): boolean { return this.modificaRegistros; }
  // Los memorandos y los reportes: todos menos la consulta y el empleado.
  get generaMemos(): boolean { return this.nivel !== '' && this.nivel !== 'CONSULTA' && !this.esEmpleado; }
  get exportaReporte(): boolean { return this.nivel !== '' && !this.esEmpleado; }
  // Más de un departamento a la vista: se muestran su filtro y su columna.
  get variosDepartamentos(): boolean { return (this.sesion?.Departamentos.length ?? 0) > 1; }
  get muestraDepartamento(): boolean { return this.veTodo && this.variosDepartamentos && this.deptoFilter === 0; }
  // Columnas de la tabla de permisos, para el mensaje de tabla vacía.
  get columnas(): number { return 10 + (this.veVarias ? 1 : 0) + (this.muestraDepartamento ? 1 : 0); }

  // Editar y anular, como lo valida la API: solo los permisos registrados en el alcance del
  // usuario. El jefe y el de departamento también ven los que su personal tiene de otra área o
  // de antes (cuentan para sus choques y límites), pero no los modifican. Un permiso finalizado
  // ya no se edita ni se anula.
  puedeModificar(permiso: Permiso): boolean {
    if (!this.modificaRegistros || this.estado(permiso) !== 'ACTIVO') return false;
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

  // Quien ve varias áreas tiene que elegir departamento (si ve más de uno) y área: mientras
  // tanto el resumen y el registro quedan vacíos, y no se registran ni se exportan permisos.
  get faltaFiltro(): boolean {
    return this.veVarias && (this.faltaDepartamento || this.areaFilter === 0);
  }

  // Falta el departamento: quien ve varios no puede elegir área (ni todas) hasta elegirlo.
  get faltaDepartamento(): boolean { return this.veTodo && this.variosDepartamentos && this.deptoFilter === 0; }

  // Título de la barra superior: la sección abierta o, con un área a la vista, el área.
  get seccionTitulo(): string {
    if (this.tab === 'personal') return this.veVarias ? 'Personal' : 'Mi personal';
    if (this.tab === 'areas') return this.esAdmin ? 'Departamentos y áreas' : 'Áreas y jefes';
    if (this.tab === 'vacaciones') {
      const area = this.nivel === 'JEFE' ? this.sesion?.NombreArea : this.areaFilter > 0 ? this.areaNombre(this.areaFilter) : null;
      if (this.areaFilter === TODAS_AREAS) return 'Vacaciones de todas las áreas';
      return area ? `Vacaciones del área de ${area}` : 'Registro de vacaciones';
    }
    if (this.nivel === 'JEFE' || this.areaFilter !== 0) return this.titulo;
    return this.tab === 'permisos' ? 'Registro de permisos' : 'Resumen de permisos';
  }

  // Sobre el título: el departamento a la vista, si hay uno solo.
  get seccionContexto(): string {
    if (!this.veTodo) return this.sesion?.NombreDepartamento ?? '';
    return this.departamentoNombre(this.deptoFilter) ?? (this.variosDepartamentos ? '' : this.sesion?.Departamentos[0]?.Nombre ?? '');
  }

  get titulo(): string {
    if (this.nivel === 'JEFE') return `Permisos del área de ${this.sesion?.NombreArea}`;
    if (this.areaFilter === TODAS_AREAS) return 'Permisos de todas las áreas';
    return this.areaFilter > 0 ? `Permisos del área de ${this.areaNombre(this.areaFilter)}` : 'Control de permisos';
  }

  // Áreas del filtro: las del departamento elegido (las del suyo, si tiene uno solo). Con
  // "Ninguno" en el departamento no se ofrece ninguna.
  get areasFiltro(): PermisoArea[] {
    if (this.faltaDepartamento) return [];
    const areas = this.sesion?.Areas ?? [];
    return this.deptoFilter > 0 ? areas.filter((area) => area.IdDepartamento === this.deptoFilter) : areas;
  }

  // Áreas que cubre el filtro: la elegida o, con "Todas las áreas", las del departamento.
  private get areasAlcance(): Set<number> {
    return this.areasAlcanceMemo([this.sesion, this.deptoFilter, this.areaFilter]);
  }

  private readonly areasAlcanceMemo = memo(() => new Set(
    this.areaFilter === TODAS_AREAS ? this.areasFiltro.map((area) => area.IdArea) : [this.areaFilter]));

  updateDepto(): void {
    if (this.faltaDepartamento
      || (this.areaFilter > 0 && !this.areasFiltro.some((area) => area.IdArea === this.areaFilter))) this.areaFilter = 0;
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
    return (idDepartamento != null ? this.departamentosPorId([this.sesion]).get(idDepartamento) : undefined)
      ?? this.sesion?.Departamentos[0]
      ?? JORNADA_POR_DEFECTO;
  }

  private readonly departamentosPorId = memo(() =>
    new Map((this.sesion?.Departamentos ?? []).map((departamento) => [departamento.IdDepartamento, departamento])));

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

  private get enAlcance(): Permiso[] { return this.enAlcanceMemo([this.permisos, this.deptoFilter, this.areaFilter, this.sesion]); }
  private readonly enAlcanceMemo = memo(() => this.filtrarAlcance(this.permisos));

  // Permisos del departamento y el área elegidos en los filtros de la pantalla; sin elegirlos, ninguno.
  // Con "Todas las áreas", los registrados en cualquier área del departamento. El jefe, todo lo suyo.
  private filtrarAlcance(permisos: Permiso[]): Permiso[] {
    if (this.faltaFiltro) return [];
    if (!this.veVarias) return permisos;
    const areas = this.areasAlcance;
    return permisos.filter((permiso) =>
      (this.deptoFilter === 0 || permiso.IdDepartamento === this.deptoFilter)
      && permiso.IdArea !== null && areas.has(permiso.IdArea));
  }

  // Permisos y vacaciones van separados: cada registro tiene su lista.
  private get permisosAlcance(): Permiso[] { return this.permisosAlcanceMemo([this.enAlcance]); }
  private readonly permisosAlcanceMemo = memo(() => this.enAlcance.filter((permiso) => permiso.Tipo !== 'VAC'));
  private get vacacionesAlcance(): Permiso[] { return this.vacacionesAlcanceMemo([this.enAlcance]); }
  private readonly vacacionesAlcanceMemo = memo(() => this.enAlcance.filter((permiso) => permiso.Tipo === 'VAC'));

  // Lo que muestra el resumen según su filtro de tipo.
  private get resumenAlcance(): Permiso[] {
    return this.resumenTipo === 'vacaciones' ? this.vacacionesAlcance : this.permisosAlcance;
  }

  private get activos(): Permiso[] { return this.activosMemo([this.resumenAlcance]); }
  private readonly activosMemo = memo(() => this.resumenAlcance.filter(isActive));

  // Textos del resumen según el tipo: "Nadie tiene vacaciones hoy", "Todavía no hay permisos este mes".
  get resumenUno(): string { return this.resumenTipo === 'vacaciones' ? 'vacaciones' : 'permiso'; }

  get resumenVarios(): string { return this.resumenTipo === 'vacaciones' ? 'vacaciones' : 'permisos'; }

  // Leyenda de los totales: "permisos activos" o "vacaciones activas".
  activosTexto(total: number): string {
    if (this.resumenTipo === 'vacaciones') return 'vacaciones activas';
    return total === 1 ? 'permiso activo' : 'permisos activos';
  }

  hoyTexto(total: number): string {
    const quien = total === 1 ? 'empleado' : 'empleados';
    return this.resumenTipo === 'vacaciones' ? `${quien} de vacaciones` : `${quien} con permiso`;
  }

  // Permisos que todavía no terminan (en curso o por venir), por fecha, hora y empleado. Los
  // finalizados ya no cuentan como vigentes; se recalculan con la hora.
  get permisosActivosLista(): Permiso[] { return this.enCursoMemo([this.activos, this.now, this.sesion]); }
  private readonly enCursoMemo = memo(() => this.activos
    .filter((permiso) => this.estado(permiso) === 'ACTIVO')
    .sort((a, b) => a.FechaInicio.localeCompare(b.FechaInicio)
      || (a.HoraSalida ?? '').localeCompare(b.HoraSalida ?? '')
      || a.Empleado.localeCompare(b.Empleado)));

  // Lista de las pestañas Este mes y Activos. Las vacaciones del mes se ven en su calendario.
  get listaResumen(): Permiso[] {
    if (this.resumenVista === 'mes') return this.resumenTipo === 'vacaciones' ? [] : this.permisosMesLista;
    return this.resumenVista === 'activos' ? this.permisosActivosLista : [];
  }

  // En vacaciones cada empleado lleva su color (el mismo en hoy, la semana y el mes), según el
  // orden en que aparece; en permisos los colores son los del tipo (null).
  colorVacacion(permiso: Permiso): { texto: string; fondo: string } | null {
    if (this.resumenTipo !== 'vacaciones') return null;
    const indice = this.coloresMemo([this.permisosActivosLista]).get(permiso.IdEmpleado) ?? 0;
    return COLORES_VACACIONES[indice % COLORES_VACACIONES.length];
  }

  private readonly coloresMemo = memo(() => {
    const indices = new Map<number, number>();
    for (const permiso of this.permisosActivosLista) {
      if (!indices.has(permiso.IdEmpleado)) indices.set(permiso.IdEmpleado, indices.size);
    }
    return indices;
  });

  // Los activos que tocan hoy, esta semana o este mes.
  get permisosHoy(): Permiso[] { return this.vigentesMemo.hoy([this.permisosActivosLista, today()]); }
  get permisosSemanaLista(): Permiso[] { return this.vigentesMemo.semana([this.permisosActivosLista, today()]); }
  get permisosMesLista(): Permiso[] { return this.vigentesMemo.mes([this.permisosActivosLista, today()]); }
  get permisosSemana(): number { return this.permisosSemanaLista.length; }
  get permisosMes(): number { return this.permisosMesLista.length; }

  private readonly vigentesMemo = {
    hoy: memo(() => this.vigentesEntre(today(), today())),
    semana: memo(() => { const { desde, hasta } = weekRange(new Date()); return this.vigentesEntre(desde, hasta); }),
    mes: memo(() => { const { desde, hasta } = monthRange(new Date()); return this.vigentesEntre(desde, hasta); }),
  };

  private vigentesEntre(desde: string, hasta: string): Permiso[] {
    return this.permisosActivosLista.filter((permiso) => overlaps(permiso, desde, hasta));
  }

  // Lo registrado desde la fecha cargada, por estado: activos, finalizados y anulados.
  get registroTotales(): Record<PermisoEstadoVista, number> {
    return this.registroTotalesMemo([this.resumenAlcance, this.now, this.sesion]);
  }

  private readonly registroTotalesMemo = memo(() => {
    const totales: Record<PermisoEstadoVista, number> = { ACTIVO: 0, FINALIZADO: 0, ANULADO: 0 };
    for (const permiso of this.resumenAlcance) totales[this.estado(permiso)]++;
    return totales;
  });

  // ---- Resumen: franja de hoy ----------------------------------------------------------

  // Jornada del eje: la del departamento a la vista (o la del usuario).
  get jornadaVista(): PermisoJornada { return this.jornada(this.deptoFilter || this.sesion?.IdDepartamento); }

  private get ejeHoy(): { inicio: number; fin: number } {
    const inicio = minutosDelDia(this.jornadaVista.HoraInicioJornada);
    const fin = minutosDelDia(this.jornadaVista.HoraFinJornada);
    return Number.isFinite(inicio) && Number.isFinite(fin) && fin > inicio ? { inicio, fin } : { inicio: 480, fin: 960 };
  }

  private porcentajeHoy(minutos: number): number {
    const { inicio, fin } = this.ejeHoy;
    return Math.min(100, Math.max(0, ((minutos - inicio) / (fin - inicio)) * 100));
  }

  // Horas en punto de la jornada, para las marcas del eje (la plantilla las repite en cada fila).
  get horasEje(): { etiqueta: string; posicion: number }[] { return this.horasEjeMemo([this.jornadaVista]); }
  private readonly horasEjeMemo = memo(() => {
    const { inicio, fin } = this.ejeHoy;
    const horas: { etiqueta: string; posicion: number }[] = [];
    for (let hora = Math.ceil(inicio / 60); hora * 60 <= fin; hora++) {
      horas.push({ etiqueta: `${pad2(hora)}:00`, posicion: this.porcentajeHoy(hora * 60) });
    }
    return horas;
  });

  // Línea de "ahora": solo en un día hábil y dentro de la jornada.
  get ahoraPosicion(): number | null {
    const dia = this.now.getDay();
    const minutos = this.now.getHours() * 60 + this.now.getMinutes();
    const { inicio, fin } = this.ejeHoy;
    return dia === 0 || dia === 6 || minutos < inicio || minutos > fin ? null : this.porcentajeHoy(minutos);
  }

  get ahoraEtiqueta(): string { return `${pad2(this.now.getHours())}:${pad2(this.now.getMinutes())}`; }

  // El de día ocupa toda la jornada; el de hora, de su salida a su entrada.
  get franjaHoy(): FranjaHoy[] { return this.franjaHoyMemo([this.permisosHoy, this.jornadaVista, today()]); }
  private readonly franjaHoyMemo = memo(() => this.permisosHoy.map((permiso): FranjaHoy => {
    const detalle = this.hoyDetalle(permiso);
    if (permiso.Tipo !== 'HORA') return { permiso, inicio: 0, ancho: 100, detalle };
    const inicio = this.porcentajeHoy(minutosDelDia(permiso.HoraSalida));
    const fin = this.porcentajeHoy(minutosDelDia(permiso.HoraEntrada));
    return { permiso, inicio, ancho: Math.max(fin - inicio, 1.5), detalle };
  }));

  // ---- Resumen: semana -----------------------------------------------------------------

  // Días de la semana actual (la plantilla los repite en cada fila); cambian con la hora.
  get semanaDias(): { key: string; nombre: string; numero: number; finDeSemana: boolean; hoy: boolean }[] {
    return this.semanaDiasMemo([this.now]);
  }

  private readonly semanaDiasMemo = memo(() => {
    const [y, m, d] = weekRange(this.now).desde.split('-').map(Number);
    return DIAS_SEMANA.map((nombre, index) => {
      const fecha = new Date(y, m - 1, d + index);
      const key = dayKey(fecha);
      return { key, nombre, numero: fecha.getDate(), finDeSemana: index >= 5, hoy: key === today() };
    });
  });

  // Cada permiso se recorta a la semana: lo que empezó antes arranca el lunes.
  get franjaSemana(): FranjaSemana[] { return this.franjaSemanaMemo([this.permisosSemanaLista, this.semanaDias]); }
  private readonly franjaSemanaMemo = memo(() => {
    const dias = this.semanaDias.map((dia) => dia.key);
    return this.permisosSemanaLista.map((permiso): FranjaSemana => {
      const inicio = apiDay(permiso.FechaInicio);
      const fin = apiDay(permiso.FechaFin);
      const desde = inicio <= dias[0] ? 1 : dias.indexOf(inicio) + 1;
      const hasta = fin >= dias[6] ? 7 : dias.indexOf(fin) + 1;
      return { permiso, desde, hasta: Math.max(hasta, desde), detalle: this.duracion(permiso, true) };
    });
  });

  // ---- Resumen: mes --------------------------------------------------------------------

  readonly diasCalendario = DIAS_CALENDARIO;

  // Calendario de vacaciones del mes: semanas de domingo a sábado; los días de otros meses quedan
  // en gris. Cada día lleva las vacaciones que lo cuentan (días hábiles: sin fines de semana ni
  // feriados del departamento).
  get semanasMes(): CeldaMes[][] { return this.semanasMesMemo([this.permisosMesLista, today(), this.sesion]); }

  private readonly semanasMesMemo = memo(() => {
    const hoy = new Date();
    const primero = new Date(hoy.getFullYear(), hoy.getMonth(), 1);
    const totalDias = new Date(hoy.getFullYear(), hoy.getMonth() + 1, 0).getDate();
    const celdas: CeldaMes[] = [];
    const vacia = (indice: number): CeldaMes => ({ key: `vacia-${indice}`, numero: null, finDeSemana: false, hoy: false, vacaciones: [] });
    for (let i = 0; i < primero.getDay(); i++) celdas.push(vacia(celdas.length));
    for (let numero = 1; numero <= totalDias; numero++) {
      const fecha = new Date(hoy.getFullYear(), hoy.getMonth(), numero);
      const key = dayKey(fecha);
      const finDeSemana = fecha.getDay() === 0 || fecha.getDay() === 6;
      const vacaciones = finDeSemana ? [] : this.permisosMesLista.filter((vacacion) =>
        overlaps(vacacion, key, key) && !this.jornada(vacacion.IdDepartamento).Feriados.includes(key));
      celdas.push({ key, numero, finDeSemana, hoy: key === today(), vacaciones });
    }
    while (celdas.length % 7 !== 0) celdas.push(vacia(celdas.length));
    return Array.from({ length: celdas.length / 7 }, (_, semana) => celdas.slice(semana * 7, semana * 7 + 7));
  });

  // Fecha en la lista del mes: el rango del de día; la fecha y las horas del de hora.
  fechaDetalle(permiso: Permiso): string {
    return permiso.Tipo === 'HORA' ? `${this.fechas(permiso)} · ${this.horario(permiso)}` : this.fechas(permiso);
  }

  // "28/10/2026" o "28/10/2026 al 30/10/2026".
  fechas(permiso: Permiso): string {
    return apiDay(permiso.FechaInicio) === apiDay(permiso.FechaFin)
      ? formatDay(permiso.FechaInicio)
      : `${formatDay(permiso.FechaInicio)} al ${formatDay(permiso.FechaFin)}`;
  }

  // "10:00 a 11:30" en el de hora; "-" en el de día.
  horario(permiso: Permiso): string {
    return permiso.HoraSalida && permiso.HoraEntrada ? `${permiso.HoraSalida} a ${permiso.HoraEntrada}` : '-';
  }

  // "3 días hábiles" o "1 h 30 min"; en la semana, el de hora muestra sus horas.
  duracion(permiso: Permiso, conHoras = false): string {
    if (permiso.Tipo === 'HORA') return conHoras ? this.horario(permiso) : formatMinutes(permiso.Minutos);
    return `${permiso.DiasHabiles} ${permiso.DiasHabiles === 1 ? 'día hábil' : 'días hábiles'}`;
  }

  // Permisos del mes que cuentan para el consumo: los activos y los ya finalizados, sin anulados.
  private get delMes(): Permiso[] { return this.delMesMemo([this.activos, today()]); }
  private readonly delMesMemo = memo(() => {
    const { desde, hasta } = monthRange(new Date());
    return this.activos.filter((permiso) => overlaps(permiso, desde, hasta));
  });

  // Permisos del mes por área (o por empleado, para el jefe), de más a menos.
  get mesPorGrupo(): { nombre: string; total: number; proporcion: number }[] {
    return this.mesPorGrupoMemo([this.delMes, this.veVarias]);
  }

  private readonly mesPorGrupoMemo = memo(() => {
    const conteo = new Map<string, number>();
    for (const permiso of this.delMes) {
      const nombre = this.veVarias ? permiso.NombreArea ?? 'Sin área' : permiso.Empleado;
      conteo.set(nombre, (conteo.get(nombre) ?? 0) + 1);
    }
    const grupos = [...conteo]
      .map(([nombre, total]) => ({ nombre, total }))
      .sort((a, b) => b.total - a.total || a.nombre.localeCompare(b.nombre));
    const maximo = grupos[0]?.total ?? 1;
    return grupos.slice(0, 8).map((grupo) => ({ ...grupo, proporcion: (grupo.total / maximo) * 100 }));
  });

  // Días hábiles y tiempo por hora de los permisos que empiezan este mes.
  get mesTotales(): { dias: number; minutos: number } {
    const mes = today().slice(0, 7);
    let dias = 0;
    let minutos = 0;
    for (const permiso of this.delMes) {
      if (apiDay(permiso.FechaInicio).slice(0, 7) !== mes) continue;
      dias += permiso.DiasHabiles;
      minutos += permiso.Minutos;
    }
    return { dias, minutos };
  }

  get hoyTitulo(): string {
    return new Intl.DateTimeFormat('es-HN', { weekday: 'long', day: 'numeric', month: 'long' }).format(this.now);
  }

  get mesTitulo(): string {
    return new Intl.DateTimeFormat('es-HN', { month: 'long', year: 'numeric' }).format(this.now);
  }

  // Abre el registro con lo mismo que muestra la pestaña del resumen: los activos y sus fechas.
  // Con el filtro en vacaciones abre el de vacaciones; si no, el de permisos.
  verEnRegistro(vista: ResumenVista): void {
    const rango = vista === 'semana' ? weekRange(this.now)
      : vista === 'mes' ? monthRange(this.now)
      : vista === 'hoy' ? { desde: today(), hasta: today() }
      : { desde: '', hasta: '' };
    if (this.resumenTipo === 'vacaciones') {
      this.selectTab('vacaciones');
      this.vacEstadoFilter = 'ACTIVO';
      this.vacDesde = rango.desde;
      this.vacHasta = rango.hasta;
      this.updateVacFilter();
      return;
    }
    this.selectTab('permisos');
    this.estadoFilter = 'ACTIVO';
    this.fechaDesde = rango.desde;
    this.fechaHasta = rango.hasta;
    this.updateFilter();
  }

  // ---- Tabla ---------------------------------------------------------------------------

  // La plantilla lo lee tres veces por ciclo (vacío, filas y paginación).
  get filteredPermisos(): Permiso[] {
    return this.filteredMemo([
      this.permisosAlcance, this.searchTerm, this.tipoFilter, this.estadoFilter, this.fechaDesde, this.fechaHasta,
      this.now, this.sesion,
    ]);
  }

  private readonly filteredMemo = memo((): Permiso[] => {
    const term = this.searchTerm.trim().toUpperCase();
    return this.permisosAlcance.filter((permiso) =>
      (!this.tipoFilter || permiso.Tipo === this.tipoFilter)
      && (!this.estadoFilter || this.estado(permiso) === this.estadoFilter)
      && (!this.fechaDesde || apiDay(permiso.FechaFin) >= this.fechaDesde)
      && (!this.fechaHasta || apiDay(permiso.FechaInicio) <= this.fechaHasta)
      && (!term
        || permiso.Empleado.toUpperCase().includes(term)
        || permiso.Motivo.toUpperCase().includes(term)
        || (permiso.NoPago ?? '').includes(term)
        || String(permiso.IdPermiso) === term));
  });

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

  // ---- Tabla de vacaciones -------------------------------------------------------------

  get filteredVacaciones(): Permiso[] {
    return this.filteredVacMemo([
      this.vacacionesAlcance, this.vacSearchTerm, this.vacEstadoFilter, this.vacDesde, this.vacHasta, this.now, this.sesion,
    ]);
  }

  private readonly filteredVacMemo = memo((): Permiso[] => {
    const term = this.vacSearchTerm.trim().toUpperCase();
    return this.vacacionesAlcance.filter((vacacion) =>
      (!this.vacEstadoFilter || this.estado(vacacion) === this.vacEstadoFilter)
      && (!this.vacDesde || apiDay(vacacion.FechaFin) >= this.vacDesde)
      && (!this.vacHasta || apiDay(vacacion.FechaInicio) <= this.vacHasta)
      && (!term
        || vacacion.Empleado.toUpperCase().includes(term)
        || String(vacacion.IdPermiso) === term));
  });

  // Columnas de la tabla de vacaciones, para el mensaje de tabla vacía.
  get columnasVacaciones(): number { return 8 + (this.veVarias ? 1 : 0) + (this.muestraDepartamento ? 1 : 0); }

  updateVacSearch(term: string): void {
    this.vacSearchTerm = term;
    this.vacPage = 1;
  }

  updateVacFilter(): void {
    this.vacPage = 1;
    if (this.vacDesde && this.vacDesde < this.cargadoDesde) this.loadPermisos(this.vacDesde);
  }

  get hayFiltroFechasVac(): boolean { return Boolean(this.vacDesde || this.vacHasta); }

  clearFechasVac(): void {
    this.vacDesde = '';
    this.vacHasta = '';
    this.vacPage = 1;
  }

  clearFechas(): void {
    this.fechaDesde = '';
    this.fechaHasta = '';
    this.permisoPage = 1;
  }

  // ---- Historial por empleado ----------------------------------------------------------

  // Mientras llega el historial completo se muestran los permisos ya cargados del empleado.
  // El historial muestra lo mismo que la sección desde donde se abrió: permisos o vacaciones.
  openHistorial(idEmpleado: number, tipo?: 'permisos' | 'vacaciones'): void {
    this.clearMessages();
    this.historialTipo = tipo
      ?? (this.tab === 'vacaciones' || (this.tab === 'resumen' && this.resumenTipo === 'vacaciones') ? 'vacaciones' : 'permisos');
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

  get historialVacaciones(): boolean { return this.historialTipo === 'vacaciones'; }

  // Columna del memorando de cada período: la ve quien registra, no la consulta.
  get historialAcciones(): boolean { return this.historialVacaciones && this.generaMemos; }

  get columnasHistorial(): number { return 5 + (this.historialAcciones ? 1 : 0); }

  // Todos los permisos del empleado que ve el usuario, del más reciente al más antiguo.
  get historialPermisos(): Permiso[] {
    return this.historialLista ?? this.permisos.filter((permiso) => permiso.IdEmpleado === this.historialEmpleadoId);
  }

  // Lo que se lista: las vacaciones o los permisos, nunca mezclados.
  get historialFilas(): Permiso[] {
    return this.historialPermisos.filter((permiso) => (permiso.Tipo === 'VAC') === this.historialVacaciones);
  }

  // Valor grande de cada tarjeta: los días de vacaciones o lo que lleva de permisos.
  historialValor(valor: ResumenEmpleado): string {
    if (!this.historialVacaciones) return consumoTexto(valor);
    return valor.DiasVacaciones > 0 ? `${valor.DiasVacaciones} ${valor.DiasVacaciones === 1 ? 'día' : 'días'}` : 'Sin vacaciones';
  }

  get historialEmpleado(): { Nombre: string; Area: string | null; Departamento: string | null } {
    const empleado = this.empleados.find((item) => item.IdEmpleado === this.historialEmpleadoId);
    const ultimo = this.historialPermisos[0];
    return {
      Nombre: empleado?.NombreCompleto ?? ultimo?.Empleado ?? '',
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
        if (!this.administra && this.tab === 'areas') this.tab = 'resumen';
        if (this.soloLectura && this.tab === 'personal') this.tab = 'resumen';
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
    this.diaForm = { ...emptyDia(), IdEmpleado: this.empleadoPropio };
    this.horaForm = { ...emptyHora(), IdEmpleado: this.empleadoPropio };
    if (this.empleadoPropio > 0) this.elegirEmpleado(this.empleadoPropio);
    this.activeWindow = 'permiso';
  }

  // Al editar también se puede cambiar el tipo: el otro formulario empieza con la misma fecha.
  openEditWindow(permiso: Permiso): void {
    if (!this.puedeModificar(permiso)) return;
    this.clearMessages();
    this.editingId = permiso.IdPermiso;
    this.formTipo = permiso.Tipo;
    // El No. de pago es el guardado en el permiso; los anteriores a ese campo toman el del empleado.
    const noPago = permiso.NoPago?.trim() || this.noPagoEmpleado(permiso.IdEmpleado);
    this.diaForm = permiso.Tipo !== 'DIA' ? emptyDia() : {
      IdEmpleado: permiso.IdEmpleado,
      NoPago: noPago,
      Motivo: permiso.Motivo,
      FechaInicio: apiDay(permiso.FechaInicio),
      FechaFin: apiDay(permiso.FechaFin),
      Telefono: permiso.Telefono ?? '',
      Lugar: permiso.Lugar ?? '',
    };
    this.horaForm = permiso.Tipo !== 'HORA' ? emptyHora() : {
      IdEmpleado: permiso.IdEmpleado,
      NoPago: noPago,
      Motivo: permiso.Motivo,
      Fecha: apiDay(permiso.FechaInicio),
      HoraSalida: permiso.HoraSalida ?? '',
      HoraEntrada: permiso.HoraEntrada ?? '',
    };
    this.activeWindow = 'permiso';
  }

  // Empleado, No. de pago y motivo son comunes: se guardan en el formulario del tipo elegido.
  get comunForm(): { IdEmpleado: number; NoPago: string; Motivo: string } {
    return this.formTipo === 'DIA' ? this.diaForm : this.horaForm;
  }

  // Al elegir el empleado se carga su No. de pago (EMPLEADOS_IHSS.NPAGO). Si no tiene, queda
  // vacío para escribirlo. Se puede corregir, y se guarda en el permiso tal como quede.
  elegirEmpleado(idEmpleado: number): void {
    this.comunForm.NoPago = this.noPagoEmpleado(idEmpleado);
  }

  // Aviso bajo el No. de pago: si salió del registro del empleado o si hay que escribirlo.
  get avisoNoPago(): string {
    const { IdEmpleado, NoPago } = this.comunForm;
    if (IdEmpleado <= 0) return '';
    const registrado = this.noPagoEmpleado(IdEmpleado);
    if (!registrado) return 'Este empleado no tiene No. de pago registrado: escríbelo.';
    return NoPago.trim() === registrado ? 'Tomado del registro del empleado.' : '';
  }

  private noPagoEmpleado(idEmpleado: number): string {
    return this.empleados.find((empleado) => empleado.IdEmpleado === idEmpleado)?.NoPago?.trim() ?? '';
  }

  // La fecha de solicitud no se escribe: es la del sistema el día que se registra (la pone la
  // API) y al editar se muestra la que ya tiene.
  get fechaSolicitudForm(): string {
    if (this.editingId === null) return today();
    return apiDay(this.permisos.find((permiso) => permiso.IdPermiso === this.editingId)?.FechaSolicitud ?? null);
  }

  // "Registrar permiso" se habilita cuando están todos los datos del tipo elegido.
  get formularioCompleto(): boolean {
    const { IdEmpleado, NoPago, Motivo } = this.comunForm;
    if (IdEmpleado <= 0 || !NoPago.trim() || !Motivo.trim()) return false;
    return this.formTipo === 'DIA'
      ? Boolean(this.diaForm.FechaInicio && this.diaForm.FechaFin && this.diaForm.Telefono.trim() && this.diaForm.Lugar.trim())
      : Boolean(this.horaForm.Fecha && this.horaForm.HoraSalida && this.horaForm.HoraEntrada);
  }

  // Al cambiar de tipo se conservan el empleado, el motivo y las fechas ya escritas: la fecha del
  // permiso por hora pasa a ser el rango del de día, y la primera fecha del de día, la del de hora.
  changeTipo(tipo: PermisoTipo): void {
    if (tipo === this.formTipo) return;
    const { IdEmpleado, NoPago, Motivo } = this.comunForm;
    if (tipo === 'DIA' && this.horaForm.Fecha && !this.diaForm.FechaInicio) {
      this.diaForm.FechaInicio = this.horaForm.Fecha;
      this.diaForm.FechaFin = this.horaForm.Fecha;
    }
    if (tipo === 'HORA' && this.diaForm.FechaInicio && !this.horaForm.Fecha) this.horaForm.Fecha = this.diaForm.FechaInicio;
    this.formTipo = tipo;
    Object.assign(this.comunForm, { IdEmpleado, NoPago, Motivo });
    this.errorMessage = '';
  }

  savePermiso(): void {
    if (this.formTipo === 'DIA') this.saveDia();
    else this.saveHora();
  }

  // ---- Vacaciones ----------------------------------------------------------------------

  // Períodos ya agregados a la solicitud que se registra (con "+"); el que se está escribiendo
  // va en vacacionForm. Al editar se cambia un solo período y la lista queda vacía.
  vacacionPeriodos: PeriodoVacacion[] = [];

  openNewVacacion(): void {
    this.clearMessages();
    this.editingId = null;
    this.vacacionForm = { ...emptyVacacion(), IdEmpleado: this.empleadoPropio };
    this.vacacionPeriodos = [];
    this.activeWindow = 'vacacion';
  }

  openEditVacacion(vacacion: Permiso): void {
    if (!this.puedeModificar(vacacion)) return;
    this.clearMessages();
    this.editingId = vacacion.IdPermiso;
    this.vacacionForm = {
      IdEmpleado: vacacion.IdEmpleado,
      FechaInicio: apiDay(vacacion.FechaInicio),
      FechaFin: apiDay(vacacion.FechaFin),
      FechaSolicitud: apiDay(vacacion.FechaSolicitud) || today(),
    };
    this.vacacionPeriodos = [];
    this.activeWindow = 'vacacion';
  }

  // Tope del campo de fecha de solicitud: no puede ser futura (tampoco lo acepta la API).
  get hoy(): string { return today(); }

  // "Registrar vacaciones" se habilita con el empleado, la fecha de solicitud y al menos un
  // período: uno agregado o el que se está escribiendo, completo.
  get vacacionCompleta(): boolean {
    const { IdEmpleado, FechaInicio, FechaFin, FechaSolicitud } = this.vacacionForm;
    return IdEmpleado > 0 && Boolean(FechaSolicitud) && (this.vacacionPeriodos.length > 0 || Boolean(FechaInicio && FechaFin));
  }

  // "+": guarda el período escrito en la lista y deja las fechas vacías para pedir el siguiente.
  agregarPeriodo(): void {
    this.errorMessage = '';
    const { FechaInicio, FechaFin } = this.vacacionForm;
    if (!FechaInicio || !FechaFin) {
      this.errorMessage = 'Indica la fecha de inicio y la de finalización del período antes de agregar otro.';
      return;
    }
    const error = this.errorPeriodo({ FechaInicio, FechaFin }, this.vacacionPeriodos);
    if (error) {
      this.errorMessage = error;
      return;
    }
    this.vacacionPeriodos = [...this.vacacionPeriodos, { FechaInicio, FechaFin }]
      .sort((a, b) => a.FechaInicio.localeCompare(b.FechaInicio));
    this.vacacionForm.FechaInicio = '';
    this.vacacionForm.FechaFin = '';
  }

  quitarPeriodo(periodo: PeriodoVacacion): void {
    this.vacacionPeriodos = this.vacacionPeriodos.filter((item) => item !== periodo);
    this.errorMessage = '';
  }

  // Lo que se revisa de cada período antes de agregarlo o enviarlo: el orden de las fechas, que
  // tenga días hábiles y que no se cruce con otro de la misma solicitud (los choques con lo ya
  // registrado los revisa la API).
  private errorPeriodo(periodo: PeriodoVacacion, otros: PeriodoVacacion[]): string {
    if (periodo.FechaFin < periodo.FechaInicio) return 'La fecha de finalización no puede ser anterior a la de inicio.';
    if (this.diasPeriodo(periodo) === 0) return `El período ${this.rangoPeriodo(periodo)} no tiene días hábiles.`;
    const cruce = otros.find((otro) => otro.FechaInicio <= periodo.FechaFin && otro.FechaFin >= periodo.FechaInicio);
    return cruce ? `El período ${this.rangoPeriodo(periodo)} se cruza con el ${this.rangoPeriodo(cruce)}.` : '';
  }

  diasPeriodo(periodo: PeriodoVacacion): number {
    return weekdaysBetween(periodo.FechaInicio, periodo.FechaFin, this.jornadaForm.Feriados);
  }

  // "del 12/11/2026 al 14/11/2026" o "del 12/11/2026" si es un solo día.
  rangoPeriodo(periodo: PeriodoVacacion): string {
    return periodo.FechaInicio === periodo.FechaFin
      ? `del ${formatDay(periodo.FechaInicio)}`
      : `del ${formatDay(periodo.FechaInicio)} al ${formatDay(periodo.FechaFin)}`;
  }

  // Períodos que se envían: los agregados y el que se está escribiendo, si está completo.
  private get periodosSolicitud(): PeriodoVacacion[] {
    const { FechaInicio, FechaFin } = this.vacacionForm;
    return FechaInicio && FechaFin ? [...this.vacacionPeriodos, { FechaInicio, FechaFin }] : this.vacacionPeriodos;
  }

  // Días hábiles de toda la solicitud (se muestra cuando hay más de un período).
  get vacTotalDias(): number {
    return this.periodosSolicitud.reduce((total, periodo) =>
      total + (periodo.FechaFin >= periodo.FechaInicio ? this.diasPeriodo(periodo) : 0), 0);
  }

  get vacTotalPeriodos(): number { return this.periodosSolicitud.length; }

  // Al elegir el inicio, la finalización lo acompaña si estaba vacía o quedó antes.
  syncVacFin(): void {
    if (!this.vacacionForm.FechaFin || this.vacacionForm.FechaFin < this.vacacionForm.FechaInicio) {
      this.vacacionForm.FechaFin = this.vacacionForm.FechaInicio;
    }
  }

  get vacPreview(): number {
    return weekdaysBetween(this.vacacionForm.FechaInicio, this.vacacionForm.FechaFin, this.jornadaForm.Feriados);
  }

  saveVacacion(): void {
    this.clearMessages();
    const form = this.vacacionForm;
    if (!this.vacacionCompleta) {
      this.errorMessage = 'Selecciona el empleado e indica las fechas de inicio, finalización y solicitud.';
      return;
    }
    if (form.FechaSolicitud > today()) {
      this.errorMessage = 'La fecha de solicitud no puede ser futura.';
      return;
    }
    if (this.editingId !== null) {
      if (form.FechaFin < form.FechaInicio) {
        this.errorMessage = 'La fecha de finalización no puede ser anterior a la de inicio.';
        return;
      }
      this.save(this.permisosService.updateVacacion(this.editingId, form), 'Vacaciones');
      return;
    }
    // Una fecha sin la otra en el período que se escribe: no se adivina, se pide.
    if (Boolean(form.FechaInicio) !== Boolean(form.FechaFin)) {
      this.errorMessage = 'Completa la fecha de inicio y la de finalización del último período, o déjalas vacías.';
      return;
    }
    const error = form.FechaInicio ? this.errorPeriodo({ FechaInicio: form.FechaInicio, FechaFin: form.FechaFin }, this.vacacionPeriodos) : '';
    if (error) {
      this.errorMessage = error;
      return;
    }
    const periodos = [...this.periodosSolicitud].sort((a, b) => a.FechaInicio.localeCompare(b.FechaInicio));
    const request = this.permisosService.createVacaciones({ IdEmpleado: form.IdEmpleado, FechaSolicitud: form.FechaSolicitud, Periodos: periodos });
    this.save(request, 'Vacaciones', periodos.length);
  }

  // Formato oficial (día u horas) lleno con los datos del permiso, listo para imprimir.
  // Los logos del encabezado se guardan en la base (Mantenimiento) y se leen una vez por sesión;
  // si no hay o falla la lectura, el formato sale con los que trae el sistema.
  private logosImpresion: LogosImpresion | null = null;

  imprimir(permiso: Permiso): void {
    if (this.logosImpresion) {
      imprimirPermiso(permiso, this.logosImpresion);
      return;
    }
    this.permisosService.getLogos().subscribe({
      next: (logos) => {
        this.logosImpresion = logosParaImpresion(logos);
        imprimirPermiso(permiso, this.logosImpresion);
      },
      error: () => {
        this.logosImpresion = {};
        imprimirPermiso(permiso, this.logosImpresion);
      },
    });
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
  // La plantilla la lee varias veces por ciclo (horas, feriados y vistas previas).
  get jornadaForm(): PermisoJornada {
    const idEmpleado = this.activeWindow === 'vacacion' ? this.vacacionForm.IdEmpleado : this.comunForm.IdEmpleado;
    return this.jornadaFormMemo([idEmpleado, this.editingId, this.empleados, this.permisos, this.deptoFilter, this.sesion]);
  }

  private readonly jornadaFormMemo = memo(() => {
    const idEmpleado = this.activeWindow === 'vacacion' ? this.vacacionForm.IdEmpleado : this.comunForm.IdEmpleado;
    const permiso = this.permisos.find((item) => item.IdPermiso === this.editingId);
    return this.jornada(this.departamentoEmpleado(idEmpleado)
      ?? (permiso?.IdEmpleado === idEmpleado ? permiso.IdDepartamento : null)
      ?? (this.deptoFilter || this.sesion?.IdDepartamento));
  });

  // Lo que ya lleva el empleado elegido, sin contar el permiso que se edita.
  get consumoForm(): ConsumoEmpleado | null {
    const idEmpleado = this.comunForm.IdEmpleado;
    if (idEmpleado <= 0) return null;
    return consumoEmpleado(this.permisos, idEmpleado, this.now, this.minutosDe, this.editingId);
  }

  // Empleados a los que se les puede registrar un permiso: los que tienen área, dentro de los
  // filtros de departamento y área de la pantalla (el jefe solo recibe los de su área). Al
  // editar se agrega el empleado del permiso aunque ya no esté en el área, para que el
  // selector lo muestre. El selector, su aviso y la lista del reporte la leen en cada ciclo.
  // La cuenta de empleado solo registra permisos para su propia ficha.
  get empleadoPropio(): number { return this.esEmpleado ? this.sesion?.IdEmpleado ?? 0 : 0; }

  get empleadosForm(): PermisoEmpleado[] {
    return this.empleadosFormMemo([this.empleados, this.permisos, this.editingId, this.areaFilter, this.deptoFilter, this.sesion]);
  }

  private readonly empleadosFormMemo = memo((): PermisoEmpleado[] => {
    // La cuenta de empleado solo recibe su ficha de la API: es a quien se registra.
    if (this.esEmpleado) return this.empleados;
    // El jefe, los de su área; los demás, los del área elegida o, con "Todas las áreas", los de
    // cualquier área del departamento.
    const areaJefe = this.sesion?.IdArea ?? 0;
    const disponibles = this.empleados.filter((empleado) =>
      empleado.IdArea !== null
      && (this.veVarias ? this.areasAlcance.has(empleado.IdArea) : areaJefe === 0 || empleado.IdArea === areaJefe)
      && (this.deptoFilter === 0 || empleado.IdDepartamento === this.deptoFilter));
    const permiso = this.permisos.find((item) => item.IdPermiso === this.editingId);
    if (!permiso || disponibles.some((empleado) => empleado.IdEmpleado === permiso.IdEmpleado)) return disponibles;
    return [{
      IdEmpleado: permiso.IdEmpleado, NombreCompleto: permiso.Empleado, NoPago: null,
      IdDepartamento: permiso.IdDepartamento ?? 0, IdArea: permiso.IdArea, NombreArea: permiso.NombreArea,
    }, ...disponibles];
  });

  private saveDia(): void {
    this.clearMessages();
    const form = this.diaForm;
    if (this.errorComun()) {
      this.errorMessage = this.errorComun();
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
    // El formato impreso del permiso por día pide dónde localizar al empleado y el lugar.
    const telefono = form.Telefono.trim();
    if (!telefono) {
      this.errorMessage = 'Escribe el número de teléfono donde localizar al empleado.';
      return;
    }
    if (!/^[\d\s()+-]+$/.test(telefono) || telefono.replace(/\D/g, '').length < 7) {
      this.errorMessage = 'El número de teléfono no es válido: usa solo números (al menos 7), espacios, guiones, paréntesis o +.';
      return;
    }
    if (!form.Lugar.trim()) {
      this.errorMessage = 'Escribe el lugar.';
      return;
    }

    this.save(this.permisosService.savePermisoDia(this.editingId, {
      ...form, NoPago: form.NoPago.trim(), Motivo: form.Motivo.trim().toLocaleUpperCase('es'), Telefono: telefono, Lugar: form.Lugar.trim(),
    }));
  }

  private saveHora(): void {
    this.clearMessages();
    const form = this.horaForm;
    const { HoraInicioJornada: inicio, HoraFinJornada: fin, Feriados: feriados } = this.jornadaForm;
    if (this.errorComun()) {
      this.errorMessage = this.errorComun();
      return;
    }
    if (!form.Fecha || !form.HoraSalida || !form.HoraEntrada) {
      this.errorMessage = 'Indica la fecha, la hora de salida y la hora de regreso.';
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
      this.errorMessage = 'La hora de regreso debe ser posterior a la hora de salida.';
      return;
    }

    this.save(this.permisosService.savePermisoHora(this.editingId, { ...form, NoPago: form.NoPago.trim(), Motivo: form.Motivo.trim().toLocaleUpperCase('es') }));
  }

  // Empleado, No. de pago y motivo, comunes a los dos tipos (el mismo orden del formulario).
  private errorComun(): string {
    const { IdEmpleado, NoPago, Motivo } = this.comunForm;
    if (IdEmpleado <= 0) return 'Selecciona el empleado.';
    if (!NoPago.trim()) return 'Escribe el No. de pago.';
    return Motivo.trim() ? '' : 'Escribe el motivo del permiso.';
  }

  // periodos: cuántos períodos de vacaciones se registraron, para el mensaje.
  private save(request: Observable<void>, que: 'Permiso' | 'Vacaciones' = 'Permiso', periodos = 1): void {
    const editing = this.editingId !== null;
    this.isSaving = true;
    request.pipe(
      finalize(() => { this.isSaving = false; this.changeDetector.markForCheck(); })
    ).subscribe({
      next: () => {
        this.closeWindow();
        this.message = que === 'Vacaciones'
          ? (editing ? 'Vacaciones actualizadas.' : periodos > 1 ? `Vacaciones registradas: ${periodos} períodos.` : 'Vacaciones registradas.')
          : (editing ? 'Permiso actualizado.' : 'Permiso registrado.');
        this.loadPermisos();
      },
      error: (error) => {
        this.errorMessage = apiErrorMessage(error, que === 'Vacaciones' ? 'No se pudieron guardar las vacaciones.' : 'No se pudo guardar el permiso.');
      },
    });
  }

  confirmAnular(): void {
    if (!this.selectedPermiso) return;
    this.clearMessages();
    this.isSaving = true;
    const vacaciones = this.selectedPermiso.Tipo === 'VAC';
    this.permisosService.anularPermiso(this.selectedPermiso.IdPermiso).pipe(
      finalize(() => { this.isSaving = false; this.changeDetector.markForCheck(); })
    ).subscribe({
      next: () => {
        this.closeWindow();
        this.message = vacaciones ? 'Vacaciones anuladas.' : 'Permiso anulado.';
        this.loadPermisos();
      },
      error: (error) => { this.errorMessage = apiErrorMessage(error, vacaciones ? 'No se pudieron anular las vacaciones.' : 'No se pudo anular el permiso.'); },
    });
  }

  // ---- Reporte -------------------------------------------------------------------------

  // Empleados del reporte: todos, o solo los marcados en la lista (reportFilters.idsEmpleado).
  reportTodosEmpleados = true;
  reportBusqueda = '';

  // Filtros con los que se exporta: con "Todos" no se filtra por empleado aunque haya marcados.
  private get reportFiltros(): PermisoReportFilters {
    return { ...this.reportFilters, idsEmpleado: this.reportTodosEmpleados ? [] : this.reportFilters.idsEmpleado };
  }

  // Lista de casillas: los empleados de la pantalla cuyo nombre coincide con la búsqueda (el No.
  // de pago es de cada permiso, no del empleado).
  get reportEmpleados(): PermisoEmpleado[] {
    const term = this.reportBusqueda.trim().toUpperCase();
    return this.empleadosForm.filter((empleado) => !term || empleado.NombreCompleto.toUpperCase().includes(term));
  }

  reportSeleccionado(idEmpleado: number): boolean {
    return this.reportFilters.idsEmpleado.includes(idEmpleado);
  }

  toggleReportEmpleado(idEmpleado: number, marcado: boolean): void {
    const ids = this.reportFilters.idsEmpleado.filter((id) => id !== idEmpleado);
    this.reportFilters.idsEmpleado = marcado ? [...ids, idEmpleado] : ids;
  }

  // Marca los que están a la vista (los de la búsqueda) sin quitar los ya marcados.
  marcarVisibles(): void {
    this.reportFilters.idsEmpleado = [...new Set([...this.reportFilters.idsEmpleado, ...this.reportEmpleados.map((e) => e.IdEmpleado)])];
  }

  quitarSeleccion(): void {
    this.reportFilters.idsEmpleado = [];
  }

  get reportCount(): number {
    return filterPermisosForReport(this.enAlcance, this.reportFiltros, this.estadoDe).length;
  }

  // El reporte pide el rango completo: mientras haya aviso, el botón de exportar queda deshabilitado.
  get reportRangoAviso(): string {
    const { desde, hasta } = this.reportFilters;
    if (!desde || !hasta) return 'Elige la fecha "desde" y la fecha "hasta" para exportar el reporte.';
    if (desde > hasta) return 'La fecha "desde" no puede ser posterior a la fecha "hasta".';
    return '';
  }

  // El conteo previo solo es exacto si el rango del reporte está dentro de lo cargado en pantalla.
  get reportCountExacto(): boolean {
    return Boolean(this.reportFilters.desde) && this.reportFilters.desde >= this.cargadoDesde;
  }

  openReportWindow(): void {
    this.clearMessages();
    this.reportFilters = emptyPermisoReportFilters();
    this.reportTodosEmpleados = true;
    this.reportBusqueda = '';
    this.activeWindow = 'report';
  }

  // Pide a la API los permisos del rango, con datos al día, aplica los filtros y descarga el Excel.
  async exportReport(): Promise<void> {
    this.clearMessages();
    if (this.reportRangoAviso) {
      this.errorMessage = this.reportRangoAviso;
      return;
    }
    const filtros = this.reportFiltros;
    if (!this.reportTodosEmpleados && filtros.idsEmpleado.length === 0) {
      this.errorMessage = 'Marca al menos un empleado o elige "Todos".';
      return;
    }
    this.isExporting = true;
    try {
      // La API trae solo el rango; con un solo empleado, solo los suyos (con varios se filtran aquí).
      const idEmpleado = filtros.idsEmpleado.length === 1 ? filtros.idsEmpleado[0] : undefined;
      const delRango = await firstValueFrom(
        this.permisosService.getPermisos({ desde: filtros.desde, hasta: filtros.hasta, idEmpleado }));
      const permisos = filterPermisosForReport(this.filtrarAlcance(delRango), filtros, this.estadoDe);
      const nombres = filtros.idsEmpleado.map((id) =>
        this.empleados.find((item) => item.IdEmpleado === id)?.NombreCompleto
        ?? delRango.find((item) => item.IdEmpleado === id)?.Empleado ?? `#${id}`);
      await exportPermisosReport(permisos, filtros, nombres, this.minutosDe, this.alcanceNombre, this.estadoDe);
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

  // ---- Memorando -----------------------------------------------------------------------
  // Remisión a Recursos Humanos, en PDF con el membrete. Dos tipos con el mismo encabezado:
  //  - permisos: los por día y por horas de un rango, en tabla (se pueden dejar fuera algunos);
  //  - vacaciones: la solicitud de un empleado, con sus días en letras y cada período en una línea.

  memoTipo: 'permisos' | 'vacaciones' = 'permisos';
  memoForm: MemoDatos = emptyMemo();
  memoDesde = '';
  memoHasta = '';
  // Permisos del rango (o vacaciones del empleado) que pueden ir en el memo; null mientras llegan.
  memoPermisos: Permiso[] | null = [];
  memoExcluidos = new Set<number>();
  private memoRequest = 0;
  // Vacaciones: el empleado y, por período, lo que va entre paréntesis después de "inclusive".
  memoEmpleadoId = 0;
  memoPeriodoTexto: Record<number, string> = {};

  // Empleados del selector del memo: los del filtro y, si el memo se abrió desde el historial de
  // otro (por ejemplo desde el resumen), también ese.
  get memoEmpleados(): PermisoEmpleado[] {
    const lista = this.empleadosForm;
    if (this.memoEmpleadoId <= 0 || lista.some((empleado) => empleado.IdEmpleado === this.memoEmpleadoId)) return lista;
    const empleado = this.empleados.find((item) => item.IdEmpleado === this.memoEmpleadoId);
    return [empleado ?? {
      IdEmpleado: this.memoEmpleadoId, NombreCompleto: this.memoEmpleadoNombre, NoPago: null,
      IdDepartamento: 0, IdArea: null, NombreArea: null,
    }, ...lista];
  }

  get memoVacacionesDias(): number {
    return this.memoSeleccionados.reduce((suma, vacacion) => suma + vacacion.DiasHabiles, 0);
  }

  get memoVacacionesResumen(): string {
    const dias = this.memoVacacionesDias;
    return `${diasEnLetras(dias)} ${dias === 1 ? 'día' : 'días'} de vacaciones de ${nombrePropio(this.memoEmpleadoNombre)}`
      + ` con pago No.${this.memoEmpleadoNoPago || ' (sin registrar)'}`;
  }

  private get memoEmpleadoNombre(): string {
    return this.empleados.find((empleado) => empleado.IdEmpleado === this.memoEmpleadoId)?.NombreCompleto
      ?? this.memoPermisos?.[0]?.Empleado ?? '';
  }

  get memoEmpleadoNoPago(): string {
    return this.empleados.find((empleado) => empleado.IdEmpleado === this.memoEmpleadoId)?.NoPago?.trim()
      || this.memoSeleccionados.find((vacacion) => vacacion.NoPago?.trim())?.NoPago?.trim() || '';
  }

  memoVacacionDetalle(vacacion: Permiso): string {
    const rango = rangoVacaciones(apiDay(vacacion.FechaInicio), apiDay(vacacion.FechaFin));
    return `${rango} · ${vacacion.DiasHabiles} ${vacacion.DiasHabiles === 1 ? 'día hábil' : 'días hábiles'}`;
  }

  // Trae todas las vacaciones activas del empleado (aunque sean de antes de lo cargado en pantalla).
  // Marca el período desde el que se abrió el memo o, si se eligió al empleado aquí, su última solicitud.
  cargarMemoVacaciones(soloEste?: number): void {
    this.memoExcluidos = new Set();
    this.memoPeriodoTexto = {};
    const pedido = ++this.memoRequest;
    const idEmpleado = this.memoEmpleadoId;
    if (idEmpleado <= 0) { this.memoPermisos = []; return; }
    this.memoPermisos = null;
    this.permisosService.getPermisos({ idEmpleado }).subscribe({
      next: (lista) => {
        if (pedido !== this.memoRequest) return;
        const vacaciones = lista
          .filter((permiso) => permiso.Tipo === 'VAC' && permiso.Estado === 'ACTIVO')
          .sort((a, b) => apiDay(a.FechaInicio).localeCompare(apiDay(b.FechaInicio)));
        const ultima = vacaciones.map((vacacion) => apiDay(vacacion.FechaSolicitud)).sort().at(-1) ?? '';
        this.memoExcluidos = new Set(vacaciones
          .filter((vacacion) => soloEste !== undefined ? vacacion.IdPermiso !== soloEste : apiDay(vacacion.FechaSolicitud) !== ultima)
          .map((vacacion) => vacacion.IdPermiso));
        this.memoPermisos = vacaciones;
        this.changeDetector.markForCheck();
      },
      error: (error) => {
        if (pedido !== this.memoRequest) return;
        this.memoPermisos = [];
        this.errorMessage = apiErrorMessage(error, 'No se pudieron cargar las vacaciones del empleado.');
        this.changeDetector.markForCheck();
      },
    });
  }

  get memoNumero(): string { return numeroMemo(this.memoForm); }

  get memoSeleccionados(): Permiso[] {
    return (this.memoPermisos ?? []).filter((permiso) => !this.memoExcluidos.has(permiso.IdPermiso));
  }

  get memoRangoAviso(): string {
    if (!this.memoDesde || !this.memoHasta) return 'Elige desde y hasta qué fecha van los permisos del memorando.';
    if (this.memoDesde > this.memoHasta) return 'La fecha "desde" no puede ser posterior a la fecha "hasta".';
    return '';
  }

  // Lo que falta para generarlo; vacío = listo.
  get memoAviso(): string {
    const datos = this.memoForm;
    if (!datos.Numero.trim() || !datos.Siglas.trim()) return 'Escribe el número del memorando y las siglas de la dependencia.';
    if (!datos.Fecha) return 'Elige la fecha del memorando.';
    if (!datos.ParaNombre.trim() || !datos.DeNombre.trim()) return 'Escribe para quién es el memorando y quién lo envía.';
    if (this.memoTipo === 'vacaciones') {
      if (this.memoEmpleadoId <= 0) return 'Elige el empleado de las vacaciones.';
      if (this.memoPermisos === null) return 'Espera a que carguen las vacaciones.';
      if (this.memoSeleccionados.length === 0) return 'Marca al menos un período de vacaciones.';
      if (this.memoSeleccionados.some((vacacion) => !this.memoPeriodoTexto[vacacion.IdPermiso]?.trim())) {
        return 'Escribe en cada período lo que va entre paréntesis (ej. 2024-2025).';
      }
      return '';
    }
    if (this.memoRangoAviso) return this.memoRangoAviso;
    if (this.memoPermisos === null) return 'Espera a que carguen los permisos.';
    if (this.memoSeleccionados.length === 0) return 'Marca al menos un permiso para el memorando.';
    return '';
  }

  // Abre en blanco, con la fecha de hoy y el mes anterior (el memo se envía después de que salen
  // los permisos). No se guarda nada: al generarlo, cerrarlo o recargar la página se pierde.
  // El de vacaciones se abre desde una de las del historial: ese período queda marcado y los
  // demás del empleado se pueden agregar.
  openMemoWindow(tipo: 'permisos' | 'vacaciones' = 'permisos', vacacion?: Permiso): void {
    this.clearMessages();
    // Los memorandos los genera quien registra y la secretaría, no la consulta.
    if (!this.generaMemos) return;
    olvidarEncabezadoMemo();
    const hoy = new Date();
    this.memoTipo = tipo;
    this.memoDesde = dayKey(new Date(hoy.getFullYear(), hoy.getMonth() - 1, 1));
    this.memoHasta = dayKey(new Date(hoy.getFullYear(), hoy.getMonth(), 0));
    this.memoForm = { ...emptyMemo(), Fecha: dayKey(hoy), Asunto: tipo === 'vacaciones' ? MEMO_ASUNTO_VACACIONES : MEMO_ASUNTO };
    this.memoEmpleadoId = vacacion?.IdEmpleado ?? 0;
    this.memoPeriodoTexto = {};
    this.activeWindow = 'memo';
    if (tipo === 'permisos') this.cargarMemoPermisos(); else this.cargarMemoVacaciones(vacacion?.IdPermiso);
  }

  // Trae de la API los permisos del rango (pueden ser anteriores a lo cargado en pantalla) del
  // departamento y el área elegidos arriba.
  cargarMemoPermisos(): void {
    this.memoExcluidos = new Set();
    const pedido = ++this.memoRequest;
    if (this.memoRangoAviso) { this.memoPermisos = []; return; }
    this.memoPermisos = null;
    const [desde, hasta] = [this.memoDesde, this.memoHasta];
    this.permisosService.getPermisos({ desde, hasta }).subscribe({
      next: (lista) => {
        if (pedido !== this.memoRequest) return;
        this.memoPermisos = permisosParaMemo(this.filtrarAlcance(lista), desde, hasta);
        this.changeDetector.markForCheck();
      },
      error: (error) => {
        if (pedido !== this.memoRequest) return;
        this.memoPermisos = [];
        this.errorMessage = apiErrorMessage(error, 'No se pudieron cargar los permisos para el memorando.');
        this.changeDetector.markForCheck();
      },
    });
  }

  memoIncluido(idPermiso: number): boolean { return !this.memoExcluidos.has(idPermiso); }

  toggleMemo(idPermiso: number, marcado: boolean): void {
    const excluidos = new Set(this.memoExcluidos);
    if (marcado) excluidos.delete(idPermiso); else excluidos.add(idPermiso);
    this.memoExcluidos = excluidos;
  }

  // "Día" o "Hora" de cada permiso en la lista, como saldrá en la tabla del memo.
  memoDetalle(permiso: Permiso): string {
    const fila = filaMemo(permiso, '');
    return fila.Hora ? `${fila.Fecha} · ${fila.Hora}` : `${fila.Fecha} · ${fila.Dia} ${fila.Dia === '1' ? 'día' : 'días'}`;
  }

  // El No. de pago es el del permiso o, si no lo tiene, el que hoy está registrado al empleado.
  memoNoPago(permiso: Permiso): string {
    return permiso.NoPago?.trim() || this.empleados.find((empleado) => empleado.IdEmpleado === permiso.IdEmpleado)?.NoPago?.trim() || '';
  }

  // Empleados marcados que saldrían sin No. de pago en la tabla (se registra en Personal).
  get memoSinPago(): string[] {
    return [...new Set(this.memoSeleccionados.filter((permiso) => !this.memoNoPago(permiso)).map((permiso) => permiso.Empleado))];
  }

  async generarMemo(): Promise<void> {
    this.clearMessages();
    if (this.memoAviso) {
      this.errorMessage = this.memoAviso;
      return;
    }
    this.isExporting = true;
    try {
      const datos = { ...this.memoForm };
      if (this.memoTipo === 'vacaciones') {
        const nombre = nombrePropio(this.memoEmpleadoNombre);
        const dias = this.memoVacacionesDias;
        await descargarMemoVacaciones(datos, {
          Nombre: nombre, NoPago: this.memoEmpleadoNoPago, Dias: dias,
          Periodos: this.memoSeleccionados.map((vacacion) => ({
            Desde: apiDay(vacacion.FechaInicio), Hasta: apiDay(vacacion.FechaFin), Periodo: this.memoPeriodoTexto[vacacion.IdPermiso] ?? '',
          })),
        });
        this.closeWindow();
        this.message = `Memorando ${numeroMemo(datos)} de vacaciones generado en PDF: ${dias} ${dias === 1 ? 'día' : 'días'} de ${nombre}.`;
        return;
      }
      const filas = this.memoSeleccionados.map((permiso) => filaMemo(permiso, this.memoNoPago(permiso)));
      await descargarMemo(datos, filas);
      this.closeWindow();
      this.message = `Memorando ${numeroMemo(datos)} generado en PDF: ${filas.length} permiso(s).`;
    } catch {
      this.errorMessage = 'No se pudo generar el PDF del memorando.';
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
    // El memo no conserva nada al cerrarse (ni lo que estaba cargando).
    this.memoForm = emptyMemo();
    this.memoPermisos = [];
    this.memoExcluidos = new Set();
    this.memoEmpleadoId = 0;
    this.memoPeriodoTexto = {};
    this.memoRequest++;
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
