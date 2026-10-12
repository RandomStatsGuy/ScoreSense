const object = value => value && typeof value === "object" && !Array.isArray(value);
const fail = reason => { throw new Error(`Exposure bounds: ${reason}`); };

/** Exact request fractions/counts, independent of selector-reported outcomes. */
export function exposureBoundCount(value, count, kind) {
  if (object(value)) {
    const softDecimal = kind === "target" && typeof value.count === "string" &&
      /^(?:\d+(?:\.\d+)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(value.count);
    const number = softDecimal ? Number(value.count) : value.count;
    if (Object.keys(value).length !== 1 || !Object.hasOwn(value, "count") || typeof number !== "number" ||
        !Number.isFinite(number) || number < 0 || number > count ||
        (kind !== "target" && !Number.isSafeInteger(number))) fail("invalid exposure count bound.");
    return number;
  }
  if (!["number", "string"].includes(typeof value)) fail("invalid exposure fraction bound.");
  const match = /^(\d*)(?:\.(\d+))?(?:[eE]([+-]?\d+))?$/.exec(String(value).trim());
  if (!match || (!match[1] && !match[2]) || (match[1] + (match[2] || "")).length > 30) fail("invalid exposure fraction bound.");
  const exponent = Number(match[3] || 0), scale = (match[2] || "").length - exponent;
  if (Math.abs(scale) > 30) fail("invalid exposure fraction precision.");
  let numerator = BigInt((match[1] || "0") + (match[2] || "")), denominator = 1n;
  if (scale >= 0) denominator = 10n ** BigInt(scale); else numerator *= 10n ** BigInt(-scale);
  if (numerator > denominator) fail("exposure fractions must be between zero and one.");
  const scaled = numerator * BigInt(count);
  return kind === "min" ? Number((scaled + denominator - 1n) / denominator)
    : kind === "max" ? Number(scaled / denominator) : Number(scaled) / Number(denominator);
}
