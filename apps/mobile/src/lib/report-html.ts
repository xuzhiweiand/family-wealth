/**
 * 报表 HTML 导出（P0-5）
 *
 * 生成自包含、内联 CSS 的单文件 HTML：无外部资源，离线可打开，
 * 走 file-export.ts 统一通道（Android 系统分享 / 鸿蒙系统另存为）。
 * 排版口径：移动端友好的 640px 居中版式，A 股配色（涨红跌绿）。
 *
 * 数字直接来自 lib/report.ts 的装配结果，不重复计算 ——
 * 与 App 内预览、主页、月度台账保持同一份口径。
 */

import { formatCNY } from '@family-wealth/shared-utils';
import type { CategorySlice } from './asset-meta';
import type { MonthlyReport, YearlyReport } from './report';

const SOURCE_LABELS: Record<string, string> = {
  manual: '手动',
  ocr: 'OCR',
  import: '导入',
  api: '接口',
};

function escapeHtml(raw: string): string {
  return raw
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** 金额 + 涨跌配色（分）；null 占位 */
function money(amount: number | null): string {
  return amount === null ? '—' : formatCNY(amount);
}

function delta(amount: number | null): string {
  if (amount === null) return '<span class="muted">—</span>';
  const cls = amount >= 0 ? 'up' : 'down';
  const sign = amount >= 0 ? '+' : '';
  return `<span class="${cls}">${sign}${formatCNY(amount)}</span>`;
}

function pct(p: number | null): string {
  if (p === null) return '<span class="muted">—</span>';
  const cls = p >= 0 ? 'up' : 'down';
  const sign = p >= 0 ? '+' : '';
  return `<span class="${cls}">${sign}${p.toFixed(2)}%</span>`;
}

function slicesRows(slices: readonly CategorySlice[], debtAmount: number, debtShare: number): string {
  const rows = slices.map(
    (s) => `<tr>
      <td><span class="dot" style="background:${s.color}"></span>${escapeHtml(s.label)}</td>
      <td class="num">${money(s.amount)}</td>
      <td class="num">${s.pct.toFixed(1)}%</td>
      <td class="bar-cell"><div class="bar-track"><div class="bar" style="width:${Math.max(2, s.pct)}%;background:${s.color}"></div></div></td>
    </tr>`,
  );
  if (debtAmount > 0) {
    rows.push(`<tr>
      <td><span class="dot" style="background:#EF4444"></span>债务</td>
      <td class="num down">${money(debtAmount)}</td>
      <td class="num down">-${debtShare.toFixed(1)}%</td>
      <td class="bar-cell"><div class="bar-track"><div class="bar" style="width:${Math.max(2, debtShare)}%;background:#EF4444"></div></div></td>
    </tr>`);
  }
  return rows.join('');
}

function monthLabel(month: string): string {
  return `${Number(month.slice(0, 4))} 年 ${Number(month.slice(5, 7))} 月`;
}

function generatedLine(at: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `由家资 App 生成 · ${at.getFullYear()}-${p(at.getMonth() + 1)}-${p(at.getDate())} ${p(at.getHours())}:${p(at.getMinutes())}`;
}

const STYLE = `
  * { margin:0; padding:0; box-sizing:border-box; }
  body { font-family:-apple-system,"PingFang SC","HarmonyOS Sans SC","Microsoft YaHei",sans-serif;
    background:#F9FAFB; color:#111827; padding:24px 16px 48px; }
  .page { max-width:640px; margin:0 auto; }
  header { text-align:center; margin-bottom:24px; }
  header h1 { font-size:22px; font-weight:700; }
  header .sub { color:#6B7280; font-size:14px; margin-top:6px; }
  .card { background:#fff; border:1px solid #E5E7EB; border-radius:14px;
    padding:16px 18px; margin-bottom:16px; }
  .card h2 { font-size:15px; font-weight:700; margin-bottom:12px; }
  .cards3 { display:flex; gap:10px; margin-bottom:16px; }
  .cards3 .cell { flex:1; background:#fff; border:1px solid #E5E7EB; border-radius:14px;
    padding:14px 12px; text-align:center; }
  .cards3 .label { font-size:12px; color:#9CA3AF; }
  .cards3 .value { font-size:16px; font-weight:700; margin-top:6px; word-break:break-all; }
  table { width:100%; border-collapse:collapse; font-size:13px; }
  th { text-align:left; color:#9CA3AF; font-weight:500; font-size:12px;
    padding:6px 4px; border-bottom:1px solid #F3F4F6; }
  td { padding:8px 4px; border-bottom:1px solid #F9FAFB; }
  .num { text-align:right; font-variant-numeric:tabular-nums; }
  th.num { text-align:right; }
  .up { color:#DC2626; }
  .down { color:#16A34A; }
  .muted { color:#9CA3AF; }
  .dot { display:inline-block; width:8px; height:8px; border-radius:4px; margin-right:6px; }
  .bar-cell { width:34%; }
  .bar-track { height:8px; border-radius:99px; background:#F3F4F6; overflow:hidden; }
  .bar { height:100%; border-radius:99px; }
  .placeholder { color:#9CA3AF; font-size:13px; text-align:center; padding:18px 0; }
  .event { display:flex; justify-content:space-between; padding:8px 0;
    border-bottom:1px solid #F9FAFB; font-size:13px; }
  .event:last-child { border-bottom:none; }
  .tag { font-size:11px; border-radius:99px; padding:2px 8px; margin-right:8px; }
  .tag.added { background:#D1FAE5; color:#059669; }
  .tag.archived { background:#F3F4F6; color:#6B7280; }
  footer { text-align:center; color:#9CA3AF; font-size:12px; margin-top:8px; }
`;

function htmlShell(title: string, body: string, generatedAt: Date): string {
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>${STYLE}</style>
</head>
<body><div class="page">
${body}
<footer>${generatedLine(generatedAt)}</footer>
</div></body>
</html>`;
}

export interface ReportHtmlOptions {
  generatedAt?: Date;
}

export function buildMonthlyReportHtml(report: MonthlyReport, options: ReportHtmlOptions = {}): string {
  const generatedAt = options.generatedAt ?? new Date();
  const title = `家资月报 · ${monthLabel(report.month)}`;

  if (!report.hasData || report.totals === null) {
    return htmlShell(
      title,
      `<header><h1>月度资产报表</h1><div class="sub">${monthLabel(report.month)}</div></header>
<div class="card"><div class="placeholder">本月还没有快照数据</div></div>`,
      generatedAt,
    );
  }

  const t = report.totals;
  const momSection =
    report.prevTotals !== null
      ? `<div class="card"><h2>环比 ${monthLabel(report.prevMonth ?? '')}</h2>
<table><thead><tr><th>指标</th><th class="num">本月</th><th class="num">上月</th><th class="num">变化</th></tr></thead><tbody>
<tr><td>净资产</td><td class="num">${money(t.netWorth)}</td><td class="num">${money(report.prevTotals.netWorth)}</td><td class="num">${delta(report.netWorthDelta)}（${pct(report.netWorthPct)}）</td></tr>
<tr><td>总资产</td><td class="num">${money(t.totalAssets)}</td><td class="num">${money(report.prevTotals.totalAssets)}</td><td class="num">${delta(report.assetsDelta)}</td></tr>
<tr><td>总负债</td><td class="num">${money(t.totalLiabilities)}</td><td class="num">${money(report.prevTotals.totalLiabilities)}</td><td class="num">${delta(report.liabilitiesDelta)}</td></tr>
</tbody></table></div>`
      : `<div class="card"><div class="placeholder">上月无数据，暂无环比</div></div>`;

  const slicesSection =
    report.slices.length > 0
      ? `<div class="card"><h2>配置分布</h2>
<table><thead><tr><th>类别</th><th class="num">金额</th><th class="num">占比</th><th></th></tr></thead>
<tbody>${slicesRows(report.slices, report.debtAmount, report.debtShare)}</tbody></table></div>`
      : '';

  const rowsSection =
    report.rows.length > 0
      ? `<div class="card"><h2>本月快照明细（${report.rows.length} 条）</h2>
<table><thead><tr><th>日期</th><th>资产</th><th>类别</th><th class="num">金额</th><th>来源</th></tr></thead><tbody>
${report.rows
  .map(
    (r) => `<tr><td>${escapeHtml(r.capturedAt.slice(0, 10))}</td><td>${escapeHtml(r.assetName)}</td><td>${escapeHtml(r.typeLabel)}</td><td class="num">${money(r.amount)}</td><td>${SOURCE_LABELS[r.source] ?? escapeHtml(r.source)}</td></tr>`,
  )
  .join('')}
</tbody></table></div>`
      : '';

  return htmlShell(
    title,
    `<header><h1>月度资产报表</h1><div class="sub">${monthLabel(report.month)}</div></header>
<div class="cards3">
  <div class="cell"><div class="label">净资产</div><div class="value">${money(t.netWorth)}</div></div>
  <div class="cell"><div class="label">总资产</div><div class="value">${money(t.totalAssets)}</div></div>
  <div class="cell"><div class="label">总负债</div><div class="value">${money(t.totalLiabilities)}</div></div>
</div>
${momSection}
${slicesSection}
${rowsSection}`,
    generatedAt,
  );
}

export function buildYearlyReportHtml(report: YearlyReport, options: ReportHtmlOptions = {}): string {
  const generatedAt = options.generatedAt ?? new Date();
  const title = `家资年报 · ${report.year} 年`;

  if (!report.hasData) {
    return htmlShell(
      title,
      `<header><h1>年度资产报表</h1><div class="sub">${escapeHtml(report.year)} 年</div></header>
<div class="card"><div class="placeholder">本年还没有快照数据</div></div>`,
      generatedAt,
    );
  }

  const compareSection = `<div class="card"><h2>年初年末对比（${monthLabel(report.beginMonth ?? '')} → ${monthLabel(report.endMonth ?? '')}）</h2>
<table><thead><tr><th>指标</th><th class="num">年初</th><th class="num">年末</th><th class="num">变化</th></tr></thead><tbody>
<tr><td>净资产</td><td class="num">${money(report.beginTotals?.netWorth ?? null)}</td><td class="num">${money(report.endTotals?.netWorth ?? null)}</td><td class="num">${delta(report.netWorthDelta)}（${pct(report.netWorthPct)}）</td></tr>
<tr><td>总资产</td><td class="num">${money(report.beginTotals?.totalAssets ?? null)}</td><td class="num">${money(report.endTotals?.totalAssets ?? null)}</td><td class="num">${delta(report.assetsDelta)}</td></tr>
<tr><td>总负债</td><td class="num">${money(report.beginTotals?.totalLiabilities ?? null)}</td><td class="num">${money(report.endTotals?.totalLiabilities ?? null)}</td><td class="num">${delta(report.liabilitiesDelta)}</td></tr>
</tbody></table></div>`;

  const trendSection =
    report.monthlyTrend.length > 0
      ? `<div class="card"><h2>月度趋势</h2>
<table><thead><tr><th>月份</th><th class="num">净资产</th><th class="num">总资产</th><th class="num">总负债</th></tr></thead><tbody>
${report.monthlyTrend
  .map(
    (p) => `<tr><td>${Number(p.date.slice(5, 7))} 月</td><td class="num">${money(p.netWorth)}</td><td class="num">${money(p.totalAssets)}</td><td class="num">${money(p.totalLiabilities)}</td></tr>`,
  )
  .join('')}
</tbody></table></div>`
      : '';

  // 配置变化：年初/年末切片按类别取并集
  const beginPct = new Map(report.beginSlices.map((s) => [s.label, s.pct]));
  const endPct = new Map(report.endSlices.map((s) => [s.label, s.pct]));
  const labels = [...new Set([...report.beginSlices, ...report.endSlices].map((s) => s.label))];
  const allocSection =
    labels.length > 0
      ? `<div class="card"><h2>配置变化（占总资产）</h2>
<table><thead><tr><th>类别</th><th class="num">年初</th><th class="num">年末</th></tr></thead><tbody>
${labels
  .map((l) => {
    const b = beginPct.get(l);
    const e = endPct.get(l);
    return `<tr><td>${escapeHtml(l)}</td><td class="num">${b === undefined ? '—' : `${b.toFixed(1)}%`}</td><td class="num">${e === undefined ? '—' : `${e.toFixed(1)}%`}</td></tr>`;
  })
  .join('')}
</tbody></table></div>`
      : '';

  const eventsSection =
    report.events.length > 0 || report.topMovers.length > 0
      ? `<div class="card"><h2>年度大事记</h2>
${report.events
  .map(
    (e) => `<div class="event"><span><span class="tag ${e.kind}">${e.kind === 'added' ? '新增' : '归档'}</span>${escapeHtml(e.assetName)}<span class="muted">（${escapeHtml(e.typeLabel)}）</span></span><span class="muted">${escapeHtml(e.at.slice(0, 10))}</span></div>`,
  )
  .join('')}
${
  report.topMovers.length > 0
    ? `<table style="margin-top:10px"><thead><tr><th>变化最大</th><th class="num">年初首笔</th><th class="num">年末末笔</th><th class="num">变化</th></tr></thead><tbody>
${report.topMovers
  .map(
    (m) => `<tr><td>${escapeHtml(m.assetName)}</td><td class="num">${money(m.firstAmount)}</td><td class="num">${money(m.lastAmount)}</td><td class="num">${delta(m.delta)}</td></tr>`,
  )
  .join('')}
</tbody></table></div>`
    : ''
}`
      : '';

  return htmlShell(
    title,
    `<header><h1>年度资产报表</h1><div class="sub">${escapeHtml(report.year)} 年</div></header>
${compareSection}
${trendSection}
${allocSection}
${eventsSection}`,
    generatedAt,
  );
}
