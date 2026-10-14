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

/** `tel:+375…` for mobile dialers; undefined if no usable digits. */
export function phoneTelHref(phone?: string | null): string | undefined {
  if (!phone) return undefined;
  const digits = normalizePhone(phone);
  return digits ? `tel:+${digits}` : undefined;
}
