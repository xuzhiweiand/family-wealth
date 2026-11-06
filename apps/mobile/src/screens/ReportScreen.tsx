/**
 * 月度 / 年度资产报表（P0-5，v0.6.0 视觉）
 *
 * 对照 v0.6.0 高保真单页「v0.6.0-report.html」复刻：
 *   页头 → 墨绿 hero（净资产 + 期初/期末/环比）→ 资产构成（占比进度条）
 *   → 月份 / 年份 chips → 报表明细 → 导出 → 隐私说明。
 *
 * 设计稿的「收入 / 支出 / 储蓄率 / 支出构成」在本 App 无流水数据源，
 * 这里用报表内真实指标替换：
 *   - hero 金额 = 当月净资产（年报 = 年末净资产）；
 *   - 三等分 = 期初 / 期末 / 环比（年报 = 年初 / 年末 / 全年）；
 *   - 资产构成 = 当月（年报 = 年末）最新快照口径的分类合计；
 *   - 本月快照明细与年报趋势 / 配置变化 / 大事记等原有内容保留在下方。
 *
 * 数字口径与主页 / 月度台账完全一致（lib/report.ts 复用 buildMonthTotals，
 * 只统计当月有快照的资产、取当月最新快照）；
 * 期间可选范围 = 有快照数据的月份 / 年份，左右箭头保留一期切换；
 * 导出自包含 HTML（内联 CSS、离线可打开），走 file-export 统一通道。
 */

