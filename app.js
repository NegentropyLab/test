/* Negentropy Lab · Signal Archive — main script */

const ARCHIVED = false;
const ARCHIVED_DATE = null; // Set to 'YYYY-MM-DD' when archiving

const SAMPLE_STAGES = {
  0:    ['total_signals'],
  100:  ['total_signals', 'win_rate', 'roi', 'avg_odds'],
  500:  ['total_signals', 'win_rate', 'roi', 'avg_odds', 'profit_factor', 'max_drawdown', 'longest_streak'],
  1000: 'all'
};

const ALL_STATS = ['total_signals', 'win_rate', 'roi', 'avg_odds', 'profit_factor', 'max_drawdown', 'longest_streak'];

const STAT_LABELS = {
  total_signals:  '累计信号',
  win_rate:       '胜率',
  roi:            'ROI',
  avg_odds:       '平均赔率',
  profit_factor:  '盈利因子',
  max_drawdown:   '最大回撤',
  longest_streak: '最长连胜'
};

const CSV_PATH = './track_record.csv';
const PAGE_SIZE = 50;

let ALL_ROWS = [];
let SORTED_ROWS = [];
let DISPLAY_COUNT = PAGE_SIZE;

async function main() {
  renderArchiveBanner();

  let csvText;
  try {
    const resp = await fetch(CSV_PATH, { cache: 'no-store' });
    if (!resp.ok) throw new Error('fetch failed: ' + resp.status);
    csvText = await resp.text();
  } catch (e) {
    setLoadingMsg('无法读取 track_record.csv');
    return;
  }

  const parsed = Papa.parse(csvText.trim(), {
    header: true,
    dynamicTyping: true,
    skipEmptyLines: true
  });

  ALL_ROWS = parsed.data.map(normalizeRow).filter(r => r.signalId != null);
  const settled = ALL_ROWS.filter(r => r.result && r.result.length > 0 && !isNaN(r.pnl));

  if (ALL_ROWS.length === 0) {
    setLoadingMsg('暂无记录');
    return;
  }

  renderStateLine(ALL_ROWS);
  renderEquityCurve(settled);
  renderStats(settled);
  renderHeatmap(ALL_ROWS);
  renderTable(ALL_ROWS);
}

function normalizeRow(r) {
  const side = r['信号'];
  const rawOdds = side === '主' ? r['皇冠主赔'] : side === '客' ? r['皇冠客赔'] : null;
  const odds = rawOdds == null || rawOdds === '' ? null : parseFloat(rawOdds);
  return {
    signalId:    r['编号'],
    signalTime:  r['信号时间'],
    matchTime:   r['比赛时间'],
    league:      r['联赛'],
    home:        r['主队'],
    away:        r['客队'],
    homeScore:   r['主队比分'],
    awayScore:   r['客队比分'],
    handicap:    r['盘口'],
    signalSide:  side,
    odds:        odds == null || isNaN(odds) ? null : odds,
    result:      r['赛果'] == null ? '' : String(r['赛果']).trim(),
    pnl:         parseFloat(r['盈亏']),
    balance:     parseFloat(r['余额']),
    stake:       parseFloat(r['下注资金']),
    zipUrl:      r['存证文件URL']
  };
}

function renderArchiveBanner() {
  if (!ARCHIVED) return;
  const banner = document.createElement('div');
  banner.className = 'archive-banner';
  banner.textContent = `本档案已于 ${ARCHIVED_DATE} 封存，内容保持原样。`;
  document.body.insertBefore(banner, document.body.firstChild);
}

function setLoadingMsg(msg) {
  const el = document.getElementById('loading');
  if (el) el.textContent = msg;
}

