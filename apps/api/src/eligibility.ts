export type RecipientLike = {
  emailConsent?: number | boolean;
  email_consent?: number | boolean;
  unsubscribedAt?: string | null;
  unsubscribed_at?: string | null;
};

function consented(customer: RecipientLike) {
  return (
    customer.emailConsent === 1 ||
    customer.emailConsent === true ||
    customer.email_consent === 1 ||
    customer.email_consent === true
  );
}

export function isEmailEligible(customer: RecipientLike) {
  return consented(customer) && !customer.unsubscribedAt && !customer.unsubscribed_at;
}

export function exclusionReason(customer: RecipientLike) {
  if (customer.unsubscribedAt || customer.unsubscribed_at) return 'unsubscribed';
  if (!consented(customer)) return 'no_email_consent';
  return null;
}
