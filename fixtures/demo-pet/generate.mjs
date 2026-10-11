import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = dirname(fileURLToPath(import.meta.url));

const people = [
  { id: 1, first: 'Anna', lastName: 'Cole', country: 'US', langTag: '', consent: true, notes: true, orders: 3, lastOrder: '2026-08-01', products: ['Dust-free Cat Litter 10L', 'Salmon Cat Food 2kg'] },
  { id: 2, first: 'Ben', lastName: 'Ward', country: 'US', langTag: '', consent: true, notes: true, orders: 4, lastOrder: '2026-07-20', products: ['Grain-free Dog Food 5kg', 'Dental Chews'] },
  { id: 3, first: 'Cara', lastName: 'Nguyen', country: 'US', langTag: '', consent: true, notes: false, orders: 2, lastOrder: '2026-08-15', products: ['Catnip Toys', 'Dust-free Cat Litter 10L'] },
  { id: 4, first: 'Diego', lastName: 'Ruiz', country: 'MX', langTag: 'lang:es', consent: true, notes: true, orders: 3, lastOrder: '2026-07-10', products: ['Arena sin polvo 10L', 'Salmon Cat Food 2kg'] },
  { id: 5, first: 'Elena', lastName: 'Soto', country: 'MX', langTag: '', consent: true, notes: true, orders: 2, lastOrder: '2026-08-05', products: ['Arena sin polvo 10L'] },
  { id: 6, first: 'Felix', lastName: 'Ortiz', country: 'ES', langTag: 'lang:es', consent: true, notes: false, orders: 3, lastOrder: '2026-06-30', products: ['Salmon Cat Food 2kg', 'Catnip Toys'] },
  { id: 7, first: 'Gina', lastName: 'Perez', country: 'ES', langTag: '', consent: true, notes: false, orders: 2, lastOrder: '2026-08-18', products: ['Grain-free Dog Food 5kg'] },
  { id: 8, first: 'Hugo', lastName: 'Silva', country: 'MX', langTag: '', consent: true, notes: true, orders: 5, lastOrder: '2026-07-02', products: ['Dental Chews', 'Grain-free Dog Food 5kg'] },
  { id: 9, first: 'Ivy', lastName: 'Brooks', country: 'US', langTag: '', consent: true, notes: true, orders: 3, lastOrder: '2026-08-22', products: ['Salmon Cat Food 2kg'] },
  { id: 10, first: 'Jake', lastName: 'Lin', country: 'US', langTag: '', consent: true, notes: false, orders: 2, lastOrder: '2026-08-28', products: ['Catnip Toys', 'Salmon Cat Food 2kg'] },
  { id: 11, first: 'Kara', lastName: 'Moss', country: 'GB', langTag: '', consent: true, notes: false, orders: 3, lastOrder: '2026-07-25', products: ['Grain-free Dog Food 5kg'] },
  { id: 12, first: 'Luis', lastName: 'Mora', country: 'MX', langTag: 'lang:es', consent: true, notes: false, orders: 2, lastOrder: '2026-08-12', products: ['Arena sin polvo 10L'] },
  { id: 13, first: 'Mia', lastName: 'Chen', country: 'US', langTag: '', consent: true, notes: true, orders: 4, lastOrder: '2026-06-15', products: ['Dust-free Cat Litter 10L', 'Catnip Toys'] },
  { id: 14, first: 'Noah', lastName: 'Diaz', country: 'ES', langTag: '', consent: true, notes: false, orders: 2, lastOrder: '2026-07-08', products: ['Salmon Cat Food 2kg'] },
  { id: 15, first: 'Olga', lastName: 'Reyes', country: 'MX', langTag: '', consent: true, notes: true, orders: 3, lastOrder: '2026-08-08', products: ['Arena sin polvo 10L', 'Salmon Cat Food 2kg'] },
  { id: 16, first: 'Pete', lastName: 'Shaw', country: 'US', langTag: '', consent: true, notes: false, orders: 1, lastOrder: '2026-10-20', products: ['Dental Chews'] },
  { id: 17, first: 'Quinn', lastName: 'Hall', country: 'GB', langTag: '', consent: true, notes: false, orders: 1, lastOrder: '2026-10-18', products: ['Catnip Toys'] },
  { id: 18, first: 'Rosa', lastName: 'Vega', country: 'MX', langTag: 'lang:es', consent: true, notes: false, orders: 1, lastOrder: '2026-10-12', products: ['Arena sin polvo 10L'] },
  { id: 19, first: 'Sam', lastName: 'Owen', country: 'US', langTag: '', consent: true, notes: false, orders: 1, lastOrder: '2026-10-08', products: ['Salmon Cat Food 2kg'] },
  { id: 20, first: 'Tess', lastName: 'Park', country: 'GB', langTag: '', consent: true, notes: false, orders: 1, lastOrder: '2026-10-25', products: ['Grain-free Dog Food 5kg'] },
  { id: 21, first: 'Uma', lastName: 'Wells', country: 'US', langTag: '', consent: false, notes: false, orders: 2, lastOrder: '2026-07-01', products: ['Dust-free Cat Litter 10L'] },
  { id: 22, first: 'Victor', lastName: 'Cruz', country: 'MX', langTag: '', consent: false, notes: false, orders: 2, lastOrder: '2026-08-01', products: ['Arena sin polvo 10L'] },
  { id: 23, first: 'Wendy', lastName: 'Fox', country: 'US', langTag: '', consent: false, notes: false, orders: 3, lastOrder: '2026-06-20', products: ['Dental Chews'] },
  { id: 24, first: 'Xavier', lastName: 'Gil', country: 'ES', langTag: '', consent: false, notes: false, orders: 2, lastOrder: '2026-07-18', products: ['Salmon Cat Food 2kg'] },
  { id: 25, first: 'Yara', lastName: 'Kim', country: 'US', langTag: '', consent: false, notes: false, orders: 2, lastOrder: '2026-08-10', products: ['Catnip Toys'] },
  { id: 26, first: 'Zane', lastName: 'Bell', country: 'US', langTag: '', consent: true, notes: false, orders: 1, lastOrder: '2026-07-12', products: ['Dust-free Cat Litter 10L'] },
  { id: 27, first: 'Alicia', lastName: 'Nunez', country: 'MX', langTag: '', consent: true, notes: false, orders: 1, lastOrder: '2026-08-02', products: ['Arena sin polvo 10L'] },
  { id: 28, first: 'Blake', lastName: 'Young', country: 'US', langTag: '', consent: true, notes: false, orders: 1, lastOrder: '2026-06-28', products: ['Grain-free Dog Food 5kg'] },
  { id: 29, first: 'Clara', lastName: 'Ives', country: 'GB', langTag: '', consent: true, notes: false, orders: 1, lastOrder: '2026-07-30', products: ['Catnip Toys'] },
  { id: 30, first: 'David', lastName: 'Khan', country: 'US', langTag: '', consent: true, notes: false, orders: 1, lastOrder: '2026-08-19', products: ['Salmon Cat Food 2kg'] },
  { id: 31, first: 'Eva', lastName: 'Lopez', country: 'ES', langTag: 'lang:es', consent: true, notes: true, orders: 4, lastOrder: '2026-07-14', products: ['Arena sin polvo 10L', 'Salmon Cat Food 2kg'] },
  { id: 32, first: 'Finn', lastName: 'Moore', country: 'US', langTag: '', consent: true, notes: true, orders: 3, lastOrder: '2026-08-04', products: ['Dental Chews', 'Grain-free Dog Food 5kg'] },
  { id: 33, first: 'Grace', lastName: 'Tao', country: 'US', langTag: '', consent: true, notes: false, orders: 2, lastOrder: '2026-09-02', products: ['Dust-free Cat Litter 10L'] },
  { id: 34, first: 'Hector', lastName: 'Ramos', country: 'MX', langTag: '', consent: true, notes: false, orders: 2, lastOrder: '2026-09-01', products: ['Arena sin polvo 10L'] },
  { id: 35, first: 'Iris', lastName: 'Pope', country: 'US', langTag: '', consent: true, notes: false, orders: 2, lastOrder: '2026-09-03', products: ['Catnip Toys'] },
  { id: 36, first: 'Jon', lastName: 'West', country: 'US', langTag: '', consent: true, notes: false, orders: 2, lastOrder: '2026-10-01', products: ['Salmon Cat Food 2kg'] },
  { id: 37, first: 'Keira', lastName: 'Bond', country: 'GB', langTag: '', consent: true, notes: false, orders: 2, lastOrder: '2026-10-05', products: ['Grain-free Dog Food 5kg'] },
  { id: 38, first: 'Leo', lastName: 'Cano', country: 'ES', langTag: '', consent: true, notes: false, orders: 1, lastOrder: '2026-08-25', products: ['Salmon Cat Food 2kg'] },
  { id: 39, first: 'Mona', lastName: 'Hart', country: 'US', langTag: '', consent: true, notes: true, orders: 3, lastOrder: '2026-08-11', products: ['Dust-free Cat Litter 10L', 'Salmon Cat Food 2kg', 'Catnip Toys'] },
  { id: 40, first: 'Nico', lastName: 'Paz', country: 'MX', langTag: 'lang:es', consent: true, notes: true, orders: 2, lastOrder: '2026-07-28', products: ['Arena sin polvo 10L'] },
];

