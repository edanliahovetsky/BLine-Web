export const betaSeason = 2027;
export const betaWebsite = "https://web-beta.bline-web.pages.dev/";

export function releaseMetadata(version: string, channel = "stable") {
  if (channel !== "stable" && channel !== "beta") {
    throw new Error(`Unknown release channel: ${channel}`);
  }
  const beta = version.match(/^\d+\.\d+\.\d+-beta\.([1-9]\d*)$/);
  if (channel === "beta" && !beta) {
    throw new Error("Beta builds require a version such as 1.0.0-beta.1");
  }
  return {
    version,
    channel,
    tag: `v${version}`,
    releaseName:
      channel === "beta"
        ? `BLine Web ${betaSeason} Beta ${beta![1]}`
        : `BLine Web v${version}`,
    appName: channel === "beta" ? "BLine Web Beta" : "BLine Web",
    prerelease: version.includes("-"),
  };
}