function renderStateLine(rows) {
  const el = document.getElementById('stateLine');
  if (!el || rows.length === 0) return;

  const firstDate = parseTs(rows[0].signalTime);
  const lastDate  = parseTs(rows[rows.length - 1].signalTime);
  const today = new Date();
  const dayNum = firstDate
    ? Math.max(1, Math.floor((today - firstDate) / 86400000) + 1)
    : 1;

  const lastText = lastDate ? formatDateTime(lastDate) : '—';

  el.innerHTML = `
    <div class="state-item"><span class="state-label">运行</span><span class="state-value">${dayNum} 天</span></div>
    <div class="state-item"><span class="state-label">信号</span><span class="state-value">${rows.length} 条</span></div>
    <div class="state-item"><span class="state-label">更新于</span><span class="state-value">${lastText}</span></div>
  `;
}

function renderEquityCurve(settled) {
  const canvas = document.getElementById('equityChart');
  if (!canvas || settled.length === 0) return;

  const labels = settled.map(r => formatDateOnly(parseTs(r.matchTime) || parseTs(r.signalTime)));
  let cum = 0;
  const data = settled.map(r => {
    const stake = r.stake && r.stake > 0 ? r.stake : null;
    const pnl = isNaN(r.pnl) ? 0 : r.pnl;
    const unit = stake ? pnl / stake : 0;
    cum += unit;
    return Number(cum.toFixed(4));
  });

  const zeroLinePlugin = {
    id: 'zeroLine',
    beforeDatasetsDraw(chart) {
      const { ctx, chartArea, scales } = chart;
      const y0 = scales.y.getPixelForValue(0);
      if (y0 >= chartArea.top && y0 <= chartArea.bottom) {
        ctx.save();
        ctx.strokeStyle = '#B8B6AF';
        ctx.setLineDash([3, 4]);
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(chartArea.left, y0);
        ctx.lineTo(chartArea.right, y0);
        ctx.stroke();
        ctx.restore();
      }
    }
  };

  new Chart(canvas, {
    type: 'line',
    data: {
      labels,
      datasets: [{
        data,
        borderColor: '#1A1A1A',
        borderWidth: 1.5,
        fill: false,
        pointRadius: 0,
        pointHoverRadius: 3,
        pointHoverBackgroundColor: '#1A1A1A',
        tension: 0,
        spanGaps: true
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'nearest', intersect: false },
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: '#FAFAF7',
          titleColor: '#1A1A1A',
          bodyColor: '#1A1A1A',
          borderColor: '#E5E3DC',
          borderWidth: 1,
          titleFont: { family: 'Georgia, serif', weight: '400' },
          bodyFont:  { family: 'SF Mono, monospace' },
          padding: 10,
          displayColors: false,
          callbacks: {
            label: (ctx) => (ctx.raw >= 0 ? '+' : '') + ctx.raw.toFixed(2) + ' 单位'
          }
        }
      },
      scales: {
        x: {
          ticks: {
            color: '#6B6B6B',
            font: { family: 'Georgia, serif', size: 11 },
            maxTicksLimit: 8,
            autoSkip: true,
            maxRotation: 0
          },
          grid: { display: false },
          border: { color: '#E5E3DC' }
        },
        y: {
          ticks: {
            color: '#6B6B6B',
            font: { family: 'SF Mono, monospace', size: 11 },
            callback: (v) => (v >= 0 ? '+' : '') + v
          },
          grid: { color: '#F0EEE7', drawTicks: false, tickLength: 0 },
          border: { color: '#E5E3DC' }
        }
      }
    },
    plugins: [zeroLinePlugin]
  });
}

