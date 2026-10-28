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

export function toPascalCase<T>(value: unknown): T {
  if (Array.isArray(value)) return value.map((item) => toPascalCase(item)) as T;
  if (value === null || typeof value !== 'object') return value as T;

  const result: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    result[key.charAt(0).toUpperCase() + key.slice(1)] = toPascalCase(item);
  }
  return result as T;
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
