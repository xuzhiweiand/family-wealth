import { StyleSheet, Text, View } from 'react-native';
import type { AssetType } from '@family-wealth/shared-types';
import { formatCNY } from '@family-wealth/shared-utils';

// W1 冒烟数据：验证 shared-types / shared-utils 链路可用
const SMOKE_ASSET_TYPES: AssetType[] = ['cash', 'stock', 'fund'];
const SMOKE_AMOUNTS: number[] = [50000, 320000, 128000];

export default function HomeScreen() {
  const total = SMOKE_AMOUNTS.reduce<number>((a, b) => a + b, 0);

  return (
    <View style={styles.container}>
      <Text style={styles.title}>家庭资产管理</Text>
      <Text style={styles.subtitle}>W1 · 项目初始化冒烟页</Text>

      <View style={styles.card}>
        <Text style={styles.cardLabel}>净资产（mock）</Text>
        <Text style={styles.cardValue}>{formatCNY(total)}</Text>
        {SMOKE_ASSET_TYPES.map((type, i) => {
          const amount = SMOKE_AMOUNTS[i] ?? 0;
          return (
            <View key={type} style={styles.row}>
              <Text style={styles.rowLabel}>{type}</Text>
              <Text style={styles.rowValue}>{formatCNY(amount)}</Text>
            </View>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F9FAFB',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  title: {
    fontSize: 28,
    fontWeight: '700',
    color: '#111827',
  },
  subtitle: {
    fontSize: 14,
    color: '#9CA3AF',
    marginTop: 4,
    marginBottom: 24,
  },
  card: {
    width: '100%',
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 20,
    shadowColor: '#000',
    shadowOpacity: 0.06,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 2,
  },
  cardLabel: {
    fontSize: 12,
    color: '#6B7280',
    marginBottom: 4,
  },
  cardValue: {
    fontSize: 32,
    fontWeight: '700',
    color: '#059669',
    marginBottom: 16,
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#F3F4F6',
  },
  rowLabel: {
    fontSize: 14,
    color: '#374151',
    textTransform: 'capitalize',
  },
  rowValue: {
    fontSize: 14,
    fontWeight: '600',
    color: '#111827',
  },
});