import { COLORS, GOLD_DECOR } from '../theme';
import { MONEY_TEXT, SERIF_CN_TEXT } from '../typography';
import { useMemo, useState } from 'react';
import {
  Alert,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  useWindowDimensions,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { filterVisibleAssets } from '@family-wealth/family';
import { formatCNY, formatCNYCompact } from '@family-wealth/shared-utils';
import { useAuthStore } from '../stores/auth-store';
import { useAssetStore } from '../stores/asset-store';
import { useMyFamilyRole } from '../stores/family-store';
import { GradientCard } from '../components/GradientCard';
import { TrendChart } from '../components/TrendChart';
import {
  availableMonths,
  availableYears,
  buildMonthlyReport,
  buildYearlyReport,
  scopeSnapshots,
  type MonthlyReport,
  type YearlyReport,
} from '../lib/report';
import { buildMonthlyReportHtml, buildYearlyReportHtml } from '../lib/report-html';
import { exportFile } from '../services/file-export';

type Mode = 'month' | 'year';

const SOURCE_LABELS: Record<string, string> = {
  manual: '手动',
  ocr: 'OCR',
  import: '导入',
  api: '接口',
};

const UPPER = COLORS.danger;
const DOWN = COLORS.success;

const CN_MONTHS = [
  '一月', '二月', '三月', '四月', '五月', '六月',
  '七月', '八月', '九月', '十月', '十一月', '十二月',
];

const CN_NUMERALS = ['壹', '贰', '叁', '肆', '伍', '陆', '柒', '捌', '玖', '拾', '拾壹', '拾贰'];

function monthRef(month: string): Date {
  return new Date(Number(month.slice(0, 4)), Number(month.slice(5, 7)) - 1, 1);
}

function monthLabel(month: string): string {
  return `${month.slice(0, 4)} 年 ${Number(month.slice(5, 7))} 月`;
}

/** '2026-10' → '十月'（hero 标签用） */
function monthCN(month: string): string {
  return CN_MONTHS[Number(month.slice(5, 7)) - 1] ?? month;
}

/** '2026-10' → '拾月'（朱砂印章用） */
function monthSeal(month: string): string {
  return `${CN_NUMERALS[Number(month.slice(5, 7)) - 1] ?? month.slice(5, 7)}月`;
}

/** 金额（分）→ '3,356,200'（不带 ¥，供 hero / 三列 / 构成行） */
function amountText(cents: number): string {
  return formatCNY(cents, { fraction: false }).replace('¥', '');
}

/** 环比 / 全年变化百分比文案 */
function pctText(pct: number | null): string {
  if (pct === null) return '—';
  return `${pct >= 0 ? '+' : ''}${pct.toFixed(2)}%`;
}

/** 占比文案：小于 1% 时不显示成 0% */
function shareText(pct: number): string {
  if (pct > 0 && pct < 1) return '<1%';
  return `${Math.round(pct)}%`;
}

/** 构成条配色：第一个墨绿 → 金色 → inkSoft → 其余在 goldDeep / 浅米色间交替 */
function compositionColor(index: number): string {
  if (index === 0) return COLORS.ink;
  if (index === 1) return COLORS.gold;
  if (index === 2) return COLORS.inkSoft;
  return index % 2 === 1 ? COLORS.goldDeep : COLORS.mintLine;
}

interface HeroStat {
  label: string;
  value: string;
  tone: 'gold' | 'muted' | 'light';
}

interface HeroModel {
  label: string;
  amount: string;
  seal: string;
  stats: HeroStat[];
}

interface CompositionRow {
  key: string;
  label: string;
  amount: string;
  pct: string;
  barPct: number;
  color: string;
}

interface CompositionModel {
  rows: CompositionRow[];
  total: number;
}

function toneColor(tone: HeroStat['tone']): string {
  if (tone === 'gold') return COLORS.goldLight;
  if (tone === 'muted') return 'rgba(242,238,226,0.72)';
  return COLORS.inkWash;
}

export default function ReportScreen() {
  const insets = useSafeAreaInsets();
  const { width: screenWidth } = useWindowDimensions();

  const user = useAuthStore((s) => s.user);
  const assets = useAssetStore((s) => s.assets);
  const snapshots = useAssetStore((s) => s.snapshots);
  const role = useMyFamilyRole();

  const [mode, setMode] = useState<Mode>('month');
  const [monthIdx, setMonthIdx] = useState<number | null>(null);
  const [yearIdx, setYearIdx] = useState<number | null>(null);
  const [exporting, setExporting] = useState(false);

  // 可见性口径（含软删：软删资产的历史快照仍计入对应月份）
  const visibleAssets = useMemo(
    () => filterVisibleAssets(assets, user?.id ?? '', role),
    [assets, user?.id, role],
  );
  const scopedSnapshots = useMemo(
    () => scopeSnapshots(snapshots, visibleAssets),
    [snapshots, visibleAssets],
  );

  const months = useMemo(() => availableMonths(scopedSnapshots), [scopedSnapshots]);
  const years = useMemo(() => availableYears(scopedSnapshots), [scopedSnapshots]);

  const effMonthIdx = Math.min(monthIdx ?? months.length - 1, months.length - 1);
  const effYearIdx = Math.min(yearIdx ?? years.length - 1, years.length - 1);

  const monthReport = useMemo<MonthlyReport | null>(() => {
    if (months.length === 0 || effMonthIdx < 0) return null;
    return buildMonthlyReport(visibleAssets, snapshots, monthRef(months[effMonthIdx]!));
  }, [months, effMonthIdx, visibleAssets, snapshots]);

  const yearReport = useMemo<YearlyReport | null>(() => {
    if (years.length === 0 || effYearIdx < 0) return null;
    return buildYearlyReport(visibleAssets, snapshots, Number(years[effYearIdx]));
  }, [years, effYearIdx, visibleAssets, snapshots]);

  const activeReport = mode === 'month' ? monthReport : yearReport;
  const canExport = activeReport !== null && activeReport.hasData;

  const handleExport = async () => {
    if (exporting || !canExport) return;
    setExporting(true);
    try {
      const html =
        mode === 'month'
          ? buildMonthlyReportHtml(monthReport!)
          : buildYearlyReportHtml(yearReport!);
      const fileName =
        mode === 'month' ? `家资月报-${monthReport!.month}.html` : `家资年报-${yearReport!.year}.html`;
      const result = await exportFile(fileName, html, 'text/html');
      if (result.status === 'saved') {
        Alert.alert('导出成功', '报表已保存到你选择的位置');
      }
    } catch (err) {
      Alert.alert('导出失败', (err as Error).message);
    } finally {
      setExporting(false);
    }
  };

  const subtitle =
    mode === 'month'
      ? months.length > 0 && effMonthIdx >= 0
        ? `${monthLabel(months[effMonthIdx]!)} · ${monthReport?.hasData ? '已归档' : '暂无快照'}`
        : '暂无快照数据'
      : years.length > 0 && effYearIdx >= 0
        ? `${years[effYearIdx]} 年 · ${yearReport?.hasData ? '已归档' : '暂无快照'}`
        : '暂无快照数据';

  const canPrev = mode === 'month' ? effMonthIdx > 0 : effYearIdx > 0;
  const canNext =
    mode === 'month' ? effMonthIdx < months.length - 1 : effYearIdx < years.length - 1;

  const stepPeriod = (dir: -1 | 1) => {
    if (mode === 'month') {
      setMonthIdx(Math.max(0, Math.min(effMonthIdx + dir, months.length - 1)));
    } else {
      setYearIdx(Math.max(0, Math.min(effYearIdx + dir, years.length - 1)));
    }
  };

  const selectPeriod = (index: number) => {
    if (mode === 'month') setMonthIdx(index);
    else setYearIdx(index);
  };

  const periodOptions: { key: string; label: string; index: number }[] =
    mode === 'month'
      ? months.map((m, i) => ({ key: m, label: m, index: i })).reverse()
      : years.map((y, i) => ({ key: y, label: y, index: i })).reverse();
  const selectedPeriodIdx = mode === 'month' ? effMonthIdx : effYearIdx;

  const hero = useMemo<HeroModel | null>(() => {
    if (mode === 'month') {
      if (monthReport === null || monthReport.totals === null) return null;
      const totals = monthReport.totals;
      const prev = monthReport.prevTotals;
      return {
        label: `${monthCN(monthReport.month)}净资产（元）`,
        amount: amountText(totals.netWorth),
        seal: monthSeal(monthReport.month),
        stats: [
          { label: '期初', value: prev === null ? '—' : amountText(prev.netWorth), tone: 'gold' },
          { label: '期末', value: amountText(totals.netWorth), tone: 'muted' },
          { label: '环比', value: pctText(monthReport.netWorthPct), tone: 'light' },
        ],
      };
    }
    if (yearReport === null || yearReport.endTotals === null) return null;
    return {
      label: `${yearReport.year} 年净资产（元）`,
      amount: amountText(yearReport.endTotals.netWorth),
      seal: '年报',
      stats: [
        {
          label: '年初',
          value: yearReport.beginTotals === null ? '—' : amountText(yearReport.beginTotals.netWorth),
          tone: 'gold',
        },
        { label: '年末', value: amountText(yearReport.endTotals.netWorth), tone: 'muted' },
        { label: '全年', value: pctText(yearReport.netWorthPct), tone: 'light' },
      ],
    };
  }, [mode, monthReport, yearReport]);

  const composition = useMemo<CompositionModel | null>(() => {
    if (mode === 'month') {
      if (monthReport === null || !monthReport.hasData) return null;
      const rows: CompositionRow[] = monthReport.slices.map((s, i) => ({
        key: s.type,
        label: s.label,
        amount: amountText(s.amount),
        pct: shareText(s.pct),
        barPct: Math.max(0, Math.min(100, s.pct)),
        color: compositionColor(i),
      }));
      return { rows, total: monthReport.positiveTotal };
    }
    if (yearReport === null || !yearReport.hasData) return null;
    const rows: CompositionRow[] = yearReport.endSlices.map((s, i) => ({
      key: s.type,
      label: s.label,
      amount: amountText(s.amount),
      pct: shareText(s.pct),
      barPct: Math.max(0, Math.min(100, s.pct)),
      color: compositionColor(i),
    }));
    const total = yearReport.endSlices.reduce((sum, s) => sum + s.amount, 0);
    return { rows, total };
  }, [mode, monthReport, yearReport]);

  return (
    <View style={styles.page}>
      <View style={{ height: insets.top }} />
      <ScrollView contentContainerStyle={styles.body} showsVerticalScrollIndicator={false}>
        {/* 页头 */}
        <View style={styles.header}>
          <View style={styles.headerMain}>
            <Text style={[styles.title, SERIF_CN_TEXT]}>
              {mode === 'month' ? '月度报表' : '年度报表'}
            </Text>
            <Text style={styles.subtitle} numberOfLines={1}>{subtitle}</Text>
          </View>
          <TouchableOpacity
            onPress={() => setMode(mode === 'month' ? 'year' : 'month')}
            hitSlop={10}
          >
            <Text style={styles.modeLink}>
              {mode === 'month' ? '年度报表' : '月度报表'} ›
            </Text>
          </TouchableOpacity>
        </View>

        {/* 墨绿 hero */}
        {hero !== null ? (
          <View style={styles.heroWrap}>
            <HeroCard width={screenWidth - 40} model={hero} />
          </View>
        ) : null}

        {/* 资产构成 */}
        {composition !== null ? (
          <CompositionSection model={composition} />
        ) : (
          <View style={styles.section}>
            <View style={styles.card}>
              <Text style={styles.empty}>还没有快照数据，先录入几笔吧</Text>
            </View>
          </View>
        )}

        {/* 期间选择 */}
        {periodOptions.length > 0 ? (
          <View style={styles.chipsSection}>
            <View style={styles.chipsRow}>
              <TouchableOpacity
                style={[styles.chipArrow, !canPrev && styles.chipArrowDisabled]}
                disabled={!canPrev}
                onPress={() => stepPeriod(-1)}
                hitSlop={8}
                accessibilityLabel="上一期"
              >
                <Text style={styles.chipArrowText}>‹</Text>
              </TouchableOpacity>
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                style={styles.chipsScroll}
                contentContainerStyle={styles.chipsContent}
              >
                {periodOptions.map((o) => {
                  const active = o.index === selectedPeriodIdx;
                  return (
                    <TouchableOpacity
                      key={o.key}
                      style={[styles.chip, active && styles.chipActive]}
                      onPress={() => selectPeriod(o.index)}
                    >
                      <Text style={[styles.chipText, active && styles.chipTextActive]}>{o.label}</Text>
                    </TouchableOpacity>
                  );
                })}
              </ScrollView>
              <TouchableOpacity
                style={[styles.chipArrow, !canNext && styles.chipArrowDisabled]}
                disabled={!canNext}
                onPress={() => stepPeriod(1)}
                hitSlop={8}
                accessibilityLabel="下一期"
              >
                <Text style={styles.chipArrowText}>›</Text>
              </TouchableOpacity>
            </View>
          </View>
        ) : null}

        {/* 原有报表数据：月报快照明细 / 年报趋势与大事记 */}
        {mode === 'month' && monthReport?.hasData ? (
          <SnapshotDetails report={monthReport} />
        ) : null}
        {mode === 'year' && yearReport?.hasData ? <YearDetails report={yearReport} /> : null}

        {/* 导出 */}
        <View style={styles.exportWrap}>
          <TouchableOpacity
            style={[styles.exportBtn, (!canExport || exporting) && styles.exportBtnDisabled]}
            disabled={!canExport || exporting}
            onPress={handleExport}
          >
            <Text style={styles.exportText}>{exporting ? '正在导出…' : '导出报表'}</Text>
          </TouchableOpacity>
        </View>

        <Text style={styles.privacy}>数据本机加密存储 · 仅你可解密查看</Text>
      </ScrollView>
    </View>
  );
}

/* ---------------- hero ---------------- */

function HeroCard({ width, model }: { width: number; model: HeroModel }) {
  return (
    <GradientCard width={width} height={176} radius={26}>
      <View style={styles.heroBody}>
        <View style={styles.heroTop}>
          <View style={styles.heroMain}>
            <Text style={styles.heroLabel} numberOfLines={1}>{model.label}</Text>
            <Text
              style={styles.heroAmount}
              numberOfLines={1}
              adjustsFontSizeToFit
              minimumFontScale={0.65}
            >
              {`¥ ${model.amount}`}
            </Text>
          </View>
          <View style={styles.seal}>
            <Text
              style={[styles.sealText, model.seal.length >= 3 && styles.sealTextSmall, SERIF_CN_TEXT]}
            >
              {model.seal}
            </Text>
          </View>
        </View>

        <View style={styles.heroHairline} />

        <View style={styles.heroStats}>
          {model.stats.map((s, i) => (
            <View key={s.label} style={[styles.heroStat, i > 0 && styles.heroStatDivider]}>
              <Text style={styles.heroStatLabel} numberOfLines={1}>{s.label}</Text>
              <Text
                style={[styles.heroStatValue, { color: toneColor(s.tone) }]}
                numberOfLines={1}
                adjustsFontSizeToFit
                minimumFontScale={0.7}
              >
                {s.value}
              </Text>
            </View>
          ))}
        </View>
      </View>
    </GradientCard>
  );
}

/* ---------------- 资产构成 ---------------- */

function CompositionSection({ model }: { model: CompositionModel }) {
  return (
    <View style={styles.section}>
      <View style={styles.sectionHead}>
        <Text style={[styles.sectionTitle, SERIF_CN_TEXT]}>资产构成</Text>
        <Text style={styles.sectionMeta}>共 {amountText(model.total)} 元</Text>
      </View>

      <View style={styles.card}>
        {model.rows.length === 0 ? (
          <Text style={styles.placeholder}>暂无分类数据</Text>
        ) : (
          model.rows.map((r, i) => (
            <View
              key={r.key}
              style={[styles.compRow, i === model.rows.length - 1 && styles.compRowLast]}
            >
              <View style={styles.compHead}>
                <Text style={styles.compLabel} numberOfLines={1}>{r.label}</Text>
                <Text style={styles.compValue} numberOfLines={1}>{`${r.amount} · ${r.pct}`}</Text>
              </View>
              <View style={styles.barTrack}>
                <View
                  style={[
                    styles.barFill,
                    { width: `${Math.max(2, r.barPct)}%`, backgroundColor: r.color },
                  ]}
                />
              </View>
            </View>
          ))
        )}
      </View>
    </View>
  );
}

/* ---------------- 月报明细 ---------------- */

function SnapshotDetails({ report }: { report: MonthlyReport }) {
  return (
    <View style={styles.section}>
      <View style={styles.sectionHead}>
        <Text style={[styles.sectionTitle, SERIF_CN_TEXT]}>本月快照明细</Text>
        <Text style={styles.sectionMeta}>{report.rows.length} 条</Text>
      </View>
      <View style={styles.card}>
        {report.rows.length === 0 ? (
          <Text style={styles.placeholder}>暂无快照</Text>
        ) : (
          report.rows.map((r, i) => (
            <View
              key={`${r.assetId}-${r.capturedAt}`}
              style={[styles.snapRow, i === report.rows.length - 1 && styles.rowLast]}
            >
              <Text style={styles.snapDate}>{r.capturedAt.slice(5, 10)}</Text>
              <View style={styles.snapMain}>
                <Text style={styles.snapName} numberOfLines={1}>{r.assetName}</Text>
                <Text style={styles.snapMeta}>
                  {r.typeLabel} · {SOURCE_LABELS[r.source] ?? r.source}
                </Text>
              </View>
              <Text style={styles.snapAmount} numberOfLines={1}>{amountText(r.amount)}</Text>
            </View>
          ))
        )}
      </View>
    </View>
  );
}

/* ---------------- 年报明细 ---------------- */

function YearDetails({ report }: { report: YearlyReport }) {
  return (
    <>
      <View style={styles.section}>
        <View style={styles.sectionHead}>
          <Text style={[styles.sectionTitle, SERIF_CN_TEXT]}>年初年末对比</Text>
          <Text style={styles.sectionMeta} numberOfLines={1}>
            {`${report.beginMonth ?? '—'} → ${report.endMonth ?? '—'}`}
          </Text>
        </View>
        <View style={styles.card}>
          <YearCompareRow
            label="净资产"
            begin={report.beginTotals?.netWorth ?? null}
            end={report.endTotals?.netWorth ?? null}
            delta={report.netWorthDelta}
            pct={report.netWorthPct}
          />
          <YearCompareRow
            label="总资产"
            begin={report.beginTotals?.totalAssets ?? null}
            end={report.endTotals?.totalAssets ?? null}
            delta={report.assetsDelta}
          />
          <YearCompareRow
            label="总负债"
            begin={report.beginTotals?.totalLiabilities ?? null}
            end={report.endTotals?.totalLiabilities ?? null}
            delta={report.liabilitiesDelta}
            last
          />
        </View>
      </View>

      {report.monthlyTrend.length > 0 ? (
        <View style={styles.section}>
          <View style={styles.sectionHead}>
            <Text style={[styles.sectionTitle, SERIF_CN_TEXT]}>月度净资产趋势</Text>
            <Text style={styles.sectionMeta}>{report.monthlyTrend.length} 个月</Text>
          </View>
          <View style={styles.chartCard}>
            <TrendChart data={report.monthlyTrend} height={200} lines={['netWorth']} />
          </View>
        </View>
      ) : null}

      <AllocationCompare report={report} />

      {report.events.length > 0 || report.topMovers.length > 0 ? (
        <View style={styles.section}>
          <View style={styles.sectionHead}>
            <Text style={[styles.sectionTitle, SERIF_CN_TEXT]}>年度大事记</Text>
            <Text style={styles.sectionMeta}>{report.events.length + report.topMovers.length} 条</Text>
          </View>
          <View style={styles.card}>
            {report.events.map((e, i) => (
              <View
                key={`${e.kind}-${e.assetName}-${e.at}`}
                style={[
                  styles.eventRow,
                  i === report.events.length - 1 && report.topMovers.length === 0 && styles.rowLast,
                ]}
              >
                <View style={[styles.tag, e.kind === 'added' ? styles.tagAdded : styles.tagArchived]}>
                  <Text
                    style={[
                      styles.tagText,
                      e.kind === 'added' ? styles.tagAddedText : styles.tagArchivedText,
                    ]}
                  >
                    {e.kind === 'added' ? '新增' : '归档'}
                  </Text>
                </View>
                <View style={styles.snapMain}>
                  <Text style={styles.snapName} numberOfLines={1}>{e.assetName}</Text>
                  <Text style={styles.snapMeta}>{e.typeLabel}</Text>
                </View>
                <Text style={styles.snapDate}>{e.at.slice(0, 10)}</Text>
              </View>
            ))}

            {report.topMovers.length > 0 ? (
              <>
                <Text style={styles.moverHeader}>变化最大的资产</Text>
                {report.topMovers.map((m, i) => (
                  <View
                    key={m.assetId}
                    style={[styles.snapRow, i === report.topMovers.length - 1 && styles.rowLast]}
                  >
                    <View style={styles.snapMain}>
                      <Text style={styles.snapName} numberOfLines={1}>{m.assetName}</Text>
                      <Text style={styles.snapMeta}>
                        {formatCNYCompact(m.firstAmount)} → {formatCNYCompact(m.lastAmount)}
                      </Text>
                    </View>
                    <Text style={[styles.snapAmount, { color: m.delta >= 0 ? UPPER : DOWN }]}>
                      {m.delta >= 0 ? '+' : ''}{formatCNY(m.delta)}
                    </Text>
                  </View>
                ))}
              </>
            ) : null}
          </View>
        </View>
      ) : null}
    </>
  );
}

function AllocationCompare({ report }: { report: YearlyReport }) {
  const beginPct = new Map(report.beginSlices.map((s) => [s.label, s.pct]));
  const endPct = new Map(report.endSlices.map((s) => [s.label, s.pct]));
  const labels = [...new Set([...report.beginSlices, ...report.endSlices].map((s) => s.label))];
  if (labels.length === 0) return null;
  return (
    <View style={styles.section}>
      <View style={styles.sectionHead}>
        <Text style={[styles.sectionTitle, SERIF_CN_TEXT]}>配置变化</Text>
        <Text style={styles.sectionMeta}>占总资产</Text>
      </View>
      <View style={styles.card}>
        {labels.map((l, i) => (
          <View key={l} style={[styles.compareRow, i === labels.length - 1 && styles.rowLast]}>
            <Text style={styles.compareLabel}>{l}</Text>
            <Text style={styles.compareValue}>
              {beginPct.get(l) === undefined ? '—' : `${beginPct.get(l)!.toFixed(1)}%`}
              {'  →  '}
              {endPct.get(l) === undefined ? '—' : `${endPct.get(l)!.toFixed(1)}%`}
            </Text>
          </View>
        ))}
      </View>
    </View>
  );
}

/* ---------------- 公共小件 ---------------- */

function YearCompareRow({
  label, begin, end, delta, pct, last = false,
}: {
  label: string;
  begin: number | null;
  end: number | null;
  delta: number | null;
  pct?: number | null;
  last?: boolean;
}) {
  return (
    <View style={[styles.yearCompareBlock, last && styles.rowLast]}>
      <Text style={styles.compareLabel}>{label}</Text>
      <Text style={styles.yearCompareValues}>
        {begin === null ? '—' : formatCNYCompact(begin)}
        {' → '}
        {end === null ? '—' : formatCNYCompact(end)}
      </Text>
      {delta !== null ? (
        <Text style={[styles.compareValue, { color: delta >= 0 ? UPPER : DOWN, marginTop: 3 }]}>
          {delta >= 0 ? '+' : ''}{formatCNY(delta)}
          {pct !== undefined && pct !== null ? `（${pct >= 0 ? '+' : ''}${pct.toFixed(2)}%）` : ''}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: COLORS.paper },
  body: { paddingBottom: 40 },

  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    paddingHorizontal: 24,
    paddingTop: 8,
    paddingBottom: 16,
  },
  headerMain: { flex: 1, marginRight: 12 },
  title: { fontSize: 21, color: COLORS.text, letterSpacing: 1 },
  subtitle: { fontSize: 10.5, color: COLORS.faint, marginTop: 4, letterSpacing: 0.3 },
  modeLink: { fontSize: 11, color: COLORS.goldDeep, letterSpacing: 0.3, marginTop: 6 },

  heroWrap: { paddingHorizontal: 20 },
  heroBody: { flex: 1, paddingHorizontal: 24, paddingTop: 24, paddingBottom: 20 },
  heroTop: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between' },
  heroMain: { flex: 1 },
  heroLabel: { fontSize: 10.5, color: 'rgba(233,220,192,0.55)', letterSpacing: 3 },
  heroAmount: {
    ...MONEY_TEXT,
    fontSize: 36,
    lineHeight: 38,
    fontWeight: '600',
    color: COLORS.inkWash,
    marginTop: 10,
  },
  seal: {
    width: 28,
    height: 28,
    borderRadius: 7,
    marginLeft: 12,
    backgroundColor: COLORS.danger,
    alignItems: 'center',
    justifyContent: 'center',
    transform: [{ rotate: '-3deg' }],
    shadowColor: COLORS.danger,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.4,
    shadowRadius: 8,
    elevation: 2,
  },
  sealText: { fontSize: 11, color: COLORS.inkWash, textAlign: 'center' },
  sealTextSmall: { fontSize: 9 },
  heroHairline: { height: 1, backgroundColor: 'rgba(198,161,91,0.5)', marginVertical: 16 },
  heroStats: { flexDirection: 'row' },
  heroStat: { flex: 1, alignItems: 'center' },
  heroStatDivider: { borderLeftWidth: 1, borderLeftColor: GOLD_DECOR },
  heroStatLabel: { fontSize: 9.5, color: 'rgba(233,220,192,0.45)', letterSpacing: 2 },
  heroStatValue: { ...MONEY_TEXT, fontSize: 15.5, marginTop: 4 },

  section: { paddingHorizontal: 24, marginTop: 24 },
  sectionHead: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  sectionTitle: { fontSize: 17, color: COLORS.text, letterSpacing: 0.6 },
  sectionMeta: { fontSize: 10.5, color: COLORS.faint, marginLeft: 12 },
  card: {
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.hairlineSoft,
    borderRadius: 20,
    padding: 16,
    shadowColor: COLORS.text,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 10,
    elevation: 2,
  },
  chartCard: {
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.hairlineSoft,
    borderRadius: 20,
    paddingVertical: 16,
    overflow: 'hidden',
    shadowColor: COLORS.text,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 10,
    elevation: 2,
  },
  empty: { textAlign: 'center', color: COLORS.faint, fontSize: 13, paddingVertical: 20 },
  placeholder: { color: COLORS.faint, fontSize: 12, textAlign: 'center', paddingVertical: 12 },

  compRow: { marginBottom: 14 },
  compRowLast: { marginBottom: 0 },
  compHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 6,
  },
  compLabel: { flexShrink: 1, fontSize: 12, color: COLORS.text },
  compValue: { ...MONEY_TEXT, fontSize: 12, color: COLORS.sub, marginLeft: 12 },
  barTrack: { height: 7, borderRadius: 999, backgroundColor: COLORS.divider, overflow: 'hidden' },
  barFill: { height: '100%', borderRadius: 999 },

  chipsSection: { paddingHorizontal: 24, marginTop: 16 },
  chipsRow: { flexDirection: 'row', alignItems: 'center' },
  chipsScroll: { flex: 1, marginHorizontal: 8 },
  chipsContent: { gap: 8, alignItems: 'center' },
  chipArrow: {
    width: 28,
    height: 28,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: COLORS.hairline,
    backgroundColor: COLORS.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  chipArrowDisabled: { opacity: 0.4 },
  chipArrowText: { fontSize: 14, lineHeight: 16, color: COLORS.sub },
  chip: {
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: COLORS.hairline,
    backgroundColor: COLORS.surface,
  },
  chipActive: { backgroundColor: COLORS.ink, borderColor: COLORS.ink },
  chipText: { fontSize: 12, color: COLORS.sub },
  chipTextActive: { color: COLORS.inkWash, fontWeight: '600' },

  snapRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.divider,
  },
  rowLast: { borderBottomWidth: 0 },
  snapDate: { fontSize: 11, color: COLORS.faint, width: 44 },
  snapMain: { flex: 1, marginRight: 8 },
  snapName: { fontSize: 13, color: COLORS.text, fontWeight: '500' },
  snapMeta: { fontSize: 10.5, color: COLORS.faint, marginTop: 1 },
  snapAmount: { ...MONEY_TEXT, fontSize: 13, fontWeight: '600', color: COLORS.text },

  compareRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.divider,
  },
  compareLabel: { fontSize: 13, color: COLORS.sub },
  compareValue: { ...MONEY_TEXT, fontSize: 12.5, fontWeight: '600' },
  yearCompareBlock: {
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.divider,
  },
  yearCompareValues: { ...MONEY_TEXT, fontSize: 12.5, color: COLORS.text, marginTop: 3 },

  eventRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.divider,
  },
  tag: { borderRadius: 999, paddingHorizontal: 8, paddingVertical: 2, marginRight: 10 },
  tagAdded: { backgroundColor: COLORS.inkWashSoft },
  tagArchived: { backgroundColor: COLORS.divider },
  tagText: { fontSize: 10.5, fontWeight: '600' },
  tagAddedText: { color: COLORS.inkSoft },
  tagArchivedText: { color: COLORS.sub },
  moverHeader: { fontSize: 11, fontWeight: '600', color: COLORS.faint, marginTop: 12, marginBottom: 2 },

  exportWrap: { paddingHorizontal: 24, marginTop: 24 },
  exportBtn: {
    height: 44,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: COLORS.ink,
    backgroundColor: COLORS.transparent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  exportBtnDisabled: { opacity: 0.4 },
  exportText: { fontSize: 13, fontWeight: '600', color: COLORS.ink, letterSpacing: 1 },
  privacy: {
    textAlign: 'center',
    fontSize: 10,
    color: COLORS.faint,
    marginTop: 16,
    letterSpacing: 0.5,
  },
});
