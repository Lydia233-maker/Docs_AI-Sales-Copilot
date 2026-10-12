import { CustomerBriefSchema, type CustomerBrief } from '@copilot/shared';
import { generateTemplate } from '../templates.ts';
import { askModel, hasModelClient, parseModelJson } from './model.ts';

export type Letter = {
  subject: string;
  body: string;
  zhSubject: string;
  zhBody: string;
  points: string[];
  writer: 'model' | 'template';
  failed: boolean;
};

function ensurePlaceholders(body: string) {
  let next = body;
  if (!next.includes('{{first_name}}')) next = `{{first_name}}\n${next}`;
  if (!next.includes('{{unsubscribe_url}}')) next = `${next.trim()}\n{{unsubscribe_url}}`;
  if (!next.includes('{{company_address}}')) next = `${next.trim()}\n{{company_address}}`;
  return next;
}

export async function composeLetter(brief: CustomerBrief, intentZh: string, discountCode: string | undefined, shared: boolean): Promise<Letter> {
  const parsed = CustomerBriefSchema.safeParse(brief);
  if (!parsed.success) {
    throw new Error(parsed.error.issues[0]?.message || '客户简报无效');
  }
  const template = () => {
    const copy = generateTemplate(parsed.data, intentZh, discountCode, { shared });
    return { ...copy, writer: 'template' as const };
  };
  if (!hasModelClient()) {
    return { ...template(), failed: false };
  }
  try {
    const raw = await askModel(
      'Write one marketing email as JSON with keys subject, body, zhSubject, zhBody. body is English or Spanish as the brief language says. Do not put the customer name, email, or phone in the request or the letter. Keep {{first_name}}, {{last_product}}, {{discount_code}}, {{unsubscribe_url}} and {{company_address}}. Do not copy the Chinese campaign intent into the foreign body. When a discount code is present, the offer line is 20% off. Use the product, the number of days, and the category from the brief. For a shared letter, do not name a specific product except through {{last_product}}.',
      JSON.stringify({
        brief: parsed.data,
        intentZh,
        discountCode: discountCode || '',
        shared,
      }),
    );
    if (!raw) return { ...template(), failed: false };
    const data = parseModelJson(raw);
    const subject = String(data.subject || '');
    const body = ensurePlaceholders(String(data.body || ''));
    const zhSubject = String(data.zhSubject || '');
    const zhBody = String(data.zhBody || '');
    if (!subject || !body || !zhSubject || !zhBody) throw new Error('model shape');
    const points = [...template().points, '这封由模型写成'];
    return { subject, body, zhSubject, zhBody, points, writer: 'model', failed: false };
  } catch {
    return { ...template(), failed: true };
  }
}
