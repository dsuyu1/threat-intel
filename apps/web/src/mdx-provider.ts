// Minimal MDX components provider for React Server Components / Edge runtime.
// Avoids @mdx-js/react's context usage (createContext), which can break under React's server conditions.

export function useMDXComponents(components?: Record<string, unknown>) {
  return components ?? {};
}

