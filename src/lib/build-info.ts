export interface BuildInfo {
  sha: string;
  builtAt: string;
}

export const buildInfo: BuildInfo = {
  sha: typeof __BUILD_SHA__ !== 'undefined' ? __BUILD_SHA__ : 'dev',
  builtAt: typeof __BUILD_TIME__ !== 'undefined' ? __BUILD_TIME__ : '',
};

export function formatBuiltAt(iso?: string): string {
  if (!iso) {
    return '';
  }

  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return iso;
  }

  return date.toISOString().slice(0, 10);
}