const noteText = {
  1: '养了两只布偶猫，喜欢无尘猫砂',
  2: '狗对谷物过敏',
  4: '喜欢无尘猫砂，上次反馈物流慢，已补偿',
  5: '只买猫砂补货',
  8: '家里两只大型犬',
  9: '喜欢三文鱼口味',
  13: '养猫多年，对粉尘敏感',
  15: '墨西哥老客，节日愿意囤货',
  31: '西班牙回头客',
  32: '狗牙不好，只要洁牙零食',
  39: '联系备用邮箱 hidden@example.com',
  40: '西语客户，备注里写了电话 +52 555 010 2000',
};

const customerRows = [
  [
    'Customer ID',
    'First Name',
    'Last Name',
    'Email',
    'Accepts Email Marketing',
    'Accepts SMS Marketing',
    'Phone',
    'Default Address Country Code',
    'Tags',
    'Note',
    'Total Spent',
    'Total Orders',
  ],
];

const orderRows = [
  [
    'Name',
    'Id',
    'Email',
    'Financial Status',
    'Created at',
    'Currency',
    'Total',
    'Discount Code',
    'Lineitem name',
    'Lineitem sku',
    'Lineitem quantity',
    'Lineitem price',
    'Shipping Country',
    'Accepts Marketing',
  ],
];

