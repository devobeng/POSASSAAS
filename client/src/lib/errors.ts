interface ApiErrorBody {
  message?: string;
  errors?: Record<string, string[] | undefined> | string;
}

function humanizeField(field: string): string {
  return field.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/^./, (c) => c.toUpperCase());
}

/**
 * Extracts a friendly, specific message from an API error response. Prefers
 * Zod's per-field validation details (which the generic "Validation failed"
 * wrapper message hides) over the top-level message, and falls back to a
 * caller-supplied default when the server gives nothing usable.
 */
export function getErrorMessage(err: unknown, fallback: string): string {
  const data = (err as { response?: { data?: ApiErrorBody } } | undefined)?.response?.data;
  if (!data) return fallback;

  if (data.errors && typeof data.errors === 'object') {
    const entries = Object.entries(data.errors).filter(
      (entry): entry is [string, string[]] => !!entry[1]?.length,
    );
    if (entries.length === 1) {
      return entries[0][1].join(' ');
    }
    if (entries.length > 1) {
      return entries.map(([field, msgs]) => `${humanizeField(field)}: ${msgs.join(', ')}`).join(' ');
    }
  }

  if (typeof data.errors === 'string' && data.errors) return data.errors;

  if (data.message && data.message !== 'Validation failed') return data.message;

  return fallback;
}
