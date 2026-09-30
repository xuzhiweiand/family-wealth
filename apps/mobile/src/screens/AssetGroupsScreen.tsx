/**
 * 分组管理页（P0-4）
 *
 * - 新建 / 重命名 / 删除 / 上下排序分组；
 * - 删除只删分组配置：组内资产自动回到「未分组」（验收 4），
 *   行内二次确认说明这一点；
 * - 分组配置为本机配置（验收 2 选定口径），页面顶部明示。
 */

import React, { useEffect, useState } from 'react';
import {
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAppNavigation } from '../lib/navigation';
import { useAssetGroupStore } from '../stores/asset-group-store';

export default function AssetGroupsScreen() {
  const insets = useSafeAreaInsets();
  const navigation = useAppNavigation();

  const groups = useAssetGroupStore((s) => s.groups);
  const hydrated = useAssetGroupStore((s) => s.hydrated);
  const hydrate = useAssetGroupStore((s) => s.hydrate);
  const add = useAssetGroupStore((s) => s.add);
  const rename = useAssetGroupStore((s) => s.rename);
  const remove = useAssetGroupStore((s) => s.remove);
  const move = useAssetGroupStore((s) => s.move);

  const [newName, setNewName] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editText, setEditText] = useState('');
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!hydrated) void hydrate();
  }, [hydrated, hydrate]);

  const submitNew = () => {
    try {
      add(newName);
      setNewName('');
      setError(null);
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const submitRename = (id: string) => {
    try {
      rename(id, editText);
      setEditingId(null);
      setError(null);
    } catch (err) {
      setError((err as Error).message);
    }
  };

  return (
    <View style={styles.page}>
      <View style={{ height: insets.top }} />
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} hitSlop={12}>
          <Text style={styles.back}>‹ 返回</Text>
        </TouchableOpacity>
        <Text style={styles.title}>分组管理</Text>
        <View style={{ width: 48 }} />
      </View>

      <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
        <Text style={styles.note}>
          分组名称与排序仅保存在本机；资产的分组归属会随资产加密同步。
        </Text>

        {/* 新建 */}
        <View style={styles.addRow}>
          <TextInput
            style={styles.input}
            placeholder="新分组名称（如：银行 / 投资 / 负债）"
            placeholderTextColor="#9CA3AF"
            value={newName}
            onChangeText={setNewName}
            maxLength={20}
          />
          <TouchableOpacity
            style={[styles.primaryBtn, newName.trim() === '' && styles.btnDisabled]}
            disabled={newName.trim() === ''}
            onPress={submitNew}
          >
            <Text style={styles.primaryBtnText}>新建</Text>
          </TouchableOpacity>
        </View>

        {error !== null ? <Text style={styles.error}>{error}</Text> : null}

        {groups.length === 0 ? (
          <Text style={styles.empty}>还没有分组，新建一个开始整理资产</Text>
        ) : (
          groups.map((g, idx) => (
            <View key={g.id} style={styles.row}>
              {editingId === g.id ? (
                <>
                  <TextInput
                    style={[styles.input, styles.rowInput]}
                    value={editText}
                    onChangeText={setEditText}
                    maxLength={20}
                    autoFocus
                  />
                  <TouchableOpacity style={styles.smallBtn} onPress={() => submitRename(g.id)}>
                    <Text style={styles.smallBtnText}>保存</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.smallBtn} onPress={() => setEditingId(null)}>
                    <Text style={styles.smallBtnTextMuted}>取消</Text>
                  </TouchableOpacity>
                </>
              ) : (
                <>
                  <Text style={styles.rowName} numberOfLines={1}>{g.name}</Text>
                  <TouchableOpacity
                    style={[styles.smallBtn, idx === 0 && styles.btnDisabled]}
                    disabled={idx === 0}
                    onPress={() => move(g.id, 'up')}
                    hitSlop={6}
                  >
                    <Text style={styles.smallBtnText}>上移</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.smallBtn, idx === groups.length - 1 && styles.btnDisabled]}
                    disabled={idx === groups.length - 1}
                    onPress={() => move(g.id, 'down')}
                    hitSlop={6}
                  >
                    <Text style={styles.smallBtnText}>下移</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={styles.smallBtn}
                    onPress={() => { setEditingId(g.id); setEditText(g.name); setConfirmDeleteId(null); }}
                    hitSlop={6}
                  >
                    <Text style={styles.smallBtnText}>改名</Text>
                  </TouchableOpacity>
                  {confirmDeleteId === g.id ? (
                    <>
                      <TouchableOpacity
                        style={[styles.smallBtn, styles.dangerBtn]}
                        onPress={() => { remove(g.id); setConfirmDeleteId(null); }}
                        hitSlop={6}
                      >
                        <Text style={styles.dangerBtnText}>确认删除</Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={styles.smallBtn}
                        onPress={() => setConfirmDeleteId(null)}
                        hitSlop={6}
                      >
                        <Text style={styles.smallBtnTextMuted}>取消</Text>
                      </TouchableOpacity>
                    </>
                  ) : (
                    <TouchableOpacity
                      style={styles.smallBtn}
                      onPress={() => { setConfirmDeleteId(g.id); setEditingId(null); }}
                      hitSlop={6}
                    >
                      <Text style={styles.dangerText}>删除</Text>
                    </TouchableOpacity>
                  )}
                </>
              )}
            </View>
          ))
        )}

        {confirmDeleteId !== null ? (
          <Text style={styles.note}>
            删除分组不会删除任何资产，组内资产将回到「未分组」。
          </Text>
        ) : null}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: '#F9FAFB' },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 20, paddingVertical: 14,
  },
  back: { fontSize: 16, color: '#10B981', width: 48 },
  title: { fontSize: 18, fontWeight: '700', color: '#111827' },
  body: { paddingHorizontal: 20, paddingBottom: 40 },
  note: { fontSize: 12, color: '#9CA3AF', marginBottom: 12, lineHeight: 18 },
  addRow: { flexDirection: 'row', gap: 10, marginBottom: 8 },
  input: {
    flex: 1, height: 48, fontSize: 16, color: '#111827',
    backgroundColor: 'white', borderColor: '#E5E7EB', borderWidth: 1,
    borderRadius: 12, paddingHorizontal: 14,
  },
  rowInput: { flex: 1 },
  primaryBtn: {
    height: 48, paddingHorizontal: 20, borderRadius: 12,
    backgroundColor: '#10B981', alignItems: 'center', justifyContent: 'center',
  },
  primaryBtnText: { color: 'white', fontSize: 16, fontWeight: '600' },
  btnDisabled: { opacity: 0.4 },
  error: { fontSize: 13, color: '#DC2626', marginBottom: 8 },
  empty: { fontSize: 14, color: '#9CA3AF', textAlign: 'center', marginTop: 32 },
  row: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: 'white', borderColor: '#E5E7EB', borderWidth: 1,
    borderRadius: 12, paddingHorizontal: 14, paddingVertical: 10, marginBottom: 10,
  },
  rowName: { flex: 1, fontSize: 16, fontWeight: '600', color: '#111827' },
  smallBtn: { paddingHorizontal: 6, paddingVertical: 6 },
  smallBtnText: { fontSize: 14, color: '#10B981' },
  smallBtnTextMuted: { fontSize: 14, color: '#6B7280' },
  dangerText: { fontSize: 14, color: '#DC2626' },
  dangerBtn: {
    backgroundColor: '#DC2626', borderRadius: 8, paddingHorizontal: 10,
  },
  dangerBtnText: { fontSize: 14, color: 'white', fontWeight: '600' },
});
