import { Component } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { FormsModule } from '@angular/forms';
import { SearchableSelectDirective } from './searchable-select.directive';

// La lista con búsqueda dentro de una ventana que detiene la propagación del clic, como los modales.
@Component({
  imports: [FormsModule, SearchableSelectDirective],
  template: `
    <section class="modal" (click)="$event.stopPropagation()">
      <label for="empleado">Empleado</label>
      <select id="empleado" [(ngModel)]="valor" name="empleado">
        <option [ngValue]="0">Selecciona al empleado</option>
        <option [ngValue]="1">ANA LOPEZ</option>
        <option [ngValue]="2">LUIS PAZ</option>
      </select>
      <p class="fuera">Otro lugar de la ventana</p>
    </section>
    <p class="pagina">Fuera de la ventana</p>
  `,
})
class HostComponent {
  valor = 0;
}

describe('SearchableSelectDirective', () => {
  let fixture: ComponentFixture<HostComponent>;
  const raiz = (): HTMLElement => fixture.nativeElement as HTMLElement;
  const input = (): HTMLInputElement => raiz().querySelector('.searchable-select-input') as HTMLInputElement;
  const lista = (): HTMLElement => document.getElementById(input().getAttribute('aria-controls')!)!;
  const abierta = (): boolean => !lista().hidden;
  // Un clic real: mousedown y luego click, que la ventana detiene.
  const clic = (elemento: Element): void => {
    elemento.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    elemento.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  };

  beforeEach(async () => {
    fixture = TestBed.createComponent(HostComponent);
    fixture.detectChanges();
    await fixture.whenStable();
  });

  afterEach(() => fixture.destroy());

  it('se cierra con un clic en otro lugar de la ventana, aunque detenga la propagación', () => {
    input().focus();
    expect(abierta()).toBe(true);
    clic(raiz().querySelector('.fuera')!);
    expect(abierta()).toBe(false);
  });

  it('se cierra con un clic fuera de la ventana', () => {
    input().focus();
    clic(raiz().querySelector('.pagina')!);
    expect(abierta()).toBe(false);
  });

  it('un clic en una opción la elige y cierra la lista', async () => {
    input().focus();
    clic(Array.from(lista().querySelectorAll('.searchable-select-option')).find((opcion) => opcion.textContent === 'LUIS PAZ')!);
    await fixture.whenStable();
    const select = raiz().querySelector('select') as HTMLSelectElement;
    expect(fixture.componentInstance.valor).toBe(2);
    expect(select.options[select.selectedIndex].textContent).toBe('LUIS PAZ');
    expect(abierta()).toBe(false);
  });

  it('un clic en la flecha la abre y otro la cierra', () => {
    const flecha = raiz().querySelector('.searchable-select-toggle')!;
    clic(flecha);
    expect(abierta()).toBe(true);
    clic(flecha);
    expect(abierta()).toBe(false);
  });

  it('al salir del campo con Tab se cierra', () => {
    input().focus();
    expect(abierta()).toBe(true);
    input().blur();
    expect(abierta()).toBe(false);
  });

  it('un clic en el campo que ya tiene el foco vuelve a abrir la lista', () => {
    input().focus();
    clic(raiz().querySelector('.fuera')!);
    expect(abierta()).toBe(false);
    clic(input());
    expect(abierta()).toBe(true);
  });
});

// Lista corta (sinBusqueda): el mismo menú, pero el campo es de solo lectura.
@Component({
  imports: [FormsModule, SearchableSelectDirective],
  template: `
    <select sinBusqueda [(ngModel)]="valor" name="estado" aria-label="Estado">
      <option value="ACTIVO">Activo</option>
      <option value="INACTIVO">Inactivo</option>
    </select>
  `,
})
class SinBusquedaComponent {
  valor = 'ACTIVO';
}

describe('SearchableSelectDirective sin búsqueda', () => {
  let fixture: ComponentFixture<SinBusquedaComponent>;
  const input = (): HTMLInputElement => (fixture.nativeElement as HTMLElement).querySelector('.searchable-select-input') as HTMLInputElement;
  const lista = (): HTMLElement => document.getElementById(input().getAttribute('aria-controls')!)!;

  beforeEach(async () => {
    fixture = TestBed.createComponent(SinBusquedaComponent);
    fixture.detectChanges();
    await fixture.whenStable();
  });

  afterEach(() => fixture.destroy());

  it('usa el mismo menú con el campo de solo lectura y sin texto de búsqueda', () => {
    expect(input().readOnly).toBe(true);
    expect(input().placeholder).toBe('');
    input().focus();
    expect(lista().hidden).toBe(false);
    expect(Array.from(lista().querySelectorAll('.searchable-select-option')).map((opcion) => opcion.textContent)).toEqual(['Activo', 'Inactivo']);
  });

  it('un clic en el campo abierto lo cierra, como un select', () => {
    input().focus();
    input().dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
    expect(lista().hidden).toBe(true);
  });

  it('elige con el teclado: espacio abre, flecha baja y Enter elige', async () => {
    input().focus();
    input().blur();
    input().focus();
    input().dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    input().dispatchEvent(new KeyboardEvent('keydown', { key: ' ' }));
    expect(lista().hidden).toBe(false);
    input().dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown' }));
    input().dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    await fixture.whenStable();
    expect(fixture.componentInstance.valor).toBe('INACTIVO');
    expect(lista().hidden).toBe(true);
  });
});
