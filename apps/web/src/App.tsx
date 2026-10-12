import { useEffect, useState, type ReactNode } from 'react';
import { draftIssues } from '@copilot/shared';
import { Link, Navigate, Route, Routes, useLocation, useNavigate, useParams } from 'react-router-dom';
import {
  api,
  type Customer,
  type CustomerDetail,
  type ImportPreview,
  type AbandonedPreview,
  type GorgiasPreview,
  type Draft,
  type Outreach,
  type OutreachListItem,
  type Preview,
  type GenerationJob,
  type Overview,
} from './api';

function useAuth() {
  const [ready, setReady] = useState(false);
  const [ok, setOk] = useState(false);
  const [store, setStore] = useState('');
  useEffect(() => {
    api
      .me()
      .then((data) => {
        setOk(true);
        setStore(data.store.name);
      })
      .catch(() => setOk(false))
      .finally(() => setReady(true));
  }, []);
  return { ready, ok, store };
}

function Shell({ children, store }: { children: ReactNode; store: string }) {
  const loc = useLocation();
  const nav = useNavigate();
  return (
    <div className="layout">
      <aside className="nav">
        <h1>AI 定向营销助手<br />{store}</h1>
        <Link className={loc.pathname === '/' ? 'active' : ''} to="/">
          总览
        </Link>
        <Link className={loc.pathname.startsWith('/customers') ? 'active' : ''} to="/customers">
          客户
        </Link>
        <Link className={loc.pathname.startsWith('/import') ? 'active' : ''} to="/import">
          导入
        </Link>
        <Link className={loc.pathname.startsWith('/store') ? 'active' : ''} to="/store">
          店铺
        </Link>
        <Link className={loc.pathname.startsWith('/audience') ? 'active' : ''} to="/audience">
          挑选客户
        </Link>
        <Link className={loc.pathname.startsWith('/outreach') ? 'active' : ''} to="/outreach">
          推广
        </Link>
        <button
          className="link"
          onClick={async () => {
            await api.logout();
            nav('/login');
          }}
        >
          退出登录
        </button>
      </aside>
      <main className="main">{children}</main>
    </div>
  );
}

function LoginPage() {
  const nav = useNavigate();
  const [email, setEmail] = useState('demo@example.com');
  const [password, setPassword] = useState('demo1234');
  const [error, setError] = useState('');
  return (
    <div className="login">
      <div className="card">
        <h2>AI 定向营销助手</h2>
        <p className="muted">给每位客户写一封不一样的信</p>
        <label>邮箱</label>
        <input value={email} onChange={(e) => setEmail(e.target.value)} />
        <label>密码</label>
        <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
        {error && <p className="danger">{error}</p>}
        <p>
          <button
            className="btn"
            onClick={async () => {
              try {
                await api.login(email, password);
                nav('/');
              } catch (err) {
                setError(err instanceof Error ? err.message : '登录失败');
              }
            }}
          >
            登录
          </button>
        </p>
      </div>
    </div>
  );
}

const SCENE_LABELS: Record<string, string> = {
  winback_dormant: '沉睡未复购',
  repurchase: '到了复购窗口',
  first_to_second: '首单还没转二单',
  abandoned_checkout: '弃购还没挽回',
};

