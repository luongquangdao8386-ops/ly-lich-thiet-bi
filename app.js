'use strict';
/* ===================== Tiện ích ===================== */
const C = window.APP_CONFIG;
const $ = (s, r = document) => r.querySelector(s);
const view = $('#view');
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const bi = (vi, zh) => `<span class="bi"><span class="vi">${vi}</span><span class="zh" lang="zh">${zh}</span></span>`;
const iso = d => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
const today = () => iso(new Date());
const addDays = (s, n) => { const d = new Date(s + 'T00:00:00'); d.setDate(d.getDate() + Number(n)); return iso(d); };
const daysBetween = (a, b) => Math.round((new Date(b + 'T00:00:00') - new Date(a + 'T00:00:00')) / 86400000);
const fmtDate = s => (s ? String(s).slice(0, 10).split('-').reverse().join('/') : '');
const fmtTime = t => new Date(t).toLocaleString('vi-VN', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit' });
const num = v => (v === '' || v == null ? '' : Number(v).toLocaleString('vi-VN'));
const go = h => { location.hash = h; };
const isUrl = u => /^https?:\/\//i.test(u);
const msgBad = html => `<p class="msg bad">${html}</p>`;
const loading = () => { view.innerHTML = `<p class="empty">${bi('Đang tải…', '加载中…')}</p>`; };

/* Bộ nhớ đệm trên máy: lưu {t: thời điểm, data} để xem khi mất mạng */
const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* bộ nhớ đầy */ } },
  del(k) { try { localStorage.removeItem(k); } catch { /* bỏ qua */ } }
};
const cache = {
  get: k => store.get('tb3_' + k, null),
  set: (k, data) => store.set('tb3_' + k, { t: Date.now(), data })
};
const staleNote = t => `<p class="note stale">${bi('Đang xem dữ liệu đã lưu lúc ' + fmtTime(t), '正在查看缓存数据，保存于 ' + fmtTime(t))}</p>`;

/* Trạng thái máy — trong Sheets ghi dạng "Đang chạy / 运行中" */
const STATUS = [
  [/^(đang chạy|运行)/i, 'run', '运行中'],
  [/^(đang sửa|hỏng|维修|故障)/i, 'down', '维修中'],
  [/^(dừng|停机)/i, 'maint', '停机'],
  [/^(thanh l[ýí]|报废)/i, 'off', '报废']
];
function st(s) {
  s = String(s || '').trim();
  const [vi, zh] = s.split(/\s*\/\s*/);
  const hit = STATUS.find(x => x[0].test(s));
  return { vi: vi || '—', zh: zh || (hit ? hit[2] : ''), cls: hit ? hit[1] : 'none' };
}
const ICON_SCAN = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 8V4h4M16 4h4v4M20 16v4h-4M8 20H4v-4M8 12h8"/></svg>';
const LOGO = '<img src="icons/logo.png" alt="" aria-hidden="true">';

/* ===================== Lớp dữ liệu (API Apps Script) =====================
   Định dạng theo Code.gs phiên 2: {ok:true,data} | {ok:false,error}
   GET  ?action=list|machine&ma=|dashboard  (&token= nếu có READ_TOKEN)
   POST text/plain {action:'addRepair', pin, data:{...}} | {action:'uploadPhoto', pin, ma, mimeType, base64} */
const apiReady = () => /^https:\/\/script\.google\.com\/(a\/[^/]+\/)?macros\/s\/[\w-]{20,}\/exec$/.test(String(C.API_URL || '').trim());
class ApiError extends Error { constructor(m, code) { super(m); this.code = code; } }
async function call(url, opt = {}) {
  if (!apiReady()) throw new ApiError('Chưa điền đúng API_URL trong config.js', 'CONFIG');
  const ctl = new AbortController(), timer = setTimeout(() => ctl.abort(), opt.timeout || 30000);
  let res;
  try { res = await fetch(url, { ...opt, signal: ctl.signal, redirect: 'follow' }); }
  catch (e) { throw new ApiError(e.name === 'AbortError' ? 'Máy chủ phản hồi quá lâu' : 'Không kết nối được máy chủ', 'NET'); }
  finally { clearTimeout(timer); }
  if (!res.ok) throw new ApiError('Máy chủ báo lỗi HTTP ' + res.status, 'HTTP');
  let j;
  try { j = await res.json(); } catch { throw new ApiError('Máy chủ trả dữ liệu lạ — kiểm tra triển khai Apps Script (Quyền truy cập: Bất kỳ ai)', 'FORMAT'); }
  if (!j.ok) {
    const e = String(j.error || 'Lỗi không rõ');
    throw new ApiError(e, /^Không tìm thấy (thiết bị|điểm đo)/.test(e) ? 'NOT_FOUND' : /PIN/.test(e) ? 'PIN' : 'SERVER');
  }
  return j.data;
}
function get(action, params = {}) {
  const u = new URL(String(C.API_URL).trim());
  u.searchParams.set('action', action);
  if (C.READ_TOKEN) u.searchParams.set('token', C.READ_TOKEN);
  Object.entries(params).forEach(([k, v]) => u.searchParams.set(k, v));
  return call(u);
}
const post = body => call(String(C.API_URL).trim(), {
  method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(body), timeout: 90000
});

/* Link Drive "chia sẻ" → link ảnh hiển thị được */
function imgUrl(u) {
  u = String(u || '').trim().split(/\s+/)[0] || '';
  const m = u.match(/drive\.google\.com\/(?:file\/d\/|open\?id=|uc\?(?:.*&)?id=)([\w-]{20,})/);
  return m ? `https://drive.google.com/thumbnail?id=${m[1]}&sz=w1280` : (isUrl(u) ? u : '');
}
const firstUrl = u => { const s = String(u || '').trim().split(/\s+/)[0] || ''; return isUrl(s) ? s : ''; };
const normM = m => ({ ...m, ma: String(m.ma), hang: m.hangSX, nam: m.namLapDat, anh: imgUrl(m.anh), taiLieu: firstUrl(m.taiLieu) });
const normR = r => ({ ...r, nguoi: r.nguoiThucHien, gioDung: r.thoiGianDung, anh: (r.anh || []).map(imgUrl).filter(Boolean) });
const normP = p => ({ ...p, lanCuoi: p.ngayGanNhat });
const normB = b => ({ ...b, anh: (b.anh || []).map(imgUrl).filter(Boolean) });
/* Một lần kiểm tra hằng ngày */
const normK = k => (k ? { ...k, anh: (k.anh || []).map(imgUrl).filter(Boolean) } : null);
function normCl(cl) {
  if (!cl) return null;
  return { ...cl, muc: cl.muc || [], lanGanNhat: normK(cl.lanGanNhat),
    lichSu: (cl.lichSu || []).map(normK) };
}

/* Kiểm định (phiên 7): thêm ngayKetThuc để dùng chung nhãn hạn với hợp đồng */
const normKD = k => ({ ...k, ngayKetThuc: k.ngayHetHan });

/* Chỉ số – điểm đo (phiên 8A) */
const normCS = r => (r ? { ...r, anh: (r.anh || []).map(imgUrl).filter(Boolean) } : null);
const normDD = d => ({ ...d, lanCuoi: normCS(d.lanCuoi) });

const api = {
  list: async () => (await get('list')).map(normM),
  async machine(ma) {
    const d = await get('machine', { ma });
    return {
      machine: normM(d.machine), repairs: (d.repairs || []).map(normR),
      maintenance: (d.maintenance || []).map(normP),
      maintHistory: (d.maintHistory || []).map(normB),
      contracts: d.contracts || [],
      inspections: (d.inspections || []).map(normKD),
      meters: (d.meters || []).map(normDD),
      dienNguon: d.dienNguon || null,
      checklist: normCl(d.checklist),
      specs: d.specs || null
    };
  },
  dashboard: () => get('dashboard'),
  contracts: () => get('contracts'),
  inspections: async () => (await get('inspections')).map(normKD),
  checks: ngay => get('checks', { ngay }),
  meters: async () => (await get('meters')).map(normDD),
  async meter(maDiem) {
    const d = await get('meter', { maDiem });
    return { ...d, lanCuoi: normCS(d.lanCuoi), lichSu: (d.lichSu || []).map(normCS) };
  },
  async energy() {
    const d = await get('energy');
    return { ...d, diem: (d.diem || []).map(normDD) };
  },
  power: () => get('power'),
  panel: maTu => get('panel', { maTu }),
  specs: ma => get('specs', { ma }),
  addRepair: (pin, data) => post({ action: 'addRepair', pin, data }),
  completeMaint: (pin, data) => post({ action: 'completeMaint', pin, data }),
  addCheck: (pin, data) => post({ action: 'addCheck', pin, data }),
  addReading: (pin, data) => post({ action: 'addReading', pin, data }),
  uploadPhoto: (pin, ma, base64) => post({ action: 'uploadPhoto', pin, ma, mimeType: 'image/jpeg', base64 })
};

/* Nén ảnh: cạnh dài tối đa 1280px, JPEG → base64 (không kèm tiền tố data:) */
async function compressImage(file, max = 1280, q = 0.8) {
  let src;
  try { src = await createImageBitmap(file, { imageOrientation: 'from-image' }); }
  catch {
    src = await new Promise((ok, no) => {
      const i = new Image();
      i.onload = () => ok(i);
      i.onerror = () => no(new Error('Không đọc được ảnh'));
      i.src = URL.createObjectURL(file);
    });
  }
  const w = src.width, h = src.height, k = Math.min(1, max / Math.max(w, h));
  const c = document.createElement('canvas');
  c.width = Math.round(w * k); c.height = Math.round(h * k);
  c.getContext('2d').drawImage(src, 0, 0, c.width, c.height);
  return c.toDataURL('image/jpeg', q).split(',')[1];
}

/* ============ Hàng đợi gửi khi mất mạng (phiên 6, mở rộng phiên 8A) ============
   Mỗi phần tử: {loai:'check'|'chiso', ma, data, files:[{b64}|{url}], t}
   (phần tử cũ không có 'loai' được hiểu là 'check')
   PIN chỉ nhớ trong phiên (sessionStorage), không lưu lâu trên máy. */
const QKEY = 'tb3_queue';
const queueAll = () => store.get(QKEY, []) || [];
const queueOf = loai => queueAll().filter(x => (x.loai || 'check') === loai);
const queueSet = a => store.set(QKEY, a);
const queueAdd = it => { const a = queueAll(); a.push(it); queueSet(a); };
const pinNho = () => { try { return sessionStorage.getItem('tb_pin') || ''; } catch { return ''; } };
const nhoPin = p => { try { sessionStorage.setItem('tb_pin', p); } catch { /* bỏ qua */ } };

let dangGui = false;
async function flushQueue(pin) {
  const p = pin || pinNho();
  let q = queueAll();
  if (!q.length) return { sent: 0, left: 0 };
  if (!navigator.onLine) return { sent: 0, left: q.length, off: true };
  if (!p) return { sent: 0, left: q.length, needPin: true };
  if (dangGui) return { sent: 0, left: q.length, busy: true };
  dangGui = true;
  let sent = 0, err = null;
  try {
    while (q.length) {
      const it = q[0];
      try {
        for (const f of it.files || []) {
          if (f.url) continue;
          f.url = (await api.uploadPhoto(p, it.ma, f.b64)).url;
          delete f.b64;
          queueSet(q);         // nhớ ảnh đã tải: gửi lại không tải trùng
        }
        const anh = (it.files || []).map(f => f.url).filter(Boolean);
        if ((it.loai || 'check') === 'chiso') {
          await api.addReading(p, { ...it.data, anh });
          store.del('tb3_dd_' + it.ma); store.del('tb3_nl');
        } else {
          await api.addCheck(p, { ...it.data, anh });
          store.del('tb3_m_' + it.ma);
        }
        q.shift(); queueSet(q); sent++;
        store.del('tb3_dash');
      } catch (e) { err = e; break; }
    }
  } finally { dangGui = false; }
  banner();
  return { sent, left: q.length, err, needPin: err && err.code === 'PIN' };
}

/* ===================== Bảo trì: tính hạn ===================== */
function due(x) {
  if (!x.lanCuoi || !(Number(x.chuKy) > 0)) return { d: 1e9, cls: 'warn', html: bi('Chưa có ngày làm gần nhất', '未填写最近保养日期') };
  const denHan = addDays(x.lanCuoi, x.chuKy), d = daysBetween(today(), denHan);
  if (d < 0) return { denHan, d, cls: 'bad', html: bi(`Quá hạn ${-d} ngày`, `逾期 ${-d} 天`) };
  if (d === 0) return { denHan, d, cls: 'warn', html: bi('Đến hạn hôm nay', '今天到期') };
  if (d <= 7) return { denHan, d, cls: 'warn', html: bi(`Còn ${d} ngày`, `剩 ${d} 天`) };
  return { denHan, d, cls: 'ok', html: bi(`Hạn ${fmtDate(denHan)}`, `到期 ${fmtDate(denHan)}`) };
}
const byRecent = (a, b) => String(b.ngay).localeCompare(String(a.ngay)) || String(b.maPhieu).localeCompare(String(a.maPhieu));
/* Ô Sheets ghi "Hoàn thành / 已完成" → tách hai dòng */
const viZh = s => { const [vi, zh] = String(s || '').split(/\s*\/\s*/); return { vi: vi || '—', zh: zh || '' }; };
const sameText = (a, b) => String(a || '').trim().toLowerCase() === String(b || '').trim().toLowerCase();

/* ============ Biểu đồ cột SVG thuần (phiên 8A, không thêm thư viện) ============
   rows: [{label, v}] */
function svgBars(rows, opt = {}) {
  const n = rows.length;
  if (!n) return `<p class="empty">${bi('Chưa có dữ liệu', '暂无数据')}</p>`;
  const W = 340, H = 134, top = 8, bot = 20;
  const max = Math.max(0, ...rows.map(r => Number(r.v) || 0));
  const bw = W / n, pad = Math.min(4, bw * 0.16);
  const cao = v => (max > 0 && v > 0 ? Math.max(2, (v / max) * (H - top - bot)) : 0);
  const buoc = Math.max(1, Math.ceil(n / 7));
  const don = opt.unit ? ' ' + opt.unit : '';
  const bars = rows.map((r, i) => {
    const v = Number(r.v) || 0, h = cao(v), y = H - bot - h;
    const x = i * bw + pad, w = Math.max(1, bw - pad * 2);
    const nhan = (i % buoc === 0 || i === n - 1)
      ? `<text x="${(i * bw + bw / 2).toFixed(1)}" y="${H - 5}" text-anchor="middle" font-size="9" fill="currentColor" opacity=".6">${esc(r.label)}</text>` : '';
    return `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${w.toFixed(1)}" height="${h.toFixed(1)}" rx="2" fill="var(--bronze)" opacity="${v > 0 ? '.95' : '.2'}"><title>${esc(r.label)}: ${num(v)}${esc(don)}</title></rect>${nhan}`;
  }).join('');
  return `<div class="chart">
    <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(opt.alt || 'Biểu đồ cột')}">
      <line x1="0" y1="${H - bot}" x2="${W}" y2="${H - bot}" stroke="currentColor" opacity=".2"/>${bars}</svg>
    <p class="note" style="margin:2px 0 0">${bi('Cao nhất ' + num(max) + don, '最高 ' + num(max) + don)}</p></div>`;
}
/* Nhãn "đã ghi / chưa ghi hôm nay" của một điểm đo */
function csNhan(d) {
  if (d.daGhiHomNay) return { cls: 'ok', html: bi('Đã ghi', '已抄') };
  return { cls: 'warn', html: bi('Chưa ghi', '未抄') };
}
/* Một điểm đo trong danh sách (trang Năng lượng, trang máy) */
function ddCard(x, maxThang) {
  const n = csNhan(x);
  const bar = maxThang ? `<i class="dd-bar"><em style="width:${((x.thangNay || 0) / maxThang * 100).toFixed(1)}%"></em></i>` : '';
  const thang = x.thangNay != null
    ? `<p class="dd-val"><b>${num(x.thangNay)} ${esc(x.donVi)}</b> <span class="s">${bi('tháng này', '本月')}</span></p>${bar}` : '';
  return `<li><a class="dd-card" href="#/diem/${encodeURIComponent(x.maDiem)}">
    <div class="dd-top"><span class="plate">${esc(x.maDiem)}</span>
      ${x.laSEU ? `<span class="badge warn seu">SEU</span>` : ''}
      <span class="badge ${n.cls} dd-badge">${n.html}</span></div>
    <b class="dd-name">${esc(x.ten)}</b>
    ${thang}
    <span class="s">${csLanCuoi(x)}</span></a></li>`;
}
/* Dòng mô tả lần ghi gần nhất của một điểm đo */
const csLanCuoi = d => (d.lanCuoi
  ? bi(`Lần cuối ${fmtDate(d.lanCuoi.ngay)}: ${num(d.lanCuoi.giaTri)} ${esc(d.donVi)}`,
    `上次 ${fmtDate(d.lanCuoi.ngay)}：${num(d.lanCuoi.giaTri)} ${esc(d.donVi)}`)
  : bi('Chưa có số liệu', '暂无数据'));
const nowLocal = () => {
  const d = new Date();
  return iso(d) + 'T' + String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
};
/* Hộp "đang chờ gửi" dùng chung (phiên 8A) */
function veQueueBox(el, loai, vi, zh, sauKhiGui) {
  const draw = () => {
    const n = queueOf(loai).length;
    el.innerHTML = n ? `<div class="alert warn"><b>${n}</b><span>${bi(vi, zh)}</span>
      <button class="btn mini primary" id="guiQ" style="margin-left:auto">${bi('Gửi ngay', '立即提交')}</button></div><div id="qmsg"></div>` : '';
    const b = $('#guiQ', el);
    if (!b) return;
    b.onclick = async () => {
      let pin = pinNho();
      if (!pin) pin = String(prompt('Nhập mã PIN để gửi / 请输入PIN码') || '').trim();
      if (!pin) return;
      b.disabled = true; b.textContent = '…';
      const res = await flushQueue(pin);
      if (res.sent) nhoPin(pin);
      const msg = $('#qmsg', el);
      if (msg) {
        msg.innerHTML = res.left
          ? msgBad(res.needPin ? bi('Sai mã PIN — thử lại', 'PIN码错误 — 请重试')
            : bi('Còn ' + res.left + ' bản ghi chưa gửi được: ' + esc(res.err?.message || ''), '还有 ' + res.left + ' 条未提交'))
          : `<p class="note">${bi('Đã gửi xong ' + res.sent + ' bản ghi', '已提交 ' + res.sent + ' 条')}</p>`;
      }
      if (res.sent && sauKhiGui) sauKhiGui();
      else draw();
    };
  };
  draw();
}

