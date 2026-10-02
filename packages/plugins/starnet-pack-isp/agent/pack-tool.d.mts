export function unwrapToolResult(out: unknown): { content?: string; data?: unknown; error?: string } | null | undefined;
export function parseParams(args: string[]): Record<string, unknown>;
