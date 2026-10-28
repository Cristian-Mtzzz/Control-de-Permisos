import { Directive, DoCheck, ElementRef, NgZone, OnDestroy, OnInit, Renderer2, inject } from '@angular/core';

@Directive({
  selector: 'select:not([nativeSelect])',
  standalone: true,
})
export class SearchableSelectDirective implements OnInit, DoCheck, OnDestroy {
  private static nextId = 0;
  private static activeInstance?: SearchableSelectDirective;

  private readonly select: HTMLSelectElement;
  private wrapper?: HTMLDivElement;
  private input?: HTMLInputElement;
  private toggleButton?: HTMLButtonElement;
  private listbox?: HTMLDivElement;
  private open = false;
  private query = '';
  private activeIndex = -1;
  private filteredOptions: HTMLOptionElement[] = [];
  private lastValue = '';
  private lastDisabled = false;
  private observer?: MutationObserver;
  private readonly listeners: Array<() => void> = [];
  private associatedLabel?: HTMLLabelElement;
  private originalLabelFor: string | null = null;
  private readonly zone = inject(NgZone);

  constructor(
    element: ElementRef<HTMLSelectElement>,
    private readonly renderer: Renderer2,
  ) {
    this.select = element.nativeElement;
  }

  ngOnInit(): void {
    const parent = this.select.parentNode;
    if (!parent) return;

    const id = ++SearchableSelectDirective.nextId;
    const inputId = `searchable-select-input-${id}`;
    const listId = `searchable-select-list-${id}`;
    this.wrapper = this.renderer.createElement('div') as HTMLDivElement;
    this.input = this.renderer.createElement('input') as HTMLInputElement;
    this.toggleButton = this.renderer.createElement('button') as HTMLButtonElement;
    this.listbox = this.renderer.createElement('div') as HTMLDivElement;

    this.renderer.addClass(this.wrapper, 'searchable-select');
    this.renderer.addClass(this.input, 'searchable-select-input');
    this.renderer.addClass(this.toggleButton, 'searchable-select-toggle');
    this.renderer.addClass(this.listbox, 'searchable-select-listbox');
    this.renderer.setAttribute(this.input, 'id', inputId);
    this.renderer.setAttribute(this.input, 'type', 'text');
    this.renderer.setAttribute(this.input, 'autocomplete', 'off');
    this.renderer.setAttribute(this.input, 'role', 'combobox');
    this.renderer.setAttribute(this.input, 'aria-autocomplete', 'list');
    this.renderer.setAttribute(this.input, 'aria-expanded', 'false');
    this.renderer.setAttribute(this.input, 'aria-controls', listId);
    this.renderer.setAttribute(this.toggleButton, 'type', 'button');
    this.renderer.setAttribute(this.toggleButton, 'aria-label', 'Abrir opciones');
    this.renderer.setAttribute(this.toggleButton, 'aria-controls', listId);
    this.renderer.setAttribute(this.toggleButton, 'aria-expanded', 'false');
    this.renderer.setAttribute(this.toggleButton, 'title', 'Abrir o cerrar opciones');
    this.renderer.setAttribute(this.listbox, 'id', listId);
    this.renderer.setAttribute(this.listbox, 'role', 'listbox');
    this.renderer.setProperty(this.listbox, 'hidden', true);

    const accessibleLabel = this.select.getAttribute('aria-label')
      ?? this.select.labels?.[0]?.textContent?.trim()
      ?? 'Buscar opción';
    this.renderer.setAttribute(this.input, 'aria-label', accessibleLabel);
    this.renderer.setAttribute(this.input, 'placeholder', 'Buscar o seleccionar...');
    this.associatedLabel = this.select.labels?.[0] as HTMLLabelElement | undefined;
    if (this.associatedLabel?.htmlFor === this.select.id) {
      this.originalLabelFor = this.associatedLabel.htmlFor;
      this.renderer.setAttribute(this.associatedLabel, 'for', inputId);
    }

    this.renderer.insertBefore(parent, this.wrapper, this.select);
    this.renderer.appendChild(this.wrapper, this.input);
    this.renderer.appendChild(this.wrapper, this.toggleButton);
    this.renderer.appendChild(this.wrapper, this.select);
    this.renderer.addClass(this.select, 'searchable-select-source');
    this.renderer.setAttribute(this.select, 'aria-hidden', 'true');
    this.renderer.setProperty(this.select, 'tabIndex', -1);

    // Attach listbox to document.body so it escapes any overflow/modal ancestor.
    this.renderer.appendChild(document.body, this.listbox);
    this.renderer.setStyle(this.listbox, 'position', 'fixed');
    this.renderer.setStyle(this.listbox, 'z-index', '99999');

    // Los eventos de la lista solo modifican su propio DOM, así que se escuchan fuera de
    // Angular: de lo contrario cada clic, scroll o cambio de tamaño de la ventana, multiplicado
    // por cada <select> de la pantalla, dispararía una detección de cambios completa. Al elegir
    // una opción se emite 'change' en el <select>, que ngModel sí procesa dentro de Angular.
    this.zone.runOutsideAngular(() => this.attachListeners());
    this.syncState();
  }

