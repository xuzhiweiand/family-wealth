/**
 * 首次启动隐私政策同意弹窗
 *
 * 合规要求（AppGallery 审核）：应用首次启动时必须明确提示用户阅读隐私政策，
 * 获得同意后方可继续使用。不同意则退出应用。
 */

import { Modal, View, TouchableOpacity, Linking, BackHandler, StyleSheet } from 'react-native';
import { Text, YStack } from 'tamagui';
import { PRIVACY_POLICY_URL, savePrivacyConsent } from '../services/privacy-consent';

interface Props {
  visible: boolean;
  onAgree: () => void;
}

export function PrivacyConsentDialog({ visible, onAgree }: Props) {
  const openPolicy = () => {
    void Linking.openURL(PRIVACY_POLICY_URL);
  };

  const handleDisagree = () => {
    // 不同意隐私政策：退出应用（合规要求）
    BackHandler.exitApp();
  };

  const handleAgree = async () => {
    await savePrivacyConsent();
    onAgree();
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={handleDisagree}>
      <View style={styles.mask}>
        <View style={styles.card}>
          <YStack space="$md">
            <Text fontSize={17} fontWeight="700" color="#111827" textAlign="center">
              隐私政策提示
            </Text>
            <Text fontSize={14} color="#374151" lineHeight={22}>
              感谢您使用家资。我们非常重视您的个人信息和隐私保护。{'\n\n'}
              在您使用本应用前，请仔细阅读并充分理解
              <Text color="#059669" onPress={openPolicy}>
                《隐私政策》
              </Text>
              的全部内容。您的资产数据采用端到端加密存储，服务端无法查看明文。{'\n\n'}
              点击"同意"即表示您已阅读并同意隐私政策的全部内容。
            </Text>
            <YStack space="$sm" marginTop="$sm">
              <TouchableOpacity style={styles.agreeBtn} onPress={() => void handleAgree()}>
                <Text fontSize={16} fontWeight="600" color="white" textAlign="center">
                  同意
                </Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.disagreeBtn} onPress={handleDisagree}>
                <Text fontSize={15} color="#6B7280" textAlign="center">
                  不同意并退出
                </Text>
              </TouchableOpacity>
            </YStack>
          </YStack>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  mask: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    paddingHorizontal: 32,
  },
  card: {
    backgroundColor: 'white',
    borderRadius: 16,
    padding: 24,
  },
  agreeBtn: {
    height: 48,
    borderRadius: 12,
    backgroundColor: '#10B981',
    justifyContent: 'center',
  },
  disagreeBtn: {
    height: 44,
    justifyContent: 'center',
  },
});
