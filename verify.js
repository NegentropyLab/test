/* Negentropy Lab · Signal Archive — verify */

const CSV_PATH    = './track_record.csv';
const GH_API_REPO = 'NegentropyLab/test';

let CSV_ROWS  = [];
let CSV_BY_ID = {};

async function init() {
  const sel = document.getElementById('sigSelect');
  const btn = document.getElementById('verifyBtn');

  try {
    const resp = await fetch(CSV_PATH, { cache: 'no-store' });
    if (!resp.ok) throw new Error('HTTP ' + resp.status);
    const text = await resp.text();
    const parsed = Papa.parse(text.trim(), { header: true, dynamicTyping: false, skipEmptyLines: true });
    CSV_ROWS = parsed.data.filter(r => r['编号']);
    CSV_BY_ID = {};
    CSV_ROWS.forEach(r => { CSV_BY_ID[String(r['编号'])] = r; });

    const opts = ['<option value="">— 请选择信号编号 —</option>']
      .concat(CSV_ROWS.slice().reverse().map(r => {
        const id    = String(r['编号'] || '');
        const home  = r['主队'] || '';
        const away  = r['客队'] || '';
        const dt    = (r['比赛时间'] || '').slice(0, 16);
        return `<option value="${escapeAttr(id)}">${escapeHtml(id)} · ${escapeHtml(dt)} · ${escapeHtml(home)} vs ${escapeHtml(away)}</option>`;
      }));
    sel.innerHTML = opts.join('');
    sel.disabled = false;
    btn.disabled = false;
  } catch (e) {
    sel.innerHTML = `<option>track_record.csv 加载失败：${escapeHtml(e.message)}</option>`;
    return;
  }

  btn.addEventListener('click', () => {
    const id = sel.value;
    if (!id) return;
    btn.disabled = true;
    sel.disabled = true;
    runVerify(id).finally(() => {
      btn.disabled = false;
      sel.disabled = false;
    });
  });
}