/* ===================== Hợp đồng bảo trì: nhãn hạn ===================== */
/* muc do máy chủ tính: het = đã hết hạn, sap = trong ngưỡng báo trước,
   ok = còn dài, xong = đã gia hạn/ngừng, thieu = chưa có ngày kết thúc */
function hdHan(h) {
  const d = h.conLai;
  if (h.muc === 'xong') return { cls: 'off', html: bi(esc(hdTinhTrang(h).vi), esc(hdTinhTrang(h).zh)) };
  if (h.muc === 'thieu') return { cls: 'warn', html: bi('Thiếu ngày kết thúc', '缺少结束日期') };
  if (d < 0) return { cls: 'bad', html: bi(`Quá hạn ${-d} ngày`, `已过期 ${-d} 天`) };
  if (d === 0) return { cls: 'bad', html: bi('Hết hạn hôm nay', '今天到期') };
  if (h.muc === 'sap') return { cls: 'warn', html: bi(`Còn ${d} ngày`, `剩 ${d} 天`) };
  return { cls: 'ok', html: bi(`Hết hạn ${fmtDate(h.ngayKetThuc)}`, `到期 ${fmtDate(h.ngayKetThuc)}`) };
}
/* Ô Sheets ghi "Đang hiệu lực / 有效" → tách hai dòng */
function hdTinhTrang(h) {
  const [vi, zh] = String(h.tinhTrang || '').split(/\s*\/\s*/);
  return { vi: vi || '—', zh: zh || '' };
}
/* Thanh thời gian: đã trôi qua bao nhiêu phần của hợp đồng */
function hdTienDo(h) {
  if (!h.ngayBatDau || !h.ngayKetThuc) return null;
  const tong = daysBetween(h.ngayBatDau, h.ngayKetThuc);
  if (!(tong > 0)) return null;
  const qua = daysBetween(h.ngayBatDau, today());
  return Math.max(0, Math.min(100, Math.round(qua / tong * 100)));
}
/* Lấy số điện thoại đầu tiên trong ô "Anh Nam – 0900 000 000" */
function hdTel(s) {
  const m = String(s || '').match(/(\+?\d[\d\s.()-]{7,})/);
  return m ? m[1].replace(/[^\d+]/g, '') : '';
}
const hdCard = h => {
  const han = hdHan(h), td = hdTienDo(h);
  return `<a class="hd-card" href="#/hop-dong/${encodeURIComponent(h.maHD)}">
    <div class="hd-top"><b>${esc(h.ten) || esc(h.maHD)}</b><span class="badge ${han.cls}">${han.html}</span></div>
    <div class="s">${esc(h.nhaThau) || '—'} · <span class="plate">${esc(h.maHD)}</span></div>
    ${td == null ? '' : `<div class="hd-bar ${han.cls}"><i style="width:${td}%"></i></div>`}
    <div class="s">${fmtDate(h.ngayBatDau) || '—'} → ${fmtDate(h.ngayKetThuc) || '—'}</div>
  </a>`;
};

/* ===================== Kiểm định / hiệu chuẩn (phiên 7) ===================== */
/* Dùng lại hdHan(): đối tượng kiểm định đã có muc / conLai / ngayKetThuc / tinhTrang */
const kdRow = (vi, zh, v) => v ? `<div class="wide"><dt>${bi(vi, zh)}</dt><dd>${esc(v)}</dd></div>` : '';
/* Còn hạn dài: hiện số ngày còn lại cho dễ so sánh (khác hợp đồng) */
function kdHan(k) {
  if (k.muc === 'ok' && k.conLai != null) return { cls: 'ok', html: bi(`Còn ${k.conLai} ngày`, `剩 ${k.conLai} 天`) };
  return hdHan(k);
}
function kdCard(k, mo) {
  const han = kdHan(k), lo = viZh(k.loai), tt = viZh(k.tinhTrang);
  return `<details class="kd-card"${mo ? ' open' : ''}>
    <summary>
      <div class="hd-top"><b>${esc(k.tenThietBi) || esc(k.ma)}</b><span class="badge ${han.cls}">${han.html}</span></div>
      <div class="s">${bi(esc(lo.vi), esc(lo.zh))}${k.ma ? ` · <span class="plate">${esc(k.ma)}</span>` : ''}</div>
      <div class="s">${bi('Hết hạn ' + (fmtDate(k.ngayHetHan) || '—'), '有效期至 ' + (fmtDate(k.ngayHetHan) || '—'))}</div>
    </summary>
    <dl class="info">
      <div><dt>${bi('Ngày kiểm định', '检验日期')}</dt><dd>${fmtDate(k.ngayKD) || '—'}</dd></div>
      <div><dt>${bi('Báo trước', '提前提醒')}</dt><dd>${esc(k.baoTruoc)} ${bi('ngày', '天')}</dd></div>
      ${kdRow('Đơn vị thực hiện', '检验单位', k.donVi)}
      ${kdRow('Số giấy CN / tem', '证书/标签编号', k.soGiay)}
      <div class="wide"><dt>${bi('Tình trạng', '状态')}</dt><dd>${bi(esc(tt.vi), esc(tt.zh))}</dd></div>
      ${kdRow('Ghi chú', '备注', k.ghiChu)}
    </dl>
    <div class="row2" style="margin-top:10px">
      ${isUrl(k.taiLieu) ? `<a class="btn" href="${esc(k.taiLieu)}" target="_blank" rel="noopener">${bi('Mở giấy chứng nhận', '打开证书')}</a>` : ''}
      ${k.ma ? `<a class="btn" href="#/may/${encodeURIComponent(k.ma)}">${bi('Xem lý lịch máy', '查看设备履历')}</a>` : ''}
    </div>
  </details>`;
}

/* ===================== Hiển thị chung ===================== */
function banner() {
  const b = $('#banner');
  const n = queueAll().length;
  if (!apiReady()) { b.className = 'banner bad'; b.innerHTML = bi('Chưa cấu hình: điền URL Apps Script vào API_URL trong config.js', '未配置：请在 config.js 的 API_URL 中填写 Apps Script 网址'); b.hidden = false; }
  else if (!navigator.onLine) {
    b.className = 'banner bad';
    b.innerHTML = bi('Không có mạng — đang xem dữ liệu đã lưu, chưa gửi được phiếu' + (n ? ` (${n} lần kiểm tra chờ gửi)` : ''),
      '无网络 — 正在查看已缓存数据，暂无法提交' + (n ? `（${n} 次点检待提交）` : ''));
    b.hidden = false;
  } else if (n) {
    b.className = 'banner';
    b.innerHTML = `<a href="#/kiem-tra">${bi(`${n} lần kiểm tra chờ gửi — bấm để gửi`, `${n} 次点检待提交 — 点击提交`)}</a>`;
    b.hidden = false;
  } else b.hidden = true;
}
function errText(e) {
  if (!navigator.onLine || e?.code === 'NET') return bi('Không có mạng hoặc không kết nối được máy chủ. Kiểm tra wifi/4G rồi thử lại.', '无网络或无法连接服务器，请检查 Wi-Fi/4G 后重试。');
  return bi('Không tải được dữ liệu: ' + esc(e?.message), '数据加载失败：' + esc(e?.message));
}
function errorBox(e) {
  view.innerHTML = `<div class="empty"><p>${errText(e)}</p><button class="btn" id="retry">${bi('Thử lại', '重试')}</button></div>`;
  $('#retry').onclick = route;
}
/* Lấy dữ liệu: có mạng thì lấy mới + lưu; lỗi thì dùng bản đã lưu (kèm thời điểm) */
async function fetchCached(key, fn) {
  try { const data = await fn(); cache.set(key, data); return { data }; }
  catch (e) {
    const c = e.code === 'NOT_FOUND' ? null : cache.get(key);
    if (c) return { data: c.data, stale: c.t, error: e };
    throw e;
  }
}
const photo = m => `<div class="photo">${m.anh ? `<a href="${esc(m.anh)}" target="_blank" rel="noopener"><img src="${esc(m.anh)}" alt="Ảnh ${esc(m.ten)}" loading="lazy" referrerpolicy="no-referrer"></a>` : bi('Chưa có ảnh', '暂无照片')}</div>`;

/* ===================== Trang chủ ===================== */
async function pageHome() {
  view.innerHTML = `
    <button class="scan-hero" id="goScan">${ICON_SCAN}${bi('Quét mã QR trên máy', '扫描设备二维码')}</button>
    <label class="search"><input id="q" type="search" autocomplete="off" placeholder="Tìm mã, tên, khu vực / 搜索编号、名称、区域" aria-label="Tìm máy"></label>
    <div id="stale"></div><div id="list"></div>`;
  $('#goScan').onclick = () => go('#/quet');
  const q = $('#q'), box = $('#list');
  q.value = sessionStorage.getItem('tb_q') || '';
  const c = cache.get('list');
  let data = c && c.data;
  const draw = () => {
    sessionStorage.setItem('tb_q', q.value);
    if (!data) { box.innerHTML = `<p class="empty">${bi('Đang tải…', '加载中…')}</p>`; return; }
    if (!data.length) { box.innerHTML = `<p class="empty">${bi('Chưa có máy nào. Nhập máy vào tab ThietBi trong Google Sheets.', '暂无设备，请在 Google 表格的 ThietBi 页录入。')}</p>`; return; }
    const k = q.value.trim().toLowerCase();
    const rows = data.filter(m => !k || [m.ma, m.ten, m.khuVuc, m.model].join(' ').toLowerCase().includes(k));
    if (!rows.length) { box.innerHTML = `<p class="empty">${bi('Không tìm thấy máy phù hợp', '未找到匹配设备')}</p>`; return; }
    const groups = {};
    rows.forEach(m => (groups[m.khuVuc || '—'] ||= []).push(m));
    box.innerHTML = Object.entries(groups).map(([area, ms]) => `
      <h2 class="area-h">${esc(area)} <small>${ms.length} ${bi('máy', '台')}</small></h2>
      <ul class="mlist">${ms.map(m => { const s = st(m.trangThai); return `<li><a class="mrow" href="#/may/${encodeURIComponent(m.ma)}">
        <span class="plate">${esc(m.ma)}</span>
        <span><span class="t">${esc(m.ten)}</span><br><span class="s">${esc(m.model)}</span></span>
        <span class="dot ${s.cls}" title="${esc(s.vi)}" aria-label="${esc(s.vi)}"></span></a></li>`; }).join('')}</ul>`).join('');
  };
  q.oninput = draw;
  draw();
  try {
    data = await api.list(); cache.set('list', data); draw();
  } catch (e) {
    if (!data) return errorBox(e);
    $('#stale').innerHTML = staleNote(c.t);
  }
}

/* ============ Thông số vận hành chuẩn (phiên 11) – chỉ xem ============
   Dữ liệu nhập trong Google Sheets (tab ThongSo), phải có người duyệt.
   App chỉ hiển thị, không so sánh tự động với số đo thực tế. */
const TS_MO_HET = 8;    // ít hơn số này thì mở sẵn mọi nhóm
const TS_CO_TIM = 15;   // nhiều hơn số này thì hiện ô tìm nhanh
function tsDai(x) {
  const mi = String(x.min ?? ''), ma = String(x.max ?? '');
  if (!mi && !ma) return '';
  const d = mi && ma ? `${mi} – ${ma}` : (mi ? `≥ ${mi}` : `≤ ${ma}`);
  return d + (x.donVi ? ' ' + x.donVi : '');
}
function tsRow(x) {
  const k = [x.thongSo, x.thongSoZh, x.giaTriChuan, x.donVi, x.dieuKien, x.nguon]
    .join(' ').toLowerCase();
  const dai = esc(tsDai(x));
  const dk = esc(x.dieuKien), ng = esc(x.nguon), gc = esc(x.ghiChu);
  return `<li class="ts-row" data-k="${esc(k)}">
    <div class="ts-n">${bi(esc(x.thongSo || x.thongSoZh), esc(x.thongSoZh))}</div>
    <p class="ts-v"><b>${esc(x.giaTriChuan) || '—'}</b>${x.donVi ? ` <span class="u">${esc(x.donVi)}</span>` : ''}</p>
    ${dai ? `<p class="s ts-dai">${bi('Cho phép: ' + dai, '允许范围：' + dai)}</p>` : ''}
    ${dk ? `<p class="s">${bi('Điều kiện: ' + dk, '条件：' + dk)}</p>` : ''}
    ${gc ? `<p class="s">${bi('Ghi chú: ' + gc, '备注：' + gc)}</p>` : ''}
    ${ng ? `<p class="s">${bi('Nguồn: ' + ng, '来源：' + ng)}</p>` : ''}</li>`;
}
function specsBox(ts) {
  if (!ts || !ts.tong) return '';
  const mo = ts.tong <= TS_MO_HET;
  const cn = ts.capNhat ? fmtDate(ts.capNhat) : '';
  const nd = esc(ts.nguoiDuyet || '');
  return `<section class="block" id="tsBox">
    <h2 class="sec">${bi('Thông số chuẩn', '标准参数')}
      <small>${bi(`${ts.tong} thông số`, `${ts.tong} 项`)}</small></h2>
    ${ts.tong > TS_CO_TIM ? `<label class="search"><input id="tsQ" type="search" autocomplete="off"
      placeholder="Tìm thông số / 搜索参数" aria-label="Tìm thông số"></label>` : ''}
    <div class="ts-groups">${ts.nhom.map((g, i) => { const n = viZh(g.ten); return `<details class="ts-g"${mo || i === 0 ? ' open' : ''}>
      <summary>${bi(esc(n.vi), esc(n.zh))}<span class="n">${g.muc.length}</span></summary>
      <ul class="ts-list">${g.muc.map(tsRow).join('')}</ul></details>`; }).join('')}</div>
    <p class="empty" id="tsNone" hidden>${bi('Không có thông số phù hợp', '无匹配参数')}</p>
    ${cn || nd ? `<p class="note">${bi(`Cập nhật ${cn || '—'}${nd ? ' · Người duyệt: ' + nd : ''}`,
      `更新 ${cn || '—'}${nd ? ' · 审批人：' + nd : ''}`)}</p>` : ''}
    <p class="note">${bi('Thông số chỉ sửa trong Google Sheets (tab ThongSo) và phải có người duyệt. Máy đang chạy sai thông số thì báo quản lý, không tự chỉnh.',
      '参数只能在 Google 表格 ThongSo 页修改并须经审批。实际偏离标准时请上报，勿擅自调整。')}</p>
  </section>`;
}
function bindSpecs() {
  const q = $('#tsQ');
  if (!q) return;
  const gs = [...view.querySelectorAll('.ts-g')], none = $('#tsNone');
  q.oninput = () => {
    const k = q.value.trim().toLowerCase();
    let hien = 0;
    gs.forEach(g => {
      let n = 0;
      g.querySelectorAll('.ts-row').forEach(li => {
        const m = !k || (li.dataset.k || '').includes(k);
        li.hidden = !m;
        if (m) n++;
      });
      g.hidden = n === 0;
      if (k && n) g.open = true;
      hien += n;
    });
    if (none) none.hidden = hien > 0;
  };
}

