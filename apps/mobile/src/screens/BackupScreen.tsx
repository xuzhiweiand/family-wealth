/**
 * 本地备份页（P0-2 本地加密备份与恢复）
 *
 * - 立即备份：全量家庭数据（含私密与软删除记录）→ 登录密码体系加密 →
 *   系统分享（Android）/ 系统另存为（鸿蒙）；
 * - 从备份恢复：选文件 → 输「生成备份时」的登录密码解密 →
 *   预览新增/更新/不变数量 → 确认后执行（仅合并：资产 LWW，快照按 id 并集）；
 * - 恢复不改变任何云端密钥体系，恢复出的数据会随正常同步上行到其他设备。
 */

import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAppNavigation } from '../lib/navigation';
import type { BackupFile } from '../lib/backup';
import {
  applyRestore,
  createBackup,
  decryptBackup,
  getLastBackupAt,
  pickBackup,
  previewRestore,
  type RestorePreview,
} from '../services/backup';

function fmtTime(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()} 年 ${d.getMonth() + 1} 月 ${d.getDate()} 日 ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export default function BackupScreen() {
  const insets = useSafeAreaInsets();
  const navigation = useAppNavigation();

  const [lastBackupAt, setLastBackupAt] = useState<string | null>(null);
  const [backing, setBacking] = useState(false);

  // 恢复流程状态机：file（已选待解密）→ preview（待确认）
  const [file, setFile] = useState<BackupFile | null>(null);
  const [fileName, setFileName] = useState('');
  const [password, setPassword] = useState('');
  const [preview, setPreview] = useState<RestorePreview | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void getLastBackupAt().then(setLastBackupAt);
  }, []);

  const resetRestore = () => {
    setFile(null);
    setFileName('');
    setPassword('');
    setPreview(null);
  };

  const handleBackup = async () => {
    if (backing) return;
    setBacking(true);
    try {
      const result = await createBackup();
      if (result.status === 'saved') {
        Alert.alert('备份成功', '加密备份已保存到你选择的位置，请妥善保管');
      }
      // shared：系统面板已表达；cancelled：用户主动取消，静默
      if (result.status !== 'cancelled') {
        setLastBackupAt(await getLastBackupAt());
      }
    } catch (err) {
      Alert.alert('备份失败', (err as Error).message);
    } finally {
      setBacking(false);
    }
  };

  const handlePick = async () => {
    try {
      const picked = await pickBackup();
      if (!picked) return; // 用户取消，静默
      setFile(picked.file);
      setFileName(picked.name);
      setPreview(null);
      setPassword('');
    } catch (err) {
      Alert.alert('无法读取备份', (err as Error).message);
    }
  };

  const handleDecrypt = async () => {
    if (!file || busy) return;
    if (password.length === 0) {
      Alert.alert('请输入密码', '恢复需要输入生成备份时的登录密码');
      return;
    }
    setBusy(true);
    try {
      const payload = await decryptBackup(file, password);
      setPassword(''); // 密码用完即弃
      setPreview(await previewRestore(payload));
    } catch (err) {
      Alert.alert('解密失败', (err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const handleConfirmRestore = () => {
    if (!preview || busy) return;
    const { assets, snapshots } = preview.plan.counts;
    Alert.alert(
      '确认恢复',
      `将新增 ${assets.added} 项资产、更新 ${assets.updated} 项资产、补写 ${snapshots.added} 条快照。\n现有较新的数据不会被覆盖。`,
      [
        { text: '取消', style: 'cancel' },
        {
          text: '确认恢复',
          onPress: async () => {
            setBusy(true);
            try {
              await applyRestore(preview.plan, preview.familyId);
              Alert.alert('恢复完成', '数据已合并到当前设备，并会同步到其他设备');
              resetRestore();
            } catch (err) {
              Alert.alert('恢复失败', (err as Error).message);
            } finally {
              setBusy(false);
            }
          },
        },
      ],
    );
  };

  const counts = preview?.plan.counts;
  const nothingToApply =
    counts !== undefined &&
    counts.assets.added === 0 &&
    counts.assets.updated === 0 &&
    counts.snapshots.added === 0;

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      {/* 顶部返回 */}
      <View style={styles.header}>
        <TouchableOpacity style={styles.backBtn} onPress={() => navigation.goBack()}>
          <Text style={styles.backText}>‹</Text>
        </TouchableOpacity>
        <Text style={styles.title}>本地备份</Text>
        <View style={styles.backBtn} />
      </View>

      <ScrollView contentContainerStyle={styles.body}>
        {/* 说明 */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>加密备份，只属于你</Text>
          <Text style={styles.desc}>
            备份包含家庭全部资产（含私密与已删除记录）和全部快照；
            用你的登录密码派生密钥加密，拿到文件的人没有密码也无法解开。
          </Text>
          <Text style={styles.desc}>
            建议每月盘点后备份一次，并把文件保存到手机之外的位置（如电脑或云盘）。
          </Text>
          <Text style={styles.lastBackup}>
            {lastBackupAt ? `上次备份：${fmtTime(lastBackupAt)}` : '还没有备份过'}
          </Text>
          <TouchableOpacity
            style={[styles.primaryBtn, backing && styles.btnDisabled]}
            onPress={() => void handleBackup()}
            disabled={backing}
          >
            {backing ? (
              <ActivityIndicator color="#FFFFFF" />
            ) : (
              <Text style={styles.primaryBtnText}>立即备份</Text>
            )}
          </TouchableOpacity>
        </View>

        {/* 恢复 */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>从备份恢复</Text>
          <Text style={styles.desc}>
            换机或重装后，选择之前保存的备份文件即可找回数据。
            恢复采用合并方式：已存在的较新数据不会被覆盖。
          </Text>

          <TouchableOpacity style={styles.secondaryBtn} onPress={() => void handlePick()}>
            <Text style={styles.secondaryBtnText}>
              {file ? `已选择：${fileName || '备份文件'}` : '选择备份文件'}
            </Text>
          </TouchableOpacity>

          {/* 已选文件 → 输密码解密 */}
          {file && !preview && (
            <View style={styles.stepBox}>
              <Text style={styles.stepLabel}>
                备份生成于 {fmtTime(file.createdAt)}，请输入当时的登录密码
              </Text>
              <TextInput
                style={styles.input}
                value={password}
                onChangeText={setPassword}
                placeholder="登录密码"
                placeholderTextColor="#9CA3AF"
                secureTextEntry
                autoCapitalize="none"
              />
              <TouchableOpacity
                style={[styles.primaryBtn, busy && styles.btnDisabled]}
                onPress={() => void handleDecrypt()}
                disabled={busy}
              >
                {busy ? (
                  <ActivityIndicator color="#FFFFFF" />
                ) : (
                  <Text style={styles.primaryBtnText}>解密并预览</Text>
                )}
              </TouchableOpacity>
            </View>
          )}

          {/* 解密成功 → 预览确认 */}
          {preview && counts && (
            <View style={styles.stepBox}>
              {preview.backupFamilyName && (
                <Text style={styles.stepLabel}>家庭：{preview.backupFamilyName}</Text>
              )}
              <Text style={styles.previewLine}>
                资产：新增 {counts.assets.added} 项，更新 {counts.assets.updated} 项，
                {counts.assets.unchanged} 项保持不变
              </Text>
              <Text style={styles.previewLine}>
                快照：补写 {counts.snapshots.added} 条，
                {counts.snapshots.existing} 条已存在
              </Text>
              {nothingToApply ? (
                <Text style={styles.upToDate}>当前数据已是最新，无需恢复</Text>
              ) : (
                <TouchableOpacity
                  style={[styles.primaryBtn, busy && styles.btnDisabled]}
                  onPress={handleConfirmRestore}
                  disabled={busy}
                >
                  {busy ? (
                    <ActivityIndicator color="#FFFFFF" />
                  ) : (
                    <Text style={styles.primaryBtnText}>确认恢复</Text>
                  )}
                </TouchableOpacity>
              )}
              <TouchableOpacity style={styles.cancelBtn} onPress={resetRestore}>
                <Text style={styles.cancelBtnText}>重新选择文件</Text>
              </TouchableOpacity>
            </View>
          )}
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#F9FAFB' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    height: 52,
  },
  backBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  backText: { fontSize: 32, color: '#111827', marginTop: -4 },
  title: { fontSize: 17, fontWeight: '600', color: '#111827' },
  body: { padding: 20, paddingBottom: 40 },
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    padding: 16,
    marginBottom: 20,
  },
  cardTitle: { fontSize: 16, fontWeight: '700', color: '#111827', marginBottom: 8 },
  desc: { fontSize: 13, color: '#6B7280', lineHeight: 20, marginBottom: 6 },
  lastBackup: { fontSize: 13, color: '#374151', marginTop: 4, marginBottom: 12 },
  primaryBtn: {
    height: 52,
    borderRadius: 12,
    backgroundColor: '#10B981',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 8,
  },
  primaryBtnText: { color: '#FFFFFF', fontSize: 18, fontWeight: '600' },
  btnDisabled: { opacity: 0.6 },
  secondaryBtn: {
    height: 52,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#10B981',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 8,
  },
  secondaryBtnText: { color: '#059669', fontSize: 16, fontWeight: '600' },
  stepBox: { marginTop: 16 },
  stepLabel: { fontSize: 13, color: '#374151', marginBottom: 8 },
  input: {
    height: 48,
    fontSize: 16,
    borderWidth: 1,
    borderColor: '#D1D5DB',
    borderRadius: 12,
    paddingHorizontal: 14,
    color: '#111827',
    backgroundColor: '#FFFFFF',
    marginBottom: 4,
  },
  previewLine: { fontSize: 14, color: '#111827', lineHeight: 22 },
  upToDate: { fontSize: 14, color: '#059669', marginTop: 12, textAlign: 'center' },
  cancelBtn: { height: 44, alignItems: 'center', justifyContent: 'center', marginTop: 4 },
  cancelBtnText: { fontSize: 14, color: '#6B7280' },
});
