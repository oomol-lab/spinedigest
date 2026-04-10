type EnumLike = Record<string, string>;

export function createEnumValueGuard<TEnum extends EnumLike>(enumType: TEnum) {
  const valueSet = new Set<string>(Object.values(enumType));

  return (value: string): value is TEnum[keyof TEnum] => valueSet.has(value);
}

export function createEnumValueAsserter<TEnum extends EnumLike>(
  enumType: TEnum,
  label: string,
) {
  const isEnumValue = createEnumValueGuard(enumType);

  return (value: string): TEnum[keyof TEnum] => {
    if (isEnumValue(value)) {
      return value;
    }

    throw new Error(`Unknown ${label}: ${value}`);
  };
}
