import { formatFeedbackDate, createFeedbackId, validateFeedbackContent } from '../services/feedback-store';
import { isValidPhone, maskPhone } from '../services/phone';

describe('手机号校验', () => {
  it('接受 11 位大陆手机号', () => {
    expect(isValidPhone('13800138000')).toBe(true);
    expect(isValidPhone('19912345678')).toBe(true);
  });

  it('拒绝位数不足或非法号段', () => {
    expect(isValidPhone('1380013800')).toBe(false);
    expect(isValidPhone('12800138000')).toBe(false);
    expect(isValidPhone('138001380001')).toBe(false);
    expect(isValidPhone('1380013800a')).toBe(false);
  });

  it('脱敏展示保留前 3 后 4 位', () => {
    expect(maskPhone('13800138000')).toBe('138****8000');
    expect(maskPhone('123')).toBe('123');
  });
});

describe('反馈工单', () => {
  it('工单号按日期与序号生成', () => {
    const id = createFeedbackId(new Date(2026, 10, 4), 7);
    expect(id).toBe('FB-20261104-0007');
  });

  it('日期与序号补零', () => {
    const id = createFeedbackId(new Date(2026, 0, 9), 1);
    expect(id).toBe('FB-20260109-0001');
    expect(formatFeedbackDate(new Date(2026, 0, 9).getTime())).toBe('2026-01-09');
  });

  it('反馈内容为空或超长时给出错误', () => {
    expect(validateFeedbackContent('   ')).toBe('请填写反馈内容');
    expect(validateFeedbackContent('a'.repeat(501))).toContain('500');
    expect(validateFeedbackContent('正常反馈')).toBeNull();
  });
});
