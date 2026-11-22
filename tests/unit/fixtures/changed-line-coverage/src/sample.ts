// Fixture for tests/unit/changed_line_coverage.test.js (#720).
// The test compiles it with `tsc --inlineSourceMap` into a temporary root and
// asserts on LINE NUMBERS of this file: keep the layout when editing it.
interface Options {
  double: boolean;
}

export function used(value: number, options: Options): number {
  if (options.double) {
    return value * 2;
  }
  return value + 1000;
}

export function neverCalled(value: number): number {
  const next = value + 1;
  return next * 3;
}

used(21, { double: true });
