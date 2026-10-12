import { type CustomerBrief, containsEmail, containsPhone, draftIssues, redactContact } from '@copilot/shared';

const CATEGORY_EN: Record<string, string> = {
  cat_litter: 'cat litter',
  cat_food: 'cat food',
  dog_food: 'dog food',
  treats: 'treats',
};

const CATEGORY_ES: Record<string, string> = {
  cat_litter: 'arena para gatos',
  cat_food: 'comida para gatos',
  dog_food: 'comida para perros',
  treats: 'premios',
};

function categoryWords(language: string, category: string | undefined) {
  const table = language === 'es' ? CATEGORY_ES : CATEGORY_EN;
  return table[category || ''] || (language === 'es' ? 'tus productos' : 'your usual products');
}

function hasHan(text: string) {
  return /[\u4e00-\u9fff]/.test(text);
}

export function generateTemplate(
  brief: CustomerBrief,
  _intentZh: string,
  discountCode?: string,
  options?: { shared?: boolean },
) {
  const shared = options?.shared === true;
  const product = brief.purchases[0]?.title || '';
  const category = categoryWords(brief.language, brief.purchases[0]?.category);
  const days = brief.daysSinceLastOrder ?? 60;
  const quotes = brief.notes.map((note) => note.trim()).filter(Boolean);
  const foreignQuotes = quotes.filter((quote) => !hasHan(quote));
  const points: string[] = [];
  if (!shared && product) points.push(`提到上次购买的 ${product}`);
  for (const quote of quotes) points.push(`用上了已确认事实：${quote.slice(0, 80)}`);
  if (discountCode) points.push(`带上折扣码 ${discountCode}`);
  points.push(shared ? '这一封和同一群人共用' : '这封是单独写的');

  const offerEn = discountCode
    ? 'Use code {{discount_code}} for 20% off.'
    : 'We have an offer ready for your next order.';
  const offerEs = discountCode
    ? 'Usa el código {{discount_code}} para un 20% de descuento.'
    : 'Tenemos una oferta para tu próximo pedido.';
  const offerZh = discountCode ? '优惠说明：使用折扣码可享 20% off。' : '优惠说明：这场为回购买家准备了优惠。';
  const factZh = quotes.length ? `已确认事实：${quotes.join('；')}。` : '';

  if (brief.language === 'es') {
    const body = shared
      ? `Hola {{first_name}},

Hace un tiempo que no pides {{last_product}}. Esta nota es para quien compra ${category}.

${offerEs}

{{unsubscribe_url}}
{{company_address}}
`
      : `Hola {{first_name}},

Han pasado ${days} días desde que pediste ${product || '{{last_product}}'}. Seguimos con ${category}. ${
          foreignQuotes.length ? `Tenemos en cuenta: ${foreignQuotes.join('; ')}. ` : ''
        }Esta nota sale de tu historial, no de un envío masivo.

${offerEs}

{{unsubscribe_url}}
{{company_address}}
`;
    return {
      subject: shared ? `Una nota sobre ${category}` : `Te extrañamos: ${product || category}`,
      body,
      zhSubject: shared ? `关于${category}的一封共用信` : `我们想你了：${product || category}`,
      zhBody: `你好 {{first_name}}，${shared ? '这封和同一群人共用，上次商品会填成你自己的。' : `距离你购买 ${product || '{{last_product}}'} 已经 ${days} 天。`}品类是${category}。${factZh}${offerZh} {{unsubscribe_url}} {{company_address}}`,
      points,
    };
  }

  const body = shared
    ? `Hi {{first_name}},

It has been a while since you ordered {{last_product}}. This note is for shoppers of ${category}.

${offerEn}

{{unsubscribe_url}}
{{company_address}}
`
    : `Hi {{first_name}},

It's been ${days} days since you ordered ${product || '{{last_product}}'}. We kept ${category} in mind. ${
        foreignQuotes.length ? `We also kept this in mind: ${foreignQuotes.join('; ')}. ` : ''
      }This note is written from your order history, not a blast to everyone.

${offerEn}

{{unsubscribe_url}}
{{company_address}}
`;
  return {
    subject: shared ? `A note about ${category}` : `We set this aside for you: ${product || category}`,
    body,
    zhSubject: shared ? `关于${category}的一封共用信` : `专门给你留的：${product || category}`,
    zhBody: `你好 {{first_name}}，${shared ? '这封和同一群人共用，上次商品会填成你自己的。' : `距离你购买 ${product || '{{last_product}}'} 已经 ${days} 天。`}品类是${category}。${factZh}${offerZh} {{unsubscribe_url}} {{company_address}}`,
    points,
  };
}

export function checkDraft(body: string) {
  return draftIssues(body);
}

export function renderCopy(body: string, values: Record<string, string>) {
  return body.replace(/\{\{\s*([a-z_]+)\s*\}\}/g, (_, name: string) => values[name] ?? '');
}

export function detectPrivacy(text: string) {
  const warnings: string[] = [];
  if (containsEmail(text)) warnings.push('email');
  if (containsPhone(text)) warnings.push('phone');
  return warnings;
}

export function redactNote(text: string) {
  return redactContact(text);
}