/* ===================== Trang chi tiết máy ===================== */
async function pageMachine(ma) {
  loading();
  let r;
  try { r = await fetchCached('m_' + ma.toUpperCase(), () => api.machine(ma)); }
  catch (e) {
    if (e.code !== 'NOT_FOUND') return errorBox(e);
    view.innerHTML = `<div class="empty"><p class="plate">${esc(ma)}</p><p>${bi('Không tìm thấy máy có mã này', '未找到该编号的设备')}</p>
      <a class="btn" href="#/">${bi('Về danh sách', '返回列表')}</a>
      <a class="btn" href="#/diem/${encodeURIComponent(ma)}">${bi('Thử mở như điểm đo', '按计量点打开')}</a></div>`;
    return;
  }
  const { machine: m, repairs, maintenance } = r.data, s = st(m.trangThai);
  const hds = r.data.contracts || [];
  const kds = r.data.inspections || [];
  const dds = r.data.meters || [];
  const dn = r.data.dienNguon;
  const lsBt = r.data.maintHistory || [];
  const cl = r.data.checklist;
  const coKt = cl && (cl.muc || []).length > 0;
  const reps = [...repairs].sort(byRecent);
  const pms = maintenance.map(x => ({ ...x, due: due(x) })).sort((a, b) => a.due.d - b.due.d);
  const tongGio = reps.reduce((t, x) => t + (Number(x.gioDung) || 0), 0);
  const info = [
    ['Model', '型号', m.model], ['Số serial', '序列号', m.serial], ['Hãng SX', '制造商', m.hang],
    ['Năm lắp đặt', '安装年份', m.nam], ['Khu vực', '区域', m.khuVuc], ['Công suất (kW)', '功率', num(m.congSuat)]
  ];
  const wide = (vi, zh, v, cls = '') => v ? `<div class="wide ${cls}"><dt>${bi(vi, zh)}</dt><dd>${esc(v)}</dd></div>` : '';
  view.innerHTML = `
    <a class="back" href="#/">‹ ${bi('Danh sách máy', '设备列表')}</a>
    ${r.stale ? staleNote(r.stale) : ''}
    <div class="hero">
      ${photo(m)}
      <div>
        <span class="plate xl">${esc(m.ma)}</span>
        <h1>${esc(m.ten)}</h1>
        <p><span class="status ${s.cls}"><span class="dot ${s.cls}"></span>${bi(esc(s.vi), esc(s.zh))}</span></p>
      </div>
    </div>
    ${coKt && !cl.daKiemTra ? `<a class="alert warn kt-cta" href="#/kiem-tra/${encodeURIComponent(m.ma)}">
      <b>📋</b><span>${bi('Hôm nay chưa kiểm tra máy này — bấm để kiểm tra', '今天尚未点检本设备 — 点击开始')}</span><span class="go">›</span></a>` : ''}
    <section class="block">
      <h2 class="sec">${bi('Thông tin máy', '设备信息')}</h2>
      <dl class="info">
        ${info.map(([vi, zh, v]) => `<div><dt>${bi(vi, zh)}</dt><dd>${esc(v) || '—'}</dd></div>`).join('')}
        <div class="wide power"><dt>${bi('Tủ nguồn / Lộ', '电源柜 / 回路')}</dt><dd>${esc(m.tuNguon) || '—'}</dd></div>
        ${wide('Nhà cung cấp', '供应商', m.nhaCungCap)}
        ${wide('Liên hệ nhà cung cấp', '供应商联系方式', m.lienHeNCC)}
        ${wide('Ghi chú', '备注', m.ghiChu)}
      </dl>
      ${m.taiLieu ? `<p><a class="btn block" href="${esc(m.taiLieu)}" target="_blank" rel="noopener">${bi('Mở tài liệu máy', '打开设备资料')}</a></p>` : ''}
    </section>
    ${specsBox(r.data.specs)}
    <section class="block">
      <h2 class="sec">${bi('Bảo trì định kỳ', '定期保养')}</h2>
      ${pms.length ? `<ul class="pm card">${pms.map(x => `<li>
        <span><b>${esc(x.hangMuc)}</b><br><span class="s">${bi(`Chu kỳ ${esc(x.chuKy)} ngày, lần cuối ${fmtDate(x.lanCuoi) || '—'}`, `周期 ${esc(x.chuKy)} 天，上次 ${fmtDate(x.lanCuoi) || '—'}`)}</span></span>
        <span class="pm-act"><span class="badge ${x.due.cls}">${x.due.html}</span>
          <a class="btn mini" href="#/bao-tri/${encodeURIComponent(m.ma)}/${encodeURIComponent(x.hangMuc)}">✓ ${bi('Đã làm', '已完成')}</a></span></li>`).join('')}</ul>`
        : `<p class="empty card">${bi('Chưa có hạng mục bảo trì', '暂无保养项目')}</p>`}
    </section>
    ${dn && (dn.tu || dn.lo) ? `<section class="block">
      <h2 class="sec">${bi('Nguồn điện', '电源')}</h2>
      ${nguonBox(dn)}
      <p class="note">${LOTO}</p>
    </section>` : ''}
    ${coKt ? `<section class="block">
      <h2 class="sec">${bi('Kiểm tra hằng ngày', '每日点检')}
        <small>${bi(`${cl.muc.length} mục · mẫu ${esc(cl.maMau)}`, `${cl.muc.length} 项 · 表 ${esc(cl.maMau)}`)}</small></h2>
      <div class="card kt-box">
        <div class="kt-row">
          <span class="badge ${cl.daKiemTra ? 'ok' : 'warn'}">${cl.daKiemTra ? bi('Đã kiểm tra hôm nay', '今天已点检') : bi('Hôm nay chưa kiểm tra', '今天未点检')}</span>
          <a class="btn mini primary" href="#/kiem-tra/${encodeURIComponent(m.ma)}">📋 ${cl.daKiemTra ? bi('Kiểm tra lại', '再次点检') : bi('Kiểm tra ngay', '开始点检')}</a>
        </div>
        ${(cl.lichSu || []).length ? `<ul class="kt-hist">${cl.lichSu.slice(0, 5).map(k => ktDong(k)).join('')}</ul>`
          : `<p class="empty">${bi('Chưa có lần kiểm tra nào', '暂无点检记录')}</p>`}
      </div>
    </section>` : ''}
    ${lsBt.length ? `<section class="block">
      <h2 class="sec">${bi('Lịch sử bảo trì', '保养记录')}
        <small>${bi(`${lsBt.length} lần gần đây`, `最近 ${lsBt.length} 次`)}</small></h2>
      <ol class="timeline">${lsBt.map((x, i) => { const kq = viZh(x.ketQua); const xau = /có vấn đề|有问题/i.test(x.ketQua); return `<li${i >= 5 ? ' class="more-bt" hidden' : ''}>
        <div class="head">${esc(fmtDate(x.ngay))} <span>${esc(x.maLan)}</span></div>
        <dl>
          <dt>${bi('Hạng mục', '项目')}</dt><dd>${esc(x.hangMuc)}</dd>
          <dt>${bi('Kết quả', '结果')}</dt><dd><span class="badge ${xau ? 'warn' : 'ok'}">${bi(esc(kq.vi), esc(kq.zh))}</span></dd>
          ${x.noiDung ? `<dt>${bi('Đã làm', '工作内容')}</dt><dd>${esc(x.noiDung)}</dd>` : ''}
          ${x.vatTu ? `<dt>${bi('Vật tư', '更换备件')}</dt><dd>${esc(x.vatTu)}</dd>` : ''}
          <dt>${bi('Người làm', '执行人')}</dt><dd>${esc(x.nguoi)}</dd>
          ${x.ghiChu ? `<dt>${bi('Ghi chú', '备注')}</dt><dd>${esc(x.ghiChu)}</dd>` : ''}
        </dl>
        ${x.anh.length ? `<div class="thumbs">${x.anh.map(u => `<a href="${esc(u)}" target="_blank" rel="noopener"><img src="${esc(u)}" alt="Ảnh bảo trì ${esc(x.maLan)}" loading="lazy" referrerpolicy="no-referrer"></a>`).join('')}</div>` : ''}</li>`; }).join('')}</ol>
      ${lsBt.length > 5 ? `<button class="btn block" id="btMore">${bi(`Xem thêm ${lsBt.length - 5} lần`, `查看更多 ${lsBt.length - 5} 次`)}</button>` : ''}
    </section>` : ''}
    ${hds.length ? `<section class="block">
      <h2 class="sec">${bi('Hợp đồng bảo trì', '维保合同')}<small>${bi('thuê ngoài', '外包')}</small></h2>
      <div class="hd-list">${hds.map(hdCard).join('')}</div>
    </section>` : ''}
    ${kds.length ? `<section class="block">
      <h2 class="sec">${bi('Kiểm định / hiệu chuẩn', '检验 / 校准')}<small>${bi(`${kds.length} giấy`, `${kds.length} 份`)}</small></h2>
      <div class="hd-list">${kds.map(k => kdCard(k)).join('')}</div>
    </section>` : ''}
    ${dds.length ? `<section class="block">
      <h2 class="sec">${bi('Điểm đo gắn với máy', '本设备计量点')}<small>${dds.length}</small></h2>
      <ul class="mlist">${dds.map(x => ddCard(x)).join('')}</ul>
    </section>` : ''}
    <section class="block">
      <h2 class="sec">${bi('Lịch sử sửa chữa', '维修记录')}
        <small>${bi(`${reps.length} lần, dừng ${num(tongGio)} giờ`, `${reps.length} 次，停机 ${num(tongGio)} 小时`)}</small></h2>
      ${reps.length ? `<ol class="timeline">${reps.map(x => `<li>
        <div class="head">${esc(fmtDate(x.ngay))} <span>${esc(x.maPhieu)}</span></div>
        <dl>
          <dt>${bi('Hiện tượng', '故障现象')}</dt><dd>${esc(x.hienTuong)}</dd>
          ${x.nguyenNhan ? `<dt>${bi('Nguyên nhân', '原因')}</dt><dd>${esc(x.nguyenNhan)}</dd>` : ''}
          ${x.bienPhap ? `<dt>${bi('Xử lý', '处理措施')}</dt><dd>${esc(x.bienPhap)}</dd>` : ''}
          ${x.vatTu ? `<dt>${bi('Vật tư', '更换备件')}</dt><dd>${esc(x.vatTu)}</dd>` : ''}
          <dt>${bi('Người làm', '执行人')}</dt><dd>${esc(x.nguoi)}</dd>
          <dt>${bi('Dừng máy', '停机')}</dt><dd>${num(x.gioDung)} ${bi('giờ', '小时')}</dd>
        </dl>
        ${x.anh.length ? `<div class="thumbs">${x.anh.map(u => `<a href="${esc(u)}" target="_blank" rel="noopener"><img src="${esc(u)}" alt="Ảnh phiếu ${esc(x.maPhieu)}" loading="lazy" referrerpolicy="no-referrer"></a>`).join('')}</div>` : ''}</li>`).join('')}</ol>`
        : `<p class="empty card">${bi('Chưa có phiếu sửa chữa', '暂无维修记录')}</p>`}
    </section>
    <div class="sticky-cta"><a class="btn primary block" href="#/phieu/${encodeURIComponent(m.ma)}">+ ${bi('Tạo phiếu sửa chữa', '新建维修单')}</a></div>`;
  bindSpecs();
  const more = $('#btMore');
  if (more) more.onclick = () => { view.querySelectorAll('.more-bt').forEach(el => { el.hidden = false; }); more.remove(); };
}

/* ============ Ảnh trong form (dùng chung cho phiếu sửa chữa + xác nhận bảo trì) ============ */
const MAX_PHOTOS = 3;
function photoField() {
  const photos = [];   // {file, preview, url (sau khi tải lên)}
  const html = `<div class="field"><span>${bi(`Ảnh (tối đa ${MAX_PHOTOS})`, `照片（最多 ${MAX_PHOTOS} 张）`)}</span>
      <div class="photo-in"><label class="btn" id="addPhoto">📷 ${bi('Chụp / chọn ảnh', '拍照 / 选择照片')}<input type="file" id="file" accept="image/*" capture="environment" hidden></label><span id="prevs" class="photo-in"></span></div></div>`;
  const draw = () => {
    $('#prevs').innerHTML = photos.map((p, i) => `<span class="pthumb"><img src="${p.preview}" alt=""><button type="button" data-i="${i}" aria-label="Bỏ ảnh">×</button></span>`).join('');
    $('#addPhoto').hidden = photos.length >= MAX_PHOTOS;
  };
  const bind = () => {
    const fileIn = $('#file');
    fileIn.onchange = () => {
      const file = fileIn.files[0];
      fileIn.value = '';
      if (!file || photos.length >= MAX_PHOTOS) return;
      photos.push({ file, preview: URL.createObjectURL(file) });
      draw();
    };
    $('#prevs').onclick = e => { const i = e.target.dataset.i; if (i != null) { photos.splice(+i, 1); draw(); } };
    draw();
  };
  /* Tải ảnh chưa tải lên; nhớ URL để lần gửi lại không tải trùng */
  const upload = async (pin, ma, setBtn) => {
    for (let i = 0; i < photos.length; i++) {
      if (photos[i].url) continue;
      setBtn(bi(`Đang tải ảnh ${i + 1}/${photos.length}…`, `正在上传照片 ${i + 1}/${photos.length}…`));
      const b64 = await compressImage(photos[i].file);
      photos[i].url = (await api.uploadPhoto(pin, ma, b64)).url;
    }
    return photos.map(p => p.url);
  };
  /* Ảnh cho hàng đợi offline: ảnh nào đã tải lên thì giữ URL, chưa thì nén ra base64 */
  const raw = async () => {
    const out = [];
    for (const p of photos) out.push(p.url ? { url: p.url } : { b64: await compressImage(p.file) });
    return out;
  };
  return { html, bind, upload, raw };
}
/* Thông báo lỗi khi gửi form (step = 'photo' | 'save') */
function sendErr(e, step) {
  if (e.code === 'PIN') {
    return /quá nhiều/.test(e.message) ? bi('Sai PIN quá nhiều lần, thử lại sau 10 phút', 'PIN码错误次数过多，请10分钟后重试')
      : e.message === 'Sai mã PIN' ? bi('Sai mã PIN', 'PIN码错误') : bi(esc(e.message), '服务器未设置PIN');
  }
  if (e.code === 'NET' && step === 'save') return bi('Không nhận được phản hồi từ máy chủ. Mở lại lý lịch máy kiểm tra đã lưu chưa trước khi gửi lại, tránh ghi trùng.', '未收到服务器响应。重新提交前请先查看设备记录，避免重复。');
  if (e.code === 'NET') return bi('Không gửi được. Kiểm tra mạng rồi thử lại.', '发送失败，请检查网络后重试。');
  return bi('Gửi không thành công: ' + esc(e.message), '提交失败');
}

/* ===================== Form phiếu sửa chữa ===================== */
function pageRepair(ma) {
  const draftKey = 'tb3_draft_' + ma.toUpperCase();
  const draft = store.get(draftKey, {});
  const val = (k, d = '') => esc(draft[k] ?? d);
  const f = (vi, zh, input, req) => `<label class="field"><span>${bi(vi + (req ? ' <b class="req">*</b>' : ''), zh)}</span>${input}</label>`;
  const ph = photoField();
  view.innerHTML = `
    <a class="back" href="#/may/${encodeURIComponent(ma)}">‹ ${bi('Quay lại máy', '返回设备')}</a>
    <h1 style="margin:0 0 4px">${bi('Phiếu sửa chữa', '维修单')}</h1>
    <p><span class="plate">${esc(ma)}</span></p>
    <form class="form" id="rf" novalidate>
      <div class="row2">
        ${f('Ngày', '日期', `<input type="date" name="ngay" required value="${val('ngay', today())}" max="${today()}">`, 1)}
        ${f('Dừng máy (giờ)', '停机时间(小时)', `<input type="number" name="thoiGianDung" min="0" step="0.25" inputmode="decimal" placeholder="0" value="${val('thoiGianDung')}">`)}
      </div>
      ${f('Hiện tượng hư hỏng', '故障现象', `<textarea name="hienTuong" required maxlength="2000">${val('hienTuong')}</textarea>`, 1)}
      ${f('Nguyên nhân', '原因', `<textarea name="nguyenNhan" maxlength="2000">${val('nguyenNhan')}</textarea>`)}
      ${f('Biện pháp xử lý', '处理措施', `<textarea name="bienPhap" required maxlength="2000">${val('bienPhap')}</textarea>`, 1)}
      ${f('Vật tư thay thế', '更换备件', `<input name="vatTu" maxlength="500" placeholder="VD: Vòng bi 6205 x2" value="${val('vatTu')}">`)}
      ${f('Người thực hiện', '执行人', `<input name="nguoiThucHien" required maxlength="100" autocomplete="name" value="${val('nguoiThucHien', store.get('tb_nguoi', ''))}">`, 1)}
      ${ph.html}
      ${f('Mã PIN', 'PIN码', '<input type="password" name="pin" required inputmode="numeric" autocomplete="off" maxlength="12">', 1)}
      <p class="note">${bi('Phiếu đã gửi không sửa/xóa được trên app (lưu hồ sơ truy xuất BRCGS).', '维修单提交后无法在应用内修改/删除（BRCGS 追溯记录）。')}</p>
      <div id="err" role="alert"></div>
      <button class="btn primary block" id="send">${bi('Gửi phiếu', '提交')}</button>
    </form>`;
  const form = $('#rf'), err = $('#err'), btn = $('#send');
  ph.bind();
  form.oninput = () => { const { pin, ...d } = Object.fromEntries(new FormData(form)); store.set(draftKey, d); };

  const setBtn = html => { btn.innerHTML = html; };
  form.onsubmit = async e => {
    e.preventDefault();
    if (btn.disabled) return;
    err.innerHTML = '';
    const bad = [...form.querySelectorAll('[required]')].find(el => !el.value.trim());
    if (bad) { err.innerHTML = msgBad(bi('Vui lòng điền đủ các ô có dấu *', '请填写所有带 * 的项目')); bad.focus(); return; }
    if (!navigator.onLine) { err.innerHTML = msgBad(bi('Không có mạng, chưa gửi được phiếu. Nội dung vẫn được giữ, thử lại khi có mạng.', '无网络，维修单未发送。内容已保留，请联网后重试。')); return; }
    const { pin, ...d } = Object.fromEntries(new FormData(form));
    btn.disabled = true;
    let step = 'photo';
    try {
      const anh = await ph.upload(pin, ma, setBtn);
      step = 'save';
      setBtn(bi('Đang gửi phiếu…', '正在提交…'));
      const r = await api.addRepair(pin, { ...d, ma, nguoiNhap: d.nguoiThucHien, anh });
      store.set('tb_nguoi', d.nguoiThucHien);
      store.del(draftKey);
      store.del('tb3_m_' + ma.toUpperCase());
      view.innerHTML = `<div class="done"><p>${bi('Đã lưu phiếu sửa chữa', '维修单已保存')}</p><span class="plate">${esc(r.maPhieu)}</span>
        <a class="btn primary" href="#/may/${encodeURIComponent(ma)}">${bi('Xem lý lịch máy', '查看设备履历')}</a></div>`;
    } catch (e2) {
      err.innerHTML = msgBad(sendErr(e2, step));
    } finally {
      if (btn.isConnected) { btn.disabled = false; setBtn(bi('Gửi phiếu', '提交')); }
    }
  };
}

