import * as mathjs from "mathjs";

interface BaseUnit {
  readonly unit: mathjs.Unit;
  readonly unitDef: string;
  readonly valueFieldName: string;
}

function mkBaseUnit<S extends string>(
  unitDef: string,
  valueFieldName: S,
): BaseUnit & { valueFieldName: S } {
  const unit = mathjs.unit(unitDef);
  return {
    unit,
    unitDef,
    valueFieldName,
  };
}

interface Dimension {
  readonly name: string;
  readonly baseUnit: BaseUnit;
}

export const dimensions = {
  Dimensionless: {
    name: "Dimensionless",
    baseUnit: mkBaseUnit("1", "value"),
  },
  Time: {
    name: "Time",
    baseUnit: mkBaseUnit("s", "seconds"),
  },
  Length: {
    name: "Length",
    baseUnit: mkBaseUnit("m", "meters"),
  },
  LinearVelocity: {
    name: "Linear Velocity",
    baseUnit: mkBaseUnit("m/s", "meters_per_sec"),
  },
  LinearAcceleration: {
    name: "Linear Acceleration",
    baseUnit: mkBaseUnit("m/s^2", "meters_per_sec2"),
  },
  Angle: {
    name: "Angle",
    baseUnit: mkBaseUnit("rad", "radians"),
  },
  AngularVelocity: {
    name: "Angular Velocity",
    baseUnit: mkBaseUnit("rad/s", "radians_per_sec"),
  },
  AngularAcceleration: {
    name: "Angular Acceleration",
    baseUnit: mkBaseUnit("rad/s^2", "radians_per_sec2"),
  },
  Mass: {
    name: "Mass",
    baseUnit: mkBaseUnit("kg", "kilograms"),
  },
} as const satisfies Record<string, Dimension>;
type Dimensions = typeof dimensions;
export type DimensionName = keyof Dimensions;

function isDimensionless(
  dimension: DimensionName,
): dimension is "Dimensionless" {
  return dimension === "Dimensionless";
}

function compatibleDimensions(
  a: mathjs.Unit | DimensionName,
  b: mathjs.Unit | DimensionName,
): boolean {
  function getUnit(value: mathjs.Unit | DimensionName): mathjs.Unit | null {
    if (mathjs.isUnit(value)) {
      return value;
    } else if (typeof value === "string" && value in dimensions) {
      return dimensions[value].baseUnit.unit;
    } else {
      return null;
    }
  }

  const unitA = getUnit(a);
  const unitB = getUnit(b);
  if (unitA === null || unitB === null) {
    return false;
  }

  return unitA.equalBase(unitB);
}

/**
 * Non distributive across D, a UnitExpressionInner<"a" | "b"> may have incorrect unit getters available
 * Eg. UnitExpressionInner<"Length" | "Angle"> has both .meters and .radians available.
 * A unit expression of unknown dimension should instead have no unit getters as it is not known what unit it is, and
 * the getters are only added for it's actual runtime dimension
 */
type UnitExpressionInner<D extends DimensionName> = {
  readonly expression: string;
  readonly dimension: D;
  readonly formattedValue: string;
  readonly baseUnitValue: number;
} & Record<Dimensions[D]["baseUnit"]["valueFieldName"], number>;

/**
 * A unit-aware value of a specified dimension.
 * When D is a single possible Dimension (not a union) a field will be provided to get the value in base units, eg. "meters"
 * When the dimension is
 */
export type UnitExpression<D extends DimensionName> = D extends unknown
  ? UnitExpressionInner<D>
  : never;

export function isUnitExpression<D extends DimensionName>(
  value: unknown,
  dimension: D,
): value is UnitExpression<D> {
  const baseUnitGetter = dimensions[dimension].baseUnit.valueFieldName;
  return (
    mathjs.isUnit(value) &&
    "expression" in value &&
    typeof value.expression === "string" &&
    "dimension" in value &&
    value.dimension === dimension &&
    "baseUnitValue" in value &&
    typeof value.baseUnitValue === "number" &&
    baseUnitGetter in value
  );
}

