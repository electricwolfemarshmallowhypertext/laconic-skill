export function compareCodepointStable(left: string, right: string): number {
  if (left === right) {
    return 0;
  }

  const leftChars = [...left];
  const rightChars = [...right];
  const maxSharedLength = Math.min(leftChars.length, rightChars.length);

  for (let index = 0; index < maxSharedLength; index += 1) {
    const leftCodepoint = leftChars[index].codePointAt(0)!;
    const rightCodepoint = rightChars[index].codePointAt(0)!;
    if (leftCodepoint !== rightCodepoint) {
      return leftCodepoint - rightCodepoint;
    }
  }

  return leftChars.length - rightChars.length;
}
