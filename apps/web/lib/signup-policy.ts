const domainPattern = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
const localPattern = /^[a-z0-9!#$%&'+/=?^_`{|}~-]+(?:\.[a-z0-9!#$%&'+/=?^_`{|}~-]+)*$/;

export function normalizeEmail(value: string) {
  return value.trim().toLowerCase();
}

export function isEmailAddress(email: string) {
  const [local, domain, ...rest] = email.split("@");
  return email.length <= 254 && local.length <= 64 && !!domain && rest.length === 0
    && localPattern.test(local) && domainPattern.test(domain);
}

export function signupEmailPolicy(setting?: string) {
  if (!setting?.trim()) return () => true;

  const entries = setting.split(",").map(normalizeEmail);
  if (entries.some((entry) => entry.startsWith("*@")
    ? !domainPattern.test(entry.slice(2))
    : !isEmailAddress(entry))) {
    console.error("SIGNUP_EMAIL_ALLOWLIST contains an invalid address or domain pattern.");
    return () => false;
  }

  const allowlist = new Set(entries);
  return (email: string) => allowlist.has(email) || allowlist.has(`*@${email.split("@")[1]}`);
}
