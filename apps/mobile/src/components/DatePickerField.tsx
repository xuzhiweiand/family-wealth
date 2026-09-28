/**
 * 记账日期选择字段（平台自适应）
 *
 * - Android/iOS：@react-native-community/datetimepicker 渲染原生弹窗，选择/取消后关闭
 * - HarmonyOS：社区库的 harmony 实现是**内联原生组件**（ArkUI DatePicker），
 *   必须由容器提供显式高度，否则布局高度为 0、表现为「点了弹不出来」。
 *   因此鸿蒙端在固定高度容器内联展示，并提供「完成」按钮收起。
 */

import { useState } from 'react';
import { Platform, View } from 'react-native';
import { Button, Text, XStack, YStack } from 'tamagui';
import DateTimePicker from '@react-native-community/datetimepicker';

const isHarmony = (Platform.OS as string) === 'harmony';

/** YYYY-MM-DD */
function formatDate(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

interface Props {
  value: Date;
  onChange: (d: Date) => void;
  /** 字段下方灰色说明文字 */
  hintText?: string;
}

export function DatePickerField({ value, onChange, hintText }: Props) {
  const [open, setOpen] = useState(false);

  return (
    <YStack space="$xs">
      <Text fontSize="$2" color="$textSecondary">
        记账日期
      </Text>
      <Button
        size={48}
        fontSize={16}
        justifyContent="flex-start"
        paddingHorizontal={16}
        backgroundColor="$bgPrimary"
        color="$textPrimary"
        borderColor="$border"
        borderWidth={1}
        onPress={() => setOpen(true)}
      >
        {formatDate(value)}
      </Button>

      {open ? (
        isHarmony ? (
          // 鸿蒙：固定高度容器内联滚轮（无显式高度则不可见）
          <View
            style={{
              height: 248,
              backgroundColor: '#FFFFFF',
              borderWidth: 1,
              borderColor: '#E5E7EB',
              borderRadius: 12,
              overflow: 'hidden',
            }}
          >
            <DateTimePicker
              value={value}
              mode="date"
              display="spinner"
              onChange={(_event, d) => {
                if (d) onChange(d);
              }}
              // harmony 平台内联组件容器样式，非 harmony 平台忽略
              style={{ flex: 1, width: '100%' }}
            />
            <XStack
              justifyContent="flex-end"
              paddingHorizontal={12}
              paddingVertical={6}
              borderTopWidth={1}
              borderTopColor="#F3F4F6"
            >
              <Button
                size={36}
                fontSize={14}
                chromeless
                color="$primary"
                onPress={() => setOpen(false)}
              >
                完成
              </Button>
            </XStack>
          </View>
        ) : (
          // Android/iOS：原生弹窗
          <DateTimePicker
            value={value}
            mode="date"
            display="default"
            onChange={(event, d) => {
              setOpen(false);
              if (d) onChange(d);
            }}
          />
        )
      ) : null}

      {hintText ? (
        <Text fontSize="$1" color="$textSecondary">
          {hintText}
        </Text>
      ) : null}
    </YStack>
  );
}