function OverviewPage() {
  const [data, setData] = useState<Overview | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    api.overview().then(setData).catch((err) => setError(err instanceof Error ? err.message : '总览加载失败'));
  }, []);
  if (error) return <p className="danger">{error}</p>;
  if (!data) return <p>加载中…</p>;
  const sceneMax = Math.max(...data.scenes.map((scene) => scene.total ?? 0), 1);
  return (
    <div>
      <h2>客户总览</h2>
      <div className="stat-grid">
        <div className="card">
          <span className="muted">客户总数</span>
          <strong>{data.total}</strong>
        </div>
        <div className="card">
          <span className="muted">资料齐全</span>
          <strong>{data.addressable}</strong>
        </div>
        <div className="card">
          <span className="muted">未同意营销</span>
          <strong>{data.noConsent}</strong>
        </div>
        <div className="card">
          <span className="muted">缺姓名或国家</span>
          <strong>{data.incomplete}</strong>
        </div>
      </div>
      <div className="card">
        <h3>按购买情况</h3>
        <p className="muted">
          条的全长是符合这个分类的人数，深色是其中可以发信的人。缺姓名或国家的人不进入这些分类，也不会生成邮件。
        </p>
        <div className="bars">
          {data.scenes.map((scene) => {
            const total = scene.total ?? 0;
            const reachable = scene.reachable ?? 0;
            const track = scene.missingAbandoned ? 0 : Math.max(Math.round((total / sceneMax) * 100), total > 0 ? 4 : 0);
            const reach = total > 0 ? Math.round((reachable / total) * 100) : 0;
            return (
              <div className="bar-row" key={scene.scenario}>
                <span>{SCENE_LABELS[scene.scenario] || scene.scenario}</span>
                <div className="bar-track" aria-hidden="true">
                  <div className="bar-fill soft" style={{ width: `${track}%` }}>
                    <div className="bar-fill" style={{ width: `${reach}%` }} />
                  </div>
                </div>
                <span className="bar-count">
                  {scene.missingAbandoned ? '还没有弃单' : `${total} 人，可发 ${reachable}`}
                </span>
              </div>
            );
          })}
        </div>
        <p className="muted">
          资料齐全的人里，英语 {data.languages.en}，西班牙语 {data.languages.es}。未同意营销的 {data.noConsent} 人会留在名单里，但不生成邮件。
        </p>
      </div>
      <div className="card">
        <h3>什么叫个性推广</h3>
        <p>
          买过至少 2 次，或者已经确认过事实的人，单独写一封。这封信要能看出这个人的商品、距今天数、品类，以及已确认的事实。
        </p>
        <p>
          只买过 1 次、又没有已确认事实的人，按语言、国家、场景、消费层级和主要品类分组，共用一封底稿。复制或发送时，才填上这个人自己的姓名和上次商品。
        </p>
        <p className="muted">中文推广意图不会原样贴进外语正文。有折扣码时，优惠句写 20% off。</p>
      </div>
    </div>
  );
}

