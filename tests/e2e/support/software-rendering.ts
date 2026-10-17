// Committed screenshot baselines were rasterized by SwiftShader, and GPU
// rasterization differs in antialiasing and text. Apply with a top-level
// `test.use(softwareRendering)` in specs that compare screenshots.
export const softwareRendering = { launchOptions: {} };
