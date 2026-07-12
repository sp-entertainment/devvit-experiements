const minimumNodeVersion = [22, 2, 0];

export const isSupportedNodeVersion = (version) => {
  const match = /^(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/.exec(version);
  if (!match) return false;

  const actual = match.slice(1).map(Number);
  return (
    minimumNodeVersion.some((minimum, index) => {
      if (actual[index] === minimum) return false;
      return (
        actual[index] > minimum &&
        actual
          .slice(0, index)
          .every((part, partIndex) => part === minimumNodeVersion[partIndex])
      );
    }) || actual.every((part, index) => part === minimumNodeVersion[index])
  );
};

export const inspectCredentials = async ({
  credentialsPath,
  readFile,
  stat,
}) => {
  const failures = [];

  try {
    const metadata = await stat(credentialsPath);
    if ((metadata.mode & 0o077) !== 0) {
      failures.push(
        'Credential file permissions must not allow group or other access.'
      );
    }

    const accounts = JSON.parse(await readFile(credentialsPath, 'utf8'));
    const primary = accounts?.primary;
    const secondary = accounts?.secondary;
    if (
      typeof primary?.username !== 'string' ||
      !primary.username ||
      typeof primary?.password !== 'string' ||
      !primary.password ||
      typeof secondary?.username !== 'string' ||
      !secondary.username ||
      typeof secondary?.password !== 'string' ||
      !secondary.password ||
      primary.username === secondary.username
    ) {
      failures.push(
        'Credential file must contain distinct primary and secondary username/password pairs.'
      );
    }
  } catch (error) {
    failures.push(
      error instanceof SyntaxError
        ? 'Credential file is not valid JSON.'
        : 'Credential file is missing or unreadable.'
    );
  }

  return failures;
};
