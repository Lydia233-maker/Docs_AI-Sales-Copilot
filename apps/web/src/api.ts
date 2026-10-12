const json = (res: Response) => res.json();

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    credentials: 'include',
    ...init,
    headers: {
      ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
      ...(init?.headers || {}),
    },
  });
  const data = await json(res).catch(() => ({}));
  if (!res.ok) {
    const message = data?.error?.message || data?.message;
    throw new Error(typeof message === 'string' ? message : '请求失败');
  }
  return data as T;
}

export const api = {
  login: (email: string, password: string) =>
    request('/api/v1/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) }),
  logout: () => request('/api/v1/auth/logout', { method: 'POST' }),
  me: () => request<{ store: { name: string; company_address: string } }>('/api/v1/auth/me'),
  overview: () => request<Overview>('/api/v1/overview'),
  customers: (query = '') => request<{ items: Customer[]; total: number }>(`/api/v1/customers${query}`),
  previewImport: (customersCsv: string, ordersCsv: string) =>
    request<ImportPreview>('/api/v1/imports/preview', {
      method: 'POST',
      body: JSON.stringify({ customersCsv, ordersCsv }),
    }),
  confirmImport: (customersCsv: string, ordersCsv: string) =>
    request<{ customers: number; spanish: number; orders: number; skippedCustomers: number }>('/api/v1/imports/customers-orders', {
      method: 'POST',
      body: JSON.stringify({ customersCsv, ordersCsv }),
    }),
  previewAbandoned: (abandonedCsv: string) =>
    request<AbandonedPreview>('/api/v1/imports/abandoned/preview', {
      method: 'POST',
      body: JSON.stringify({ abandonedCsv }),
    }),
  confirmAbandoned: (abandonedCsv: string) =>
    request<{ checkouts: number; matched: number; unmatched: number }>('/api/v1/imports/abandoned', {
      method: 'POST',
      body: JSON.stringify({ abandonedCsv }),
    }),
  previewGorgias: (csv: string) =>
    request<GorgiasPreview>('/api/v1/imports/gorgias/preview', { method: 'POST', body: JSON.stringify({ csv }) }),
  confirmGorgias: (csv: string) =>
    request<{ matched: number; unmatched: number; skipped: number; created: number }>('/api/v1/imports/gorgias', {
      method: 'POST',
      body: JSON.stringify({ csv }),
    }),
  decideFact: (id: string, decision: 'confirm' | 'dismiss') =>
    request<{ status: string }>(`/api/v1/facts/${id}/decision`, {
      method: 'POST',
      body: JSON.stringify({ decision }),
    }),
  customer: (id: string) => request<CustomerDetail>(`/api/v1/customers/${id}`),
  updateLanguage: (id: string, language: 'en' | 'es') =>
    request<Customer>(`/api/v1/customers/${id}/language`, {
      method: 'PATCH',
      body: JSON.stringify({ language }),
    }),
  store: () => request<{ id: string; name: string; companyAddress: string }>('/api/v1/store'),
  updateAddress: (companyAddress: string) =>
    request<{ companyAddress: string }>('/api/v1/store', {
      method: 'PATCH',
      body: JSON.stringify({ companyAddress }),
    }),
  addNote: (id: string, text: string) =>
    request<{ privacyWarnings: string[] }>(`/api/v1/customers/${id}/notes`, {
      method: 'POST',
      body: JSON.stringify({ text }),
    }),
  addTag: (id: string, tag: string) =>
    request<{ preferenceTags: string[] }>(`/api/v1/customers/${id}/tags`, {
      method: 'POST',
      body: JSON.stringify({ tag }),
    }),
  preview: (body: object) => request<Preview>('/api/v1/audience/preview', { method: 'POST', body: JSON.stringify(body) }),
  createOutreach: (body: object) =>
    request<Outreach>('/api/v1/outreach', { method: 'POST', body: JSON.stringify(body) }),
  listOutreach: () => request<{ items: OutreachListItem[]; total: number }>('/api/v1/outreach'),
  getOutreach: (id: string) => request<Outreach>(`/api/v1/outreach/${id}`),
  generate: (id: string) => request<Outreach>(`/api/v1/outreach/${id}/generate`, { method: 'POST' }),
  continueGeneration: (id: string) => request<Outreach>(`/api/v1/outreach/${id}/continue`, { method: 'POST' }),
  regenerateDraft: (id: string) => request<Draft>(`/api/v1/drafts/${id}/regenerate`, { method: 'POST' }),
  updateDraft: (id: string, body: string) =>
    request<Draft>(`/api/v1/drafts/${id}`, { method: 'PATCH', body: JSON.stringify({ body }) }),
  reviewDraft: (id: string) =>
    request<Draft>(`/api/v1/drafts/${id}/review`, { method: 'POST', body: JSON.stringify({ decision: 'approve' }) }),
  bulkApprove: (id: string) =>
    request<{ approved: number; skipped: number } & Outreach>(`/api/v1/outreach/${id}/drafts/bulk-approve`, {
      method: 'POST',
    }),
  renderDraft: (id: string) => request<{ subject: string; body: string }>(`/api/v1/drafts/${id}/rendered`),
  send: (id: string) => request<{ sent: number; sender: string }>(`/api/v1/outreach/${id}/send`, { method: 'POST' }),
};

export type OverviewScene = {
  scenario: string;
  missingAbandoned: boolean;
  total: number | null;
  reachable: number | null;
  personalized: number | null;
  cohortGroups: number | null;
};

export type Overview = {
  total: number;
  incomplete: number;
  addressable: number;
  noConsent: number;
  languages: { en: number; es: number };
  scenes: OverviewScene[];
};

export type ImportPreview = {
  customerRows: number;
  customers: number;
  skippedCustomers: number;
  spanish: number;
  notes: number;
  orderRows: number;
  orders: number;
  unmatchedOrders: number;
  storeCustomers: number;
};

export type Customer = {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  country: string;
  language: string;
  emailConsent: boolean;
  orderCount: number;
  totalSpentCents: number;
  lastOrderAt: string | null;
  spendTier: string;
  topCategory: string | null;
  preferenceTags: string[];
  hasNotes: boolean;
  daysSinceLastOrder: number | null;
};

export type Fact = {
  id: string;
  kind: string;
  status: string;
  source: string;
  quote: string;
};

export type CustomerDetail = Customer & {
  notes: { id: string; text: string }[];
  orders: { id: string; name: string; createdAtShop: string; totalCents: number }[];
  facts: Fact[];
};

export type AbandonedPreview = {
  rows: number;
  checkouts: number;
  matched: number;
  unmatched: number;
  storeCheckouts: number;
};

export type GorgiasPreview = {
  rows: number;
  withText: number;
  matched: number;
  unmatched: number;
  skipped: number;
};

export type GenerationJob = {
  status: 'writing' | 'done' | 'interrupted';
  plannedCount: number;
  completedCount: number;
  failedCount: number;
  nextCustomerName: string | null;
  failedCountLabel?: string;
};

export type OutreachListItem = {
  id: string;
  name: string;
  intentZh: string;
  status: string;
  createdAt: string;
  job: GenerationJob | null;
};

export type AudienceItem = {
  id: string;
  firstName: string | null;
  lastName: string | null;
  email: string;
  language: string;
  eligible: boolean;
  topCategory: string | null;
  spendTier: string;
};

export type Preview = {
  missingAbandoned?: boolean;
  message?: string;
  total: number | null;
  reachable: number | null;
  excluded: number;
  languages: { en: number; es: number };
  personalized: number;
  cohort: number;
  cohortGroups: number;
  calls: number;
  unitPriceCents: number | null;
  costCents: number | null;
  costConfigured: boolean;
  items: AudienceItem[];
};

export type Draft = {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  country: string;
  language: string;
  mode: string;
  subject: string;
  body: string;
  zhSubject: string;
  zhBody: string;
  personalizationPoints: string[];
  writer?: string | null;
  status: string;
  issues: { level: string; message: string }[];
  canApprove: boolean;
};

export type Outreach = {
  id: string;
  name: string;
  intentZh: string;
  reachable: number;
  excluded: number;
  exclusionReasons: Record<string, number>;
  drafts: Draft[];
  status: string;
  job: GenerationJob | null;
};
