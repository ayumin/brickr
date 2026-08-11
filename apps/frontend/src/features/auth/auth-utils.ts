import { HANDLE_PATTERN, MIN_PASSWORD_LENGTH, MIN_SIGNUP_AGE_YEARS } from "@brickr/shared";

const HANDLE_REGEXP = new RegExp(HANDLE_PATTERN);
const BIRTHDATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/u;

export type SignupFormValues = {
  inviteCode: string;
  email: string;
  password: string;
  handle: string;
  displayName: string;
  birthdate: string;
};

/**
 * Everything checkable before a request is even sent. Mirrors, but does not
 * replace, the backend's `signupSchema` - the backend still validates
 * independently (CLAUDE.md §55), this only avoids a pointless round trip.
 * Returns a single message for the first problem found, since the form only
 * has room to show one error banner at a time.
 */
export function validateSignupForm(values: SignupFormValues): string | null {
  if (values.inviteCode.trim().length === 0) {
    return "招待コードを入力してください。";
  }
  if (values.email.trim().length === 0) {
    return "メールアドレスを入力してください。";
  }
  if (values.password.length < MIN_PASSWORD_LENGTH) {
    return `パスワードは${String(MIN_PASSWORD_LENGTH)}文字以上で入力してください。`;
  }
  if (!HANDLE_REGEXP.test(values.handle.trim().toLowerCase())) {
    return "ハンドルは半角英小文字・数字・_のみ、3〜32文字で入力してください。";
  }
  if (values.displayName.trim().length === 0) {
    return "表示名を入力してください。";
  }
  if (!isOldEnough(values.birthdate, MIN_SIGNUP_AGE_YEARS)) {
    return `生年月日を入力してください（${String(MIN_SIGNUP_AGE_YEARS)}歳未満は登録できません）。`;
  }
  return null;
}

function isOldEnough(birthdate: string, minimumAgeYears: number): boolean {
  if (!BIRTHDATE_PATTERN.test(birthdate)) {
    return false;
  }
  const born = new Date(`${birthdate}T00:00:00Z`);
  if (Number.isNaN(born.getTime())) {
    return false;
  }
  const cutoff = new Date(born);
  cutoff.setUTCFullYear(cutoff.getUTCFullYear() + minimumAgeYears);
  return cutoff.getTime() <= Date.now();
}
