const releaseVersionPattern =
  /^\d+\.\d+\.\d+(?:-[0-9A-Za-z]+(?:\.[0-9A-Za-z]+)*)?(?:\+[0-9A-Za-z]+(?:\.[0-9A-Za-z]+)*)?$/;

export function isReleaseVersion(version) {
  return releaseVersionPattern.test(version);
}

export function deriveWindowsMsiVersion(version) {
  const parsed = parseReleaseVersion(version);
  const major = readMsiField(parsed.major, "major", 255);
  const minor = readMsiField(parsed.minor, "minor", 255);
  const patch = readMsiField(parsed.patch, "patch", 65535);

  if (!parsed.prerelease) {
    return `${major}.${minor}.${patch}`;
  }

  const prereleaseNumber = readPrereleaseBuildNumber(
    parsed.prerelease,
    version,
  );
  const build = readMsiField(prereleaseNumber, "build", 65535);
  return `${major}.${minor}.${patch}.${build}`;
}

function parseReleaseVersion(version) {
  const match = version.match(
    /^(?<major>\d+)\.(?<minor>\d+)\.(?<patch>\d+)(?:-(?<prerelease>[0-9A-Za-z]+(?:\.[0-9A-Za-z]+)*))?(?:\+(?<build>[0-9A-Za-z]+(?:\.[0-9A-Za-z]+)*))?$/,
  );

  if (!match?.groups) {
    throw new Error(`release version is not valid semver: ${version}`);
  }

  return match.groups;
}

function readPrereleaseBuildNumber(prerelease, version) {
  const numericPart = prerelease
    .split(".")
    .findLast((part) => /^\d+$/.test(part));

  if (!numericPart) {
    throw new Error(
      `release version ${version} has prerelease "${prerelease}", but Windows MSI needs a numeric prerelease identifier such as alpha.1`,
    );
  }

  return numericPart;
}

function readMsiField(value, label, max) {
  const number = Number(value);

  if (!Number.isSafeInteger(number) || number < 0 || number > max) {
    throw new Error(
      `Windows MSI ${label} version field ${value} must be between 0 and ${max}`,
    );
  }

  return number;
}