  private attachListeners(): void {
    if (!this.input || !this.toggleButton || !this.listbox) return;
    this.listeners.push(this.renderer.listen(this.input, 'focus', () => this.openList()));
    this.listeners.push(this.renderer.listen(this.toggleButton, 'mousedown', (event: MouseEvent) => event.preventDefault()));
    this.listeners.push(this.renderer.listen(this.toggleButton, 'click', () => {
      if (this.open) {
        this.closeList();
        return;
      }
      this.input?.focus();
      if (!this.open) this.openList();
    }));
    this.listeners.push(this.renderer.listen(this.input, 'input', () => {
      this.activateList();
      this.query = this.input?.value ?? '';
      this.activeIndex = 0;
      this.open = true;
      this.positionListbox();
      this.renderOptions();
      this.updateExpandedState();
    }));
    this.listeners.push(this.renderer.listen(this.input, 'keydown', (event: KeyboardEvent) => this.handleKeydown(event)));
    this.listeners.push(this.renderer.listen(this.select, 'focus', () => this.input?.focus()));
    this.listeners.push(this.renderer.listen(this.listbox, 'mousedown', (event: MouseEvent) => event.preventDefault()));
    this.listeners.push(this.renderer.listen(this.listbox, 'click', (event: MouseEvent) => this.handleOptionClick(event)));
    this.listeners.push(this.renderer.listen('document', 'click', (event: MouseEvent) => {
      if (!this.wrapper?.contains(event.target as Node) && !this.listbox?.contains(event.target as Node)) this.closeList();
    }));
    this.listeners.push(this.renderer.listen('window', 'scroll', () => { if (this.open) this.positionListbox(); }));
    this.listeners.push(this.renderer.listen('window', 'resize', () => { if (this.open) this.positionListbox(); }));

    const MutationObserverType = this.select.ownerDocument.defaultView?.MutationObserver;
    if (MutationObserverType) {
      this.observer = new MutationObserverType(() => {
        if (this.open) this.renderOptions();
        else this.syncSelectedValue();
      });
      this.observer.observe(this.select, { childList: true, subtree: true, attributes: true, characterData: true });
    }
  }

  ngDoCheck(): void {
    this.syncState();
  }

  ngOnDestroy(): void {
    this.closeList();
    this.observer?.disconnect();
    this.listeners.forEach((removeListener) => removeListener());
    if (this.associatedLabel && this.originalLabelFor !== null) {
      this.renderer.setAttribute(this.associatedLabel, 'for', this.originalLabelFor);
    }
    this.renderer.removeClass(this.select, 'searchable-select-source');
    this.renderer.removeAttribute(this.select, 'aria-hidden');
    this.renderer.setProperty(this.select, 'tabIndex', 0);
    // Remove the listbox that was appended to document.body.
    if (this.listbox && document.body.contains(this.listbox)) {
      document.body.removeChild(this.listbox);
    }
  }

  private positionListbox(): void {
    if (!this.input || !this.listbox) return;
    const rect = this.input.getBoundingClientRect();
    const spaceBelow = window.innerHeight - rect.bottom;
    const spaceAbove = rect.top;
    const maxListboxH = 280;

    this.renderer.setStyle(this.listbox, 'left', `${rect.left}px`);
    this.renderer.setStyle(this.listbox, 'width', `${rect.width}px`);
    this.renderer.removeStyle(this.listbox, 'top');
    this.renderer.removeStyle(this.listbox, 'bottom');

    if (spaceBelow >= 120 || spaceBelow >= spaceAbove) {
      // Open downward
      this.renderer.setStyle(this.listbox, 'top', `${rect.bottom}px`);
      this.renderer.setStyle(this.listbox, 'max-height', `${Math.min(maxListboxH, spaceBelow - 8)}px`);
    } else {
      // Open upward
      this.renderer.setStyle(this.listbox, 'bottom', `${window.innerHeight - rect.top}px`);
      this.renderer.setStyle(this.listbox, 'max-height', `${Math.min(maxListboxH, spaceAbove - 8)}px`);
    }
  }

  private syncState(): void {
    if (!this.input) return;
    if (this.lastDisabled !== this.select.disabled) {
      this.lastDisabled = this.select.disabled;
      this.renderer.setProperty(this.input, 'disabled', this.lastDisabled);
      this.renderer.setProperty(this.toggleButton, 'disabled', this.lastDisabled);
      if (this.lastDisabled) this.closeList();
    }
    if (!this.open && this.lastValue !== this.select.value) {
      this.lastValue = this.select.value;
      this.syncSelectedValue();
    }
  }

  private syncSelectedValue(): void {
    if (!this.input || this.open) return;
    this.renderer.setProperty(this.input, 'value', this.select.selectedOptions[0]?.textContent?.trim() ?? '');
    this.lastValue = this.select.value;
  }

