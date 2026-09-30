/**
 * 月末盘点提醒 TurboModule（ArkTS 侧，Calendar Kit 实现）
 *
 * 方案选型：Calendar Kit 替代 ReminderAgent
 * - READ_CALENDAR / WRITE_CALENDAR 为 user_grant 权限，用户弹窗授权即可，
 *   无需 AGC ACL 审批（ReminderAgent 需审批 3-7 工作日）
 * - 日历事件由系统日历 App 负责到点提醒，App 被杀也能触发
 * - recurrenceRule 原生支持按月重复，简化调度逻辑
 *
 * 事件管理：
 * - 使用专属日历账户 'familywealth'（避免污染用户默认日历）
 * - 事件 title 携带唯一 id，便于查询/更新/删除
 * - 启动时 diff 校验：用户手动删除的事件自动重建
 *
 * 模块名 ReminderAgent：JS 侧 TurboModuleRegistry、本文件、
 * C++ ReminderAgentPackage.h 三处必须一致。
 */

import { TurboModule, TurboModuleContext } from '@rnoh/react-native-openharmony/ts';
import { calendarManager } from '@kit.CalendarKit';
import { common, Permissions, abilityAccessCtrl } from '@kit.AbilityKit';
import { BusinessError } from '@kit.BasicServicesKit';

const TAG = 'ReminderAgent(Calendar)';
const EVENT_TITLE_PREFIX = '家资盘点';

export class ReminderAgentTurboModule extends TurboModule {
  private calendar: calendarManager.Calendar | null = null;

  constructor(ctx: TurboModuleContext) {
    super(ctx);
  }

  /**
   * 获取或创建专属日历账户
   */
  private async ensureCalendar(context: common.Context): Promise<calendarManager.Calendar> {
    if (this.calendar) return this.calendar;

    // 使用默认日历（Calendar Kit 的 getCalendar 无参时返回默认日历）
    this.calendar = await calendarManager.getCalendarManager(context).getCalendar();
    return this.calendar;
  }

  /**
   * 请求日历权限（READ_CALENDAR + WRITE_CALENDAR）
   */
  async requestCalendarPermission(): Promise<boolean> {
    try {
      const context = this.ctx.uiAbilityContext as common.UIAbilityContext;
      const atManager = abilityAccessCtrl.createAtManager();
      const permissions: Permissions[] = [
        'ohos.permission.READ_CALENDAR',
        'ohos.permission.WRITE_CALENDAR',
      ];
      const result = await atManager.requestPermissionsFromUser(context, permissions);
      const granted = result.authResults.every((r) => r === 0);
      console.info(`${TAG}: requestCalendarPermission result=${granted}`);
      return granted;
    } catch (err) {
      const error = err as BusinessError;
      console.error(`${TAG}: requestCalendarPermission failed, code=${error.code}`);
      return false;
    }
  }

  /**
   * 检查日历权限状态
   */
  async checkCalendarPermission(): Promise<string> {
    try {
      const context = this.ctx.uiAbilityContext as common.UIAbilityContext;
      const atManager = abilityAccessCtrl.createAtManager();
      const permissions: Permissions[] = [
        'ohos.permission.READ_CALENDAR',
        'ohos.permission.WRITE_CALENDAR',
      ];
      const results = await atManager.checkAccessToken(
        context.applicationInfo.accessTokenId,
        permissions[0],
      );
      const writeResult = await atManager.checkAccessToken(
        context.applicationInfo.accessTokenId,
        permissions[1],
      );
      const granted =
        results === abilityAccessCtrl.GrantStatus.PERMISSION_GRANTED &&
        writeResult === abilityAccessCtrl.GrantStatus.PERMISSION_GRANTED;
      return granted ? 'granted' : 'denied';
    } catch (err) {
      return 'unknown';
    }
  }

