import { extractPlaceholders, isAllowedPlaceholder } from '@copilot/shared';

export type Brief = {
  language: 'en' | 'es';
  country: string;
  orderCount: number;
  spendTier: string;
  daysSinceLastOrder: number | null;
  purchases: { title: string; category: string; daysAgo: number }[];
  preferenceTags: string[];
  notes: string[];
};

export function generateTemplate(brief: Brief, intentZh: string, discountCode?: string) {
  const product = brief.purchases[0]?.title || 'your last order';
  const noteHint = brief.notes[0] || '';
  const tags = brief.preferenceTags.map((tag) => tag.trim()).filter(Boolean);
  const tagHint = tags.join('、');
  const days = brief.daysSinceLastOrder ?? 60;
  const points: string[] = [];
  if (product !== 'your last order') points.push(`提到上次购买的 ${product}`);
  if (noteHint) points.push(`用上了备注：${noteHint.slice(0, 24)}`);
  if (tagHint) points.push(`用上了偏好标签：${tagHint}`);
  if (discountCode) points.push(`带上折扣码 ${discountCode}`);

  if (brief.language === 'es') {
    return {
      subject: `Te extrañamos: ${product}`,
      body: `Hola {{first_name}},

Han pasado ${days} días desde que pediste {{last_product}}. ${noteHint ? 'Tenemos en cuenta lo que te importa. ' : ''}Por eso te escribimos esta nota, no un correo masivo.

Intención de la campaña: ${intentZh}
${discountCode ? `Usa el código {{discount_code}} para un 20% de descuento.` : 'Tenemos una oferta de recompra lista para ti.'}

{{unsubscribe_url}}
{{company_address}}
`,
      zhSubject: `我们想你了：${product}`,
      zhBody: `你好 {{first_name}}，距离你购买 {{last_product}} 已经 ${days} 天。${noteHint ? `备注：${noteHint}。` : ''}${tagHint ? `偏好：${tagHint}。` : ''}这是按你的购买记录写的，不是群发。推广意图：${intentZh}。${discountCode ? '折扣码 {{discount_code}}。' : ''} {{unsubscribe_url}} {{company_address}}`,
      points,
    };
  }

  return {
    subject: `We set this aside for you: ${product}`,
    body: `Hi {{first_name}},

It's been ${days} days since you ordered {{last_product}}. ${noteHint ? 'We kept your note in mind. ' : ''}This note is written from your order history, not a blast to everyone.

Campaign intent: ${intentZh}
${discountCode ? `Use code {{discount_code}} for 20% off.` : 'We have a restock offer ready.'}

{{unsubscribe_url}}
{{company_address}}
`,
    zhSubject: `专门给你留的：${product}`,
    zhBody: `你好 {{first_name}}，距离你购买 {{last_product}} 已经 ${days} 天。${noteHint ? `备注：${noteHint}。` : ''}${tagHint ? `偏好：${tagHint}。` : ''}这是按你的购买记录写的，不是群发。推广意图：${intentZh}。${discountCode ? '折扣码 {{discount_code}}。' : ''} {{unsubscribe_url}} {{company_address}}`,
    points,
  };
}

export function checkDraft(body: string) {
  const issues: { level: 'block' | 'warn'; message: string }[] = [];
  if (!body.includes('{{unsubscribe_url}}')) {
    issues.push({ level: 'block', message: '缺少退订链接 {{unsubscribe_url}}' });
  }
  if (!body.includes('{{company_address}}')) {
    issues.push({ level: 'block', message: '缺少公司地址 {{company_address}}' });
  }
  for (const name of extractPlaceholders(body)) {
    if (!isAllowedPlaceholder(name)) {
      issues.push({ level: 'block', message: `未知的占位符 ${name}` });
    }
  }
  return issues;
}

export function renderCopy(body: string, values: Record<string, string>) {
  return body.replace(/\{\{\s*([a-z_]+)\s*\}\}/g, (_, name: string) => values[name] ?? '');
}

export function detectPrivacy(text: string) {
  const warnings: string[] = [];
  if (/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i.test(text)) warnings.push('email');
  if (/\+?\d[\d\s()-]{7,}\d/.test(text)) warnings.push('phone');
  return warnings;
}

export function redactNote(text: string) {
  return text
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[已隐藏]')
    .replace(/\+?\d[\d\s()-]{7,}\d/g, '[已隐藏]');
}
