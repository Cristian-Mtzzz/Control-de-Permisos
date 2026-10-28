import { apiErrorMessage, toPascalCase } from './api-response';

describe('toPascalCase', () => {
  it('convierte claves camelCase de objetos anidados y arreglos', () => {
    const result = toPascalCase<{ Items: { IdEquipo: number; NCombo: string | null }[]; TotalCount: number }>({
      items: [{ idEquipo: 7, nCombo: null }],
      totalCount: 1,
    });

    expect(result).toEqual({ Items: [{ IdEquipo: 7, NCombo: null }], TotalCount: 1 });
  });

  it('deja intactas las respuestas que ya vienen en PascalCase', () => {
    const body = { IdUsuario: 3, Modules: ['TALLER'], IsSuperAdmin: false };

    expect(toPascalCase(body)).toEqual(body);
  });

  it('respeta valores primitivos y null', () => {
    expect(toPascalCase(null)).toBeNull();
    expect(toPascalCase('texto')).toBe('texto');
    expect(toPascalCase(['A', 'B'])).toEqual(['A', 'B']);
  });
});

describe('apiErrorMessage', () => {
  it('usa el Message de la API en PascalCase o camelCase', () => {
    expect(apiErrorMessage({ error: { Message: 'Duplicado.' } }, 'Respaldo')).toBe('Duplicado.');
    expect(apiErrorMessage({ error: { message: 'Duplicado.' } }, 'Respaldo')).toBe('Duplicado.');
  });

  it('usa el título de ProblemDetails cuando no hay Message', () => {
    expect(apiErrorMessage({ error: { title: 'One or more validation errors occurred.' } }, 'Respaldo'))
      .toBe('One or more validation errors occurred.');
    expect(apiErrorMessage({ error: { Title: 'One or more validation errors occurred.' } }, 'Respaldo'))
      .toBe('One or more validation errors occurred.');
  });

  it('usa el respaldo cuando el error no trae cuerpo útil', () => {
    expect(apiErrorMessage({ error: null, message: 'Http failure response' }, 'Respaldo')).toBe('Respaldo');
    expect(apiErrorMessage({ error: 'texto plano' }, 'Respaldo')).toBe('Respaldo');
    expect(apiErrorMessage(undefined, 'Respaldo')).toBe('Respaldo');
  });
});
