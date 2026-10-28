import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { FormsModule } from '@angular/forms';
import { MayusculasDirective } from './mayusculas.directive';

@Component({
  imports: [FormsModule, MayusculasDirective],
  template: `<input appMayusculas [(ngModel)]="valor" name="valor" />`,
})
class HostComponent {
  valor = '';
}

describe('MayusculasDirective', () => {
  async function escribir(texto: string): Promise<{ input: HTMLInputElement; host: HostComponent }> {
    const fixture = TestBed.createComponent(HostComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    const input = fixture.nativeElement.querySelector('input') as HTMLInputElement;
    input.value = texto;
    input.dispatchEvent(new Event('input'));
    return { input, host: fixture.componentInstance };
  }

  it('convierte lo escrito a mayúsculas en el campo y en el modelo', async () => {
    const { input, host } = await escribir('soporte técnico ñandú');
    expect(input.value).toBe('SOPORTE TÉCNICO ÑANDÚ');
    expect(host.valor).toBe('SOPORTE TÉCNICO ÑANDÚ');
  });

  it('no cambia un texto que ya está en mayúsculas', async () => {
    const { input, host } = await escribir('DESARROLLO 2');
    expect(input.value).toBe('DESARROLLO 2');
    expect(host.valor).toBe('DESARROLLO 2');
  });
});