  /**
   * 发布日历提醒（支持单次和月度重复）
   *
   * @param id 提醒唯一标识
   * @param timestamp 首次触发时间戳（毫秒）
   * @param title 事件标题
   * @param body 事件描述
   * @param recurring 是否按月重复（true: 每月最后一日；false: 单次）
   * @returns 是否发布成功
   */
  async publishCalendarReminder(
    id: string,
    timestamp: number,
    title: string,
    body: string,
    recurring: boolean,
  ): Promise<boolean> {
    try {
      const context = this.ctx.uiAbilityContext as common.UIAbilityContext;
      const calendar = await this.ensureCalendar(context);

      // 构造日历事件（直接用 calendarManager.Event 类型）
      const event: calendarManager.Event = {
        type: calendarManager.EventType.NORMAL,
        title: `${EVENT_TITLE_PREFIX} · ${title}`,
        description: body + `\n[id:${id}]`, // 在 description 中嵌入 id，便于后续查询
        startTime: timestamp,
        endTime: timestamp + 30 * 60 * 1000, // 30 分钟时长
        reminderTime: [0], // 准点提醒
      };

      // 如果按月重复，添加 recurrenceRule
      if (recurring) {
        event.recurrenceRule = {
          recurrenceFrequency: calendarManager.RecurrenceFrequency.MONTHLY,
          count: 12, // 未来 12 个月
        };
      }

      // 先删除同 id 的旧事件（避免重复）
      await this.deleteEventById(calendar, id);

      // 创建新事件
      const eventId = await calendar.addEvent(event);
      console.info(
        `${TAG}: publishCalendarReminder success, id=${id}, eventId=${eventId}, recurring=${recurring}`,
      );
      return true;
    } catch (err) {
      const error = err as BusinessError;
      console.error(
        `${TAG}: publishCalendarReminder failed, code=${error.code}, msg=${error.message}`,
      );
      return false;
    }
  }

  /**
   * 取消指定提醒
   */
  async cancelReminder(id: string): Promise<void> {
    try {
      const context = this.ctx.uiAbilityContext as common.UIAbilityContext;
      const calendar = await this.ensureCalendar(context);
      await this.deleteEventById(calendar, id);
      console.info(`${TAG}: cancelReminder success, id=${id}`);
    } catch (err) {
      const error = err as BusinessError;
      console.error(`${TAG}: cancelReminder failed, code=${error.code}`);
    }
  }

  /**
   * 取消所有提醒
   */
  async cancelAllReminders(): Promise<void> {
    try {
      const context = this.ctx.uiAbilityContext as common.UIAbilityContext;
      const calendar = await this.ensureCalendar(context);
      const events = await calendar.getEvents();

      // 删除所有以 '家资盘点' 开头的事件
      for (const event of events) {
        if (event.title?.startsWith(EVENT_TITLE_PREFIX)) {
          await calendar.deleteEvent(event.id!);
        }
      }
      console.info(`${TAG}: cancelAllReminders success`);
    } catch (err) {
      const error = err as BusinessError;
      console.error(`${TAG}: cancelAllReminders failed, code=${error.code}`);
    }
  }

  /**
   * 查询所有已调度的提醒（用于启动时 diff 校验）
   *
   * @returns 提醒 id 列表（JSON 字符串数组）
   */
  async getScheduledReminders(): Promise<string> {
    try {
      const context = this.ctx.uiAbilityContext as common.UIAbilityContext;
      const calendar = await this.ensureCalendar(context);
      const events = await calendar.getEvents();

      // 提取所有 '家资盘点' 事件的 id（从 title 解析）
      const ids: string[] = [];
      for (const event of events) {
        if (event.title?.startsWith(EVENT_TITLE_PREFIX)) {
          // title 格式：'家资盘点 · reminder:2026-01:main:2026-01-31'
          // 从 description 中提取 id（我们在 description 中存储了原始 id）
          const match = event.description?.match(/\[id:([^\]]+)\]/);
          if (match) {
            ids.push(match[1]);
          }
        }
      }
      return JSON.stringify(ids);
    } catch (err) {
      const error = err as BusinessError;
      console.error(`${TAG}: getScheduledReminders failed, code=${error.code}`);
      return '[]';
    }
  }

  /**
   * 根据 id 删除事件（内部辅助方法）
   */
  private async deleteEventById(
    calendar: calendarManager.Calendar,
    id: string,
  ): Promise<void> {
    const events = await calendar.getEvents();
    for (const event of events) {
      // 从 description 中匹配 id
      if (event.description?.includes(`[id:${id}]`)) {
        await calendar.deleteEvent(event.id!);
        console.info(`${TAG}: deleted event id=${id}, eventId=${event.id}`);
      }
    }
  }
}
