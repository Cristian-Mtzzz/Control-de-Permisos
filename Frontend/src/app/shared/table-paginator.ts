import { Component, computed, input, model, Pipe, PipeTransform } from '@angular/core';

export const PAGE_SIZE_OPTIONS = [10, 25, 50, 100];

// Página válida para el total actual: si la lista se reduce (por un filtro), se ajusta a la última.
export function clampPage(page: number, total: number, pageSize: number): number {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  return Math.min(Math.max(1, page), totalPages);
}

/** Devuelve solo los elementos de la página indicada: `items | page: pagina : tamaño`. */
@Pipe({ name: 'page' })
export class PagePipe implements PipeTransform {
  transform<T>(items: readonly T[] | null | undefined, page: number, pageSize: number): T[] {
    if (!items?.length) return [];
    const start = (clampPage(page, items.length, pageSize) - 1) * pageSize;
    return items.slice(start, start + pageSize);
  }
}

/**
 * Selector "Mostrar N registros" que va arriba a la derecha de la tabla.
 * Uso: `<app-table-page-size [(page)]="pagina" [(pageSize)]="tamaño" />`
 */
@Component({
  selector: 'app-table-page-size',
  template: `
    <label class="table-page-size">
      Mostrar
      <select [value]="pageSize()" (change)="changePageSize($any($event.target).value)">
        @for (size of pageSizes; track size) { <option [value]="size" [selected]="size === pageSize()">{{ size }}</option> }
      </select>
      registros
    </label>
  `,
  styles: `
    :host {
      display: flex;
      justify-content: flex-end;
      margin-bottom: .3rem;
    }
    .table-page-size {
      display: inline-flex;
      align-items: center;
      gap: .45rem;
      color: #617573;
      font-size: .8rem;
      font-weight: 600;
    }
    .table-page-size select {
      width: auto;
      min-height: 2.15rem;
      padding: .3rem .5rem;
      border: 1px solid #d3dfdb;
      border-radius: 8px;
      color: #203238;
      background: #fff;
    }
  `,
})
export class TablePageSizeComponent {
  readonly page = model(1);
  readonly pageSize = model(PAGE_SIZE_OPTIONS[0]);
  readonly pageSizes = PAGE_SIZE_OPTIONS;

  // Al cambiar el tamaño se vuelve a la primera página.
  changePageSize(value: string): void {
    this.pageSize.set(Number(value));
    this.page.set(1);
  }
}

/**
 * Paginación en el navegador para tablas que reciben la lista completa.
 * Uso: `<app-table-paginator [total]="lista.length" [(page)]="pagina" [pageSize]="tamaño" />`
 * debajo de la tabla, `<app-table-page-size>` encima y
 * `@for (item of lista | page: pagina : tamaño; ...)` en el cuerpo.
 */
@Component({
  selector: 'app-table-paginator',
  template: `
    @if (total() > 0) {
    <nav class="table-paginator" [attr.aria-label]="label()">
      <span class="table-paginator-summary">{{ firstItem() }}–{{ lastItem() }} de {{ total() }} registros</span>
      <div class="table-paginator-buttons">
        <button type="button" (click)="goTo(1)" [disabled]="currentPage() === 1" aria-label="Primera página">«</button>
        <button type="button" (click)="goTo(currentPage() - 1)" [disabled]="currentPage() === 1">Anterior</button>
        @for (pageNumber of visiblePages(); track pageNumber) {
        <button type="button" [class.active]="pageNumber === currentPage()"
          [attr.aria-current]="pageNumber === currentPage() ? 'page' : null" (click)="goTo(pageNumber)">{{ pageNumber }}</button>
        }
        <button type="button" (click)="goTo(currentPage() + 1)" [disabled]="currentPage() === totalPages()">Siguiente</button>
        <button type="button" (click)="goTo(totalPages())" [disabled]="currentPage() === totalPages()" aria-label="Última página">»</button>
      </div>
    </nav>
    }
  `,
  styles: `
    .table-paginator {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      justify-content: space-between;
      gap: .75rem 1rem;
      margin-top: .85rem;
      color: #617573;
      font-size: .8rem;
    }
    .table-paginator-buttons {
      display: flex;
      flex-wrap: wrap;
      gap: .25rem;
    }
    .table-paginator-buttons button {
      min-width: 2.15rem;
      min-height: 2.15rem;
      padding: .4rem .65rem;
      border: 1px solid #cfdbd7;
      border-radius: 8px;
      color: #315c59;
      background: #fff;
      cursor: pointer;
      font-size: .78rem;
      font-weight: 600;
    }
    .table-paginator-buttons button:hover:not(:disabled):not(.active) {
      border-color: #8fb5ab;
      background: #eef5f2;
    }
    .table-paginator-buttons button.active {
      border-color: var(--admin-button-fill, #276968);
      color: #fff;
      background: var(--admin-button-fill, #276968);
    }
    .table-paginator-buttons button:disabled {
      cursor: not-allowed;
      opacity: .42;
    }
  `,
})
export class TablePaginatorComponent {
  readonly total = input.required<number>();
  readonly label = input('Paginación de la tabla');
  readonly page = model(1);
  readonly pageSize = input(PAGE_SIZE_OPTIONS[0]);

  readonly totalPages = computed(() => Math.max(1, Math.ceil(this.total() / this.pageSize())));
  readonly currentPage = computed(() => clampPage(this.page(), this.total(), this.pageSize()));
  readonly firstItem = computed(() => (this.currentPage() - 1) * this.pageSize() + 1);
  readonly lastItem = computed(() => Math.min(this.currentPage() * this.pageSize(), this.total()));

  // Muestra hasta cinco números alrededor de la página actual.
  readonly visiblePages = computed(() => {
    const last = this.totalPages();
    const start = Math.max(1, Math.min(this.currentPage() - 2, last - 4));
    return Array.from({ length: Math.min(5, last) }, (_, index) => start + index);
  });

  goTo(page: number): void {
    this.page.set(clampPage(page, this.total(), this.pageSize()));
  }
}
