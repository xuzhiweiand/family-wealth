/**
 * 月度 / 年度资产报表（P0-5）
 *
 * - 月报：三卡（净资产/总资产/总负债）、环比、配置分布、本月快照明细；
 * - 年报：年初年末对比、月趋势图、配置变化、年度大事记（增删资产 + 变化 Top 3）；
 * - 数字口径与主页/月度台账完全一致（lib/report.ts 复用 buildMonthTotals，
 *   只统计当月有快照的资产、取当月最新快照）；
 * - 期间左右箭头切换，可选范围 = 有快照数据的月份/年份（无数据期间不可选）；
 * - 导出自包含 HTML（内联 CSS、离线可打开），走 file-export 统一通道；
 * - 可见性口径与导出一致：filterVisibleAssets（含软删资产的历史快照）。
 */

import React, { useMemo, useState } from 'react';
import {
  Alert,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { filterVisibleAssets } from '@family-wealth/family';
import { formatCNY, formatCNYCompact } from '@family-wealth/shared-utils';
import { useAppNavigation } from '../lib/navigation';
import { useAuthStore } from '../stores/auth-store';
import { useAssetStore } from '../stores/asset-store';
import { useMyFamilyRole } from '../stores/family-store';
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
import { ASSET_TYPE_COLORS } from '../lib/asset-meta';
import type { AssetType } from '@family-wealth/shared-types';

type Mode = 'month' | 'year';

const SOURCE_LABELS: Record<string, string> = {
  manual: '手动',
  ocr: 'OCR',
  import: '导入',
  api: '接口',
};

const UP = '#DC2626';
const DOWN = '#16A34A';

function monthRef(month: string): Date {
  return new Date(Number(month.slice(0, 4)), Number(month.slice(5, 7)) - 1, 1);
}

function monthLabel(month: string): string {
  return `${month.slice(0, 4)} 年 ${Number(month.slice(5, 7))} 月`;
}

export default function ReportScreen() {
  const insets = useSafeAreaInsets();
  const navigation = useAppNavigation();

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

  const periodLabel =
    mode === 'month'
      ? months.length > 0 && effMonthIdx >= 0
        ? monthLabel(months[effMonthIdx]!)
        : '—'
      : years.length > 0 && effYearIdx >= 0
        ? `${years[effYearIdx]} 年`
        : '—';
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

  return (
    <View style={styles.page}>
      <View style={{ height: insets.top }} />
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} hitSlop={12}>
          <Text style={styles.back}>‹ 返回</Text>
        </TouchableOpacity>
        <Text style={styles.title}>资产报表</Text>
        <View style={{ width: 48 }} />
      </View>

      {/* 月报 / 年报 切换 */}
      <View style={styles.segmentWrap}>
        <View style={styles.segment}>
          {(['month', 'year'] as Mode[]).map((m) => (
            <TouchableOpacity
              key={m}
              style={[styles.segmentItem, mode === m && styles.segmentActive]}
              onPress={() => setMode(m)}
            >
              <Text style={[styles.segmentText, mode === m && styles.segmentTextActive]}>
                {m === 'month' ? '月报' : '年报'}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>

      {/* 期间切换 */}
      <View style={styles.periodRow}>
        <TouchableOpacity
          style={[styles.periodArrow, !canPrev && styles.periodArrowDisabled]}
          disabled={!canPrev}
          onPress={() => stepPeriod(-1)}
          hitSlop={10}
        >
          <Text style={[styles.periodArrowText, !canPrev && styles.periodArrowTextDisabled]}>‹</Text>
        </TouchableOpacity>
        <Text style={styles.periodLabel}>{periodLabel}</Text>
        <TouchableOpacity
          style={[styles.periodArrow, !canNext && styles.periodArrowDisabled]}
          disabled={!canNext}
          onPress={() => stepPeriod(1)}
          hitSlop={10}
        >
          <Text style={[styles.periodArrowText, !canNext && styles.periodArrowTextDisabled]}>›</Text>
        </TouchableOpacity>
      </View>

      <ScrollView contentContainerStyle={styles.body} showsVerticalScrollIndicator={false}>
        {activeReport === null || !activeReport.hasData ? (
          <Text style={styles.empty}>还没有快照数据，先录入几笔吧</Text>
        ) : mode === 'month' ? (
          <MonthView report={monthReport!} />
        ) : (
          <YearView report={yearReport!} />
        )}
      </ScrollView>

      {/* 导出 */}
      <View style={[styles.footer, { paddingBottom: insets.bottom + 12 }]}>
        <TouchableOpacity
          style={[styles.exportBtn, (!canExport || exporting) && styles.btnDisabled]}
          disabled={!canExport || exporting}
          onPress={handleExport}
        >
          <Text style={styles.exportBtnText}>{exporting ? '正在导出…' : '导出 HTML 报表'}</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

/* ---------------- 月报 ---------------- */

function MonthView({ report }: { report: MonthlyReport }) {
  const t = report.totals!;
  return (
    <>
      {/* 三卡 */}
      <View style={styles.cards3}>
        <StatCell label="净资产" value={formatCNYCompact(t.netWorth)} />
        <StatCell label="总资产" value={formatCNYCompact(t.totalAssets)} />
        <StatCell label="总负债" value={formatCNYCompact(t.totalLiabilities)} />
      </View>

      {/* 环比 */}
      <Card title={report.prevTotals !== null ? `环比 ${monthLabel(report.prevMonth ?? '')}` : '环比'}>
        {report.prevTotals === null ? (
          <Text style={styles.placeholder}>上月无数据，暂无环比</Text>
        ) : (
          <>
            <CompareRow label="净资产" delta={report.netWorthDelta} pct={report.netWorthPct} />
            <CompareRow label="总资产" delta={report.assetsDelta} />
            <CompareRow label="总负债" delta={report.liabilitiesDelta} />
          </>
        )}
      </Card>

      {/* 配置分布 */}
      {report.slices.length > 0 ? (
        <Card title="配置分布">
          {report.slices.map((s) => (
            <SliceBar
              key={s.type}
              label={s.label}
              amount={s.amount}
              pct={s.pct}
              color={ASSET_TYPE_COLORS[s.type as AssetType] ?? '#9CA3AF'}
              max={report.slices[0]?.amount ?? 1}
            />
          ))}
          {report.debtAmount > 0 ? (
            <SliceBar
              label="债务"
              amount={report.debtAmount}
              pct={-report.debtShare}
              color="#EF4444"
              max={report.slices[0]?.amount ?? 1}
            />
          ) : null}
        </Card>
      ) : null}

      {/* 快照明细 */}
      <Card title={`本月快照明细（${report.rows.length} 条）`}>
        {report.rows.map((r) => (
          <View key={`${r.assetId}-${r.capturedAt}`} style={styles.snapRow}>
            <Text style={styles.snapDate}>{r.capturedAt.slice(5, 10)}</Text>
            <View style={styles.snapMain}>
              <Text style={styles.snapName} numberOfLines={1}>{r.assetName}</Text>
              <Text style={styles.snapMeta}>
                {r.typeLabel} · {SOURCE_LABELS[r.source] ?? r.source}
              </Text>
            </View>
            <Text style={styles.snapAmount}>{formatCNY(r.amount)}</Text>
          </View>
        ))}
      </Card>
    </>
  );
}

/* ---------------- 年报 ---------------- */

function YearView({ report }: { report: YearlyReport }) {
  return (
    <>
      {/* 年初年末对比 */}
      <Card title={`年初年末对比（${monthLabel(report.beginMonth ?? '')} → ${monthLabel(report.endMonth ?? '')}）`}>
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
        />
      </Card>

      {/* 月趋势 */}
      {report.monthlyTrend.length > 0 ? (
        <Card title="月度净资产趋势">
          <TrendChart data={report.monthlyTrend} height={200} lines={['netWorth']} />
        </Card>
      ) : null}

      {/* 配置变化 */}
      <AllocationCompare report={report} />

      {/* 年度大事记 */}
      {report.events.length > 0 || report.topMovers.length > 0 ? (
        <Card title="年度大事记">
          {report.events.map((e) => (
            <View key={`${e.kind}-${e.assetName}-${e.at}`} style={styles.eventRow}>
              <View style={[styles.tag, e.kind === 'added' ? styles.tagAdded : styles.tagArchived]}>
                <Text style={[styles.tagText, e.kind === 'added' ? styles.tagAddedText : styles.tagArchivedText]}>
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
              {report.topMovers.map((m) => (
                <View key={m.assetId} style={styles.snapRow}>
                  <View style={styles.snapMain}>
                    <Text style={styles.snapName} numberOfLines={1}>{m.assetName}</Text>
                    <Text style={styles.snapMeta}>
                      {formatCNYCompact(m.firstAmount)} → {formatCNYCompact(m.lastAmount)}
                    </Text>
                  </View>
                  <Text style={[styles.snapAmount, { color: m.delta >= 0 ? UP : DOWN }]}>
                    {m.delta >= 0 ? '+' : ''}{formatCNY(m.delta)}
                  </Text>
                </View>
              ))}
            </>
          ) : null}
        </Card>
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
    <Card title="配置变化（占总资产）">
      {labels.map((l) => (
        <View key={l} style={styles.allocRow}>
          <Text style={styles.allocLabel}>{l}</Text>
          <Text style={styles.allocValue}>
            {beginPct.get(l) === undefined ? '—' : `${beginPct.get(l)!.toFixed(1)}%`}
            {'  →  '}
            {endPct.get(l) === undefined ? '—' : `${endPct.get(l)!.toFixed(1)}%`}
          </Text>
        </View>
      ))}
    </Card>
  );
}

/* ---------------- 公共小件 ---------------- */

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={styles.card}>
      <Text style={styles.cardTitle}>{title}</Text>
      {children}
    </View>
  );
}

function StatCell({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.statCell}>
      <Text style={styles.statLabel}>{label}</Text>
      <Text style={styles.statValue} numberOfLines={1} adjustsFontSizeToFit>{value}</Text>
    </View>
  );
}

function CompareRow({ label, delta, pct }: { label: string; delta: number | null; pct?: number | null }) {
  if (delta === null) return null;
  const color = delta >= 0 ? UP : DOWN;
  return (
    <View style={styles.compareRow}>
      <Text style={styles.compareLabel}>{label}</Text>
      <Text style={[styles.compareValue, { color }]}>
        {delta >= 0 ? '+' : ''}{formatCNY(delta)}
        {pct !== undefined && pct !== null ? `（${pct >= 0 ? '+' : ''}${pct.toFixed(2)}%）` : ''}
      </Text>
    </View>
  );
}

function YearCompareRow({
  label, begin, end, delta, pct,
}: {
  label: string;
  begin: number | null;
  end: number | null;
  delta: number | null;
  pct?: number | null;
}) {
  return (
    <View style={styles.yearCompareRow}>
      <Text style={styles.compareLabel}>{label}</Text>
      <Text style={styles.yearCompareValues}>
        {begin === null ? '—' : formatCNYCompact(begin)}
        {' → '}
        {end === null ? '—' : formatCNYCompact(end)}
      </Text>
      {delta !== null ? (
        <Text style={[styles.compareValue, { color: delta >= 0 ? UP : DOWN }]}>
          {delta >= 0 ? '+' : ''}{formatCNY(delta)}
          {pct !== undefined && pct !== null ? `（${pct >= 0 ? '+' : ''}${pct.toFixed(2)}%）` : ''}
        </Text>
      ) : null}
    </View>
  );
}

function SliceBar({
  label, amount, pct, color, max,
}: {
  label: string;
  amount: number;
  pct: number;
  color: string;
  max: number;
}) {
  return (
    <View style={styles.sliceRow}>
      <View style={styles.sliceHead}>
        <Text style={styles.sliceLabel}>{label}</Text>
        <Text style={styles.sliceAmount}>
          {formatCNYCompact(amount)}
          <Text style={styles.slicePct}>{pct >= 0 ? ` ${pct.toFixed(1)}%` : ` -${Math.abs(pct).toFixed(1)}%`}</Text>
        </Text>
      </View>
      <View style={styles.barTrack}>
        <View style={{
          width: `${Math.max(2, (Math.abs(amount) / Math.max(1, max)) * 100)}%`,
          height: '100%', borderRadius: 999, backgroundColor: color,
        }} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: '#F9FAFB' },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingVertical: 12,
  },
  back: { fontSize: 16, color: '#10B981', width: 48 },
  title: { fontSize: 17, fontWeight: '700', color: '#111827' },
  segmentWrap: { paddingHorizontal: 20, marginBottom: 12 },
  segment: {
    flexDirection: 'row', backgroundColor: '#F3F4F6', borderRadius: 10, padding: 3,
  },
  segmentItem: { flex: 1, paddingVertical: 7, borderRadius: 8, alignItems: 'center' },
  segmentActive: { backgroundColor: '#10B981' },
  segmentText: { fontSize: 14, fontWeight: '500', color: '#6B7280' },
  segmentTextActive: { color: 'white', fontWeight: '700' },
  periodRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    marginBottom: 4, paddingHorizontal: 20,
  },
  periodArrow: {
    width: 40, height: 36, borderRadius: 10, backgroundColor: 'white',
    borderWidth: 1, borderColor: '#E5E7EB', alignItems: 'center', justifyContent: 'center',
  },
  periodArrowDisabled: { backgroundColor: '#F9FAFB' },
  periodArrowText: { fontSize: 20, color: '#111827', marginTop: -2 },
  periodArrowTextDisabled: { color: '#D1D5DB' },
  periodLabel: {
    flex: 1, textAlign: 'center', fontSize: 16, fontWeight: '700', color: '#111827',
  },
  body: { padding: 20, paddingTop: 12, paddingBottom: 24 },
  empty: { textAlign: 'center', color: '#9CA3AF', fontSize: 14, marginTop: 48 },
  cards3: { flexDirection: 'row', gap: 10, marginBottom: 12 },
  statCell: {
    flex: 1, backgroundColor: 'white', borderWidth: 1, borderColor: '#E5E7EB',
    borderRadius: 14, paddingVertical: 14, paddingHorizontal: 8, alignItems: 'center',
  },
  statLabel: { fontSize: 12, color: '#9CA3AF' },
  statValue: { fontSize: 15, fontWeight: '700', color: '#111827', marginTop: 6 },
  card: {
    backgroundColor: 'white', borderWidth: 1, borderColor: '#E5E7EB',
    borderRadius: 14, padding: 16, marginBottom: 12,
  },
  cardTitle: { fontSize: 15, fontWeight: '700', color: '#111827', marginBottom: 12 },
  placeholder: { color: '#9CA3AF', fontSize: 13, textAlign: 'center', paddingVertical: 8 },
  compareRow: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingVertical: 7, borderBottomWidth: 1, borderBottomColor: '#F9FAFB',
  },
  compareLabel: { fontSize: 14, color: '#6B7280' },
  compareValue: { fontSize: 14, fontWeight: '600' },
  yearCompareRow: { paddingVertical: 7, borderBottomWidth: 1, borderBottomColor: '#F9FAFB' },
  yearCompareValues: { fontSize: 13, color: '#374151', marginTop: 3 },
  sliceRow: { marginBottom: 10 },
  sliceHead: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4 },
  sliceLabel: { fontSize: 13, color: '#6B7280' },
  sliceAmount: { fontSize: 13, fontWeight: '600', color: '#111827' },
  slicePct: { fontWeight: '400', color: '#9CA3AF' },
  barTrack: { height: 8, borderRadius: 999, backgroundColor: '#F3F4F6', overflow: 'hidden' },
  snapRow: {
    flexDirection: 'row', alignItems: 'center',
    paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: '#F9FAFB',
  },
  snapDate: { fontSize: 12, color: '#9CA3AF', width: 44 },
  snapMain: { flex: 1, marginRight: 8 },
  snapName: { fontSize: 14, color: '#111827', fontWeight: '500' },
  snapMeta: { fontSize: 11, color: '#9CA3AF', marginTop: 1 },
  snapAmount: { fontSize: 14, fontWeight: '600', color: '#111827' },
  eventRow: {
    flexDirection: 'row', alignItems: 'center',
    paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: '#F9FAFB',
  },
  tag: { borderRadius: 999, paddingHorizontal: 8, paddingVertical: 2, marginRight: 10 },
  tagAdded: { backgroundColor: '#D1FAE5' },
  tagArchived: { backgroundColor: '#F3F4F6' },
  tagText: { fontSize: 11, fontWeight: '600' },
  tagAddedText: { color: '#059669' },
  tagArchivedText: { color: '#6B7280' },
  moverHeader: { fontSize: 13, fontWeight: '600', color: '#6B7280', marginTop: 12, marginBottom: 4 },
  allocRow: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingVertical: 7, borderBottomWidth: 1, borderBottomColor: '#F9FAFB',
  },
  allocLabel: { fontSize: 14, color: '#6B7280' },
  allocValue: { fontSize: 13, fontWeight: '600', color: '#111827' },
  footer: { paddingHorizontal: 20, paddingTop: 8, backgroundColor: '#F9FAFB' },
  exportBtn: {
    height: 52, borderRadius: 14, backgroundColor: '#10B981',
    alignItems: 'center', justifyContent: 'center',
  },
  exportBtnText: { color: 'white', fontSize: 18, fontWeight: '700' },
  btnDisabled: { opacity: 0.45 },
});
