// Utilidades para leer respuestas de la API.
//
// La API responde en PascalCase (IdEquipo, Message...), igual que los modelos del
// frontend. toPascalCase también acepta respuestas en camelCase para que el frontend
// siga funcionando si se despliega antes que una API que aún no tenga ese formato.

type ApiErrorBody = {
  Message?: string; message?: string;
  Detail?: string; detail?: string;
  Title?: string; title?: string;
} | string | null;

export interface ApiError {
  error?: ApiErrorBody;
  message?: string;
}

// Convierte sobre el mismo objeto, sin copiarlo: cada respuesta HTTP es un objeto nuevo y, como
// la API ya responde en PascalCase, lo normal es que no haya ninguna clave que cambiar.
export function toPascalCase<T>(value: unknown): T {
  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index++) value[index] = toPascalCase(value[index]);
    return value as T;
  }
  if (value === null || typeof value !== 'object') return value as T;

  const record = value as Record<string, unknown>;
  for (const key of Object.keys(record)) {
    const item = toPascalCase(record[key]);
    const pascalKey = key.charAt(0).toUpperCase() + key.slice(1);
    if (pascalKey !== key) delete record[key];
    record[pascalKey] = item;
  }
  return record as T;
}

// Mensaje para el usuario a partir de un error HTTP: primero el Message de la API,
// luego los campos de ProblemDetails y por último el texto de respaldo.
export function apiErrorMessage(error: ApiError | null | undefined, fallback: string): string {
  const body = error?.error;
  if (body && typeof body === 'object') {
    const message = body.Message ?? body.message ?? body.Detail ?? body.detail ?? body.Title ?? body.title;
    if (message) return message;
  }
  return fallback;
}