const prices = {
  'Dust-free Cat Litter 10L': 24.8,
  'Salmon Cat Food 2kg': 32.5,
  'Grain-free Dog Food 5kg': 48.0,
  'Dental Chews': 16.0,
  'Catnip Toys': 9.9,
  'Arena sin polvo 10L': 22.0,
};

let orderSeq = 1000;
for (const p of people) {
  const email = `${p.first.toLowerCase()}.${p.lastName.toLowerCase()}@example.com`;
  customerRows.push([
    String(1000 + p.id),
    p.first,
    p.lastName,
    email,
    p.consent ? 'yes' : 'no',
    p.consent ? 'yes' : 'no',
    `+1555010${String(2000 + p.id).slice(-4)}`,
    p.country,
    p.langTag,
    p.notes ? noteText[p.id] ?? '' : '',
    '',
    String(p.orders),
  ]);

  const last = new Date(p.lastOrder);
  for (let i = 0; i < p.orders; i++) {
    const created = new Date(last);
    created.setDate(created.getDate() - i * 40);
    const date = created.toISOString().slice(0, 10);
    const items =
      i === 0 && p.products.length > 1
        ? p.products.slice(0, 2)
        : [p.products[i % p.products.length]];
    const total = items.reduce((sum, title) => sum + prices[title], 0);
    items.forEach((title, idx) => {
      orderRows.push([
        `#${orderSeq}`,
        String(8000 + orderSeq),
        email,
        'paid',
        date,
        'USD',
        idx === 0 ? total.toFixed(2) : '',
        '',
        title,
        title.replace(/\s+/g, '-').toLowerCase(),
        '1',
        prices[title].toFixed(2),
        p.country,
        p.consent ? 'yes' : 'no',
      ]);
    });
    orderSeq += 1;
  }
}

function csv(rows) {
  return rows
    .map((row) =>
      row
        .map((cell) => {
          const value = String(cell ?? '');
          return /[",\n]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value;
        })
        .join(','),
    )
    .join('\n');
}

writeFileSync(join(dir, 'customers.csv'), csv(customerRows) + '\n');
writeFileSync(join(dir, 'orders.csv'), csv(orderRows) + '\n');

const notes = Object.entries(noteText).map(([id, text]) => ({
  customerExternalId: String(1000 + Number(id)),
  text,
}));
writeFileSync(join(dir, 'notes.json'), JSON.stringify(notes, null, 2) + '\n');

const dormant = people.filter((p) => p.lastOrder <= '2026-09-02').length;
const noConsent = people.filter((p) => !p.consent).length;
const es = people.filter((p) => p.langTag === 'lang:es' || ['MX', 'ES'].includes(p.country)).length;
const withNotes = Object.keys(noteText).length;

writeFileSync(
  join(dir, 'README.md'),
  `# 宠物用品演示数据

今天固定为 **2026-11-01**。沉睡口径：最后一次购买距今 ≥ 60 天，即末购日期 ≤ 2026-09-02。

| 项目 | 数量 |
| --- | --- |
| 客户总数 | ${people.length} |
| 未同意营销 | ${noConsent} |
| 西班牙语（标签或 MX/ES） | ${es} |
| 有备注 | ${withNotes} |
| 沉睡客户 | ${dormant} |
| 沉睡且已同意营销（可触达） | ${people.filter((p) => p.lastOrder <= '2026-09-02' && p.consent).length} |

- 所有邮箱以 \`@example.com\` 结尾。
- 客户 1001（Anna Cole）有多商品订单：猫砂 + 猫粮。
- 客户 1033 末购 2026-09-02，算沉睡；客户 1035 末购 2026-09-03，不算沉睡。
- 客户 1039、1040 的备注含邮箱或电话，用来演示隐私提醒。
`,
);

console.log('wrote fixtures', {
  customers: people.length,
  orders: orderSeq - 1000,
  dormant,
});
