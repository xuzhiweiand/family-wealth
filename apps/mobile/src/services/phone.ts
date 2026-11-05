/** 中国大陆手机号校验与脱敏展示 */

export const PHONE_PATTERN = /^1[3-9]\d{9}$/;

export function isValidPhone(phone: string): boolean {
  return PHONE_PATTERN.test(phone);
}

/** 138****8000 */
export function maskPhone(phone: string): string {
  if (phone.length !== 11) return phone;
  return `${phone.slice(0, 3)}****${phone.slice(7)}`;
}