  private openList(): void {
    if (!this.input || this.select.disabled) return;
    this.activateList();
    this.open = true;
    this.query = '';
    this.activeIndex = this.select.selectedIndex >= 0 ? this.select.selectedIndex : 0;
    this.renderer.setProperty(this.input, 'value', this.select.selectedOptions[0]?.textContent?.trim() ?? '');
    this.input.select();
    this.positionListbox();
    this.renderOptions();
    this.updateExpandedState();
  }

  private closeList(): void {
    if (!this.open && this.listbox?.hidden) return;
    this.open = false;
    this.query = '';
    this.renderer.setProperty(this.listbox, 'hidden', true);
    this.updateExpandedState();
    if (SearchableSelectDirective.activeInstance === this) {
      SearchableSelectDirective.activeInstance = undefined;
    }
    this.syncSelectedValue();
  }

  private activateList(): void {
    const activeInstance = SearchableSelectDirective.activeInstance;
    if (activeInstance && activeInstance !== this) activeInstance.closeList();
    SearchableSelectDirective.activeInstance = this;
  }

  private renderOptions(): void {
    if (!this.listbox) return;
    const terms = this.normalize(this.query).trim().split(/\s+/).filter(Boolean);
    this.filteredOptions = Array.from(this.select.options).filter((option) => {
      if (option.disabled) return false;
      const text = this.normalize(option.textContent ?? '');
      return terms.every((term) => text.includes(term));
    });

    while (this.listbox.firstChild) this.renderer.removeChild(this.listbox, this.listbox.firstChild);
    if (this.filteredOptions.length === 0) {
      const empty = this.renderer.createElement('div');
      this.renderer.addClass(empty, 'searchable-select-empty');
      this.renderer.setAttribute(empty, 'role', 'status');
      this.renderer.setProperty(empty, 'textContent', 'No hay coincidencias.');
      this.renderer.appendChild(this.listbox, empty);
      this.renderer.removeAttribute(this.input, 'aria-activedescendant');
      return;
    }

    this.filteredOptions.forEach((option, index) => {
      const item = this.renderer.createElement('div');
      this.renderer.addClass(item, 'searchable-select-option');
      this.renderer.setAttribute(item, 'role', 'option');
      this.renderer.setAttribute(item, 'id', `${this.listbox?.id}-option-${index}`);
      this.renderer.setAttribute(item, 'data-option-index', String(index));
      this.renderer.setAttribute(item, 'aria-selected', option.selected ? 'true' : 'false');
      this.renderer.setProperty(item, 'textContent', option.textContent?.trim() ?? '');
      if (index === this.activeIndex) this.renderer.addClass(item, 'active');
      this.renderer.appendChild(this.listbox, item);
    });
    this.updateActiveDescendant();
  }

  private handleKeydown(event: KeyboardEvent): void {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      if (!this.open) this.openList();
      else this.moveActive(1);
      return;
    }
    if (event.key === 'ArrowUp' && this.open) {
      event.preventDefault();
      this.moveActive(-1);
      return;
    }
    if (event.key === 'Enter' && this.open) {
      event.preventDefault();
      const option = this.filteredOptions[this.activeIndex];
      if (option) this.selectOption(option);
      return;
    }
    if (event.key === 'Escape' && this.open) {
      event.preventDefault();
      this.closeList();
    }
  }

  private moveActive(offset: number): void {
    if (this.filteredOptions.length === 0) return;
    this.activeIndex = Math.min(Math.max(this.activeIndex + offset, 0), this.filteredOptions.length - 1);
    this.renderOptions();
    this.listbox?.querySelector(`#${this.listbox.id}-option-${this.activeIndex}`)?.scrollIntoView({ block: 'nearest' });
  }

  private handleOptionClick(event: MouseEvent): void {
    const target = event.target as HTMLElement;
    const optionElement = target.closest<HTMLElement>('[data-option-index]');
    const index = Number(optionElement?.getAttribute('data-option-index'));
    const option = this.filteredOptions[index];
    if (option) this.selectOption(option);
  }

  private selectOption(option: HTMLOptionElement): void {
    this.renderer.setProperty(this.select, 'selectedIndex', option.index);
    this.lastValue = this.select.value;
    this.select.dispatchEvent(new Event('change', { bubbles: true }));
    this.syncSelectedValue();
    this.closeList();
  }

  private updateExpandedState(): void {
    this.renderer.setAttribute(this.input, 'aria-expanded', this.open ? 'true' : 'false');
    this.renderer.setAttribute(this.toggleButton, 'aria-expanded', this.open ? 'true' : 'false');
    this.renderer.setAttribute(this.toggleButton, 'aria-label', this.open ? 'Cerrar opciones' : 'Abrir opciones');
    this.renderer.setProperty(this.listbox, 'hidden', !this.open);
  }

  private updateActiveDescendant(): void {
    if (this.activeIndex < 0 || this.activeIndex >= this.filteredOptions.length) {
      this.renderer.removeAttribute(this.input, 'aria-activedescendant');
      return;
    }
    this.renderer.setAttribute(this.input, 'aria-activedescendant', `${this.listbox?.id}-option-${this.activeIndex}`);
  }

  private normalize(value: string): string {
    return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase();
  }
}
