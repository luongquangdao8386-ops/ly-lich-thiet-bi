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
    throw new ApiError(e, /^Không tìm thấy thiết bị/.test(e) ? 'NOT_FOUND' : /PIN/.test(e) ? 'PIN' : 'SERVER');
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

const api = {
  list: async () => (await get('list')).map(normM),
  async machine(ma) {
    const d = await get('machine', { ma });
    return { machine: normM(d.machine), repairs: (d.repairs || []).map(normR), maintenance: (d.maintenance || []).map(normP), contracts: d.contracts || [] };
  },
  dashboard: () => get('dashboard'),
  contracts: () => get('contracts'),
  addRepair: (pin, data) => post({ action: 'addRepair', pin, data }),
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

/* ===================== Hiển thị chung ===================== */
function banner() {
  const b = $('#banner');
  if (!apiReady()) { b.className = 'banner bad'; b.innerHTML = bi('Chưa cấu hình: điền URL Apps Script vào API_URL trong config.js', '未配置：请在 config.js 的 API_URL 中填写 Apps Script 网址'); b.hidden = false; }
  else if (!navigator.onLine) { b.className = 'banner bad'; b.innerHTML = bi('Không có mạng — đang xem dữ liệu đã lưu, chưa gửi được phiếu', '无网络 — 正在查看已缓存数据，暂无法提交维修单'); b.hidden = false; }
  else b.hidden = true;
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

/* ===================== Trang chi tiết máy ===================== */
async function pageMachine(ma) {
  loading();
  let r;
  try { r = await fetchCached('m_' + ma.toUpperCase(), () => api.machine(ma)); }
  catch (e) {
    if (e.code !== 'NOT_FOUND') return errorBox(e);
    view.innerHTML = `<div class="empty"><p class="plate">${esc(ma)}</p><p>${bi('Không tìm thấy máy có mã này', '未找到该编号的设备')}</p><a class="btn" href="#/">${bi('Về danh sách', '返回列表')}</a></div>`;
    return;
  }
  const { machine: m, repairs, maintenance } = r.data, s = st(m.trangThai);
  const hds = r.data.contracts || [];
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
    <section class="block">
      <h2 class="sec">${bi('Bảo trì định kỳ', '定期保养')}</h2>
      ${pms.length ? `<ul class="pm card">${pms.map(x => `<li>
        <span><b>${esc(x.hangMuc)}</b><br><span class="s">${bi(`Chu kỳ ${esc(x.chuKy)} ngày, lần cuối ${fmtDate(x.lanCuoi) || '—'}`, `周期 ${esc(x.chuKy)} 天，上次 ${fmtDate(x.lanCuoi) || '—'}`)}</span></span>
        <span class="badge ${x.due.cls}">${x.due.html}</span></li>`).join('')}</ul>`
        : `<p class="empty card">${bi('Chưa có hạng mục bảo trì', '暂无保养项目')}</p>`}
    </section>
    ${hds.length ? `<section class="block">
      <h2 class="sec">${bi('Hợp đồng bảo trì', '维保合同')}<small>${bi('thuê ngoài', '外包')}</small></h2>
      <div class="hd-list">${hds.map(hdCard).join('')}</div>
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
}

/* ===================== Form phiếu sửa chữa ===================== */
const MAX_PHOTOS = 3;
function pageRepair(ma) {
  const draftKey = 'tb3_draft_' + ma.toUpperCase();
  const draft = store.get(draftKey, {});
  const val = (k, d = '') => esc(draft[k] ?? d);
  const f = (vi, zh, input, req) => `<label class="field"><span>${bi(vi + (req ? ' <b class="req">*</b>' : ''), zh)}</span>${input}</label>`;
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
      <div class="field"><span>${bi(`Ảnh (tối đa ${MAX_PHOTOS})`, `照片（最多 ${MAX_PHOTOS} 张）`)}</span>
        <div class="photo-in"><label class="btn" id="addPhoto">📷 ${bi('Chụp / chọn ảnh', '拍照 / 选择照片')}<input type="file" id="file" accept="image/*" capture="environment" hidden></label><span id="prevs" class="photo-in"></span></div></div>
      ${f('Mã PIN', 'PIN码', '<input type="password" name="pin" required inputmode="numeric" autocomplete="off" maxlength="12">', 1)}
      <p class="note">${bi('Phiếu đã gửi không sửa/xóa được trên app (lưu hồ sơ truy xuất BRCGS).', '维修单提交后无法在应用内修改/删除（BRCGS 追溯记录）。')}</p>
      <div id="err" role="alert"></div>
      <button class="btn primary block" id="send">${bi('Gửi phiếu', '提交')}</button>
    </form>`;
  const form = $('#rf'), err = $('#err'), btn = $('#send'), fileIn = $('#file');
  const photos = []; // {file, url (sau khi tải lên)}
  const drawPhotos = () => {
    $('#prevs').innerHTML = photos.map((p, i) => `<span class="pthumb"><img src="${p.preview}" alt=""><button type="button" data-i="${i}" aria-label="Bỏ ảnh">×</button></span>`).join('');
    $('#addPhoto').hidden = photos.length >= MAX_PHOTOS;
  };
  fileIn.onchange = () => {
    const file = fileIn.files[0];
    fileIn.value = '';
    if (!file || photos.length >= MAX_PHOTOS) return;
    photos.push({ file, preview: URL.createObjectURL(file) });
    drawPhotos();
  };
  $('#prevs').onclick = e => { const i = e.target.dataset.i; if (i != null) { photos.splice(+i, 1); drawPhotos(); } };
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
      for (let i = 0; i < photos.length; i++) {
        if (photos[i].url) continue;
        setBtn(bi(`Đang tải ảnh ${i + 1}/${photos.length}…`, `正在上传照片 ${i + 1}/${photos.length}…`));
        const b64 = await compressImage(photos[i].file);
        photos[i].url = (await api.uploadPhoto(pin, ma, b64)).url;
      }
      step = 'save';
      setBtn(bi('Đang gửi phiếu…', '正在提交…'));
      const r = await api.addRepair(pin, { ...d, ma, nguoiNhap: d.nguoiThucHien, anh: photos.map(p => p.url) });
      store.set('tb_nguoi', d.nguoiThucHien);
      store.del(draftKey);
      store.del('tb3_m_' + ma.toUpperCase());
      view.innerHTML = `<div class="done"><p>${bi('Đã lưu phiếu sửa chữa', '维修单已保存')}</p><span class="plate">${esc(r.maPhieu)}</span>
        <a class="btn primary" href="#/may/${encodeURIComponent(ma)}">${bi('Xem lý lịch máy', '查看设备履历')}</a></div>`;
    } catch (e2) {
      let html;
      if (e2.code === 'PIN') html = /quá nhiều/.test(e2.message) ? bi('Sai PIN quá nhiều lần, thử lại sau 10 phút', 'PIN错误次数过多，请10分钟后重试') : e2.message === 'Sai mã PIN' ? bi('Sai mã PIN', 'PIN码错误') : bi(esc(e2.message), '服务器未设置PIN');
      else if (e2.code === 'NET' && step === 'save') html = bi('Không nhận được phản hồi từ máy chủ. Mở lịch sử máy kiểm tra phiếu đã lưu chưa trước khi gửi lại, tránh trùng phiếu.', '未收到服务器响应。重新提交前请先查看设备记录，避免重复。');
      else if (e2.code === 'NET') html = bi('Không gửi được. Kiểm tra mạng rồi thử lại.', '发送失败，请检查网络后重试。');
      else html = bi('Gửi không thành công: ' + esc(e2.message), '提交失败');
      err.innerHTML = msgBad(html);
    } finally {
      if (btn.isConnected) { btn.disabled = false; setBtn(bi('Gửi phiếu', '提交')); }
    }
  };
  drawPhotos();
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
  view.innerHTML = `
    <h1 style="margin:0 0 12px">${bi('Tổng quan', '概览')}</h1>
    ${r.stale ? staleNote(r.stale) : ''}
    ${hdHet + hdSap ? `<a class="alert ${hdHet ? 'bad' : 'warn'}" href="#/hop-dong?loc=${hdHet ? 'het' : 'sap'}">
      <b>${hdHet + hdSap}</b>
      <span>${bi(hdHet ? `hợp đồng đã hết hạn (${hdHet}), sắp hết hạn (${hdSap})` : `hợp đồng sắp hết hạn`,
        hdHet ? `份合同已过期 (${hdHet})、即将到期 (${hdSap})` : '份合同即将到期')}</span>
      <span class="go">›</span></a>` : ''}
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
function parseCode(s) {
  s = String(s || '').trim();
  if (!s) return '';
  if (!isUrl(s)) return s.toUpperCase();
  try {
    const u = new URL(s);
    const m = u.searchParams.get('ma') || decodeURIComponent((u.hash.match(/^#\/may\/([^/?]+)/) || [])[1] || '');
    return m.trim().toUpperCase();
  } catch { return ''; }
}
async function pageScan() {
  view.innerHTML = `
    <h1 style="margin:0 0 12px">${bi('Quét mã QR', '扫描二维码')}</h1>
    <div class="scanbox"><video id="cam" playsinline muted></video><div id="h5"></div><div class="reticle" id="ret"></div></div>
    <p id="scanmsg" class="muted" style="text-align:center">${bi('Đang mở camera…', '正在打开摄像头…')}</p>
    <form class="manual" id="manual"><input id="mcode" placeholder="VD: IN-01" aria-label="Nhập mã máy" autocapitalize="characters">
      <button class="btn primary">${bi('Mở', '打开')}</button></form>`;
  $('#manual').onsubmit = e => { e.preventDefault(); const c = parseCode($('#mcode').value); if (c) go('#/may/' + encodeURIComponent(c)); };
  const msg = $('#scanmsg');
  const still = () => location.hash === '#/quet';
  let done = false;
  const found = raw => {
    if (done) return;
    const c = parseCode(raw);
    if (!c) { msg.innerHTML = bi('Mã QR này không phải tem thiết bị', '此二维码不是设备标签'); return; }
    done = true; stopScan(); navigator.vibrate?.(80);
    go('#/may/' + encodeURIComponent(c));
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

/* ===================== In tem QR ===================== */
const appUrlOk = () => /^https:\/\//.test(C.APP_URL || '') && !/ten-cong-ty/.test(C.APP_URL);
async function pageLabels() {
  loading();
  let l;
  try { l = await fetchCached('list', api.list); } catch (e) { return errorBox(e); }
  const list = l.data;
  const areas = [...new Set(list.map(m => m.khuVuc).filter(Boolean))];
  const chosen = new Set(list.map(m => m.ma));
  view.innerHTML = `
    <div class="no-print">
      <h1 style="margin:0 0 12px">${bi('In tem QR', '打印二维码标签')}</h1>
      ${appUrlOk() ? '' : msgBad(bi('Chưa sửa APP_URL trong config.js thành link app thật — tem in ra sẽ sai link. Đã khóa nút In.', '尚未在 config.js 中把 APP_URL 改为真实网址，标签链接将错误，已禁用打印。'))}
      <div class="tem-tools">
        <div class="row2">
          <label class="field"><span>${bi('Khu vực', '区域')}</span><select id="fa"><option value="">Tất cả / 全部</option>${areas.map(a => `<option>${esc(a)}</option>`).join('')}</select></label>
          <label class="field"><span>${bi('Cỡ tem', '标签尺寸')}</span><select id="fs"><option value="30">30 mm</option><option value="40" selected>40 mm</option><option value="50">50 mm</option></select></label>
        </div>
        <label class="field"><span>${bi('Lọc theo mã', '按编号筛选')}</span><input id="fc" type="search" placeholder="VD: IN"></label>
        <div class="card"><label class="picks" style="display:flex;gap:10px;padding:10px 14px;border-bottom:1px solid var(--line)"><input type="checkbox" id="all" checked> <b>${bi('Chọn tất cả', '全选')}</b></label><div class="picks" id="picks"></div></div>
        <button class="btn primary block" id="print" ${appUrlOk() ? '' : 'disabled'}>${bi('In tem', '打印')} (<span id="n"></span>)</button>
        <p class="note">${bi('Link trong tem: ', '标签链接：')}<b>${esc(C.APP_URL)}?ma=…</b></p>
        <p class="note">${bi('Tem decal PVC hoặc nhôm, chịu dầu và nhiệt. Không dán ở vị trí có thể rơi vào sản phẩm; đưa tem vào danh mục kiểm soát vật lạ.', '使用PVC或铝质标签，耐油耐热。勿贴在可能掉入产品的位置；纳入异物管控清单。')}</p>
      </div>
      <h2 class="sec">${bi('Xem trước', '预览')}</h2>
    </div>
    <div class="sheet" id="sheet"></div>`;
  const fa = $('#fa'), fc = $('#fc'), fs = $('#fs');
  const visible = () => list.filter(m => (!fa.value || m.khuVuc === fa.value) && (!fc.value.trim() || m.ma.toLowerCase().includes(fc.value.trim().toLowerCase())));
  const drawSheet = () => {
    const v = visible().filter(m => chosen.has(m.ma));
    $('#n').textContent = v.length;
    const sheet = $('#sheet');
    if (!v.length) { sheet.innerHTML = `<p class="empty">${bi('Chưa chọn máy nào', '未选择设备')}</p>`; return; }
    sheet.innerHTML = v.map((m, i) => `<div class="tem" style="--s:${fs.value}mm">
      <div class="qr" id="qr${i}"></div>
      <div class="code">${LOGO}${esc(m.ma)}</div>
      <div class="name">${esc(m.ten)}</div>
      <div class="hint">Quét để xem lý lịch<br>扫码查看履历</div></div>`).join('');
    if (!window.QRCode) { sheet.insertAdjacentHTML('afterbegin', msgBad(bi('Chưa tải được bộ tạo mã QR (cần mạng).', '二维码生成组件未加载（需要网络）。'))); return; }
    const base = C.APP_URL.replace(/\/?$/, '/');
    v.forEach((m, i) => new QRCode($('#qr' + i), { text: base + '?ma=' + encodeURIComponent(m.ma), width: 256, height: 256, correctLevel: QRCode.CorrectLevel.M }));
  };
  const drawPicks = () => {
    const v = visible();
    $('#picks').innerHTML = v.map(m => `<label><input type="checkbox" value="${esc(m.ma)}" ${chosen.has(m.ma) ? 'checked' : ''}> <span class="plate">${esc(m.ma)}</span> ${esc(m.ten)}</label>`).join('');
    $('#all').checked = v.length > 0 && v.every(m => chosen.has(m.ma));
    drawSheet();
  };
  fa.onchange = drawPicks; fc.oninput = drawPicks; fs.onchange = drawSheet;
  $('#picks').onchange = e => { e.target.checked ? chosen.add(e.target.value) : chosen.delete(e.target.value); drawPicks(); };
  $('#all').onchange = e => { visible().forEach(m => e.target.checked ? chosen.add(m.ma) : chosen.delete(m.ma)); drawPicks(); };
  $('#print').onclick = () => window.print();
  if (!window.QRCode) window.addEventListener('load', drawSheet, { once: true });
  drawPicks();
}

/* ===================== Điều hướng ===================== */
const routes = [
  [/^#?\/?$/, pageHome, 'home'],
  [/^#\/may\/(.+)$/, pageMachine, 'home'],
  [/^#\/phieu\/(.+)$/, pageRepair, 'home'],
  [/^#\/tong-quan$/, pageDash, 'dash'],
  [/^#\/quet$/, pageScan, 'scan'],
  [/^#\/them$/, pageMore, 'more'],
  [/^#\/hop-dong(?:\?loc=(\w+))?$/, pageContracts, 'more'],
  [/^#\/hop-dong\/(.+)$/, pageContract, 'more'],
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
    try { await fn(m[1] ? decodeURIComponent(m[1]) : undefined); } catch (e) { console.error(e); errorBox(e); }
    view.focus({ preventScroll: true });
    return;
  }
  go('#/');
}

(function start() {
  $('#co-vi').textContent = C.COMPANY_VI;
  $('#co-zh').textContent = C.COMPANY_ZH;
  const ma = new URLSearchParams(location.search).get('ma');
  if (ma) history.replaceState(null, '', location.pathname + '#/may/' + encodeURIComponent(ma.trim().toUpperCase()));
  addEventListener('hashchange', route);
  addEventListener('online', banner);
  addEventListener('offline', banner);
  addEventListener('pagehide', stopScan);
  document.addEventListener('visibilitychange', () => { if (document.hidden) stopScan(); else if (location.hash === '#/quet') route(); });
  route();
  if ('serviceWorker' in navigator && location.protocol === 'https:') {
    navigator.serviceWorker.register('service-worker.js').catch(() => { /* bỏ qua */ });
  }
})();