function computeMetrics(settled) {
  if (settled.length === 0) return {};

  let wins = 0, losses = 0;
  let totalPnL = 0, totalStake = 0;
  let oddsSum = 0, oddsCount = 0;
  let totalWin = 0, totalLoss = 0;
  let peak = -Infinity, maxDD = 0, maxDDPct = 0;
  let curStreak = 0, maxStreak = 0;

  settled.forEach(r => {
    const res = r.result;
    const isWin  = res === '赢' || res === '赢半';
    const isLose = res === '输' || res === '输半';
    if (isWin)  wins++;
    if (isLose) losses++;

    const pnl   = r.pnl   || 0;
    const stake = r.stake || 0;
    totalPnL   += pnl;
    totalStake += stake;
    if (pnl > 0) totalWin  += pnl;
    if (pnl < 0) totalLoss += -pnl;

    const bal = r.balance;
    if (!isNaN(bal)) {
      if (bal > peak) peak = bal;
      const dd = peak - bal;
      if (dd > maxDD) {
        maxDD = dd;
        maxDDPct = peak > 0 ? (dd / peak) * 100 : 0;
      }
    }

    if (r.odds != null && r.odds > 0) { oddsSum += r.odds; oddsCount++; }

    if (isWin)       { curStreak++; if (curStreak > maxStreak) maxStreak = curStreak; }
    else if (isLose) { curStreak = 0; }
  });

  const wrDenom = wins + losses;
  return {
    total_signals:  settled.length,
    win_rate:       wrDenom > 0 ? (wins / wrDenom * 100).toFixed(1) + '%' : '—',
    roi:            totalStake > 0 ? signed(totalPnL / totalStake * 100, 1) + '%' : '—',
    avg_odds:       oddsCount > 0 ? (oddsSum / oddsCount).toFixed(2) : '—',
    profit_factor:  totalLoss > 0 ? (totalWin / totalLoss).toFixed(2) : '—',
    max_drawdown:   maxDD > 0 ? '−' + maxDDPct.toFixed(1) + '%' : '0%',
    longest_streak: String(maxStreak)
  };
}

function renderStats(settled) {
  const el = document.getElementById('statsRow');
  if (!el) return;

  const metrics = computeMetrics(settled);
  const n = settled.length;

  let visible = SAMPLE_STAGES[0];
  Object.keys(SAMPLE_STAGES).map(Number).sort((a, b) => a - b).forEach(k => {
    if (n >= k) visible = SAMPLE_STAGES[k];
  });
  if (visible === 'all') visible = ALL_STATS;

  el.innerHTML = visible.map(key => `
    <div class="stat">
      <div class="stat-label">${STAT_LABELS[key]}</div>
      <div class="stat-value">${metrics[key] ?? '—'}</div>
    </div>
  `).join('');
}

function renderHeatmap(rows) {
  const el = document.getElementById('heatmap');
  if (!el) return;

  const counts = {};
  rows.forEach(r => {
    const d = parseTs(r.signalTime);
    if (!d) return;
    const key = ymd(d);
    counts[key] = (counts[key] || 0) + 1;
  });

  const today = new Date();
  const end = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const start = new Date(end);
  start.setDate(start.getDate() - 52 * 7);
  start.setDate(start.getDate() - start.getDay()); // align to Sunday

  const max = Math.max(0, ...Object.values(counts));
  const cols = [];
  const cursor = new Date(start);

  for (let w = 0; w < 53; w++) {
    let col = '<div class="heatmap-col">';
    for (let d = 0; d < 7; d++) {
      if (cursor <= end) {
        const c = counts[ymd(cursor)] || 0;
        let lvl = 0;
        if (max > 0 && c > 0) {
          const r = c / max;
          if (r <= 0.25) lvl = 1;
          else if (r <= 0.5) lvl = 2;
          else if (r <= 0.75) lvl = 3;
          else lvl = 4;
        }
        col += `<div class="heatmap-cell ${lvl ? 'l' + lvl : ''}"></div>`;
      } else {
        col += '<div class="heatmap-cell" style="visibility:hidden"></div>';
      }
      cursor.setDate(cursor.getDate() + 1);
    }
    col += '</div>';
    cols.push(col);
  }

  el.innerHTML = cols.join('');
}