function CustomersPage() {
  const [items, setItems] = useState<Customer[]>([]);
  const [language, setLanguage] = useState('');
  useEffect(() => {
    const query = language ? `?language=${language}` : '';
    api.customers(query).then((data) => setItems(data.items));
  }, [language]);
  return (
    <div>
      <h2>客户</h2>
      <div className="card row">
        <span>语言</span>
        <select value={language} onChange={(e) => setLanguage(e.target.value)} style={{ width: 160 }}>
          <option value="">全部</option>
          <option value="en">英语</option>
          <option value="es">西班牙语</option>
        </select>
        <span className="muted">共 {items.length} 人</span>
      </div>
      <div className="card">
        <table>
          <thead>
            <tr>
              <th>姓名</th>
              <th>国家</th>
              <th>语言</th>
              <th>订单</th>
              <th>距今</th>
              <th>同意营销</th>
              <th>备注</th>
            </tr>
          </thead>
          <tbody>
            {items.map((c) => (
              <tr key={c.id}>
                <td>
                  <Link to={`/customers/${c.id}`}>
                    {`${c.firstName || ''} ${c.lastName || ''}`.trim() || '未填姓名'}
                  </Link>
                </td>
                <td>{c.country || '未填国家'}</td>
                <td>{c.language === 'es' ? '西班牙语' : '英语'}</td>
                <td>{c.orderCount}</td>
                <td>{c.daysSinceLastOrder ?? '-'}</td>
                <td>{c.emailConsent ? '是' : '否'}</td>
                <td>{c.hasNotes ? '有' : ''}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function CustomerPage() {
  const { id } = useParams();
  const [data, setData] = useState<CustomerDetail | null>(null);
  const [languageError, setLanguageError] = useState('');
  const load = async () => {
    if (!id) return;
    setData(await api.customer(id));
  };
  useEffect(() => {
    load();
  }, [id]);
  if (!data) return <p>加载中…</p>;
  return (
    <div>
      <h2>
        {data.firstName} {data.lastName}
      </h2>
      <div className="card">
        <h3>画像</h3>
        <table>
          <tbody>
            <tr>
              <th>语言</th>
              <td>
                <select
                  value={data.language === 'es' ? 'es' : 'en'}
                  style={{ width: 160 }}
                  onChange={async (event) => {
                    if (!id) return;
                    const language = event.target.value === 'es' ? 'es' : 'en';
                    setLanguageError('');
                    try {
                      await api.updateLanguage(id, language);
                      load();
                    } catch (err) {
                      setLanguageError(err instanceof Error ? err.message : '语言没有保存');
                    }
                  }}
                >
                  <option value="en">英语</option>
                  <option value="es">西班牙语</option>
                </select>
                {languageError && <p className="danger">{languageError}</p>}
              </td>
            </tr>
            <tr>
              <th>国家</th>
              <td>{data.country}</td>
            </tr>
            <tr>
              <th>购买次数</th>
              <td>{data.orderCount} 笔</td>
            </tr>
            <tr>
              <th>消费金额</th>
              <td>${(data.totalSpentCents / 100).toFixed(2)}</td>
            </tr>
            <tr>
              <th>消费层级</th>
              <td>{data.spendTier === 'high' ? '高' : data.spendTier === 'mid' ? '中' : '低'}</td>
            </tr>
            <tr>
              <th>主要品类</th>
              <td>{categoryLabel(data.topCategory)}</td>
            </tr>
            <tr>
              <th>距上次购买</th>
              <td>{data.daysSinceLastOrder == null ? '没有订单' : `${data.daysSinceLastOrder} 天`}</td>
            </tr>
            <tr>
              <th>营销同意</th>
              <td>{data.emailConsent ? '同意接收邮件' : '未同意，不会生成文案'}</td>
            </tr>
          </tbody>
        </table>
      </div>
      <div className="card">
        <h3>订单</h3>
        {data.orders.map((o) => (
          <div key={o.id}>
            {o.name} · {o.createdAtShop} · ${(o.totalCents / 100).toFixed(2)}
          </div>
        ))}
      </div>
      <div className="card">
        <h3>备注</h3>
        {data.notes.length === 0 && <p className="muted">还没有备注</p>}
        {data.notes.map((n) => (
          <p key={n.id}>{n.text}</p>
        ))}
      </div>
      <div className="card">
        <h3>事实</h3>
        <p className="muted">只有已确认的事实会写进信。商品标题和聊天原话需要先确认。</p>
        {(data.facts || []).length === 0 && <p className="muted">还没有事实</p>}
        {(data.facts || []).map((fact) => (
          <p key={fact.id}>
            <span className="tag">{factStatus(fact.status)}</span>
            <span className="tag">{factKind(fact.kind)}</span>
            {fact.quote}
            {fact.status === 'suggested' && (
              <span className="row">
                <button
                  className="btn"
                  onClick={async () => {
                    await api.decideFact(fact.id, 'confirm');
                    await load();
                  }}
                >
                  确认
                </button>
                <button
                  className="btn secondary"
                  onClick={async () => {
                    await api.decideFact(fact.id, 'dismiss');
                    await load();
                  }}
                >
                  忽略
                </button>
              </span>
            )}
          </p>
        ))}
      </div>
    </div>
  );
}

function StorePage() {
  const [address, setAddress] = useState('');
  const [saved, setSaved] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    api.store().then((store) => {
      setAddress(store.companyAddress);
      setSaved(store.companyAddress);
    });
  }, []);
  return (
    <div>
      <h2>店铺</h2>
      <div className="card">
        <label>公司地址</label>
        <input value={address} onChange={(event) => setAddress(event.target.value)} />
        <p className="muted">复制和模拟发送时，信的底部使用这个地址。</p>
        <p>
          <button
            className="btn"
            disabled={busy || !address.trim()}
            onClick={async () => {
              setBusy(true);
              setError('');
              try {
                const next = await api.updateAddress(address.trim());
                setAddress(next.companyAddress);
                setSaved(next.companyAddress);
              } catch (err) {
                setError(err instanceof Error ? err.message : '地址没有保存');
              } finally {
                setBusy(false);
              }
            }}
          >
            保存地址
          </button>
        </p>
        {saved && <p className="muted">当前地址：{saved}</p>}
        {error && <p className="danger">{error}</p>}
      </div>
    </div>
  );
}

function readFile(file: File) {
  return file.text();
}

function ClearImports() {
  const [confirming, setConfirming] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  return (
    <div className="card">
      <h3>清除导入的数据</h3>
      <p>
        导入只会按邮箱新增或更新，不会删掉这份文件里没有的旧客户。所以上次缺姓名、缺国家的人会一直留在店里，页面上也没有逐个删除。
      </p>
      <p className="muted">清除会删掉本店的客户、订单、弃单、聊天事实和已经写好的推广。登录账号和公司地址保留。</p>
      {confirming ? (
        <div className="row">
          <button
            className="btn danger"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              setError('');
              try {
                const saved = await api.clearImports();
                setMessage(`已清除 ${saved.customers} 位客户、${saved.orders} 笔订单、${saved.checkouts} 张弃单。`);
                setConfirming(false);
              } catch (err) {
                setError(err instanceof Error ? err.message : '清除失败');
              } finally {
                setBusy(false);
              }
            }}
          >
            确认清除
          </button>
          <button className="btn secondary" disabled={busy} onClick={() => setConfirming(false)}>
            取消
          </button>
        </div>
      ) : (
        <p>
          <button className="btn danger" onClick={() => setConfirming(true)}>
            清除本店数据
          </button>
        </p>
      )}
      {message && <p>{message}</p>}
      {error && <p className="danger">{error}</p>}
    </div>
  );
}

function ImportPage() {
  const [customersFile, setCustomersFile] = useState<File | null>(null);
  const [ordersFile, setOrdersFile] = useState<File | null>(null);
  const [customersCsv, setCustomersCsv] = useState('');
  const [ordersCsv, setOrdersCsv] = useState('');
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [beforeCount, setBeforeCount] = useState<number | null>(null);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  return (
    <div>
      <h2>导入</h2>
      <ClearImports />
      <div className="card">
        <p className="muted">先预览。确认之前不会写入客户和订单。</p>
        <p>
          客户 CSV 和订单 CSV 要一起上传。两份文件用邮箱自动对应，不看列的左右位置，但列名要能认出。客户表提供是谁、哪个国家、是否同意收信、备注。订单表提供买了什么、什么时候买。只上传其中一个不够：没有客户表就不知道姓名和营销同意，没有订单表就分不出沉睡、复购和上次商品。
        </p>
        <p className="muted">
          没有邮箱、没有姓名（名和姓都空），或没有国家的行会跳过。这些行不写入，也不能发信。国家列认 Default Address Country Code 或 Country。
        </p>
        <label>客户 CSV</label>
        <input
          type="file"
          accept=".csv,text/csv"
          onChange={(event) => {
            setCustomersFile(event.target.files?.[0] ?? null);
            setPreview(null);
            setMessage('');
          }}
        />
        <label>订单 CSV</label>
        <input
          type="file"
          accept=".csv,text/csv"
          onChange={(event) => {
            setOrdersFile(event.target.files?.[0] ?? null);
            setPreview(null);
            setMessage('');
          }}
        />
        <p>
          <button
            className="btn secondary"
            disabled={busy || !customersFile || !ordersFile}
            onClick={async () => {
              if (!customersFile || !ordersFile) return;
              setBusy(true);
              setError('');
              setMessage('');
              try {
                const [customersText, ordersText] = await Promise.all([readFile(customersFile), readFile(ordersFile)]);
                const current = await api.customers();
                const next = await api.previewImport(customersText, ordersText);
                const after = await api.customers();
                setCustomersCsv(customersText);
                setOrdersCsv(ordersText);
                setPreview(next);
                setBeforeCount(current.total);
                if (after.total !== current.total) {
                  setError('预览改动了客户人数，请先不要确认。');
                }
              } catch (err) {
                setPreview(null);
                setError(err instanceof Error ? err.message : '预览失败');
              } finally {
                setBusy(false);
              }
            }}
          >
            预览
          </button>
        </p>
        {preview && (
          <div>
            <p>
              可导入客户 {preview.customers} 人，跳过 {preview.skippedCustomers} 行（没有邮箱、姓名或国家）。其中西班牙语{' '}
              {preview.spanish} 人，备注 {preview.notes} 条。订单 {preview.orders} 笔
              {preview.unmatchedOrders > 0 ? `，其中 ${preview.unmatchedOrders} 笔对不上这次能导入的客户` : ''}。
            </p>
            <p className="muted">当前客户列表仍是 {beforeCount ?? preview.storeCustomers} 人，还没有写入。</p>
            <p>
              <button
                className="btn"
                disabled={busy || !customersCsv || !ordersCsv}
                onClick={async () => {
                  setBusy(true);
                  setError('');
                  try {
                    const saved = await api.confirmImport(customersCsv, ordersCsv);
                    setMessage(
                      `已导入。店里现在 ${saved.customers} 人，西班牙语 ${saved.spanish} 人，订单 ${saved.orders} 笔。这次跳过 ${saved.skippedCustomers} 行。`,
                    );
                    setPreview(null);
                  } catch (err) {
                    setError(err instanceof Error ? err.message : '导入失败');
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                确认导入
              </button>
            </p>
          </div>
        )}
        {message && <p>{message}</p>}
        {error && <p className="danger">{error}</p>}
      </div>
      <AbandonedImport />
      <GorgiasImport />
    </div>
  );
}

function AbandonedImport() {
  const [fileText, setFileText] = useState('');
  const [preview, setPreview] = useState<AbandonedPreview | null>(null);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  return (
    <div className="card">
      <h3>弃单 CSV</h3>
      <p className="muted">
        列名用 Shopify 弃单导出：Email、Created at、Lineitem name。同一张弃单的每一行商品共用一个 Id。还可以有 Name 和 Lineitem quantity。
      </p>
      <input
        type="file"
        accept=".csv,text/csv"
        onChange={async (event) => {
          const file = event.target.files?.[0];
          setPreview(null);
          setMessage('');
          setFileText(file ? await file.text() : '');
        }}
      />
      <p>
        <button
          className="btn secondary"
          disabled={busy || !fileText}
          onClick={async () => {
            setBusy(true);
            setError('');
            try {
              const before = await api.previewAbandoned(fileText);
              const after = await api.previewAbandoned(fileText);
              if (before.storeCheckouts !== after.storeCheckouts) {
                setError('预览改动了弃单，请先不要确认。');
                return;
              }
              setPreview(before);
            } catch (err) {
              setError(err instanceof Error ? err.message : '预览失败');
            } finally {
              setBusy(false);
            }
          }}
        >
          预览弃单
        </button>
      </p>
      {preview && (
        <div>
          <p>
            弃单 {preview.checkouts} 张，对得上客户 {preview.matched} 张，对不上 {preview.unmatched} 张。当前账本里的弃单还是{' '}
            {preview.storeCheckouts} 张。
          </p>
          <button
            className="btn"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              setError('');
              try {
                const saved = await api.confirmAbandoned(fileText);
                setMessage(`已导入弃单 ${saved.checkouts} 张，对得上 ${saved.matched} 张，对不上 ${saved.unmatched} 张。`);
                setPreview(null);
              } catch (err) {
                setError(err instanceof Error ? err.message : '导入失败');
              } finally {
                setBusy(false);
              }
            }}
          >
            确认导入弃单
          </button>
        </div>
      )}
      {message && <p>{message}</p>}
      {error && <p className="danger">{error}</p>}
    </div>
  );
}

function GorgiasImport() {
  const [fileText, setFileText] = useState('');
  const [preview, setPreview] = useState<GorgiasPreview | null>(null);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  return (
    <div className="card">
      <h3>Gorgias 聊天</h3>
      <p className="muted">
        这一版只读「Export with message content」里的 Customer email 和 Message text。对不上客户的行不会挂到别人身上。没有 DeepSeek 钥匙时不猜测是偏好还是需要小心的事。
      </p>
      <input
        type="file"
        accept=".csv,text/csv"
        onChange={async (event) => {
          const file = event.target.files?.[0];
          setPreview(null);
          setMessage('');
          setFileText(file ? await file.text() : '');
        }}
      />
      <p>
        <button
          className="btn secondary"
          disabled={busy || !fileText}
          onClick={async () => {
            setBusy(true);
            setError('');
            try {
              setPreview(await api.previewGorgias(fileText));
            } catch (err) {
              setError(err instanceof Error ? err.message : '预览失败');
            } finally {
              setBusy(false);
            }
          }}
        >
          预览聊天
        </button>
      </p>
      {preview && (
        <div>
          <p>
            有正文 {preview.withText} 行，对得上 {preview.matched} 行，对不上 {preview.unmatched} 行，空正文 {preview.skipped} 行。
          </p>
          <button
            className="btn"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              setError('');
              try {
                const saved = await api.confirmGorgias(fileText);
                setMessage(`已导入。新事实 ${saved.created} 条，对不上 ${saved.unmatched} 行，空正文 ${saved.skipped} 行。`);
                setPreview(null);
              } catch (err) {
                setError(err instanceof Error ? err.message : '导入失败');
              } finally {
                setBusy(false);
              }
            }}
          >
            确认导入聊天
          </button>
        </div>
      )}
      {message && <p>{message}</p>}
      {error && <p className="danger">{error}</p>}
    </div>
  );
}

