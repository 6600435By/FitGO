/** Strip to digits and normalize Belarus mobile to 375XXXXXXXXX. */
export function normalizePhone(phone: string): string {
  let digits = phone.replace(/\D/g, '');
  if (digits.length === 9) {
    digits = `375${digits}`;
  } else if (digits.length === 11 && digits.startsWith('80')) {
    digits = `375${digits.slice(2)}`;
  } else if (digits.length === 10 && digits.startsWith('8')) {
    digits = `375${digits.slice(1)}`;
  }
  return digits;
}

export function phonesMatch(a: string, b: string): boolean {
  const left = normalizePhone(a);
  const right = normalizePhone(b);
  if (!left || !right) return false;
  if (left === right) return true;
  if (left.length >= 9 && right.length >= 9) {
    return left.slice(-9) === right.slice(-9);
  }
  return false;
}
