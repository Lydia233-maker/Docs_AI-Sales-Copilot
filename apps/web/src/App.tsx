import { useEffect, useState, type ReactNode } from 'react';
import { draftIssues } from '@copilot/shared';
import { Link, Navigate, Route, Routes, useLocation, useNavigate, useParams } from 'react-router-dom';
import {
  api,
  type Customer,
  type CustomerDetail,
  type ImportPreview,
  type Draft,
  type Outreach,
  type OutreachListItem,
  type Preview,
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
                nav('/customers');
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
                    {c.firstName} {c.lastName}
                  </Link>
                </td>
                <td>{c.country}</td>
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
  const [text, setText] = useState('');
  const [tag, setTag] = useState('');
  const [tagError, setTagError] = useState('');
  const [noteError, setNoteError] = useState('');
  const [warn, setWarn] = useState<string[]>([]);
  const [languageError, setLanguageError] = useState('');
  const load = () => id && api.customer(id).then(setData);
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
            <tr>
              <th>偏好标签</th>
              <td>
                {(data.preferenceTags || []).length === 0
                  ? '还没有'
                  : data.preferenceTags.map((item) => (
                      <span key={item} className="tag">
                        {item}
                      </span>
                    ))}
              </td>
            </tr>
          </tbody>
        </table>
        <label>添加偏好标签</label>
        <div className="row">
          <input
            value={tag}
            onChange={(e) => {
              setTag(e.target.value);
              setTagError('');
            }}
            placeholder="例如：布偶猫"
          />
          <button
            className="btn"
            onClick={async () => {
              const value = tag.trim();
              if (!id || !value) {
                setTagError('标签不能为空');
                return;
              }
              if (value.length > 40) {
                setTagError('标签最多 40 个字');
                return;
              }
              try {
                await api.addTag(id, value);
                setTag('');
                setTagError('');
                load();
              } catch (err) {
                const message = err instanceof Error ? err.message : '';
                setTagError(
                  message.includes('标签') ? message : '网络失败，标签没有保存。请确认后端已启动后再试。',
                );
              }
            }}
          >
            添加标签
          </button>
        </div>
        {tagError && <p className="danger">{tagError}</p>}
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
        {data.notes.map((n) => (
          <p key={n.id}>{n.text}</p>
        ))}
        {warn.length > 0 && (
          <p className="warn">备注中包含{warn.map(privacyLabel).join('、')}，发给 AI 前会自动隐藏</p>
        )}
        <textarea
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            setNoteError('');
          }}
          rows={3}
        />
        {noteError && <p className="danger">{noteError}</p>}
        <p>
          <button
            className="btn"
            onClick={async () => {
              if (!id || !text.trim()) {
                setNoteError('备注不能为空');
                return;
              }
              try {
                const res = await api.addNote(id, text);
                setWarn(res.privacyWarnings);
                setText('');
                setNoteError('');
                load();
              } catch (err) {
                setNoteError(err instanceof Error ? err.message : '备注没有保存。请确认后端已启动后再试。');
              }
            }}
          >
            添加备注
          </button>
        </p>
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
      <div className="card">
        <p className="muted">先预览。确认之前不会写入客户和订单。</p>
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
              文件里有客户 {preview.customers} 人，其中西班牙语 {preview.spanish} 人，备注 {preview.notes} 条。订单{' '}
              {preview.orders} 笔
              {preview.unmatchedOrders > 0 ? `，其中 ${preview.unmatchedOrders} 笔对不上这次的客户表` : ''}。
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
                    setMessage(`已导入。客户 ${saved.customers} 人，西班牙语 ${saved.spanish} 人，订单 ${saved.orders} 笔。`);
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
    </div>
  );
}

function AudiencePage() {
  const nav = useNavigate();
  const [scenario, setScenario] = useState<'winback_dormant' | 'all'>('winback_dormant');
  const [preview, setPreview] = useState<Preview | null>(null);
  const [intent, setIntent] = useState('黑五老客专享 8 折，主推猫砂和猫粮，强调囤货划算');
  const [code, setCode] = useState('SAVE20');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const refresh = () => api.preview({ scenario }).then(setPreview);
  useEffect(() => {
    refresh();
  }, [scenario]);
  return (
    <div>
      <h2>挑选客户</h2>
      <div className="card">
        <label>场景</label>
        <select value={scenario} onChange={(e) => setScenario(e.target.value as 'winback_dormant' | 'all')}>
          <option value="winback_dormant">沉睡召回（60 天以上未购买）</option>
          <option value="all">全部客户</option>
        </select>
        {preview && (
          <p>
            共 {preview.total} 人，可触达 {preview.reachable} 人，排除 {preview.excluded} 人（未同意营销）。英语{' '}
            {preview.languages.en}，西班牙语 {preview.languages.es}。逐个定制 {preview.personalized}，小群方式{' '}
            {preview.cohort}。
          </p>
        )}
        <label>推广意图（中文）</label>
        <textarea value={intent} onChange={(e) => setIntent(e.target.value)} rows={3} />
        <label>折扣码</label>
        <input value={code} onChange={(e) => setCode(e.target.value)} />
        <p>
          <button
            className="btn"
            disabled={busy || !intent.trim()}
            onClick={async () => {
              setBusy(true);
              setError('');
              try {
                const created = await api.createOutreach({
                  scenario,
                  intentZh: intent.trim(),
                  discountCode: code.trim(),
                });
                const generated = await api.generate(created.id);
                nav(`/outreach/${generated.id}`);
              } catch (err) {
                setError(err instanceof Error ? err.message : '生成失败。请确认后端已启动后再试。');
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy ? '正在为客户生成文案…' : '开始生成'}
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
              · {statusLabel(item.status)} · {item.intentZh}
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
  const load = () =>
    id &&
    api.getOutreach(id).then((d) => {
      setData(d);
      const next = d.drafts.find((x) => x.id === current?.id) || d.drafts[0] || null;
      setCurrent(next);
      setBody(next?.body || '');
    });
  useEffect(() => {
    load();
  }, [id]);
  if (!data) return <p>加载中…</p>;
  return (
    <div>
      <h2>
        {data.name} · {statusLabel(data.status)}
      </h2>
      <p className="muted">{data.intentZh}</p>
      <div className="banner">模拟发送 · 可触达 {data.reachable} · 排除 {data.excluded}</div>
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
                    await api.reviewDraft(current.id, 'approve');
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

function privacyLabel(code: string) {
  if (code === 'email') return '邮箱';
  if (code === 'phone') return '电话';
  return code;
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
      <Route path="/" element={<Navigate to="/customers" replace />} />
    </Routes>
  );
}