function AudiencePage() {
  const nav = useNavigate();
  const [scenario, setScenario] = useState<'winback_dormant' | 'repurchase' | 'first_to_second' | 'abandoned_checkout'>(
    'winback_dormant',
  );
  const [language, setLanguage] = useState('');
  const [category, setCategory] = useState('');
  const [spendTier, setSpendTier] = useState('');
  const [preview, setPreview] = useState<Preview | null>(null);
  const [removed, setRemoved] = useState<string[]>([]);
  const [intent, setIntent] = useState('黑五老客专享 8 折，主推猫砂和猫粮，强调囤货划算');
  const [code, setCode] = useState('SAVE20');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    setRemoved([]);
    const body: Record<string, string> = { scenario };
    if (language) body.language = language;
    if (category) body.category = category;
    if (spendTier) body.spendTier = spendTier;
    api.preview(body).then(setPreview).catch((err) => setError(err instanceof Error ? err.message : '挑选失败'));
  }, [scenario, language, category, spendTier]);
  const chosen = (preview?.items || []).filter((item) => !removed.includes(item.id));
  return (
    <div>
      <h2>挑选客户</h2>
      <div className="card">
        <label>场景</label>
        <select value={scenario} onChange={(e) => setScenario(e.target.value as typeof scenario)}>
          <option value="winback_dormant">沉睡召回（60 天以上未购买）</option>
          <option value="repurchase">复购提醒</option>
          <option value="first_to_second">首单转二单</option>
          <option value="abandoned_checkout">弃购挽回</option>
        </select>
        <div className="row">
          <select value={language} onChange={(e) => setLanguage(e.target.value)}>
            <option value="">全部语言</option>
            <option value="en">英语</option>
            <option value="es">西班牙语</option>
          </select>
          <select value={category} onChange={(e) => setCategory(e.target.value)}>
            <option value="">全部品类</option>
            <option value="cat_litter">猫砂</option>
            <option value="cat_food">猫粮</option>
            <option value="dog_food">狗粮</option>
            <option value="treats">零食玩具</option>
          </select>
          <select value={spendTier} onChange={(e) => setSpendTier(e.target.value)}>
            <option value="">全部消费层级</option>
            <option value="high">高</option>
            <option value="mid">中</option>
            <option value="low">低</option>
          </select>
        </div>
        {preview?.missingAbandoned && <p>还没有弃单数据</p>}
        {preview && !preview.missingAbandoned && (
          <p>
            共 {preview.total} 人，可触达 {preview.reachable} 人，排除 {preview.excluded} 人（未同意营销）。英语{' '}
            {preview.languages.en}，西班牙语 {preview.languages.es}。单独写 {preview.personalized} 人，共用{' '}
            {preview.cohortGroups} 组，调用 {preview.calls} 次。
            {preview.costConfigured
              ? `单价 ${preview.unitPriceCents} 分，费用 ${preview.costCents} 分。`
              : '费用还没配置。'}
          </p>
        )}
        <p className="muted">
          个性推广指：买过至少 2 次，或已有确认事实的人单独写，信里写出商品、天数、品类和已确认事实。其余人共用一封底稿，复制时才填上各人的姓名和上次商品。没有姓名或国家的客户不会出现在这个名单里。
        </p>
        {preview && !preview.missingAbandoned && (
          <div style={{ maxHeight: 280, overflow: 'auto' }}>
            {preview.items.map((item) => (
              <label key={item.id} style={{ display: 'block' }}>
                <input
                  type="checkbox"
                  checked={!removed.includes(item.id)}
                  onChange={() =>
                    setRemoved((current) =>
                      current.includes(item.id) ? current.filter((id) => id !== item.id) : [...current, item.id],
                    )
                  }
                />{' '}
                {item.firstName} {item.lastName}
                {item.eligible ? '' : ' · 不生成'}
              </label>
            ))}
          </div>
        )}
        <label>推广意图（中文）</label>
        <textarea value={intent} onChange={(e) => setIntent(e.target.value)} rows={3} />
        <label>折扣码</label>
        <input value={code} onChange={(e) => setCode(e.target.value)} />
        <p>
          <button
            className="btn"
            disabled={busy || !intent.trim() || preview?.missingAbandoned || chosen.length === 0}
            onClick={async () => {
              setBusy(true);
              setError('');
              try {
                const created = await api.createOutreach({
                  scenario,
                  intentZh: intent.trim(),
                  discountCode: code.trim(),
                  customerIds: chosen.map((item) => item.id),
                  ...(language ? { language } : {}),
                  ...(category ? { category } : {}),
                  ...(spendTier ? { spendTier } : {}),
                });
                await api.generate(created.id);
                nav(`/outreach/${created.id}`);
              } catch (err) {
                setError(err instanceof Error ? err.message : '生成失败。请确认后端已启动后再试。');
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy ? '正在开始写信…' : '开始生成'}
          </button>
        </p>
        {error && <p className="danger">{error}</p>}
      </div>
    </div>
  );
}

function OutreachListPage() {
  const [items, setItems] = useState<OutreachListItem[]>([]);
  const [error, setError] = useState('');
  useEffect(() => {
    api
      .listOutreach()
      .then((data) => setItems(data.items))
      .catch((err) => setError(err instanceof Error ? err.message : '推广列表加载失败'));
  }, []);
  return (
    <div>
      <h2>推广</h2>
      <div className="card">
        {error && <p className="danger">{error}</p>}
        {items.map((item) => (
          <p key={item.id}>
            <Link to={`/outreach/${item.id}`}>{item.name}</Link>
            <span className="muted">
              {' '}
              · {progressLabel(item.status, item.job)} · {item.intentZh}
            </span>
          </p>
        ))}
        {items.length === 0 && !error && <p className="muted">还没有推广，先去挑选客户。</p>}
      </div>
    </div>
  );
}

function OutreachPage() {
  const { id } = useParams();
  const [data, setData] = useState<Outreach | null>(null);
  const [current, setCurrent] = useState<Draft | null>(null);
  const [body, setBody] = useState('');
  const [copied, setCopied] = useState('');
  const [rendered, setRendered] = useState<{ subject: string; body: string } | null>(null);
  const [message, setMessage] = useState('');
  const currentId = current?.id;
  const load = () =>
    id &&
    api.getOutreach(id).then((d) => {
      setData(d);
      const next = d.drafts.find((x) => x.id === currentId) || d.drafts[0] || null;
      setCurrent(next);
      if (!currentId || next?.id !== currentId) setBody(next?.body || '');
    });
  useEffect(() => {
    if (!id) return;
    let timer = 0;
    let stop = false;
    const tick = () => {
      api.getOutreach(id).then((d) => {
        if (stop) return;
        setData(d);
        setCurrent((prev) => {
          const next = d.drafts.find((item) => item.id === prev?.id) || d.drafts[0] || null;
          if (!prev || prev.id !== next?.id) setBody(next?.body || '');
          return next;
        });
        if (d.job?.status === 'writing') timer = window.setTimeout(tick, 800);
      });
    };
    tick();
    return () => {
      stop = true;
      window.clearTimeout(timer);
    };
  }, [id]);
  if (!data) return <p>加载中…</p>;
  return (
    <div>
      <h2>
        {data.name} · {progressLabel(data.status, data.job)}
      </h2>
      <p className="muted">{data.intentZh}</p>
      <div className="banner">模拟发送 · 可触达 {data.reachable} · 排除 {data.excluded}</div>
      {data.job && (
        <div className="banner">
          计划 {data.job.plannedCount} 封，已写完 {data.job.completedCount} 封
          {data.job.nextCustomerName ? `，还没写的从 ${data.job.nextCustomerName} 开始` : ''}，失败 {data.job.failedCount}{' '}
          封
        </div>
      )}
      <div className="row">
        <button
          className="btn"
          onClick={async () => {
            if (!id) return;
            const res = await api.bulkApprove(id);
            setMessage(`已通过 ${res.approved} 份，跳过 ${res.skipped} 份`);
            load();
          }}
        >
          一键通过
        </button>
        <button
          className="btn secondary"
          onClick={async () => {
            if (!id) return;
            const res = await api.send(id);
            setMessage(`已模拟发送 ${res.sent} 封`);
            load();
          }}
        >
          模拟发送
        </button>
        {data.job && data.job.status !== 'writing' && (data.job.status === 'interrupted' || data.job.failedCount > 0 || data.job.completedCount < data.job.plannedCount) && (
          <button
            className="btn secondary"
            onClick={async () => {
              if (!id) return;
              await api.continueGeneration(id);
              setMessage('继续写剩下的');
              load();
            }}
          >
            继续写剩下的
          </button>
        )}
      </div>
      {message && <p>{message}</p>}
      <div className="split" style={{ marginTop: 16 }}>
        <div className="card">
          <h3>文案列表</h3>
          {data.drafts.map((d) => (
            <p key={d.id}>
              <button
                className="link"
                style={{ background: 'none', border: 0, cursor: 'pointer', color: '#16332a' }}
                onClick={() => {
                  setCurrent(d);
                  setBody(d.body);
                  setRendered(null);
                  setCopied('');
                }}
              >
                {d.firstName} {d.lastName} · {d.language === 'es' ? '西语' : '英语'} · {statusLabel(d.status)}
              </button>
              <br />
              <span className="muted">{d.personalizationPoints[0]}</span>
            </p>
          ))}
        </div>
        {current && (
          <div className="card">
            <h3>
              {current.firstName} {current.lastName}
            </h3>
            <p className="muted">
              {current.mode === 'personalized'
                ? '这封是单独写的。正文里应能看出这个人的商品、天数或已确认事实。'
                : '这封和同一群人共用底稿。上面仍是占位符，复制后才会变成这个人的姓名和上次商品。'}
            </p>
            {current.personalizationPoints.map((p) => (
              <span key={p} className="tag">
                {p}
              </span>
            ))}
            {current.issues.map((i) => (
              <p key={i.message} className="danger">
                {i.message}
              </p>
            ))}
            <p>
              <b>{current.subject}</b>
            </p>
            <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={12} />
            {localBlockers(body).map((issue) => (
              <p key={issue} className="danger">
                {issue}
              </p>
            ))}
            <p className="muted">中文对照：{current.zhBody}</p>
            <div className="row">
              <button
                className="btn secondary"
                onClick={async () => {
                  try {
                    await api.updateDraft(current.id, body);
                    setMessage('已保存修改');
                    load();
                  } catch (err) {
                    setMessage(err instanceof Error ? err.message : '保存失败');
                  }
                }}
              >
                保存修改
              </button>
              <button
                className="btn"
                disabled={localBlockers(body).length > 0 || current.status === 'approved'}
                onClick={async () => {
                  try {
                    await api.updateDraft(current.id, body);
                    await api.reviewDraft(current.id);
                    setMessage('这份文案已通过');
                    load();
                  } catch (err) {
                    setMessage(err instanceof Error ? err.message : '无法通过');
                  }
                }}
              >
                {current.status === 'approved' ? '已通过' : '通过'}
              </button>
              <button
                className="btn secondary"
                onClick={async () => {
                  try {
                    const next = await api.regenerateDraft(current.id);
                    setMessage(next.writer === 'template' ? '这一封已用信纸重写' : '这一封已重新生成');
                    setBody(next.body);
                    load();
                  } catch (err) {
                    setMessage(err instanceof Error ? err.message : '无法重写');
                  }
                }}
              >
                重新生成这一封
              </button>
              <button
                className="btn secondary"
                onClick={async () => {
                  try {
                    const next = await api.renderDraft(current.id);
                    setRendered(next);
                    const text = `${next.subject}\n\n${next.body}`;
                    try {
                      await navigator.clipboard.writeText(text);
                      setCopied('已复制填好姓名的最终文案。下面也能直接选中。');
                    } catch {
                      setCopied('浏览器没有允许自动复制。请在下面选中文案后手动复制。');
                    }
                  } catch (err) {
                    setCopied('');
                    setMessage(err instanceof Error ? err.message : '无法生成最终文案');
                  }
                }}
              >
                复制
              </button>
            </div>
            {copied && <p className="muted">{copied}</p>}
            {rendered && (
              <pre className="copy-box">
                {rendered.subject}
                {'\n\n'}
                {rendered.body}
              </pre>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function categoryLabel(category: string | null) {
  if (category === 'cat_litter') return '猫砂';
  if (category === 'cat_food') return '猫粮';
  if (category === 'dog_food') return '狗粮';
  if (category === 'treats') return '零食玩具';
  return '还没有';
}

function localBlockers(body: string) {
  return draftIssues(body).map((issue) => issue.message);
}

function statusLabel(status: string) {
  if (status === 'draft') return '草稿';
  if (status === 'reviewing') return '待审核';
  if (status === 'ready') return '待审核';
  if (status === 'approved') return '已通过';
  if (status === 'rejected') return '已拒绝';
  if (status === 'sent') return '已发送';
  return status;
}

function factStatus(status: string) {
  if (status === 'confirmed') return '已确认';
  return '待确认';
}

function factKind(kind: string) {
  if (kind === 'caution') return '需要小心的事';
  if (kind === 'preference') return '偏好';
  return '还没分类';
}

function progressLabel(status: string, job: GenerationJob | null) {
  if (status === 'sent') return '已发送';
  if (job?.status === 'writing') return '正在写';
  if (job?.status === 'done') return '已写完';
  if (job?.status === 'interrupted') return '中途停下';
  return statusLabel(status);
}

function Guard({ children }: { children: ReactNode }) {
  const { ready, ok, store } = useAuth();
  if (!ready) return <p style={{ padding: 40 }}>加载中…</p>;
  if (!ok) return <Navigate to="/login" replace />;
  return <Shell store={store}>{children}</Shell>;
}

export function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route
        path="/"
        element={
          <Guard>
            <OverviewPage />
          </Guard>
        }
      />
      <Route
        path="/customers"
        element={
          <Guard>
            <CustomersPage />
          </Guard>
        }
      />
      <Route
        path="/customers/:id"
        element={
          <Guard>
            <CustomerPage />
          </Guard>
        }
      />
      <Route
        path="/import"
        element={
          <Guard>
            <ImportPage />
          </Guard>
        }
      />
      <Route
        path="/store"
        element={
          <Guard>
            <StorePage />
          </Guard>
        }
      />
      <Route
        path="/audience"
        element={
          <Guard>
            <AudiencePage />
          </Guard>
        }
      />
      <Route
        path="/outreach"
        element={
          <Guard>
            <OutreachListPage />
          </Guard>
        }
      />
      <Route
        path="/outreach/:id"
        element={
          <Guard>
            <OutreachPage />
          </Guard>
        }
      />
    </Routes>
  );
}