function renderTable(rows) {
  const tbody = document.getElementById('recordBody');
  const table = document.getElementById('recordTable');
  const loading = document.getElementById('loading');
  if (!tbody || !table) return;

  SORTED_ROWS = [...rows].sort((a, b) => {
    const ta = (parseTs(a.signalTime) || new Date(0)).getTime();
    const tb = (parseTs(b.signalTime) || new Date(0)).getTime();
    if (tb !== ta) return tb - ta;
    return (b.signalId || 0) - (a.signalId || 0);
  });

  if (SORTED_ROWS.length < 200) DISPLAY_COUNT = SORTED_ROWS.length;
  else DISPLAY_COUNT = PAGE_SIZE;

  paintRows();

  const btn = document.getElementById('loadMore');
  if (btn) {
    btn.onclick = () => {
      DISPLAY_COUNT = Math.min(SORTED_ROWS.length, DISPLAY_COUNT + PAGE_SIZE);
      paintRows();
    };
  }

  if (loading) loading.style.display = 'none';
  table.style.display = '';
}

function paintRows() {
  const tbody = document.getElementById('recordBody');
  const btn = document.getElementById('loadMore');
  tbody.innerHTML = SORTED_ROWS.slice(0, DISPLAY_COUNT).map(r => {
    const dateStr = formatDateOnly(parseTs(r.matchTime) || parseTs(r.signalTime));
    const score = (r.homeScore !== undefined && r.homeScore !== null && r.homeScore !== ''
                && r.awayScore !== undefined && r.awayScore !== null && r.awayScore !== '')
      ? `${r.homeScore}–${r.awayScore}` : '—';
    const side = r.signalSide === '主' ? '主' : r.signalSide === '客' ? '客' : '';
    const resultLetter = mapResult(r.result);
    const pnlStr = isNaN(r.pnl) ? '—' : signed(r.pnl, 2);
    const balStr = isNaN(r.balance) ? '—' : r.balance.toFixed(2);
    const oddsStr = r.odds != null ? r.odds.toFixed(2) : '—';
    const zipLink = r.zipUrl
      ? `<a href="${escapeAttr(r.zipUrl)}" target="_blank" rel="noopener">↗</a>`
      : '';
    return `<tr>
      <td class="num">${r.signalId ?? ''}</td>
      <td class="text">${escapeHtml(dateStr)}</td>
      <td class="text">${escapeHtml(r.league ?? '')}</td>
      <td class="text">${escapeHtml(r.home ?? '')}<span class="vs">vs</span>${escapeHtml(r.away ?? '')}</td>
      <td class="num">${escapeHtml(score)}</td>
      <td class="text">${side}</td>
      <td class="text">${escapeHtml(r.handicap ?? '')}</td>
      <td class="num">${oddsStr}</td>
      <td class="text">${resultLetter}</td>
      <td class="num">${pnlStr}</td>
      <td class="num">${balStr}</td>
      <td class="text link">${zipLink}</td>
    </tr>`;
  }).join('');

  if (btn) {
    const remaining = SORTED_ROWS.length - DISPLAY_COUNT;
    if (remaining > 0) {
      btn.style.display = '';
      btn.textContent = `加载更多 · 剩余 ${remaining} 条`;
    } else {
      btn.style.display = 'none';
    }
  }
}

function mapResult(r) {
  switch (r) {
    case '赢':   return '胜';
    case '赢半': return '胜半';
    case '输':   return '负';
    case '输半': return '负半';
    case '走':
    case '平':   return '走';
    default:     return r || '—';
  }
}

function parseTs(s) {
  if (!s) return null;
  const str = String(s).trim();
  const m = str.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:[ T](\d{1,2}):(\d{1,2})(?::(\d{1,2}))?)?/);
  if (!m) return null;
  return new Date(+m[1], +m[2] - 1, +m[3], +(m[4] || 0), +(m[5] || 0), +(m[6] || 0));
}

function ymd(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${dd}`;
}

function formatDateOnly(d) {
  if (!d) return '';
  return ymd(d);
}

function formatDateTime(d) {
  if (!d) return '';
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${ymd(d)} ${hh}:${mm}`;
}

function signed(n, dp) {
  if (n > 0) return '+' + n.toFixed(dp);
  if (n < 0) return '−' + Math.abs(n).toFixed(dp);
  return n.toFixed(dp);
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function escapeAttr(s) {
  return escapeHtml(s).replace(/'/g, '&#39;');
}

main();