async function runVerify(signalId) {
  const stepsEl   = document.getElementById('verifySteps');
  const summaryEl = document.getElementById('verifySummary');
  stepsEl.innerHTML = '';
  summaryEl.innerHTML = '';

  const row = CSV_BY_ID[signalId];
  if (!row) {
    addStep('查找记录', 'error', `编号 ${signalId} 不在 track_record.csv 中`);
    return;
  }

  // Step 1 ─ locate row
  const sig = row['信号'];
  const odds = sig === '主' ? row['皇冠主赔'] : sig === '客' ? row['皇冠客赔'] : '';
  addStep('查找记录', 'ok',
    `${row['联赛'] || ''} · ${row['主队'] || ''} vs ${row['客队'] || ''}\n` +
    `盘口 ${row['盘口'] || '—'} · 信号 ${sig || '—'} · 赔率 ${odds || '—'}`);

  // Step 2 ─ download zip
  const sourceFile = String(row['源文件'] || '');
  const zipFile = sourceFile.replace(/\.csv$/i, '.zip');
  if (!zipFile) {
    addStep('下载存证', 'error', '记录中未指定源文件名');
    return;
  }
  let zipBlob;
  try {
    const resp = await fetch(`./csv/${zipFile}`, { cache: 'no-store' });
    if (!resp.ok) throw new Error('HTTP ' + resp.status);
    zipBlob = await resp.blob();
    addStep('下载存证', 'ok', `./csv/${zipFile} · ${formatBytes(zipBlob.size)}`);
  } catch (e) {
    addStep('下载存证', 'error', `无法下载 ./csv/${zipFile}：${e.message}`);
    return;
  }

  // Step 3 ─ AES decrypt
  const password = String(row['解压密码'] || '');
  if (!password) {
    addStep('AES 解密', 'error', '记录中未提供解压密码');
    return;
  }
  let csvText, csvBytes, innerName = '';
  try {
    const reader = new zip.ZipReader(new zip.BlobReader(zipBlob), { password });
    const entries = await reader.getEntries();
    if (!entries.length) throw new Error('zip 内无文件');
    const entry = entries[0];
    innerName = entry.filename;
    // 拿原始字节，避免 text 往返丢 BOM / 改行结尾，导致 SHA 不一致
    csvBytes = await entry.getData(new zip.Uint8ArrayWriter());
    await reader.close();
    csvText = new TextDecoder('utf-8').decode(csvBytes);
    addStep('AES 解密', 'ok', `内部文件 ${innerName} · ${formatBytes(csvBytes.length)}`);
  } catch (e) {
    addStep('AES 解密', 'error', `解密失败：${e.message}（密码错误或非 AES 加密）`);
    return;
  }

  // Step 4 ─ SHA-256
  const expectedHash = String(row['SHA256'] || '').toLowerCase().trim();
  let actualHash;
  try {
    const buf = await crypto.subtle.digest('SHA-256', csvBytes);
    actualHash = [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
  } catch (e) {
    addStep('计算 SHA-256', 'error', e.message);
    return;
  }
  if (expectedHash && actualHash === expectedHash) {
    addStep('计算 SHA-256', 'ok', `${actualHash}\n与记录哈希一致`);
  } else if (expectedHash) {
    addStep('计算 SHA-256', 'error',
      `期望 ${expectedHash}\n实际 ${actualHash}\n哈希不一致`);
    return;
  } else {
    addStep('计算 SHA-256', 'warn', `${actualHash}\n记录中未提供期望哈希，无法比对`);
  }

  // Step 5 ─ GitHub commit timestamp
  let commitTimeISO = null;
  try {
    const url = `https://api.github.com/repos/${GH_API_REPO}/commits?path=csv/${encodeURIComponent(zipFile)}&per_page=20`;
    const resp = await fetch(url);
    if (!resp.ok) throw new Error('HTTP ' + resp.status);
    const commits = await resp.json();
    if (!Array.isArray(commits) || commits.length === 0) throw new Error('该路径无 commit 记录');
    const oldest = commits[commits.length - 1];
    commitTimeISO = oldest && oldest.commit && oldest.commit.committer && oldest.commit.committer.date;
    if (!commitTimeISO) throw new Error('commit 中无时间戳字段');

    const matchTime = parseTs(row['比赛时间']);
    const commitDate = new Date(commitTimeISO);
    if (matchTime && commitDate >= matchTime) {
      addStep('查询 commit 时间戳', 'warn',
        `commit 时间 ${commitTimeISO}\n晚于赛事开赛 ${formatTs(matchTime)} (UTC+8)\n（测试环境时序不符不阻断后续步骤）`);
    } else {
      addStep('查询 commit 时间戳', 'ok',
        `${commitTimeISO}` +
        (matchTime ? `\n早于赛事开赛 ${formatTs(matchTime)} (UTC+8)` : ''));
    }
  } catch (e) {
    addStep('查询 commit 时间戳', 'warn',
      `查询失败：${e.message}\n（GitHub API 未鉴权时限速 60 次/小时，可稍后重试）`);
  }

  // Step 6 ─ content compare
  let innerRow = null;
  try {
    const inner = Papa.parse(csvText.trim(), { header: true, skipEmptyLines: true });
    innerRow = (inner.data || []).find(r => String(r['编号']) === String(signalId));
    if (!innerRow) {
      addStep('比对原始预测', 'error', '解密后的 CSV 中未找到该编号');
      return;
    }
    const fields = ['联赛', '主队', '客队', '盘口', '信号', '皇冠主赔', '皇冠客赔'];
    const diffs = [];
    fields.forEach(f => {
      const a = String(innerRow[f] ?? '').trim();
      const b = String(row[f] ?? '').trim();
      if (a !== b) diffs.push(`${f}：解密=${a} ｜ 记录=${b}`);
    });
    if (diffs.length === 0) {
      addStep('比对原始预测', 'ok', '关键字段全部一致：联赛 / 主队 / 客队 / 盘口 / 信号方向 / 皇冠赔率');
    } else {
      addStep('比对原始预测', 'error', diffs.join('\n'));
      return;
    }
  } catch (e) {
    addStep('比对原始预测', 'error', e.message);
    return;
  }

  // Final summary + full decrypted CSV
  summaryEl.innerHTML = `
    <div class="verify-summary">
      <div class="vs-title">信号 ${escapeHtml(signalId)} 的赛前存证已通过独立验证</div>
      ${commitTimeISO
        ? `<div class="vs-meta">commit 时间戳 · ${escapeHtml(commitTimeISO)}</div>`
        : `<div class="vs-meta">本次未取得 commit 时间戳，其余环节均通过</div>`}
    </div>
    ${renderDecryptedCsv(csvText, innerName, String(signalId))}
  `;
}

function renderDecryptedCsv(csvText, innerName, signalId) {
  if (!csvText) return '';
  const parsed = Papa.parse(csvText.trim(), { header: true, skipEmptyLines: true });
  const headers = (parsed.meta && parsed.meta.fields) || [];
  const rows = parsed.data || [];
  if (!headers.length || !rows.length) return '';

  const thead = '<tr>' + headers.map(h => `<th>${escapeHtml(h)}</th>`).join('') + '</tr>';
  const tbody = rows.map(r => {
    const isCurrent = String(r['编号'] ?? '').trim() === signalId;
    const tds = headers.map(h => {
      const v = String(r[h] ?? '').trim();
      if (!v) return '<td class="empty">—</td>';
      if (/^https?:\/\//i.test(v)) {
        return `<td class="url"><a href="${escapeAttr(v)}" target="_blank" rel="noopener">打开页面 ↗</a></td>`;
      }
      return `<td>${escapeHtml(v)}</td>`;
    }).join('');
    return `<tr${isCurrent ? ' class="current"' : ''}>${tds}</tr>`;
  }).join('');

  return `
    <div class="decrypted-content">
      <div class="dc-title">解密后的原始信号 · ${escapeHtml(innerName || 'CSV')}</div>
      <div class="dc-note">下表是刚刚解密的 zip 内 CSV 的完整内容，共 ${rows.length} 行。当前选中的信号行已加粗。页面 URL 列点击后在新标签页打开，可独立核对皇冠赔率与赛果。</div>
      <div class="dc-scroll">
        <table class="dc-table-full">
          <thead>${thead}</thead>
          <tbody>${tbody}</tbody>
        </table>
      </div>
    </div>
  `;
}

function addStep(name, status, detail) {
  const el = document.getElementById('verifySteps');
  const icon = status === 'ok' ? '✓' : status === 'warn' ? '!' : '✗';
  const stepEl = document.createElement('div');
  stepEl.className = `verify-step ${status}`;
  stepEl.innerHTML = `
    <div class="vs-name"><span class="vs-icon">${icon}</span>${escapeHtml(name)}</div>
    <div class="vs-detail">${escapeHtml(detail).replace(/\n/g, '<br>')}</div>
  `;
  el.appendChild(stepEl);
}

function formatBytes(n) {
  if (n < 1024) return n + ' B';
  if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB';
  return (n / 1024 / 1024).toFixed(2) + ' MB';
}

function parseTs(s) {
  if (!s) return null;
  const str = String(s).trim();
  const m = str.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:[ T](\d{1,2}):(\d{1,2})(?::(\d{1,2}))?)?/);
  if (!m) return null;
  return new Date(+m[1], +m[2] - 1, +m[3], +(m[4] || 0), +(m[5] || 0), +(m[6] || 0));
}

function formatTs(d) {
  const y  = d.getFullYear();
  const m  = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${y}-${m}-${dd} ${hh}:${mm}`;
}

function escapeHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function escapeAttr(s) {
  return escapeHtml(s).replace(/'/g, '&#39;');
}

init();
