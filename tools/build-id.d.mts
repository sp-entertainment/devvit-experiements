export const buildInputs: () => Promise<string[]>;
export const hashBuildInputs: (
  paths: string[],
  baseDirectory?: string
) => Promise<string>;
export const getBuildId: () => Promise<string>;