/* ===================== Xác nhận đã bảo trì (phiên 5) ===================== */
const KET_QUA = [
  ['Hoàn thành / 已完成', '✓', 'Hoàn thành', '已完成'],
  ['Hoàn thành, có vấn đề / 完成但有问题', '⚠', 'Hoàn thành, có vấn đề', '完成但有问题'],
];
async function pageMaintDone(ma, hangMuc) {
  loading();
  const MA = String(ma).toUpperCase();
  let r;
  try { r = await fetchCached('m_' + MA, () => api.machine(ma)); }
  catch (e) {
    if (e.code !== 'NOT_FOUND') return errorBox(e);
    view.innerHTML = `<div class="empty"><p class="plate">${esc(MA)}</p><p>${bi('Không tìm thấy máy có mã này', '未找到该编号的设备')}</p><a class="btn" href="#/">${bi('Về danh sách', '返回列表')}</a></div>`;
    return;
  }
  const m = r.data.machine;
  const item = (r.data.maintenance || []).find(x => sameText(x.hangMuc, hangMuc));
  if (!item) {
    view.innerHTML = `<div class="empty"><p class="plate">${esc(MA)}</p>
      <p>${bi('Không còn hạng mục bảo trì "' + esc(hangMuc) + '" của máy này. Kiểm tra tab BaoTri trong Google Sheets.', '本设备已无保养项目"' + esc(hangMuc) + '"，请检查 Google 表格 BaoTri 页。')}</p>
      <a class="btn" href="#/may/${encodeURIComponent(ma)}">${bi('Về trang máy', '返回设备')}</a></div>`;
    return;
  }
  const d0 = due(item);
  const draftKey = 'tb3_bt_' + MA + '|' + item.hangMuc;
  const draft = store.get(draftKey, {});
  const val = (k, d = '') => esc(draft[k] ?? d);
  const f = (vi, zh, input, req) => `<label class="field"><span>${bi(vi + (req ? ' <b class="req">*</b>' : ''), zh)}</span>${input}</label>`;
  const ph = photoField();
  const kqCu = draft.ketQua || KET_QUA[0][0];
  view.innerHTML = `
    <a class="back" href="#/may/${encodeURIComponent(ma)}">‹ ${bi('Quay lại máy', '返回设备')}</a>
    <h1 style="margin:0 0 4px">${bi('Xác nhận đã bảo trì', '确认已保养')}</h1>
    <p><span class="plate">${esc(m.ma)}</span> ${esc(m.ten)}</p>
    <div class="card bt-head">
      <b>${esc(item.hangMuc)}</b>
      <span class="s">${bi(`Chu kỳ ${esc(item.chuKy)} ngày · lần cuối ${fmtDate(item.lanCuoi) || '—'}`, `周期 ${esc(item.chuKy)} 天 · 上次 ${fmtDate(item.lanCuoi) || '—'}`)}</span>
      <span class="badge ${d0.cls}">${d0.html}</span>
    </div>
    <form class="form" id="bf" novalidate>
      ${f('Ngày làm', '保养日期', `<input type="date" name="ngay" required value="${val('ngay', today())}" max="${today()}">`, 1)}
      <div class="field"><span>${bi('Kết quả <b class="req">*</b>', '结果')}</span>
        <div class="picks2" id="kq">${KET_QUA.map(([v, ic, vi, zh]) => `<label class="pick${v === kqCu ? ' on' : ''}">
          <input type="radio" name="ketQua" value="${esc(v)}" ${v === kqCu ? 'checked' : ''}><span class="ic">${ic}</span>${bi(vi, zh)}</label>`).join('')}</div></div>
      ${f('Công việc đã làm', '工作内容', `<textarea name="noiDung" maxlength="2000" placeholder="VD: Tra mỡ ổ trục, siết lại bu lông">${val('noiDung')}</textarea>`)}
      ${f('Vật tư thay thế', '更换备件', `<input name="vatTu" maxlength="500" placeholder="VD: Mỡ EP2 0,5 kg" value="${val('vatTu')}">`)}
      ${f('Người thực hiện', '执行人', `<input name="nguoi" required maxlength="100" autocomplete="name" value="${val('nguoi', store.get('tb_nguoi', ''))}">`, 1)}
      ${f('Ghi chú / vấn đề phát hiện', '备注 / 发现的问题', `<textarea name="ghiChu" maxlength="2000" placeholder="VD: Ổ trục có tiếng kêu nhẹ">${val('ghiChu')}</textarea>`)}
      ${ph.html}
      ${f('Mã PIN', 'PIN码', '<input type="password" name="pin" required inputmode="numeric" autocomplete="off" maxlength="12">', 1)}
      <p class="note">${bi('Đã xác nhận thì không sửa/xóa được trên app (lưu hồ sơ truy xuất BRCGS). Ngày làm gần nhất trong bảng chỉ được đẩy lên khi ngày mới muộn hơn ngày đang có.', '确认后无法在应用内修改/删除（BRCGS 追溯记录）。仅当新日期晚于原日期时才更新"最近保养日期"。')}</p>
      <div id="err" role="alert"></div>
      <button class="btn primary block" id="send">${bi('Xác nhận đã làm', '确认已完成')}</button>
    </form>`;
  const form = $('#bf'), err = $('#err'), btn = $('#send');
  ph.bind();
  $('#kq').onchange = e => [...$('#kq').children].forEach(l => l.classList.toggle('on', l.contains(e.target)));
  form.oninput = () => { const { pin, ...d } = Object.fromEntries(new FormData(form)); store.set(draftKey, d); };

  const setBtn = html => { btn.innerHTML = html; };
  form.onsubmit = async e => {
    e.preventDefault();
    if (btn.disabled) return;
    err.innerHTML = '';
    const bad = [...form.querySelectorAll('[required]')].find(el => !el.value.trim());
    if (bad) { err.innerHTML = msgBad(bi('Vui lòng điền đủ các ô có dấu *', '请填写所有带 * 的项目')); bad.focus(); return; }
    if (!navigator.onLine) { err.innerHTML = msgBad(bi('Không có mạng, chưa gửi được. Nội dung vẫn được giữ, thử lại khi có mạng.', '无网络，暂未提交。内容已保留，请联网后重试。')); return; }
    const { pin, ...d } = Object.fromEntries(new FormData(form));
    btn.disabled = true;
    let step = 'photo';
    try {
      const anh = await ph.upload(pin, m.ma, setBtn);
      step = 'save';
      setBtn(bi('Đang ghi nhận…', '正在提交…'));
      const res = await api.completeMaint(pin, { ...d, ma: m.ma, hangMuc: item.hangMuc, anh });
      store.set('tb_nguoi', d.nguoi);
      store.del(draftKey);
      store.del('tb3_m_' + MA);
      store.del('tb3_dash');
      if (res.goiY === 'taoPhieu') {
        const k = 'tb3_draft_' + MA;
        const cu = store.get(k, {});
        store.set(k, {
          ...cu, ngay: d.ngay,
          hienTuong: cu.hienTuong || d.ghiChu || d.noiDung || ('Phát hiện khi bảo trì: ' + item.hangMuc),
          nguoiThucHien: cu.nguoiThucHien || d.nguoi,
        });
      }
      view.innerHTML = `<div class="done">
        <p>${bi('Đã ghi nhận bảo trì', '保养已记录')}</p>
        <span class="plate">${esc(res.maLan)}</span>
        <p class="note">${bi(`${esc(item.hangMuc)} · lần gần nhất ${fmtDate(res.ngayGanNhat)}` + (res.ngayDenHan ? ` · hạn kế tiếp ${fmtDate(res.ngayDenHan)}` : ''),
          `${esc(item.hangMuc)} · 最近 ${fmtDate(res.ngayGanNhat)}` + (res.ngayDenHan ? ` · 下次 ${fmtDate(res.ngayDenHan)}` : ''))}</p>
        ${res.goiY === 'taoPhieu' ? `<p>${msgBad(bi('Kết quả có vấn đề — nên lập phiếu sửa chữa để theo dõi.', '结果存在问题 — 建议开维修单跟踪。'))}</p>
          <a class="btn primary" href="#/phieu/${encodeURIComponent(m.ma)}">+ ${bi('Tạo phiếu sửa chữa', '新建维修单')}</a>` : ''}
        <a class="btn" href="#/may/${encodeURIComponent(m.ma)}">${bi('Xem lý lịch máy', '查看设备履历')}</a></div>`;
    } catch (e2) {
      err.innerHTML = msgBad(sendErr(e2, step));
    } finally {
      if (btn.isConnected) { btn.disabled = false; setBtn(bi('Xác nhận đã làm', '确认已完成')); }
    }
  };
}

/* ===================== Kiểm tra hằng ngày (phiên 6) ===================== */
/* Ô Sheets ghi tiêu chuẩn 2 dòng: "tiếng Việt\n中文" */
const hai = s => { const [a, b] = String(s || '').split('\n'); return { vi: (a || '').trim(), zh: (b || '').trim() }; };
/* Một dòng trong lịch sử kiểm tra */
function ktDong(k) {
  const xau = k.soKhongDat > 0;
  return `<li>
    <div class="kt-h"><b>${esc(fmtDate(k.ngay))}</b><span class="s">${esc(k.maLan)}</span>
      <span class="badge ${xau ? 'bad' : 'ok'}">${xau ? bi(`Không đạt ${k.soKhongDat} mục`, `${k.soKhongDat} 项不合格`) : bi('Đạt', '合格')}</span></div>
    <div class="s">${bi('Người kiểm tra: ' + esc(k.nguoi || '—'), '点检人：' + esc(k.nguoi || '—'))}</div>
    ${k.chiTietKhongDat ? `<div class="kt-bad">${esc(k.chiTietKhongDat).replace(/\n/g, '<br>')}</div>` : ''}
    ${(k.anh || []).length ? `<div class="thumbs">${k.anh.map(u => `<a href="${esc(u)}" target="_blank" rel="noopener"><img src="${esc(u)}" alt="Ảnh kiểm tra ${esc(k.maLan)}" loading="lazy" referrerpolicy="no-referrer"></a>`).join('')}</div>` : ''}
  </li>`;
}