function validateExpressionForDimension<D extends DimensionName>(
  expression: mathjs.MathNode,
  dimension: D,
): mathjs.MathNode | null {
  let newNumber: mathjs.MathType | undefined | null;
  try {
    newNumber = expression.evaluate();
  } catch {
    // Error parsing expression
    return null;
  }

  if (newNumber == undefined || newNumber === null) {
    // Error parsing expression
    return null;
  }

  // Dimensionless results can be returned as plain numbers
  if (typeof newNumber === "number") {
    if (!isFinite(newNumber)) {
      // Error: Not a finite number
      return null;
    }

    // Check if we expect a dimensionless result
    if (isDimensionless(dimension)) {
      return expression;
    } else {
      // Error: Expected a unit, but got a dimensionless number
      return null;
    }
  }

  if (!mathjs.isUnit(newNumber)) {
    // Error: Not a unit or plain number
    return null;
  }

  // newNumber is a valid unit
  // Check if the unit is compatible with the base unit
  if (compatibleDimensions(dimension, newNumber)) {
    return expression;
  }

  // Error: Unit is not compatible with the expected dimension
  return null;
}

function unsafeMkUnitExpression<D extends DimensionName>(
  expression: mathjs.MathNode,
  dimension: D,
): UnitExpression<D> | null {
  const result = expression.evaluate();

  let value: mathjs.Unit;
  let baseUnitValue: number;
  if (typeof result == "number") {
    value = mathjs.unit(result);
    baseUnitValue = result;
  } else if (mathjs.isUnit(result)) {
    value = result;

    if (compatibleDimensions(result, "Dimensionless")) {
      baseUnitValue = result.toNumber();
    } else {
      baseUnitValue = result.toNumber(dimensions[dimension].baseUnit.unitDef);
    }
  } else {
    return null;
  }

  return {
    expression: expression.toString(),
    dimension,
    formattedValue: mathjs.format(value),
    baseUnitValue,
    get [dimensions[dimension].baseUnit.valueFieldName]() {
      return this.baseUnitValue;
    },
  } as UnitExpression<D>;
}

export function mkUnitExpression<D extends DimensionName>(
  expression: mathjs.MathNode,
  dimension: D,
): UnitExpression<D> | null {
  const validNode = validateExpressionForDimension(expression, dimension);
  if (validNode) {
    return unsafeMkUnitExpression(validNode, dimension);
  }

  return null;
}

export function parseUnitExpression<D extends DimensionName>(
  expression: string,
  dimension: D,
): UnitExpression<D> | null {
  return mkUnitExpression(mathjs.parse(expression), dimension);
}

export interface UnitFactory<D extends DimensionName = DimensionName> {
  of: (value: number) => UnitExpression<D>;
}

function factoryFromUnit<D extends DimensionName>(
  unit: mathjs.Unit,
  dimension: D,
): UnitFactory<D> {
  if (!compatibleDimensions(dimension, unit)) {
    throw "factoryFromUnit: unit not compatible with dimension " + dimension;
  }

  return {
    of(value) {
      if (compatibleDimensions(unit, "Dimensionless")) {
        return unsafeMkUnitExpression(
          new mathjs.ConstantNode(value),
          dimension,
        )!;
      }

      return unsafeMkUnitExpression(
        mathjs.parse(mathjs.unit(value, unit.toString()).toString()),
        dimension,
      )!;
    },
  };
}

function factoryFromBaseUnit<D extends DimensionName>(
  dimension: D,
): UnitFactory<D> {
  return factoryFromUnit(dimensions[dimension].baseUnit.unit, dimension);
}

export const units = {
  //Dimensionless: factoryFromBaseUnit("Dimensionless"),
  Second: factoryFromBaseUnit("Time"),
  Meter: factoryFromBaseUnit("Length"),
  MeterPerSecond: factoryFromBaseUnit("LinearVelocity"),
  MeterPerSecondSquared: factoryFromBaseUnit("LinearAcceleration"),
  Radian: factoryFromBaseUnit("Angle"),
  RadianPerSecond: factoryFromBaseUnit("AngularVelocity"),
  RadianPerSecondSquared: factoryFromBaseUnit("AngularAcceleration"),
  Degree: factoryFromUnit(mathjs.unit("deg"), "Angle"),
  DegreePerSecond: factoryFromUnit(mathjs.unit("deg/s"), "AngularVelocity"),
  DegreePerSecondSquared: factoryFromUnit(
    mathjs.unit("deg/s^2"),
    "AngularAcceleration",
  ),
  Kilogram: factoryFromBaseUnit("Mass"),
} as const;
