import { Directive, ElementRef, HostListener, inject } from '@angular/core';

// Convierte a mayúsculas lo que se escribe en un input o textarea, aunque el teclado esté en
// minúsculas, conservando la posición del cursor. Vuelve a emitir "input" para que ngModel reciba
// el texto ya convertido, sin importar en qué orden corran los listeners. No toca el texto mientras
// se compone un carácter con tecla muerta (á, ñ...): lo convierte al terminar.
@Directive({
  selector: 'input[appMayusculas], textarea[appMayusculas]',
  standalone: true,
})
export class MayusculasDirective {
  private readonly element = inject<ElementRef<HTMLInputElement | HTMLTextAreaElement>>(ElementRef).nativeElement;

  @HostListener('input', ['$event'])
  onInput(event: Event): void {
    if ((event as InputEvent).isComposing) return;
    this.convertir();
  }

  @HostListener('compositionend')
  onCompositionEnd(): void {
    this.convertir();
  }

  private convertir(): void {
    const valor = this.element.value;
    const mayusculas = valor.toLocaleUpperCase('es');
    if (valor === mayusculas) return;
    const { selectionStart, selectionEnd } = this.element;
    this.element.value = mayusculas;
    this.element.setSelectionRange(selectionStart, selectionEnd);
    this.element.dispatchEvent(new Event('input', { bubbles: true }));
  }
}