async function pageCheck(ma) {
  loading();
  const MA = String(ma).toUpperCase();
  let r;
  try { r = await fetchCached('m_' + MA, () => api.machine(ma)); }
  catch (e) {
    if (e.code !== 'NOT_FOUND') return errorBox(e);
    view.innerHTML = `<div class="empty"><p class="plate">${esc(MA)}</p><p>${bi('Không tìm thấy máy có mã này', '未找到该编号的设备')}</p><a class="btn" href="#/">${bi('Về danh sách', '返回列表')}</a></div>`;
    return;
  }
  const m = r.data.machine, cl = r.data.checklist;
  if (!cl || !(cl.muc || []).length) {
    view.innerHTML = `<div class="empty"><p class="plate">${esc(MA)}</p>
      <p>${bi('Máy này chưa có mẫu kiểm tra. Điền cột "Mẫu kiểm tra" của máy ở tab ThietBi và nhập các mục ở tab MauKiemTra trong Google Sheets.', '本设备未设置点检表。请在 Google 表格 ThietBi 页填写"点检表"列，并在 MauKiemTra 页录入项目。')}</p>
      <a class="btn" href="#/may/${encodeURIComponent(ma)}">${bi('Về trang máy', '返回设备')}</a></div>`;
    return;
  }
  const draftKey = 'tb3_kt_' + MA;
  const draft = store.get(draftKey, {});
  const state = {
    idGui: draft.idGui || (MA + '-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 6)),
    kq: draft.kq || {}, gc: draft.gc || {}
  };
  const luu = () => store.set(draftKey, { idGui: state.idGui, kq: state.kq, gc: state.gc });
  const ph = photoField();
  const f = (vi, zh, input, req) => `<label class="field"><span>${bi(vi + (req ? ' <b class="req">*</b>' : ''), zh)}</span>${input}</label>`;
  const caTen = hai(String(cl.ca || '').replace(/\s*\/\s*/, '\n'));

  view.innerHTML = `
    <a class="back" href="#/may/${encodeURIComponent(ma)}">‹ ${bi('Quay lại máy', '返回设备')}</a>
    <h1 style="margin:0 0 4px">${bi('Kiểm tra hằng ngày', '每日点检')}</h1>
    <p><span class="plate">${esc(m.ma)}</span> ${esc(m.ten)}</p>
    <div class="card bt-head">
      <b>${fmtDate(cl.ngay)} · ${bi(esc(caTen.vi), esc(caTen.zh))}</b>
      <span class="s">${bi(`${cl.muc.length} mục · mẫu ${esc(cl.maMau)}`, `${cl.muc.length} 项 · 表 ${esc(cl.maMau)}`)}</span>
      ${cl.daKiemTra ? `<span class="badge ok">${bi('Hôm nay đã kiểm tra một lần', '今天已点检过一次')}</span>` : ''}
    </div>
    <button type="button" class="btn block" id="allOk">✓ ${bi('Đánh dấu tất cả đạt', '全部标记合格')}</button>
    <form class="form" id="kf" novalidate>
      <div class="kt-list" id="kl">${cl.muc.map(x => {
        const tc = hai(x.tieuChuan);
        const khong = state.kq[x.stt] === 'khong';
        return `<div class="kt-item${khong ? ' no' : ''}" data-stt="${x.stt}">
          <div class="kt-q"><b>${x.stt}. ${esc(x.hangMuc)}</b>
            ${x.hangMucZh ? `<span class="zh" lang="zh">${esc(x.hangMucZh)}</span>` : ''}
            ${tc.vi ? `<span class="s">${esc(tc.vi)}${tc.zh ? `<br><span lang="zh">${esc(tc.zh)}</span>` : ''}</span>` : ''}</div>
          <div class="kt-btns">
            <button type="button" class="kt-b dat${khong ? '' : ' on'}" data-kq="dat">✓ ${bi('Đạt', '合格')}</button>
            <button type="button" class="kt-b khong${khong ? ' on' : ''}" data-kq="khong">✕ ${bi('Không đạt', '不合格')}</button>
          </div>
          <div class="kt-gc"${khong ? '' : ' hidden'}>
            <textarea data-gc="${x.stt}" maxlength="500" placeholder="Bắt buộc: mô tả lỗi / 必填：说明问题">${esc(state.gc[x.stt] || '')}</textarea>
          </div>
        </div>`;
      }).join('')}</div>
      ${f('Người kiểm tra', '点检人', `<input name="nguoi" required maxlength="100" autocomplete="name" value="${esc(draft.nguoi || store.get('tb_nguoi', ''))}">`, 1)}
      ${ph.html}
      ${f('Mã PIN', 'PIN码', `<input type="password" name="pin" required inputmode="numeric" autocomplete="off" maxlength="12" value="${esc(pinNho())}">`, 1)}
      <p class="note">${bi('Mục không đạt bắt buộc ghi chú, ảnh tùy chọn. Đã gửi thì không sửa/xóa được trên app (hồ sơ BRCGS) — sửa sai trong Google Sheets. Mất mạng vẫn kiểm tra được: máy sẽ giữ lại và tự gửi khi có mạng.', '不合格项必须填写说明，照片可选。提交后无法在应用内修改/删除（BRCGS 记录）——请在 Google 表格更正。无网络也可点检：应用会保存并在联网后自动提交。')}</p>
      <div id="err" role="alert"></div>
      <button class="btn primary block" id="send">${bi('Gửi kết quả kiểm tra', '提交点检结果')}</button>
    </form>`;

  const form = $('#kf'), err = $('#err'), btn = $('#send'), kl = $('#kl');
  ph.bind();
  const setItem = (el, kq) => {
    el.classList.toggle('no', kq === 'khong');
    el.querySelectorAll('.kt-b').forEach(b => b.classList.toggle('on', b.dataset.kq === kq));
    el.querySelector('.kt-gc').hidden = kq !== 'khong';
  };
  kl.onclick = e => {
    const b = e.target.closest('.kt-b');
    if (!b) return;
    const el = b.closest('.kt-item'), stt = el.dataset.stt;
    state.kq[stt] = b.dataset.kq;
    setItem(el, b.dataset.kq);
    if (b.dataset.kq === 'khong') el.querySelector('textarea').focus();
    luu();
  };
  kl.oninput = e => {
    const t = e.target.closest('[data-gc]');
    if (!t) return;
    state.gc[t.dataset.gc] = t.value;
    luu();
  };
  $('#allOk').onclick = () => {
    kl.querySelectorAll('.kt-item').forEach(el => { state.kq[el.dataset.stt] = 'dat'; setItem(el, 'dat'); });
    luu();
  };

  const setBtn = html => { btn.innerHTML = html; };
  const xong = (res, cho) => {
    const so = res.soKhongDat || 0;
    store.del(draftKey);
    store.del('tb3_m_' + MA); store.del('tb3_dash'); store.del('tb3_kt_ngay_' + cl.ngay);
    view.innerHTML = `<div class="done">
      <p>${cho ? bi('Đã lưu trên máy — sẽ tự gửi khi có mạng', '已保存在手机 — 联网后自动提交')
        : bi(res.trung ? 'Lần kiểm tra này đã được ghi trước đó' : 'Đã ghi nhận kiểm tra', res.trung ? '本次点检此前已记录' : '点检已记录')}</p>
      ${res.maLan ? `<span class="plate">${esc(res.maLan)}</span>` : ''}
      <p class="note">${bi(`${esc(m.ma)} · ${fmtDate(cl.ngay)} · ` + (so ? `${so} mục không đạt` : 'tất cả đạt'),
        `${esc(m.ma)} · ${fmtDate(cl.ngay)} · ` + (so ? `${so} 项不合格` : '全部合格'))}</p>
      ${so ? `<a class="btn primary" href="#/phieu/${encodeURIComponent(m.ma)}">+ ${bi('Tạo phiếu sửa chữa', '新建维修单')}</a>` : ''}
      <a class="btn primary" href="#/quet">${bi('Quét máy tiếp theo', '扫描下一台')}</a>
      <a class="btn" href="#/kiem-tra">${bi('Xem tiến độ kiểm tra', '查看点检进度')}</a>
      <a class="btn" href="#/may/${encodeURIComponent(m.ma)}">${bi('Về trang máy', '返回设备')}</a></div>`;
    banner();
  };

  form.onsubmit = async e => {
    e.preventDefault();
    if (btn.disabled) return;
    err.innerHTML = '';
    const items = cl.muc.map(x => ({ stt: x.stt, kq: state.kq[x.stt] === 'khong' ? 'khong' : 'dat', gc: String(state.gc[x.stt] || '').trim() }));
    const thieu = items.find(i => i.kq === 'khong' && !i.gc);
    if (thieu) {
      err.innerHTML = msgBad(bi(`Mục ${thieu.stt} không đạt — bắt buộc ghi chú`, `第 ${thieu.stt} 项不合格 — 必须填写说明`));
      const t = kl.querySelector(`[data-gc="${thieu.stt}"]`);
      if (t) { t.focus(); t.scrollIntoView({ block: 'center' }); }
      return;
    }
    const { pin, ...d } = Object.fromEntries(new FormData(form));
    if (!String(d.nguoi || '').trim() || !String(pin || '').trim()) {
      err.innerHTML = msgBad(bi('Vui lòng điền đủ các ô có dấu *', '请填写所有带 * 的项目'));
      return;
    }
    store.set('tb_nguoi', d.nguoi);
    store.set(draftKey, { idGui: state.idGui, kq: state.kq, gc: state.gc, nguoi: d.nguoi });
    nhoPin(pin);
    const data = { idGui: state.idGui, ma: m.ma, nguoi: d.nguoi, ngay: cl.ngay, ca: cl.ca, ketQua: items, anh: [] };
    const soKhongDat = items.filter(i => i.kq === 'khong').length;
    const vaoHangDoi = async () => {
      setBtn(bi('Đang lưu…', '正在保存…'));
      const files = await ph.raw();
      queueAdd({ ma: m.ma, data, files, t: Date.now() });
      xong({ soKhongDat }, true);
    };
    btn.disabled = true;
    let step = 'photo';
    try {
      if (!navigator.onLine) return await vaoHangDoi();
      const anh = await ph.upload(pin, m.ma, setBtn);
      step = 'save';
      setBtn(bi('Đang gửi…', '正在提交…'));
      const res = await api.addCheck(pin, { ...data, anh });
      xong({ ...res, soKhongDat }, false);
    } catch (e2) {
      if (e2.code === 'NET') { try { return await vaoHangDoi(); } catch { /* rơi xuống báo lỗi */ } }
      err.innerHTML = msgBad(sendErr(e2, step));
    } finally {
      if (btn.isConnected) { btn.disabled = false; setBtn(bi('Gửi kết quả kiểm tra', '提交点检结果')); }
    }
  };
}

/* ===================== Trang Kiểm tra (tiến độ trong ngày) ===================== */
async function pageChecks() {
  let ngay = today();
  view.innerHTML = `
    <h1 style="margin:0 0 12px">${bi('Kiểm tra hằng ngày', '每日点检')}</h1>
    <div id="qbox"></div>
    <label class="field" style="max-width:220px"><span>${bi('Ngày', '日期')}</span>
      <input type="date" id="ngay" value="${ngay}" max="${today()}"></label>
    <div id="ktv"><p class="empty">${bi('Đang tải…', '加载中…')}</p></div>`;

  const qbox = $('#qbox');
  const veQueue = () => {
    const n = queueOf('check').length;
    qbox.innerHTML = n ? `<div class="alert warn"><b>${n}</b>
      <span>${bi('lần kiểm tra chờ gửi', '次点检待提交')}</span>
      <button class="btn mini primary" id="guiQ" style="margin-left:auto">${bi('Gửi ngay', '立即提交')}</button></div>
      <div id="qmsg"></div>` : '';
    const b = $('#guiQ');
    if (!b) return;
    b.onclick = async () => {
      const msg = $('#qmsg');
      let pin = pinNho();
      if (!pin) pin = String(prompt('Nhập mã PIN để gửi / 请输入PIN码') || '').trim();
      if (!pin) return;
      b.disabled = true; b.textContent = '…';
      const res = await flushQueue(pin);
      if (res.sent) nhoPin(pin);
      msg.innerHTML = res.left
        ? msgBad(res.needPin ? bi('Sai mã PIN — thử lại', 'PIN码错误 — 请重试')
          : bi('Còn ' + res.left + ' lần chưa gửi được: ' + esc(res.err?.message || ''), '还有 ' + res.left + ' 次未提交'))
        : `<p class="note">${bi('Đã gửi xong ' + res.sent + ' lần kiểm tra', '已提交 ' + res.sent + ' 次点检')}</p>`;
      veQueue();
      if (res.sent) tai();
    };
  };

  const tai = async () => {
    const box = $('#ktv');
    if (!box) return;
    box.innerHTML = `<p class="empty">${bi('Đang tải…', '加载中…')}</p>`;
    let r;
    try { r = await fetchCached('kt_ngay_' + ngay, () => api.checks(ngay)); }
    catch (e) { box.innerHTML = `<p class="empty">${errText(e)}</p>`; return; }
    const d = r.data, may = d.may || [], caList = d.ca || [];
    const rec = m => caList.map(c => m.ca[c]).find(Boolean) || null;
    const daLam = may.filter(m => rec(m));
    const chuaLam = may.filter(m => !rec(m));
    const khongDat = daLam.filter(m => rec(m).kq === 'khong');
    const pct = may.length ? Math.round(daLam.length / may.length * 100) : 0;
    const groups = {};
    chuaLam.forEach(m => (groups[m.khuVuc || '—'] ||= []).push(m));
    box.innerHTML = `
      ${r.stale ? staleNote(r.stale) : ''}
      <div class="card kt-prog">
        <div class="kt-row"><b>${daLam.length}/${may.length}</b>
          <span class="s">${bi('máy đã kiểm tra ngày ' + fmtDate(d.ngay), fmtDate(d.ngay) + ' 已点检设备')}</span></div>
        <div class="hd-bar ${pct === 100 ? 'ok' : 'warn'}"><i style="width:${pct}%"></i></div>
      </div>
      ${khongDat.length ? `<section class="block">
        <h2 class="sec">${bi('Máy không đạt', '不合格设备')}<small>${khongDat.length}</small></h2>
        <ul class="mlist">${khongDat.map(m => { const k = rec(m); return `<li><a class="mrow" href="#/may/${encodeURIComponent(m.ma)}">
          <span class="plate">${esc(m.ma)}</span>
          <span><span class="t">${esc(m.ten)}</span><br><span class="s">${esc(k.nguoi || '')} · ${esc(k.maLan)}</span></span>
          <span class="badge bad">${bi(k.soKhongDat + ' mục', k.soKhongDat + ' 项')}</span></a></li>`; }).join('')}</ul>
      </section>` : ''}
      <section class="block">
        <h2 class="sec">${bi('Chưa kiểm tra', '未点检')}<small>${chuaLam.length}</small></h2>
        ${chuaLam.length ? Object.entries(groups).map(([kv, ms]) => `
          <h3 class="area-h">${esc(kv)} <small>${ms.length}</small></h3>
          <ul class="mlist">${ms.map(m => `<li><a class="mrow" href="#/kiem-tra/${encodeURIComponent(m.ma)}">
            <span class="plate">${esc(m.ma)}</span><span><span class="t">${esc(m.ten)}</span></span>
            <span class="btn mini primary">📋 ${bi('Kiểm tra', '点检')}</span></a></li>`).join('')}</ul>`).join('')
          : `<p class="empty card">${may.length ? bi('Tất cả máy đã được kiểm tra ✓', '所有设备已完成点检 ✓')
            : bi('Chưa có máy nào cần kiểm tra. Điền cột "Mẫu kiểm tra" ở tab ThietBi trong Google Sheets.', '暂无需点检设备，请在 Google 表格 ThietBi 页填写"点检表"列。')}</p>`}
      </section>
      ${daLam.length ? `<section class="block">
        <h2 class="sec">${bi('Đã kiểm tra', '已点检')}<small>${daLam.length}</small></h2>
        <ul class="mlist">${daLam.map(m => { const k = rec(m); return `<li><a class="mrow" href="#/may/${encodeURIComponent(m.ma)}">
          <span class="plate">${esc(m.ma)}</span>
          <span><span class="t">${esc(m.ten)}</span><br><span class="s">${esc(k.nguoi || '')}</span></span>
          <span class="badge ${k.kq === 'khong' ? 'bad' : 'ok'}">${k.kq === 'khong' ? bi('Không đạt', '不合格') : bi('Đạt', '合格')}</span></a></li>`; }).join('')}</ul>
      </section>` : ''}
      <p class="note">${bi('Máy cần kiểm tra là máy có điền cột "Mẫu kiểm tra" ở tab ThietBi. Nội dung từng mục sửa ở tab MauKiemTra.', '需点检的设备＝ThietBi 页填写了"点检表"列的设备。项目内容在 MauKiemTra 页维护。')}</p>`;
  };

  $('#ngay').onchange = e => { ngay = e.target.value || today(); tai(); };
  veQueue();
  tai();
  if (queueOf('check').length && navigator.onLine && pinNho()) {
    flushQueue().then(res => { if (res.sent) { veQueue(); tai(); } });
  }
}

/* ===================== Tổng quan ===================== */
async function pageDash() {
  loading();
  let r, l;
  try { [r, l] = await Promise.all([fetchCached('dash', api.dashboard), fetchCached('list', api.list)]); }
  catch (e) { return errorBox(e); }
  const d = r.data, ms = l.data;
  const cnt = cls => ms.filter(m => st(m.trangThai).cls === cls).length;
  const soon = [...(d.quaHan || []), ...(d.sapDenHan || [])];
  const badge = x => x.conLai < 0 ? `<span class="badge bad">${bi(`Quá hạn ${-x.conLai} ngày`, `逾期 ${-x.conLai} 天`)}</span>`
    : `<span class="badge warn">${x.conLai === 0 ? bi('Đến hạn hôm nay', '今天到期') : bi(`Còn ${x.conLai} ngày`, `剩 ${x.conLai} 天`)}</span>`;
  const top = (d.topDung || []).filter(t => t.gio > 0 || t.soLan > 0);
  const maxH = Math.max(1, ...top.map(t => t.gio));
  const months = d.theoThang || [];
  const maxM = Math.max(1, ...months.map(x => x.soLan));
  const hd = d.hopDong || { het: [], sap: [], tong: 0 };
  const hdHet = (hd.het || []).length, hdSap = (hd.sap || []).length;
  const kdt = d.kiemDinh || { het: [], sap: [], tong: 0 };
  const kdHet = (kdt.het || []).length, kdSap = (kdt.sap || []).length;
  const cs = d.chiSo || null;
  const csChua = cs ? (cs.chuaGhi || []).length : 0;
  const kt = d.kiemTra || null;
  const ktChua = kt ? (kt.chuaLam || []).length : 0;
  const ktXau = kt ? (kt.khongDat || []).length : 0;
  view.innerHTML = `
    <h1 style="margin:0 0 12px">${bi('Tổng quan', '概览')}</h1>
    ${r.stale ? staleNote(r.stale) : ''}
    ${ktXau ? `<a class="alert bad" href="#/kiem-tra"><b>${ktXau}</b>
      <span>${bi('máy kiểm tra không đạt hôm nay', '台设备今天点检不合格')}</span><span class="go">›</span></a>` : ''}
    ${kt && kt.tongCan ? `<a class="alert ${ktChua ? 'warn' : ''}" href="#/kiem-tra"><b>${kt.daLam}/${kt.tongCan}</b>
      <span>${ktChua ? bi(`máy đã kiểm tra hôm nay — còn ${ktChua} máy chưa làm`, `台设备今天已点检 — 还有 ${ktChua} 台未做`)
        : bi('máy đã kiểm tra hôm nay ✓', '台设备今天已点检 ✓')}</span><span class="go">›</span></a>` : ''}
    ${hdHet + hdSap ? `<a class="alert ${hdHet ? 'bad' : 'warn'}" href="#/hop-dong?loc=${hdHet ? 'het' : 'sap'}">
      <b>${hdHet + hdSap}</b>
      <span>${bi(hdHet ? `hợp đồng đã hết hạn (${hdHet}), sắp hết hạn (${hdSap})` : `hợp đồng sắp hết hạn`,
        hdHet ? `份合同已过期 (${hdHet})、即将到期 (${hdSap})` : '份合同即将到期')}</span>
      <span class="go">›</span></a>` : ''}
    ${kdHet + kdSap ? `<a class="alert ${kdHet ? 'bad' : 'warn'}" href="#/kiem-dinh?loc=${kdHet ? 'het' : 'sap'}">
      <b>${kdHet + kdSap}</b>
      <span>${bi(kdHet ? `giấy kiểm định đã hết hạn (${kdHet}), sắp hết hạn (${kdSap})` : 'giấy kiểm định sắp hết hạn',
        kdHet ? `份检验证书已过期 (${kdHet})、即将到期 (${kdSap})` : '份检验证书即将到期')}</span>
      <span class="go">›</span></a>` : ''}
    ${cs && cs.tong ? `<a class="alert ${csChua ? 'warn' : ''}" href="#/nang-luong"><b>${cs.daGhi}/${cs.tong}</b>
      <span>${csChua ? bi(`điểm đo đã ghi chỉ số hôm nay — còn ${csChua} điểm chưa ghi`, `个计量点今天已抄表 — 还有 ${csChua} 个未抄`)
        : bi('điểm đo đã ghi chỉ số hôm nay ✓', '个计量点今天已抄表 ✓')}</span><span class="go">›</span></a>` : ''}
    <div class="kpis">
      <div class="kpi"><b>${d.tongMay}</b>${bi('Tổng số máy', '设备总数')}</div>
      <div class="kpi ok"><b>${cnt('run')}</b>${bi('Đang chạy', '运行中')}</div>
      <div class="kpi down"><b>${cnt('down')}</b>${bi('Đang sửa', '维修中')}</div>
      <div class="kpi maint"><b>${(d.quaHan || []).length}</b>${bi('Quá hạn bảo trì', '保养逾期')}</div>
    </div>
    <section class="block">
      <h2 class="sec">${bi('Bảo trì quá hạn và sắp đến hạn', '逾期及即将到期保养')}<small>${bi('trong 7 ngày', '7天内')}</small></h2>
      ${soon.length ? `<ul class="pm card">${soon.map(x => `<li><a href="#/may/${encodeURIComponent(x.ma)}" style="text-decoration:none">
        <span class="plate">${esc(x.ma)}</span> <b>${esc(x.hangMuc)}</b><br><span class="s">${esc(x.ten)} · ${bi('hạn ' + fmtDate(x.ngayDenHan), '到期 ' + fmtDate(x.ngayDenHan))}</span></a>
        ${badge(x)}</li>`).join('')}</ul>`
        : `<p class="empty card">${bi('Không có hạng mục nào cần làm', '暂无待办保养')}</p>`}
    </section>
    <section class="block">
      <h2 class="sec">${bi('Máy dừng nhiều nhất', '停机最多设备')}<small>${bi('tổng số giờ', '累计小时')}</small></h2>
      <div class="card hbars">${top.length ? top.map(t => `<a class="hbar" href="#/may/${encodeURIComponent(t.ma)}" title="${esc(t.ten)} · ${t.soLan} lần">
        <span class="plate">${esc(t.ma)}</span><i style="width:${(t.gio / maxH * 100).toFixed(1)}%"></i><b>${num(t.gio)}</b></a>`).join('')
        : `<p class="empty">${bi('Chưa có dữ liệu', '暂无数据')}</p>`}</div>
    </section>
    <section class="block">
      <h2 class="sec">${bi('Số lần sửa theo tháng', '每月维修次数')}<small>${bi(`${months.length} tháng gần nhất · tổng ${d.tongPhieu} phiếu`, `近${months.length}个月 · 共 ${d.tongPhieu} 单`)}</small></h2>
      <div class="card vbars m12">${months.map(x => `<div class="vbar"><b>${x.soLan}</b><i style="height:${(x.soLan / maxM * 120).toFixed(0)}px"></i><span>${x.thang.slice(5)}</span></div>`).join('')}</div>
    </section>`;
}

/* ===================== Quét QR ===================== */
const QR_LIBS = [
  'https://unpkg.com/html5-qrcode@2.3.8/html5-qrcode.min.js',
  'https://cdn.jsdelivr.net/npm/html5-qrcode@2.3.8/html5-qrcode.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/html5-qrcode/2.3.8/html5-qrcode.min.js'
];
const loadScript = src => new Promise((ok, no) => {
  const s = document.createElement('script');
  s.src = src; s.onload = ok; s.onerror = () => { s.remove(); no(new Error(src)); };
  document.head.appendChild(s);
});
async function loadQrLib() {
  for (const u of QR_LIBS) {
    if (window.Html5Qrcode) return;
    try { await loadScript(u); } catch { /* thử nguồn khác */ }
  }
  if (!window.Html5Qrcode) throw new Error('Không tải được bộ quét QR');
}
let scanStream = null, scanTimer = null, h5 = null;
function stopScan() {
  if (scanTimer) { clearInterval(scanTimer); scanTimer = null; }
  if (scanStream) { scanStream.getTracks().forEach(t => t.stop()); scanStream = null; }
  if (h5) { const x = h5; h5 = null; x.stop().catch(() => {}).finally(() => { try { x.clear(); } catch { /* bỏ qua */ } }); }
}
/* Tem máy: ...?ma=IN-01 · tem điểm đo (phiên 8A): ...?diem=DD-TONG
   tem tủ điện (phiên 9): ...?tu=MSB-01 · tem ổ cắm: ...?od=OC-01
   → {kind:'may'|'diem'|'tu'|'od', ma} hoặc null */
const KIND_PATH = { may: 'may', diem: 'diem', tu: 'tu-dien', od: 'o-cam' };
function parseCode(s) {
  s = String(s || '').trim();
  if (!s) return null;
  if (!isUrl(s)) return { kind: 'may', ma: s.toUpperCase() };
  try {
    const u = new URL(s);
    const lay = (p, re) => (u.searchParams.get(p) || decodeURIComponent((u.hash.match(re) || [])[1] || '')).trim();
    const dd = lay('diem', /^#\/diem\/([^/?]+)/);
    if (dd) return { kind: 'diem', ma: dd.toUpperCase() };
    const tu = lay('tu', /^#\/tu-dien\/([^/?]+)/);
    if (tu) return { kind: 'tu', ma: tu.toUpperCase() };
    const od = lay('od', /^#\/o-cam\/([^/?]+)/);
    if (od) return { kind: 'od', ma: od.toUpperCase() };
    const m = lay('ma', /^#\/may\/([^/?]+)/);
    return m ? { kind: 'may', ma: m.toUpperCase() } : null;
  } catch { return null; }
}
const codeHash = c => (c ? '#/' + (KIND_PATH[c.kind] || 'may') + '/' + encodeURIComponent(c.ma) : '');
async function pageScan() {
  view.innerHTML = `
    <h1 style="margin:0 0 12px">${bi('Quét mã QR', '扫描二维码')}</h1>
    <div class="scanbox"><video id="cam" playsinline muted></video><div id="h5"></div><div class="reticle" id="ret"></div></div>
    <p id="scanmsg" class="muted" style="text-align:center">${bi('Đang mở camera…', '正在打开摄像头…')}</p>
    <form class="manual" id="manual"><input id="mcode" placeholder="VD: IN-01" aria-label="Nhập mã máy" autocapitalize="characters">
      <button class="btn primary">${bi('Mở', '打开')}</button></form>`;
  $('#manual').onsubmit = e => { e.preventDefault(); const c = parseCode($('#mcode').value); if (c) go(codeHash(c)); };
  const msg = $('#scanmsg');
  const still = () => location.hash === '#/quet';
  let done = false;
  const found = raw => {
    if (done) return;
    const c = parseCode(raw);
    if (!c) { msg.innerHTML = bi('Mã QR này không phải tem thiết bị', '此二维码不是设备标签'); return; }
    done = true; stopScan(); navigator.vibrate?.(80);
    go(codeHash(c));
  };
  const camErr = () => { msg.innerHTML = bi('Không mở được camera. Hãy cho phép dùng camera (hoặc mở app bằng https) hoặc nhập mã bên dưới.', '无法打开摄像头，请允许使用摄像头或在下方输入编号。'); };
  if (!navigator.mediaDevices?.getUserMedia) return camErr();

  let native = false;
  if ('BarcodeDetector' in window) {
    try { native = (await BarcodeDetector.getSupportedFormats()).includes('qr_code'); } catch { native = false; }
  }
  if (native) {
    try {
      const det = new BarcodeDetector({ formats: ['qr_code'] });
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
      if (!still()) { stream.getTracks().forEach(t => t.stop()); return; }
      scanStream = stream;
      const v = $('#cam'); v.srcObject = stream; await v.play();
      msg.innerHTML = bi('Đưa tem QR vào giữa khung', '将二维码对准框内');
      scanTimer = setInterval(async () => {
        try { const res = await det.detect(v); if (res[0]) found(res[0].rawValue); } catch { /* khung hình chưa sẵn sàng */ }
      }, 250);
    } catch { camErr(); }
    return;
  }
  /* Dự phòng (iPhone…): thư viện html5-qrcode */
  $('#cam').hidden = true; $('#ret').hidden = true;
  try { await loadQrLib(); }
  catch { msg.innerHTML = bi('Không tải được bộ quét QR (cần mạng). Có thể dùng camera điện thoại quét tem, hoặc nhập mã bên dưới.', '扫码组件加载失败（需要网络）。可用手机相机扫描标签，或在下方输入编号。'); return; }
  if (!still()) return;
  const inst = new Html5Qrcode('h5', { verbose: false });
  h5 = inst;
  try {
    await inst.start({ facingMode: 'environment' },
      { fps: 10, qrbox: (w, h) => { const s = Math.floor(Math.min(w, h) * 0.7); return { width: s, height: s }; } },
      text => found(text), () => {});
    if (!still() || h5 !== inst) { inst.stop().catch(() => {}); return; }
    msg.innerHTML = bi('Đưa tem QR vào giữa khung', '将二维码对准框内');
  } catch { if (h5 === inst) h5 = null; camErr(); }
}

/* ===================== Trang Thêm (更多) ===================== */
const TILES = [
  ['#/hop-dong', '<path d="M6 3h9l4 4v14H6z"/><path d="M14 3v5h5M9 12h7M9 16h5"/>', 'Hợp đồng bảo trì', '维保合同'],
  ['#/kiem-dinh', '<path d="M12 3l7 3v6c0 4-3 7-7 9-4-2-7-5-7-9V6z"/><path d="M9 12l2 2 4-4"/>', 'Kiểm định / hiệu chuẩn', '检验 / 校准'],
  ['#/nang-luong', '<path d="M13 3L5 14h6l-1 7 8-11h-6z"/>', 'Chỉ số – Năng lượng', '能耗指标'],
  ['#/lo-dien', '<path d="M5 3h14v6H5zM9 9v4a3 3 0 0 0 3 3h0a3 3 0 0 1 3 3v2M9 5.5h.01M12 5.5h.01M15 5.5h.01"/>', 'Lộ điện – nguồn', '线路 – 电源'],
  ['#/tem', '<path d="M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM14 14h2v2h-2zM18 18h2v2h-2z"/>', 'In tem QR', '打印二维码标签'],
];
function pageMore() {
  view.innerHTML = `
    <h1 style="margin:0 0 12px">${bi('Thêm', '更多')}</h1>
    <div class="tiles">${TILES.map(([h, d, vi, zh]) => `<a class="tile" href="${h}">
      <svg viewBox="0 0 24 24" aria-hidden="true">${d}</svg>${bi(vi, zh)}</a>`).join('')}</div>`;
}

/* ===================== Danh sách hợp đồng ===================== */
const HD_LOC = [['', 'Tất cả', '全部'], ['sap', 'Sắp hết hạn', '即将到期'], ['het', 'Đã hết hạn', '已过期']];
async function pageContracts(loc) {
  loading();
  let r;
  try { r = await fetchCached('hd', api.contracts); } catch (e) { return errorBox(e); }
  const all = r.data || [];
  let f = HD_LOC.some(x => x[0] === loc) ? loc : '';
  view.innerHTML = `
    <h1 style="margin:0 0 12px">${bi('Hợp đồng bảo trì', '维保合同')}</h1>
    ${r.stale ? staleNote(r.stale) : ''}
    <label class="search"><input id="q" type="search" autocomplete="off" placeholder="Tìm tên, nhà thầu, mã HĐ / 搜索名称、承包商、编号" aria-label="Tìm hợp đồng"></label>
    <div class="chips" id="chips">${HD_LOC.map(([v, vi, zh]) => `<button data-v="${v}" class="${v === f ? 'on' : ''}">${bi(vi, zh)}</button>`).join('')}</div>
    <div id="hdl"></div>
    <p class="note">${bi('Nhập và sửa hợp đồng trong Google Sheets, tab HopDong.', '请在 Google 表格 HopDong 页录入和维护合同。')}</p>`;
  const q = $('#q'), box = $('#hdl');
  const draw = () => {
    const k = q.value.trim().toLowerCase();
    const rows = all.filter(h => (!f || h.muc === f) &&
      (!k || [h.ten, h.nhaThau, h.maHD, h.phamVi].join(' ').toLowerCase().includes(k)));
    box.innerHTML = rows.length ? `<div class="hd-list">${rows.map(hdCard).join('')}</div>`
      : `<p class="empty card">${all.length ? bi('Không có hợp đồng phù hợp', '没有匹配的合同')
        : bi('Chưa có hợp đồng nào. Nhập vào tab HopDong trong Google Sheets.', '暂无合同，请在 Google 表格 HopDong 页录入。')}</p>`;
  };
  q.oninput = draw;
  $('#chips').onclick = e => {
    const b = e.target.closest('button');
    if (!b) return;
    f = b.dataset.v;
    [...$('#chips').children].forEach(x => x.classList.toggle('on', x === b));
    draw();
  };
  draw();
}

/* ===================== Chi tiết hợp đồng ===================== */
async function pageContract(maHD) {
  loading();
  let r;
  try { r = await fetchCached('hd', api.contracts); } catch (e) { return errorBox(e); }
  const h = (r.data || []).find(x => String(x.maHD).toUpperCase() === String(maHD).toUpperCase());
  if (!h) {
    view.innerHTML = `<div class="empty"><p class="plate">${esc(maHD)}</p><p>${bi('Không tìm thấy hợp đồng này', '未找到该合同')}</p>
      <a class="btn" href="#/hop-dong">${bi('Về danh sách hợp đồng', '返回合同列表')}</a></div>`;
    return;
  }
  const han = hdHan(h), td = hdTienDo(h), tt = hdTinhTrang(h), tel = hdTel(h.lienHe);
  const row = (vi, zh, v) => v ? `<div class="wide"><dt>${bi(vi, zh)}</dt><dd>${esc(v)}</dd></div>` : '';
  const may = (h.thietBi || []).filter(Boolean);
  view.innerHTML = `
    <a class="back" href="#/hop-dong">‹ ${bi('Hợp đồng bảo trì', '维保合同')}</a>
    ${r.stale ? staleNote(r.stale) : ''}
    <span class="plate xl">${esc(h.maHD)}</span>
    <h1>${esc(h.ten)}</h1>
    <p><span class="badge ${han.cls}">${han.html}</span></p>
    ${td == null ? '' : `<div class="hd-bar ${han.cls}"><i style="width:${td}%"></i></div>`}
    <section class="block">
      <dl class="info">
        ${row('Nhà thầu', '承包商', h.nhaThau)}
        ${row('Người liên hệ', '联系人', h.lienHe)}
        <div><dt>${bi('Ngày bắt đầu', '开始日期')}</dt><dd>${fmtDate(h.ngayBatDau) || '—'}</dd></div>
        <div><dt>${bi('Ngày kết thúc', '结束日期')}</dt><dd>${fmtDate(h.ngayKetThuc) || '—'}</dd></div>
        <div><dt>${bi('Tần suất bảo trì', '保养频率')}</dt><dd>${esc(h.tanSuat) || '—'}</dd></div>
        <div><dt>${bi('Báo trước', '提前提醒')}</dt><dd>${esc(h.baoTruoc)} ${bi('ngày', '天')}</dd></div>
        ${row('Phạm vi công việc', '工作范围', h.phamVi)}
        ${row('Người phụ trách', '负责人', h.nguoiPhuTrach)}
        <div class="wide"><dt>${bi('Tình trạng gia hạn', '续签状态')}</dt><dd>${bi(esc(tt.vi), esc(tt.zh))}</dd></div>
        ${h.giaTri ? row('Giá trị hợp đồng (VNĐ)', '合同金额', num(h.giaTri)) : ''}
        ${row('Ghi chú', '备注', h.ghiChu)}
      </dl>
      <div class="row2" style="margin-top:12px">
        ${tel ? `<a class="btn" href="tel:${esc(tel)}">${bi('Gọi nhà thầu', '致电承包商')}</a>` : ''}
        ${isUrl(h.taiLieu) ? `<a class="btn" href="${esc(h.taiLieu)}" target="_blank" rel="noopener">${bi('Mở hợp đồng', '打开合同')}</a>` : ''}
      </div>
    </section>
    ${may.length ? `<section class="block">
      <h2 class="sec">${bi('Thiết bị thuộc hợp đồng', '合同涵盖设备')}</h2>
      <ul class="mlist">${may.map(x => `<li><a class="mrow" href="#/may/${encodeURIComponent(x)}">
        <span class="plate">${esc(x)}</span><span><span class="t">${bi('Xem lý lịch máy', '查看设备履历')}</span></span><span>›</span></a></li>`).join('')}</ul>
    </section>` : ''}
    <p class="note">${bi('Khi gia hạn: thêm một dòng hợp đồng mới (mã mới) trong Google Sheets, rồi đổi dòng này thành "Đã gia hạn" để giữ lịch sử hồ sơ.', '续签时：在 Google 表格中新增一行新合同（新编号），并将本行改为"已续签"，以保留记录。')}</p>`;
}

/* ===================== Danh sách kiểm định (phiên 7) ===================== */
const KD_LOC = [['', 'Tất cả', '全部'], ['sap', 'Sắp hết hạn', '即将到期'],
  ['het', 'Đã hết hạn', '已过期'], ['ok', 'Còn hạn', '有效期内']];
async function pageInspections(loc) {
  loading();
  let r;
  try { r = await fetchCached('kd', api.inspections); } catch (e) { return errorBox(e); }
  const all = r.data || [];
  const loais = [...new Set(all.map(k => k.loai).filter(Boolean))];
  let f = KD_LOC.some(x => x[0] === loc) ? loc : '';
  view.innerHTML = `
    <h1 style="margin:0 0 12px">${bi('Kiểm định / hiệu chuẩn', '检验 / 校准')}</h1>
    ${r.stale ? staleNote(r.stale) : ''}
    <label class="search"><input id="q" type="search" autocomplete="off" placeholder="Tìm tên, mã máy, số giấy / 搜索名称、编号、证书号" aria-label="Tìm kiểm định"></label>
    ${loais.length > 1 ? `<label class="field"><span>${bi('Loại kiểm định', '检验类别')}</span>
      <select id="fl"><option value="">${'Tất cả / 全部'}</option>${loais.map(x => `<option>${esc(x)}</option>`).join('')}</select></label>` : ''}
    <div class="chips" id="chips">${KD_LOC.map(([v, vi, zh]) => `<button data-v="${v}" class="${v === f ? 'on' : ''}">${bi(vi, zh)}</button>`).join('')}</div>
    <div id="kdl"></div>
    <p class="note">${bi('Nhập và sửa trong Google Sheets, tab KiemDinh. Kiểm định lại thì thêm dòng mới, đổi dòng cũ thành "Đã kiểm định lại".', '请在 Google 表格 KiemDinh 页录入。复检后新增一行，并将旧行改为"已复检"。')}</p>
    <p class="note">${bi('App chỉ nhắc hạn. Danh mục thiết bị bắt buộc kiểm định và trách nhiệm pháp lý do công ty tự xác định theo quy định hiện hành.', '本应用仅作到期提醒。强制检验设备清单及法律责任由公司依现行法规自行确定。')}</p>`;
  const q = $('#q'), fl = $('#fl'), box = $('#kdl');
  const draw = () => {
    const k = q.value.trim().toLowerCase();
    const lo = fl ? fl.value : '';
    const rows = all.filter(x => (!f || x.muc === f) && (!lo || x.loai === lo) &&
      (!k || [x.tenThietBi, x.ma, x.soGiay, x.donVi, x.loai].join(' ').toLowerCase().includes(k)));
    box.innerHTML = rows.length ? `<div class="hd-list">${rows.map(x => kdCard(x)).join('')}</div>`
      : `<p class="empty card">${all.length ? bi('Không có giấy kiểm định phù hợp', '没有匹配的检验记录')
        : bi('Chưa có dữ liệu. Nhập vào tab KiemDinh trong Google Sheets.', '暂无数据，请在 Google 表格 KiemDinh 页录入。')}</p>`;
  };
  q.oninput = draw;
  if (fl) fl.onchange = draw;
  $('#chips').onclick = e => {
    const b = e.target.closest('button');
    if (!b) return;
    f = b.dataset.v;
    [...$('#chips').children].forEach(x => x.classList.toggle('on', x === b));
    draw();
  };
  draw();
}

/* ===================== In tem QR ===================== */
const appUrlOk = () => /^https:\/\//.test(C.APP_URL || '') && !/ten-cong-ty/.test(C.APP_URL);
/* Tem máy (?ma=) và tem điểm đo (?diem=, phiên 8A) */
const TEM_LOAI = {
  may: { vi: 'Máy / thiết bị', zh: '设备', param: 'ma', hintVi: 'Quét để xem lý lịch', hintZh: '扫码查看履历' },
  diem: { vi: 'Điểm đo (công tơ)', zh: '计量点', param: 'diem', hintVi: 'Quét để ghi chỉ số', hintZh: '扫码抄表' },
  tu: { vi: 'Tủ điện', zh: '配电柜', param: 'tu', hintVi: 'Quét để xem các lộ trong tủ', hintZh: '扫码查看柜内回路' },
  ocam: { vi: 'Ổ cắm / điểm điện (tem nhỏ)', zh: '插座（小标签）', param: 'od', gon: true, co: '25' },
};
async function pageLabels() {
  loading();
  let l;
  try { l = await fetchCached('list', api.list); } catch (e) { return errorBox(e); }
  const kho = { may: l.data.map(m => ({ ma: m.ma, ten: m.ten, khuVuc: m.khuVuc })), diem: null, tu: null, ocam: null };
  let loai = 'may';
  const cur = () => kho[loai] || [];
  let chosen = new Set(cur().map(m => m.ma));
  view.innerHTML = `
    <div class="no-print">
      <h1 style="margin:0 0 12px">${bi('In tem QR', '打印二维码标签')}</h1>
      ${appUrlOk() ? '' : msgBad(bi('Chưa sửa APP_URL trong config.js thành link app thật — tem in ra sẽ sai link. Đã khóa nút In.', '尚未在 config.js 中把 APP_URL 改为真实网址，标签链接将错误，已禁用打印。'))}
      <div class="tem-tools">
        <label class="field"><span>${bi('Loại tem', '标签类型')}</span><select id="ft">${Object.entries(TEM_LOAI).map(([k, v]) => `<option value="${k}">${esc(v.vi)} / ${esc(v.zh)}</option>`).join('')}</select></label>
        <div class="row2">
          <label class="field"><span id="falb">${bi('Khu vực', '区域')}</span><select id="fa"><option value="">Tất cả / 全部</option></select></label>
          <label class="field"><span>${bi('Cỡ tem', '标签尺寸')}</span><select id="fs"><option value="20">20 mm</option><option value="25">25 mm</option><option value="30">30 mm</option><option value="40" selected>40 mm</option><option value="50">50 mm</option></select></label>
        </div>
        <label class="field"><span>${bi('Lọc theo mã', '按编号筛选')}</span><input id="fc" type="search" placeholder="VD: IN"></label>
        <div class="card"><label class="picks" style="display:flex;gap:10px;padding:10px 14px;border-bottom:1px solid var(--line)"><input type="checkbox" id="all" checked> <b>${bi('Chọn tất cả', '全选')}</b></label><div class="picks" id="picks"></div></div>
        <button class="btn primary block" id="print" ${appUrlOk() ? '' : 'disabled'}>${bi('In tem', '打印')} (<span id="n"></span>)</button>
        <p class="note" id="lk"></p>
        <p class="note">${bi('Tem decal PVC hoặc nhôm, chịu dầu và nhiệt. Không dán ở vị trí có thể rơi vào sản phẩm; đưa tem vào danh mục kiểm soát vật lạ.', '使用PVC或铝质标签，耐油耐热。勿贴在可能掉入产品的位置；纳入异物管控清单。')}</p>
      </div>
      <h2 class="sec">${bi('Xem trước', '预览')}</h2>
    </div>
    <div class="sheet" id="sheet"></div>`;
  const ft = $('#ft'), fa = $('#fa'), fc = $('#fc'), fs = $('#fs');
  const visible = () => cur().filter(m => (!fa.value || m.khuVuc === fa.value) && (!fc.value.trim() || m.ma.toLowerCase().includes(fc.value.trim().toLowerCase())));
  const drawSheet = () => {
    const v = visible().filter(m => chosen.has(m.ma));
    const t = TEM_LOAI[loai];
    $('#n').textContent = v.length;
    const sheet = $('#sheet');
    if (!v.length) { sheet.innerHTML = `<p class="empty">${bi('Chưa chọn mục nào', '未选择项目')}</p>`; return; }
    sheet.innerHTML = v.map((m, i) => `<div class="tem${t.gon ? ' tem-gon' : ''}" style="--s:${fs.value}mm">
      <div class="qr" id="qr${i}"></div>
      <div class="code">${t.gon ? '' : LOGO}${esc(m.ma)}</div>
      ${t.gon ? '' : `<div class="name">${esc(m.ten)}</div>
      <div class="hint">${esc(t.hintVi)}<br>${esc(t.hintZh)}</div>`}</div>`).join('');
    if (!window.QRCode) { sheet.insertAdjacentHTML('afterbegin', msgBad(bi('Chưa tải được bộ tạo mã QR (cần mạng).', '二维码生成组件未加载（需要网络）。'))); return; }
    const base = C.APP_URL.replace(/\/?$/, '/');
    v.forEach((m, i) => new QRCode($('#qr' + i), { text: base + '?' + t.param + '=' + encodeURIComponent(m.ma), width: 256, height: 256, correctLevel: QRCode.CorrectLevel.M }));
  };
  const drawPicks = () => {
    const v = visible();
    $('#picks').innerHTML = v.map(m => `<label><input type="checkbox" value="${esc(m.ma)}" ${chosen.has(m.ma) ? 'checked' : ''}> <span class="plate">${esc(m.ma)}</span> ${esc(m.ten)}</label>`).join('')
      || `<p class="empty">${bi('Không có mục nào', '没有项目')}</p>`;
    $('#all').checked = v.length > 0 && v.every(m => chosen.has(m.ma));
    $('#lk').innerHTML = bi('Link trong tem: ', '标签链接：') + `<b>${esc(C.APP_URL)}?${TEM_LOAI[loai].param}=…</b>`;
    drawSheet();
  };
  const veKhuVuc = () => {
    $('#falb').innerHTML = loai === 'tu' ? bi('Vị trí', '位置')
      : loai === 'ocam' ? bi('Tủ cấp nguồn', '供电柜') : bi('Khu vực', '区域');
    const areas = [...new Set(cur().map(m => m.khuVuc).filter(Boolean))];
    fa.innerHTML = `<option value="">Tất cả / 全部</option>` + areas.map(a => `<option>${esc(a)}</option>`).join('');
  };
  ft.onchange = async () => {
    loai = ft.value;
    if (!kho[loai]) {
      $('#picks').innerHTML = `<p class="empty">${bi('Đang tải…', '加载中…')}</p>`;
      try {
        if (loai === 'diem') {
          const rr = await fetchCached('meters', api.meters);
          kho.diem = (rr.data || []).map(d => ({ ma: d.maDiem, ten: d.ten, khuVuc: d.khuVuc }));
        } else {
          const rr = await fetchCached('dien', api.power);   // tủ điện + ổ cắm dùng chung một lần tải
          kho.tu = (rr.data.tu || []).map(t => ({ ma: t.maTu, ten: t.ten, khuVuc: t.viTri }));
          kho.ocam = (rr.data.lo || []).map(l => ({ ma: l.maDiem, ten: l.viTri || viZh(l.loai).vi, khuVuc: l.maTu }));
        }
      } catch (e) { kho[loai] = []; $('#picks').innerHTML = msgBad(errText(e)); }
    }
    if (TEM_LOAI[loai].co) fs.value = TEM_LOAI[loai].co;
    chosen = new Set(cur().map(m => m.ma));
    veKhuVuc();
    drawPicks();
  };
  fa.onchange = drawPicks; fc.oninput = drawPicks; fs.onchange = drawSheet;
  $('#picks').onchange = e => { e.target.checked ? chosen.add(e.target.value) : chosen.delete(e.target.value); drawPicks(); };
  $('#all').onchange = e => { visible().forEach(m => e.target.checked ? chosen.add(m.ma) : chosen.delete(m.ma)); drawPicks(); };
  $('#print').onclick = () => window.print();
  if (!window.QRCode) window.addEventListener('load', drawSheet, { once: true });
  veKhuVuc();
  drawPicks();
}

/* ===================== Chỉ số – Năng lượng (phiên 8A) ===================== */
function khongThayDiem(MA) {
  view.innerHTML = `<div class="empty"><p class="plate">${esc(MA)}</p>
    <p>${bi('Không tìm thấy điểm đo có mã này. Khai báo ở tab DiemDo trong Google Sheets.', '未找到该计量点，请在 Google 表格 DiemDo 页登记。')}</p>
    <a class="btn" href="#/nang-luong">${bi('Về danh sách điểm đo', '返回计量点列表')}</a>
    <a class="btn" href="#/may/${encodeURIComponent(MA)}">${bi('Thử mở như mã máy', '按设备编号打开')}</a></div>`;
}

async function pageEnergy() {
  loading();
  let r;
  try { r = await fetchCached('nl', api.energy); } catch (e) { return errorBox(e); }
  const d = r.data, ds = d.diem || [], chua = d.chuaGhi || [];
  const sap = [...ds].sort((a, b) => (b.thangNay || 0) - (a.thangNay || 0));
  const maxThang = Math.max(1, ...ds.map(x => x.thangNay || 0));
  view.innerHTML = `
    <h1 style="margin:0 0 12px">${bi('Chỉ số – Năng lượng', '能耗指标')}</h1>
    <div id="qbox"></div>
    ${r.stale ? staleNote(r.stale) : ''}
    ${!ds.length ? `<p class="empty card">${bi('Chưa khai báo điểm đo nào. Mở Google Sheets → tab DiemDo, nhập mã điểm đo, tên, loại, đơn vị, hệ số nhân.', '尚未登记计量点。请在 Google 表格 DiemDo 页录入编号、名称、类别、单位、倍率。')}</p>` : ''}
    ${ds.length ? (chua.length
      ? `<div class="alert warn"><b>${chua.length}</b><span>${bi('điểm đo chưa ghi chỉ số hôm nay', '个计量点今天未抄表')}</span></div>`
      : `<div class="alert"><b>✓</b><span>${bi('Tất cả điểm đo đã ghi hôm nay', '所有计量点今天已抄表')}</span></div>`) : ''}
    ${ds.length ? `<section class="block">
      <h2 class="sec">${bi('Điện tiêu thụ 14 ngày', '近14天用电')}
        <small>${bi('tháng này ' + num(d.tongDienThang) + ' kWh', '本月 ' + num(d.tongDienThang) + ' kWh')}</small></h2>
      <div class="card">${svgBars((d.theoNgay || []).map(x => ({ label: String(x.ngay).slice(8), v: x.dien })), { unit: 'kWh', alt: 'Điện tiêu thụ 14 ngày' })}</div>
    </section>` : ''}
    ${ds.length ? `<section class="block">
      <h2 class="sec">${bi('Điểm đo', '计量点')}<small>${bi(`${ds.length} điểm · tháng ${esc(d.thang || '')}`, `${ds.length} 个 · ${esc(d.thang || '')}`)}</small></h2>
      <ul class="mlist">${sap.map(x => ddCard(x, maxThang)).join('')}</ul>
    </section>` : ''}
    <p class="note">${bi('Số liệu này phục vụ hồ sơ ISO 50001 (đường cơ sở EnB, chỉ số EnPI). Khi làm báo cáo phải đối chiếu với hóa đơn/công tơ của điện lực. Cột "Tiêu thụ" trong tab ChiSo do app tự tính — không sửa tay.', '本数据用于 ISO 50001 台账（能源基准 EnB、能源绩效参数 EnPI）。出报告时须与电力公司账单/电表核对。ChiSo 页"消耗量"列由应用自动计算，请勿手改。')}</p>`;
  veQueueBox($('#qbox'), 'chiso', 'lần ghi chỉ số chờ gửi', '条抄表记录待提交', () => { store.del('tb3_nl'); route(); });
  if (queueOf('chiso').length && navigator.onLine && pinNho()) {
    flushQueue().then(res => { if (res.sent) { store.del('tb3_nl'); route(); } });
  }
}

async function pageMeter(maDiem) {
  const MA = String(maDiem).toUpperCase();
  loading();
  let r;
  try { r = await fetchCached('dd_' + MA, () => api.meter(MA)); }
  catch (e) {
    if (e.code !== 'NOT_FOUND') return errorBox(e);
    return khongThayDiem(MA);
  }
  const d = r.data, diem = d.diem, lc = d.lanCuoi;
  const ngay14 = (d.theoNgay || []).slice(-14);
  const ls = d.lichSu || [];
  const daGhi = !!(lc && lc.ngay === today());
  const nhan = daGhi ? { cls: 'ok', html: bi('Đã ghi hôm nay', '今天已抄表') }
    : { cls: 'warn', html: lc ? bi('Lần cuối ' + fmtDate(lc.ngay), '上次 ' + fmtDate(lc.ngay)) : bi('Chưa có số liệu', '暂无数据') };
  const wide = (vi, zh, v) => v ? `<div class="wide"><dt>${bi(vi, zh)}</dt><dd>${v}</dd></div>` : '';
  view.innerHTML = `
    <a class="back" href="#/nang-luong">‹ ${bi('Chỉ số – Năng lượng', '能耗指标')}</a>
    ${r.stale ? staleNote(r.stale) : ''}
    <div class="hero">
      <div>
        <span class="plate xl">${esc(diem.maDiem)}</span>
        <h1>${esc(diem.ten)}</h1>
        <p><span class="badge ${nhan.cls}">${nhan.html}</span>${diem.laSEU ? ` <span class="badge warn seu">SEU</span>` : ''}</p>
      </div>
    </div>
    <section class="block">
      <h2 class="sec">${bi('Thông tin điểm đo', '计量点信息')}</h2>
      <dl class="info">
        <div><dt>${bi('Loại', '类别')}</dt><dd>${esc(diem.loai) || '—'}</dd></div>
        <div><dt>${bi('Đơn vị', '单位')}</dt><dd>${esc(diem.donVi) || '—'}</dd></div>
        <div><dt>${bi('Hệ số nhân', '倍率')}</dt><dd>${num(diem.heSo)}</dd></div>
        <div><dt>${bi('Khu vực', '区域')}</dt><dd>${esc(diem.khuVuc) || '—'}</dd></div>
        ${wide('Thiết bị liên quan', '相关设备', diem.ma ? `<a href="#/may/${encodeURIComponent(diem.ma)}">${esc(diem.ma)}</a>` : '')}
        ${wide('Ghi chú', '备注', esc(diem.ghiChu))}
      </dl>
    </section>
    <section class="block">
      <h2 class="sec">${bi('Lần ghi gần nhất', '最近抄表')}</h2>
      <div class="card cs-last">
        ${lc ? `<div><b class="cs-num">${num(lc.giaTri)} <small>${esc(diem.donVi)}</small></b>
          <span class="s">${bi(fmtDate(lc.ngay) + ' ' + String(lc.thoiDiem || '').slice(11) + ' · ' + esc(lc.nguoi), fmtDate(lc.ngay) + ' · ' + esc(lc.nguoi))}</span>
          ${lc.tieuThu != null ? `<span class="badge ok">${bi('Tiêu thụ ' + num(lc.tieuThu) + ' ' + esc(diem.donVi), '消耗 ' + num(lc.tieuThu) + ' ' + esc(diem.donVi))}</span>` : ''}</div>`
          : `<p class="empty">${bi('Chưa có lần ghi nào', '暂无抄表记录')}</p>`}
        <div class="cs-sum">
          <div><b>${num(d.tongThangNay)}</b><span>${bi('tháng này (' + esc(diem.donVi) + ')', '本月 (' + esc(diem.donVi) + ')')}</span></div>
          <div><b>${num(d.tong30)}</b><span>${bi('30 ngày qua', '近30天')}</span></div>
        </div>
      </div>
    </section>
    <section class="block">
      <h2 class="sec">${bi('Tiêu thụ 14 ngày', '近14天消耗')}<small>${esc(diem.donVi)}</small></h2>
      <div class="card">${svgBars(ngay14.map(x => ({ label: String(x.ngay).slice(8), v: x.tieuThu })), { unit: diem.donVi, alt: 'Tiêu thụ 14 ngày' })}</div>
    </section>
    <section class="block">
      <h2 class="sec">${bi('Tiêu thụ 12 tháng', '近12个月消耗')}<small>${esc(diem.donVi)}</small></h2>
      <div class="card">${svgBars((d.theoThang || []).map(x => ({ label: String(x.thang).slice(5), v: x.tieuThu })), { unit: diem.donVi, alt: 'Tiêu thụ 12 tháng' })}</div>
    </section>
    <section class="block">
      <h2 class="sec">${bi('Lịch sử ghi chỉ số', '抄表记录')}<small>${bi(`${ls.length} lần gần nhất`, `最近 ${ls.length} 次`)}</small></h2>
      ${ls.length ? `<ul class="cs-hist card">${ls.map(x => `<li>
        <span><b>${num(x.giaTri)} <small>${esc(diem.donVi)}</small></b><br>
          <span class="s">${esc(String(x.thoiDiem || '').replace(/^(\d{4})-(\d{2})-(\d{2})/, '$3/$2/$1'))} · ${esc(x.nguoi)}</span>
          ${x.ghiChu ? `<br><span class="s">${esc(x.ghiChu)}</span>` : ''}
          ${x.anh && x.anh.length ? `<span class="thumbs">${x.anh.map(u => `<a href="${esc(u)}" target="_blank" rel="noopener"><img src="${esc(u)}" alt="Ảnh mặt đồng hồ" loading="lazy" referrerpolicy="no-referrer"></a>`).join('')}</span>` : ''}</span>
        <span class="badge ${x.tieuThu == null ? '' : 'ok'}">${x.tieuThu == null ? bi('—', '—') : bi('+' + num(x.tieuThu), '+' + num(x.tieuThu))}</span></li>`).join('')}</ul>`
        : `<p class="empty card">${bi('Chưa có dữ liệu', '暂无数据')}</p>`}
    </section>
    <div class="sticky-cta"><a class="btn primary block" href="#/ghi-chi-so/${encodeURIComponent(diem.maDiem)}">+ ${bi('Ghi chỉ số', '抄表录入')}</a></div>`;
}

async function pageReading(maDiem) {
  const MA = String(maDiem).toUpperCase();
  loading();
  let r;
  try { r = await fetchCached('dd_' + MA, () => api.meter(MA)); }
  catch (e) {
    if (e.code !== 'NOT_FOUND') return errorBox(e);
    return khongThayDiem(MA);
  }
  const diem = r.data.diem, lc = r.data.lanCuoi;
  const draftKey = 'tb3_cs_' + MA;
  const draft = store.get(draftKey, {});
  const state = { idGui: draft.idGui || (MA + '-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 6)) };
  const ph = photoField();
  const f = (vi, zh, input, req) => `<label class="field"><span>${bi(vi + (req ? ' <b class="req">*</b>' : ''), zh)}</span>${input}</label>`;

  view.innerHTML = `
    <a class="back" href="#/diem/${encodeURIComponent(MA)}">‹ ${bi('Quay lại điểm đo', '返回计量点')}</a>
    <h1 style="margin:0 0 4px">${bi('Ghi chỉ số', '抄表录入')}</h1>
    <p><span class="plate">${esc(diem.maDiem)}</span> ${esc(diem.ten)}</p>
    <div class="card bt-head">
      ${lc ? `<b>${bi('Lần trước: ' + num(lc.giaTri) + ' ' + esc(diem.donVi), '上次：' + num(lc.giaTri) + ' ' + esc(diem.donVi))}</b>
        <span class="s">${esc(String(lc.thoiDiem || '').replace(/^(\d{4})-(\d{2})-(\d{2})/, '$3/$2/$1'))} · ${esc(lc.nguoi)}</span>`
        : `<b>${bi('Chưa có lần ghi nào — số này sẽ là số gốc', '尚无记录 — 本次为起始读数')}</b>`}
    </div>
    <form class="form" id="cf" novalidate>
      <label class="field"><span>${bi('Chỉ số trên đồng hồ (' + esc(diem.donVi) + ') <b class="req">*</b>', '表读数 (' + esc(diem.donVi) + ')')}</span>
        <input class="big-num" name="giaTri" required inputmode="decimal" autocomplete="off" placeholder="0" value="${esc(draft.giaTri || '')}"></label>
      <div id="tt" class="cs-tt"></div>
      ${f('Thời điểm ghi', '抄表时间', `<input type="datetime-local" name="thoiDiem" value="${nowLocal()}" max="${nowLocal()}">`)}
      ${f('Người ghi', '抄表人', `<input name="nguoi" required maxlength="100" autocomplete="name" value="${esc(draft.nguoi || store.get('tb_nguoi', ''))}">`, 1)}
      ${f('Ghi chú', '备注', `<input name="ghiChu" maxlength="200" placeholder="VD: thay đồng hồ / 例：换表" value="${esc(draft.ghiChu || '')}">`)}
      ${ph.html}
      ${f('Mã PIN', 'PIN码', `<input type="password" name="pin" required inputmode="numeric" autocomplete="off" maxlength="12" value="${esc(pinNho())}">`, 1)}
      <p class="note">${bi('Ghi đúng số đang hiện trên mặt đồng hồ (không phải phần chênh lệch) — app tự tính tiêu thụ. Nếu vừa thay hoặc đặt lại đồng hồ, ghi chú "thay đồng hồ". Nên chụp ảnh mặt đồng hồ để đối chiếu. Đã gửi thì không sửa/xóa được trên app — sửa sai trong Google Sheets. Mất mạng vẫn ghi được, máy sẽ tự gửi khi có mạng.', '请填写表盘当前读数（不是差值），应用会自动计算消耗量。若刚换表或归零，请在备注写"换表"。建议拍表盘照片以便核对。提交后无法在应用内修改/删除 — 请在 Google 表格更正。无网络也可录入，联网后自动提交。')}</p>
      <div id="err" role="alert"></div>
      <button class="btn primary block" id="send">${bi('Lưu chỉ số', '保存读数')}</button>
    </form>`;

  const form = $('#cf'), err = $('#err'), btn = $('#send'), tt = $('#tt');
  ph.bind();
  const gt = form.giaTri;
  const luu = () => store.set(draftKey, { idGui: state.idGui, giaTri: gt.value, nguoi: form.nguoi.value, ghiChu: form.ghiChu.value });
  /* Xem trước phần chênh lệch ngay khi gõ */
  const xemTruoc = () => {
    const v = Number(String(gt.value).replace(',', '.'));
    if (!lc || !isFinite(v) || !String(gt.value).trim()) { tt.innerHTML = ''; return; }
    const ht = (v - lc.giaTri) * (Number(diem.heSo) || 1);
    tt.innerHTML = ht < 0
      ? msgBad(bi('Nhỏ hơn lần trước (' + num(lc.giaTri) + ') — đọc lại đồng hồ, hoặc ghi chú "thay đồng hồ".', '小于上次读数（' + num(lc.giaTri) + '）— 请重新读表，或在备注写"换表"。'))
      : `<p class="note ok-note">${bi('Tiêu thụ tạm tính: ' + num(Math.round(ht * 100) / 100) + ' ' + esc(diem.donVi), '暂算消耗：' + num(Math.round(ht * 100) / 100) + ' ' + esc(diem.donVi))}</p>`;
  };
  gt.oninput = () => { luu(); xemTruoc(); };
  form.nguoi.oninput = luu; form.ghiChu.oninput = luu;
  xemTruoc();

  const setBtn = html => { btn.innerHTML = html; };
  const xong = (res, cho) => {
    store.del(draftKey);
    store.del('tb3_dd_' + MA); store.del('tb3_nl'); store.del('tb3_dash');
    if (diem.ma) store.del('tb3_m_' + diem.ma);
    view.innerHTML = `<div class="done">
      <p>${cho ? bi('Đã lưu trên máy — sẽ tự gửi khi có mạng', '已保存在手机 — 联网后自动提交')
        : bi(res.trung ? 'Lần ghi này đã được lưu trước đó' : 'Đã lưu chỉ số', res.trung ? '本次记录此前已保存' : '读数已保存')}</p>
      ${res.maGhi ? `<span class="plate">${esc(res.maGhi)}</span>` : ''}
      <p class="note">${bi(esc(diem.maDiem) + ' · ' + esc(diem.ten), esc(diem.maDiem))}</p>
      ${res.tieuThu != null ? `<p><span class="badge ok">${bi('Tiêu thụ ' + num(res.tieuThu) + ' ' + esc(diem.donVi), '消耗 ' + num(res.tieuThu) + ' ' + esc(diem.donVi))}</span></p>` : ''}
      ${res.canhBao ? msgBad(bi(esc(res.canhBao), '本次消耗异常偏高，请核对读数。')) : ''}
      <a class="btn primary" href="#/quet">${bi('Quét điểm đo tiếp theo', '扫描下一个计量点')}</a>
      <a class="btn" href="#/nang-luong">${bi('Về danh sách điểm đo', '返回计量点列表')}</a>
      <a class="btn" href="#/diem/${encodeURIComponent(MA)}">${bi('Xem điểm đo này', '查看本计量点')}</a></div>`;
    banner();
  };

  form.onsubmit = async e => {
    e.preventDefault();
    if (btn.disabled) return;
    err.innerHTML = '';
    const { pin, ...d } = Object.fromEntries(new FormData(form));
    const giaTri = Number(String(d.giaTri || '').replace(',', '.'));
    if (!String(d.giaTri || '').trim() || !isFinite(giaTri) || giaTri < 0) {
      err.innerHTML = msgBad(bi('Chỉ số không hợp lệ — chỉ nhập số', '读数无效 — 只能填数字'));
      gt.focus(); return;
    }
    if (!String(d.nguoi || '').trim() || !String(pin || '').trim()) {
      err.innerHTML = msgBad(bi('Vui lòng điền đủ các ô có dấu *', '请填写所有带 * 的项目'));
      return;
    }
    store.set('tb_nguoi', d.nguoi);
    nhoPin(pin);
    const data = { idGui: state.idGui, maDiem: diem.maDiem, giaTri,
      thoiDiem: d.thoiDiem || nowLocal(), nguoi: d.nguoi, ghiChu: d.ghiChu || '', anh: [] };
    const vaoHangDoi = async () => {
      setBtn(bi('Đang lưu…', '正在保存…'));
      const files = await ph.raw();
      queueAdd({ loai: 'chiso', ma: diem.maDiem, data, files, t: Date.now() });
      xong({ tieuThu: null }, true);
    };
    btn.disabled = true;
    let step = 'photo';
    try {
      if (!navigator.onLine) return await vaoHangDoi();
      const anh = await ph.upload(pin, diem.maDiem, setBtn);
      step = 'save';
      setBtn(bi('Đang gửi…', '正在提交…'));
      const res = await api.addReading(pin, { ...data, anh });
      xong(res, false);
    } catch (e2) {
      if (e2.code === 'NET') { try { return await vaoHangDoi(); } catch { /* rơi xuống báo lỗi */ } }
      err.innerHTML = msgBad(sendErr(e2, step));
    } finally {
      if (btn.isConnected) { btn.disabled = false; setBtn(bi('Lưu chỉ số', '保存读数')); }
    }
  };
}

/* ===================== Lộ điện / nguồn điện (phiên 9) ===================== */
const LOTO = bi('An toàn: thông tin ở đây chỉ để tra cứu. Trước khi thao tác phải CẮT ĐIỆN, KHÓA – TREO THẺ (LOTO) và đo kiểm tra chắc chắn không còn điện. Sau khi cải tạo mạch phải cập nhật lại tab TuDien / LoDien.',
  '安全提示：此处信息仅供查询。作业前必须断电、上锁挂牌（LOTO）并验电确认无电。线路改造后须及时更新 TuDien / LoDien 表。');

/* Chuỗi tủ cấp nguồn phía trên (trên cùng trước) – tính ngay trên máy để dùng khi sóng yếu */
function chuoiTu(ds, key) {
  const map = {};
  (ds || []).forEach(t => map[t.maTu] = t);
  const chain = [];
  let cur = map[key], guard = 0;
  while (cur && cur.tuCap && map[cur.tuCap] && guard++ < 20) {
    cur = map[cur.tuCap];
    if (chain.some(x => x.maTu === cur.maTu)) break;
    chain.unshift({ maTu: cur.maTu, ten: cur.ten, viTri: cur.viTri });
  }
  return chain;
}
/* MSB-01 › DB-IN-01 › tủ đang xem */
function duongDanHtml(ds, cuoi) {
  const items = (ds || []).map(t => `<a href="#/tu-dien/${encodeURIComponent(t.maTu)}">${esc(t.maTu)}</a>`);
  if (cuoi) items.push(`<b>${esc(cuoi)}</b>`);
  return items.length > 1 ? `<p class="path">${items.join(' <span>›</span> ')}</p>` : '';
}
const pwRow = (vi, zh, v) => (v ? `<div class="wide"><dt>${bi(vi, zh)}</dt><dd>${v}</dd></div>` : '');

/* Khối "nguồn điện" dùng chung cho trang máy và trang ổ cắm */
function nguonBox(dn) {
  const tu = dn.tu, lo = dn.lo;
  const day = lo && lo.coDay ? esc(lo.coDay) + (lo.chieuDai ? ` · ${esc(lo.chieuDai)} m` : '') : '';
  return `<div class="card pw-box">
    ${duongDanHtml(dn.duongDan, tu ? tu.maTu : '')}
    <dl class="info">
      ${tu ? pwRow('Tủ cấp nguồn', '供电柜', `<span class="plate">${esc(tu.maTu)}</span> ${esc(tu.ten)}`) : ''}
      ${lo ? pwRow('Lộ / số CB', '回路编号', `<b>${esc(lo.lo) || '—'}</b>`) : ''}
      ${lo ? pwRow('CB', '断路器', esc(lo.cb)) : ''}
      ${day ? pwRow('Cỡ dây', '导线规格', day) : ''}
      ${lo ? pwRow('Pha', '相位', esc(lo.pha)) : ''}
      ${lo ? pwRow('Vị trí', '位置', esc(lo.viTri)) : ''}
      ${tu ? pwRow('Vị trí tủ', '柜体位置', esc(tu.viTri)) : ''}
      ${tu ? pwRow('CB tổng của tủ', '柜总断路器', esc(tu.cbTong)) : ''}
      ${lo ? pwRow('Ghi chú', '备注', esc(lo.ghiChu)) : ''}
    </dl>
    ${tu ? `<a class="btn block" href="#/tu-dien/${encodeURIComponent(tu.maTu)}">${bi('Xem các lộ trong tủ', '查看柜内回路')}</a>` : ''}
  </div>`;
}

const tuRow = t => `<li><a class="mrow" href="#/tu-dien/${encodeURIComponent(t.maTu)}">
  <span class="plate">${esc(t.maTu)}</span>
  <span><span class="t">${esc(t.ten) || '—'}</span><br><span class="s">${esc(t.viTri)}${t.cbTong ? ' · ' + esc(t.cbTong) : ''}</span></span></a></li>`;
const loRow = l => `<li><a class="mrow" href="#/o-cam/${encodeURIComponent(l.maDiem)}">
  <span class="plate">${esc(l.maDiem)}</span>
  <span><span class="t">${esc(l.viTri) || esc(viZh(l.loai).vi)}</span><br>
    <span class="s">${esc(l.maTu) || '—'} · ${esc(l.lo) || '—'}${l.cb ? ' · ' + esc(l.cb) : ''}</span></span></a></li>`;
const LO_MAX = 40;
const themNua = n => (n > 0 ? `<p class="note">${bi(`Còn ${n} mục nữa — gõ thêm để lọc`, `还有 ${n} 项 — 请输入更多字符筛选`)}</p>` : '');

async function pagePower() {
  loading();
  let r;
  try { r = await fetchCached('dien', api.power); } catch (e) { return errorBox(e); }
  const tus = r.data.tu || [], los = r.data.lo || [];
  view.innerHTML = `
    <h1 style="margin:0 0 12px">${bi('Lộ điện – nguồn', '线路 – 电源')}</h1>
    ${r.stale ? staleNote(r.stale) : ''}
    ${(tus.length || los.length) ? `<button class="scan-hero" id="goScan">${ICON_SCAN}${bi('Quét tem trên tủ điện / ổ cắm', '扫描配电柜或插座标签')}</button>
    <label class="search"><input id="q" type="search" autocomplete="off" placeholder="Mã ổ cắm, mã máy, tủ, vị trí / 搜索插座、设备、柜、位置" aria-label="Tìm lộ điện"></label>
    <div id="kq"></div>`
      : `<p class="empty card">${bi('Chưa có dữ liệu lộ dây. Mở Google Sheets → tab TuDien nhập các tủ điện, tab LoDien nhập ổ cắm / máy và lộ cấp nguồn.', '暂无线路数据。请在 Google 表格 TuDien 页录入配电柜，LoDien 页录入插座/设备及供电回路。')}</p>`}
    <p class="note">${LOTO}</p>`;
  if (!tus.length && !los.length) return;
  $('#goScan').onclick = () => go('#/quet');
  const q = $('#q'), box = $('#kq');
  q.value = sessionStorage.getItem('tb_qd') || '';
  const draw = () => {
    sessionStorage.setItem('tb_qd', q.value);
    const k = q.value.trim().toLowerCase();
    const ft = tus.filter(t => !k || [t.maTu, t.ten, t.viTri, t.cbTong].join(' ').toLowerCase().includes(k));
    const fl = los.filter(l => !k || [l.maDiem, l.loai, l.maTu, l.lo, l.cb, l.viTri, l.pha].join(' ').toLowerCase().includes(k));
    if (!ft.length && !fl.length) { box.innerHTML = `<p class="empty">${bi('Không tìm thấy mục nào', '未找到匹配项')}</p>`; return; }
    box.innerHTML = `
      ${fl.length ? `<h2 class="area-h">${bi('Ổ cắm / máy', '插座 / 设备')} <small>${fl.length}</small></h2>
        <ul class="mlist">${fl.slice(0, LO_MAX).map(loRow).join('')}</ul>${themNua(fl.length - LO_MAX)}` : ''}
      ${ft.length ? `<h2 class="area-h">${bi('Tủ điện', '配电柜')} <small>${ft.length}</small></h2>
        <ul class="mlist">${ft.slice(0, LO_MAX).map(tuRow).join('')}</ul>${themNua(ft.length - LO_MAX)}` : ''}`;
  };
  q.oninput = draw;
  draw();
}

function khongThayDien(MA, laTu) {
  view.innerHTML = `<div class="empty"><p class="plate">${esc(MA)}</p>
    <p>${laTu ? bi('Không tìm thấy tủ điện có mã này. Nhập ở tab TuDien trong Google Sheets.', '未找到该配电柜，请在 Google 表格 TuDien 页录入。')
      : bi('Không tìm thấy điểm điện có mã này. Nhập ở tab LoDien trong Google Sheets.', '未找到该用电点，请在 Google 表格 LoDien 页录入。')}</p>
    <a class="btn" href="#/lo-dien">${bi('Về trang Lộ điện', '返回线路页')}</a>
    <a class="btn" href="#/may/${encodeURIComponent(MA)}">${bi('Thử mở như mã máy', '按设备编号打开')}</a></div>`;
}

async function pagePanel(maTu) {
  const MA = String(maTu).toUpperCase();
  loading();
  let r;
  try { r = await fetchCached('tu_' + MA, () => api.panel(MA)); }
  catch (e) {
    if (e.code !== 'NOT_FOUND') return errorBox(e);
    return khongThayDien(MA, true);
  }
  const d = r.data, t = d.tu, los = d.lo || [], con = d.tuCon || [];
  const anh = imgUrl(t.anh), soDo = firstUrl(t.soDo);
  view.innerHTML = `
    <a class="back" href="#/lo-dien">‹ ${bi('Lộ điện – nguồn', '线路 – 电源')}</a>
    ${r.stale ? staleNote(r.stale) : ''}
    <div class="hero">
      ${anh ? `<div class="photo"><a href="${esc(anh)}" target="_blank" rel="noopener"><img src="${esc(anh)}" alt="Ảnh tủ ${esc(t.maTu)}" loading="lazy" referrerpolicy="no-referrer"></a></div>` : ''}
      <div>
        <span class="plate xl">${esc(t.maTu)}</span>
        <h1>${esc(t.ten) || bi('Tủ điện', '配电柜')}</h1>
        ${duongDanHtml(d.duongDan, t.maTu)}
      </div>
    </div>
    <section class="block">
      <h2 class="sec">${bi('Thông tin tủ', '柜体信息')}</h2>
      <dl class="info">
        ${pwRow('Vị trí', '位置', esc(t.viTri))}
        ${pwRow('CB tổng', '总断路器', esc(t.cbTong))}
        ${pwRow('Cáp cấp vào', '进线电缆', esc(t.dayCap))}
        ${pwRow('Điện áp', '电压', esc(t.dienAp))}
        ${pwRow('Ghi chú', '备注', esc(t.ghiChu))}
      </dl>
      ${soDo ? `<p><a class="btn block" href="${esc(soDo)}" target="_blank" rel="noopener">${bi('Mở sơ đồ tủ', '打开柜体图纸')}</a></p>` : ''}
    </section>
    <section class="block">
      <h2 class="sec">${bi('Các lộ trong tủ', '柜内回路')}<small>${los.length}</small></h2>
      ${los.length ? `<ul class="mlist">${los.map(loRow).join('')}</ul>`
        : `<p class="empty card">${bi('Chưa khai báo lộ nào cho tủ này (tab LoDien).', '本柜尚未登记回路（LoDien 页）。')}</p>`}
    </section>
    ${con.length ? `<section class="block">
      <h2 class="sec">${bi('Tủ nhánh cấp từ tủ này', '下级配电柜')}<small>${con.length}</small></h2>
      <ul class="mlist">${con.map(tuRow).join('')}</ul>
    </section>` : ''}
    <p class="note">${LOTO}</p>`;
}

async function pagePoint(maDiem) {
  const MA = String(maDiem).toUpperCase();
  loading();
  let r;
  try { r = await fetchCached('dien', api.power); } catch (e) { return errorBox(e); }
  const lo = (r.data.lo || []).find(x => x.maDiem === MA);
  if (!lo) return khongThayDien(MA, false);
  const tu = (r.data.tu || []).find(x => x.maTu === lo.maTu) || null;
  const l = viZh(lo.loai);
  view.innerHTML = `
    <a class="back" href="#/lo-dien">‹ ${bi('Lộ điện – nguồn', '线路 – 电源')}</a>
    ${r.stale ? staleNote(r.stale) : ''}
    <div class="hero">
      <div>
        <span class="plate xl">${esc(lo.maDiem)}</span>
        <h1>${esc(lo.viTri) || esc(l.vi)}</h1>
        <p class="s">${bi(esc(l.vi), esc(l.zh))}</p>
      </div>
    </div>
    <section class="block">
      <h2 class="sec">${bi('Nguồn điện', '电源')}</h2>
      ${nguonBox({ tu, lo, duongDan: tu ? chuoiTu(r.data.tu, tu.maTu) : [] })}
    </section>
    ${/thiết bị|máy|设备/i.test(lo.loai) ? `<p><a class="btn block" href="#/may/${encodeURIComponent(lo.maDiem)}">${bi('Mở lý lịch máy cùng mã', '按同编号打开设备履历')}</a></p>` : ''}
    <p class="note">${LOTO}</p>`;
}

/* ===================== Điều hướng ===================== */
const routes = [
  [/^#?\/?$/, pageHome, 'home'],
  [/^#\/may\/(.+)$/, pageMachine, 'home'],
  [/^#\/phieu\/(.+)$/, pageRepair, 'home'],
  [/^#\/bao-tri\/([^/]+)\/(.+)$/, pageMaintDone, 'home'],
  [/^#\/kiem-tra$/, pageChecks, 'check'],
  [/^#\/kiem-tra\/(.+)$/, pageCheck, 'check'],
  [/^#\/tong-quan$/, pageDash, 'dash'],
  [/^#\/quet$/, pageScan, 'scan'],
  [/^#\/them$/, pageMore, 'more'],
  [/^#\/hop-dong(?:\?loc=(\w+))?$/, pageContracts, 'more'],
  [/^#\/hop-dong\/(.+)$/, pageContract, 'more'],
  [/^#\/kiem-dinh(?:\?loc=(\w+))?$/, pageInspections, 'more'],
  [/^#\/nang-luong$/, pageEnergy, 'more'],
  [/^#\/diem\/(.+)$/, pageMeter, 'more'],
  [/^#\/ghi-chi-so\/(.+)$/, pageReading, 'more'],
  [/^#\/lo-dien$/, pagePower, 'more'],
  [/^#\/tu-dien\/(.+)$/, pagePanel, 'more'],
  [/^#\/o-cam\/(.+)$/, pagePoint, 'more'],
  [/^#\/tem$/, pageLabels, 'more']
];
async function route() {
  stopScan();
  banner();
  const h = location.hash || '#/';
  for (const [re, fn, tab] of routes) {
    const m = h.match(re);
    if (!m) continue;
    document.querySelectorAll('.tabbar a').forEach(a => a.classList.toggle('active', a.dataset.tab === tab));
    window.scrollTo(0, 0);
    try { await fn(m[1] ? decodeURIComponent(m[1]) : undefined, m[2] ? decodeURIComponent(m[2]) : undefined); }
    catch (e) { console.error(e); errorBox(e); }
    view.focus({ preventScroll: true });
    return;
  }
  go('#/');
}

/* Có mạng + đã nhớ PIN trong phiên → tự gửi các lần kiểm tra đang chờ */
function tuGui() {
  if (queueAll().length && navigator.onLine && pinNho()) {
    flushQueue().then(res => { if (res.sent && location.hash === '#/kiem-tra') route(); });
  }
}

(function start() {
  $('#co-vi').textContent = C.COMPANY_VI;
  $('#co-zh').textContent = C.COMPANY_ZH;
  const sp = new URLSearchParams(location.search);
  const ma = sp.get('ma');
  if (ma) history.replaceState(null, '', location.pathname + '#/may/' + encodeURIComponent(ma.trim().toUpperCase()));
  const dm = sp.get('diem');
  if (!ma && dm) history.replaceState(null, '', location.pathname + '#/diem/' + encodeURIComponent(dm.trim().toUpperCase()));
  /* Tem tủ điện / ổ cắm (phiên 9) */
  const tuQR = sp.get('tu'), odQR = sp.get('od');
  if (!ma && !dm && tuQR) history.replaceState(null, '', location.pathname + '#/tu-dien/' + encodeURIComponent(tuQR.trim().toUpperCase()));
  if (!ma && !dm && !tuQR && odQR) history.replaceState(null, '', location.pathname + '#/o-cam/' + encodeURIComponent(odQR.trim().toUpperCase()));
  addEventListener('hashchange', route);
  addEventListener('online', () => { banner(); tuGui(); });
  addEventListener('offline', banner);
  addEventListener('pagehide', stopScan);
  document.addEventListener('visibilitychange', () => { if (document.hidden) stopScan(); else if (location.hash === '#/quet') route(); });
  route();
  tuGui();
  if ('serviceWorker' in navigator && location.protocol === 'https:') {
    navigator.serviceWorker.register('service-worker.js').catch(() => { /* bỏ qua */ });
  }
})();
