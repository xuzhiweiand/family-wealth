/**
 * OCR 金额识别回归语料
 *
 * 目的：在没有真机的情况下先把「解析层」的准确率钉死。
 * 每个样本模拟一个真实 App 截图的 OCR 输出（一行一块），
 * expectedInCents 是用户真正想录的那个数。
 *
 * 用法约定：
 *   - 真机联调拿到真实 OCR 文本后，往这里加样本即可回归
 *   - 难度分级：
 *     easy   金额与关键词在同一行（如「账户余额 ¥85,420.57」）
 *     medium 金额独立成行但带货币符号；或存在低分干扰项
 *     hard   关键词与金额分离 + 同屏多个带符号数字（依赖排序/兜底）
 */

import type { OcrBlock } from '../../types';

export interface CorpusSample {
  id: string;
  /** 场景描述（哪类 App 的哪个页面） */
  source: string;
  difficulty: 'easy' | 'medium' | 'hard';
  /** OCR 文本行，顺序即屏幕自上而下 */
  lines: readonly string[];
  /** 用户想录的金额（分） */
  expectedInCents: number;
}

export const OCR_CORPUS: readonly CorpusSample[] = [
  {
    id: 'cmb-debit-home',
    source: '招行借记卡首页',
    difficulty: 'easy',
    lines: [
      '招商银行',
      '储蓄卡(6222****1234)',
      '账户余额',
      '¥85,420.57',
      '昨日收益 +1.23元',
      '转账',
    ],
    expectedInCents: 8_542_057,
  },
  {
    id: 'icbc-deposit',
    source: '工行存款页',
    difficulty: 'easy',
    lines: [
      '中国工商银行',
      '活期存款',
      '可用余额 12,345.67元',
      '近7日收益 ¥3.45',
    ],
    expectedInCents: 1_234_567,
  },
  {
    id: 'alipay-assets',
    source: '支付宝总资产页',
    difficulty: 'medium',
    lines: [
      '总资产(元)',
      '¥234,567.89',
      '昨日收益 +12.34',
      '余额宝',
      '7日年化 2.34%',
    ],
    expectedInCents: 23_456_789,
  },
  {
    id: 'alipay-yuebao-split',
    source: '余额宝页（金额与关键词分离）',
    difficulty: 'hard',
    lines: [
      '余额宝',
      '可用额度',
      '123,456.78',
      '累计收益 ¥2,345.67',
      '万份收益 0.85',
    ],
    expectedInCents: 12_345_678,
  },
  {
    id: 'broker-positions',
    source: '券商持仓页',
    difficulty: 'medium',
    lines: [
      '华泰证券',
      '总市值 ¥1,234,567.89',
      '可用资金 ¥50,000.00',
      '持仓盈亏 -12,345.67',
      '当日参考盈亏 -1.23%',
      '仓位 68.5%',
    ],
    expectedInCents: 123_456_789,
  },
  {
    id: 'wechat-change',
    source: '微信零钱页',
    difficulty: 'easy',
    lines: [
      '微信支付',
      '零钱',
      '¥1,234.56',
      '零钱通收益 +2.34',
      '转入',
    ],
    expectedInCents: 123_456,
  },
  {
    id: 'credit-card-bill',
    source: '信用卡账单页',
    difficulty: 'easy',
    lines: [
      '信用卡',
      '本期应还金额 ¥3,456.78',
      '最低还款额 ¥345.67',
      '还款日 09月12日',
    ],
    expectedInCents: 345_678,
  },
  {
    id: 'fund-holding',
    source: '基金持仓页',
    difficulty: 'medium',
    lines: [
      '易方达货币基金',
      '持有金额 ¥123,456.78',
      '持有收益 +2,345.67',
      '近1年收益率 12.34%',
      '万份收益 0.89',
    ],
    expectedInCents: 12_345_678,
  },
  {
    id: 'wealth-mgmt',
    source: '银行理财页',
    difficulty: 'easy',
    lines: [
      '理财产品',
      '本金 ¥500,000.00',
      '预计年化收益率 3.25%',
      '产品期限 180天',
      '业绩比较基准 3.10%',
    ],
    expectedInCents: 50_000_000,
  },
  {
    id: 'mortgage-remaining',
    source: '房贷余额页',
    difficulty: 'easy',
    lines: [
      '个人住房贷款',
      '贷款余额 ¥1,234,567.00',
      '月供 ¥8,765.43',
      '已还期数 36',
    ],
    expectedInCents: 123_456_700,
  },
  {
    id: 'fixed-deposit',
    source: '定期存款页',
    difficulty: 'medium',
    lines: [
      '定期存款',
      '账户余额 ¥200,000.00',
      '年利率 1.95%',
      '存入日期 2026-01-15',
      '到期日 2027-01-15',
    ],
    expectedInCents: 20_000_000,
  },
  {
    id: 'gold-holding',
    source: '贵金属持仓页',
    difficulty: 'medium',
    lines: [
      '黄金积存',
      '持有克数 50.2克',
      '参考市值 ¥34,567.89',
      '今日涨幅 0.85%',
    ],
    expectedInCents: 3_456_789,
  },
  {
    id: 'cash-manual',
    source: '现金手记（无关键词无符号）',
    difficulty: 'hard',
    lines: [
      '现金',
      '5,678.90',
    ],
    expectedInCents: 567_890,
  },
  {
    id: 'transfer-received',
    source: '转账收款截图',
    difficulty: 'easy',
    lines: [
      '转账',
      '收款金额 ¥2,000.00',
      '转账时间 2026-09-07 14:32',
      '订单号 202609071432001234567',
    ],
    expectedInCents: 200_000,
  },
  {
    id: 'ant-wealth-split',
    source: '蚂蚁财富页（关键词分离+符号干扰）',
    difficulty: 'hard',
    lines: [
      '蚂蚁财富',
      '总资产',
      '¥987,654.32',
      '昨日收益 ¥1,234.56',
      '持仓产品 8',
    ],
    expectedInCents: 98_765_432,
  },
  {
    id: 'bank-card-list',
    source: '银行卡列表页',
    difficulty: 'medium',
    lines: [
      '我的账户',
      '储蓄卡',
      '余额 8,542.05元',
      '信用卡',
      '应还 ¥3,456.78',
    ],
    expectedInCents: 854_205,
  },
  {
    id: 'licaitong',
    source: '理财通页',
    difficulty: 'easy',
    lines: [
      '理财通',
      '总资产 ¥500,000.00',
      '近7日年化 2.15%',
      '累计收益 +3,456.78',
    ],
    expectedInCents: 50_000_000,
  },
  {
    id: 'margin-liability',
    source: '融资融券页',
    difficulty: 'medium',
    lines: [
      '融资融券',
      '负债总额 ¥250,000.00',
      '授信额度 ¥1,000,000.00',
      '维持担保比例 280.5%',
    ],
    expectedInCents: 25_000_000,
  },
  {
    id: 'matured-principal',
    source: '理财到期页',
    difficulty: 'medium',
    lines: [
      '到期理财产品',
      '到期本金 ¥100,000.00',
      '预期收益 ¥2,150.00',
      '到期日 2026-09-10',
    ],
    expectedInCents: 10_000_000,
  },
  {
    id: 'insurance-cash-value',
    source: '保单现金价值页',
    difficulty: 'medium',
    lines: [
      '保单详情',
      '现金价值 ¥80,000.00',
      '已交保费 ¥96,000.00',
      '保单号 202600123456789',
    ],
    expectedInCents: 8_000_000,
  },
  {
    id: 'crypto-account',
    source: '数字货币账户页',
    difficulty: 'medium',
    lines: [
      '币币账户',
      '总估值 ¥12,345.67',
      '24h涨跌幅 -3.45%',
      '可用 0.5 BTC',
    ],
    expectedInCents: 1_234_567,
  },
  {
    id: 'loan-receivable',
    source: '借出债权页',
    difficulty: 'medium',
    lines: [
      '借出',
      '本金 ¥50,000.00',
      '约定年利率 5.00%',
      '还款进度 3/12',
    ],
    expectedInCents: 5_000_000,
  },
  {
    id: 'auto-loan',
    source: '车贷页（两个同分候选）',
    difficulty: 'hard',
    lines: [
      '汽车金融',
      '剩余应还',
      '¥120,000.00',
      '月还款 ¥4,200.00',
    ],
    expectedInCents: 12_000_000,
  },
  {
    id: 'fullwidth-digits',
    source: '全角数字识别',
    difficulty: 'hard',
    lines: [
      '当前余额',
      '¥１２,３４５.６７',
      '明细',
    ],
    expectedInCents: 1_234_567,
  },
  {
    id: 'ten-thousand-unit',
    source: '万单位金额',
    difficulty: 'medium',
    lines: [
      '家庭总资产',
      '128.56万',
      '环比上月 +2.34%',
    ],
    expectedInCents: 128_560_000,
  },
];

/** 把语料样本转成 OCR blocks（自上而下排列，模拟屏幕布局） */
export function corpusToBlocks(sample: CorpusSample): OcrBlock[] {
  return sample.lines.map((text, i) => ({
    text,
    bbox: { x: 0, y: i * 40, width: 360, height: 36 },
    confidence: 0.92,
  }));
}
