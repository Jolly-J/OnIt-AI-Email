import React, { useState, useEffect, useRef } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { Calendar } from '@/components/ui/calendar';
import {
  Calendar as CalendarIcon,
  Clock,
  MapPin,
  Video,
  Users,
  Mail,
  CheckCircle2,
  Loader2,
  Building2,
  Copy,
  Check,
  ExternalLink,
  Search,
  X,
  ChevronDown,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  api,
  type MeetingRoomItem,
  type CreateMeetingResult,
  type InternalContactItem,
} from '@/lib/api';
import { toast } from 'sonner';

interface DingTalkScheduleDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialData?: {
    summary?: string;
    description?: string;
    meeting_date?: string;
    start_time?: string;
    end_time?: string;
    attendee_mobiles?: string[];
    attendee_userids?: string[];
    attendee_emails?: string[];
    email_account_id?: number;
  };
  onSuccess?: (result: CreateMeetingResult) => void;
}

// 5分钟级双列时间选择器 (时:分 Popover)
const HOURS = Array.from({ length: 24 }, (_, i) => String(i).padStart(2, '0'));
const BASE_MINUTES = ['00', '05', '10', '15', '20', '25', '30', '35', '40', '45', '50', '55'];

interface FiveMinuteTimePickerProps {
  value: string;
  onChange: (val: string) => void;
  placeholder?: string;
  className?: string;
}

const FiveMinuteTimePicker: React.FC<FiveMinuteTimePickerProps> = ({
  value,
  onChange,
  placeholder = '选择时间',
  className,
}) => {
  const [popoverOpen, setPopoverOpen] = useState(false);
  const hourScrollRef = useRef<HTMLDivElement>(null);
  const minuteScrollRef = useRef<HTMLDivElement>(null);
  const selectedHourRef = useRef<HTMLButtonElement>(null);
  const selectedMinuteRef = useRef<HTMLButtonElement>(null);

  const [currentHour, currentMinute] = (value && value.includes(':'))
    ? value.split(':')
    : ['09', '00'];

  const minutesList = BASE_MINUTES.includes(currentMinute)
    ? BASE_MINUTES
    : [...BASE_MINUTES, currentMinute].sort();

  // 展开浮层时自动滚动到当前选中项
  useEffect(() => {
    if (popoverOpen) {
      const timer = setTimeout(() => {
        selectedHourRef.current?.scrollIntoView({ block: 'center', behavior: 'smooth' });
        selectedMinuteRef.current?.scrollIntoView({ block: 'center', behavior: 'smooth' });
      }, 50);
      return () => clearTimeout(timer);
    }
  }, [popoverOpen]);

  return (
    <Popover open={popoverOpen} onOpenChange={setPopoverOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={popoverOpen}
          className={cn(
            "w-[105px] h-9 px-2.5 text-xs justify-between font-normal bg-background hover:bg-muted/40",
            className
          )}
        >
          <span className="font-mono text-xs">{value || placeholder}</span>
          <ChevronDown className="h-3.5 w-3.5 opacity-50 shrink-0 ml-1" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-48 p-2 z-50 shadow-md" align="start">
        <div className="flex divide-x divide-border">
          {/* 小时列 (00~23) */}
          <div className="flex-1 pr-1.5">
            <div className="text-[11px] font-medium text-muted-foreground px-1 py-0.5 text-center border-b border-border/60 mb-1">
              时
            </div>
            <div
              ref={hourScrollRef}
              className="h-44 overflow-y-auto space-y-0.5 pr-0.5 text-xs"
            >
              {HOURS.map((h) => {
                const isSelected = h === currentHour;
                return (
                  <button
                    key={h}
                    type="button"
                    ref={isSelected ? selectedHourRef : undefined}
                    onClick={() => {
                      onChange(`${h}:${currentMinute || '00'}`);
                    }}
                    className={cn(
                      "w-full text-center py-1 text-xs rounded transition-colors font-mono",
                      isSelected
                        ? "bg-primary text-primary-foreground font-semibold"
                        : "hover:bg-muted text-foreground"
                    )}
                  >
                    {h}
                  </button>
                );
              })}
            </div>
          </div>

          {/* 分钟列 (5分钟级) */}
          <div className="flex-1 pl-1.5">
            <div className="text-[11px] font-medium text-muted-foreground px-1 py-0.5 text-center border-b border-border/60 mb-1">
              分
            </div>
            <div
              ref={minuteScrollRef}
              className="h-44 overflow-y-auto space-y-0.5 pl-0.5 text-xs"
            >
              {minutesList.map((m) => {
                const isSelected = m === currentMinute;
                return (
                  <button
                    key={m}
                    type="button"
                    ref={isSelected ? selectedMinuteRef : undefined}
                    onClick={() => {
                      onChange(`${currentHour || '09'}:${m}`);
                      setPopoverOpen(false);
                    }}
                    className={cn(
                      "w-full text-center py-1 text-xs rounded transition-colors font-mono",
                      isSelected
                        ? "bg-primary text-primary-foreground font-semibold"
                        : "hover:bg-muted text-foreground"
                    )}
                  >
                    {m}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
};

// 默认推荐时间段：对齐到下一个 5 分钟整倍数，时长默认 1 小时
const getDefaultTimeRange = () => {
  const now = new Date();
  const minutes = now.getMinutes();
  const rem = minutes % 5;
  const add = rem === 0 ? 5 : 5 - rem;
  now.setMinutes(minutes + add, 0, 0);

  const pad = (n: number) => String(n).padStart(2, '0');
  const start = `${pad(now.getHours())}:${pad(now.getMinutes())}`;
  const endObj = new Date(now.getTime() + 60 * 60 * 1000);
  const end = `${pad(endObj.getHours())}:${pad(endObj.getMinutes())}`;
  return { start, end };
};

export const DingTalkScheduleDialog: React.FC<DingTalkScheduleDialogProps> = ({
  open,
  onOpenChange,
  initialData,
  onSuccess,
}) => {
  // 表单状态
  const initialTimes = getDefaultTimeRange();
  const [summary, setSummary] = useState('');
  const [description, setDescription] = useState('');
  const [meetingDate, setMeetingDate] = useState('');
  const [startTime, setStartTime] = useState(initialTimes.start);
  const [endTime, setEndTime] = useState(initialTimes.end);
  const [selectedRoomId, setSelectedRoomId] = useState<string>('none');
  const [emailInput, setEmailInput] = useState('');
  const [enableVideo, setEnableVideo] = useState(true);
  const [sendIcs, setSendIcs] = useState(false);
  const [copied, setCopied] = useState(false);

  // 内部参会人状态
  const [internalContacts, setInternalContacts] = useState<InternalContactItem[]>([]);
  const [selectedContacts, setSelectedContacts] = useState<InternalContactItem[]>([]);
  const [contactSearch, setContactSearch] = useState('');
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const [shouldRenderDropdown, setShouldRenderDropdown] = useState(false);
  const [isDropdownActive, setIsDropdownActive] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // 内部参会同事下拉框出退场平滑动效 (05-menu-dropdown 规范)
  useEffect(() => {
    if (isDropdownOpen && internalContacts.length > 0) {
      setShouldRenderDropdown(true);
      const raf = requestAnimationFrame(() => setIsDropdownActive(true));
      return () => cancelAnimationFrame(raf);
    } else {
      setIsDropdownActive(false);
      const timer = setTimeout(() => {
        setShouldRenderDropdown(false);
      }, 150);
      return () => clearTimeout(timer);
    }
  }, [isDropdownOpen, internalContacts.length]);

  // 会议室列表与状态
  const [rooms, setRooms] = useState<MeetingRoomItem[]>([]);
  const [isLoadingRooms, setIsLoadingRooms] = useState(false);

  // 提交与交互动效状态
  const [submitting, setSubmitting] = useState(false);
  const [isShaking, setIsShaking] = useState(false);
  const [successResult, setSuccessResult] = useState<CreateMeetingResult | null>(null);

  // 初始化填充数据
  useEffect(() => {
    if (open) {
      setSuccessResult(null);
      setCopied(false);
      const today = new Date().toISOString().split('T')[0];
      const dTimes = getDefaultTimeRange();
      setSummary(initialData?.summary || '【线上沟通】业务对接会议');
      setDescription(initialData?.description || '基于邮件往来确认的线上会议沟通');
      setMeetingDate(initialData?.meeting_date || today);
      setStartTime(initialData?.start_time || dTimes.start);
      setEndTime(initialData?.end_time || dTimes.end);
      setSelectedRoomId('none');
      setEmailInput(initialData?.attendee_emails?.join(', ') || '');
      setSelectedContacts([]);
      setContactSearch('');
      setIsDropdownOpen(false);
      setSendIcs(Boolean(initialData?.attendee_emails && initialData.attendee_emails.length > 0));
    }
  }, [open, initialData]);

  // 监听日期与时间变动，自动查询会议室实时可用状态
  useEffect(() => {
    if (!open || !meetingDate || !startTime || !endTime) return;

    let isMounted = true;
    setIsLoadingRooms(true);

    api.calendar
      .getRooms({ date: meetingDate, startTime, endTime })
      .then((res) => {
        if (isMounted) {
          setRooms(res.rooms || []);
        }
      })
      .catch((err) => {
        console.error('加载会议室列表失败:', err);
      })
      .finally(() => {
        if (isMounted) setIsLoadingRooms(false);
      });

    return () => {
      isMounted = false;
    };
  }, [open, meetingDate, startTime, endTime]);

  // 加载内部员工通讯录
  useEffect(() => {
    if (!open) return;
    let isMounted = true;
    api.calendar
      .getContacts(contactSearch)
      .then((data) => {
        if (isMounted) setInternalContacts(data || []);
      })
      .catch((err) => {
        console.error('获取内部同事失败:', err);
      });

    return () => {
      isMounted = false;
    };
  }, [open, contactSearch]);

  // 点击外部关闭联系人下拉框
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setIsDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // 触发表单错误震颤
  const triggerShake = () => {
    setIsShaking(true);
    setTimeout(() => setIsShaking(false), 500);
  };

  // 日历弹窗状态
  const [isCalendarOpen, setIsCalendarOpen] = useState(false);

  // 变更开始时间时，若结束时间早于或等于开始时间，则智能顺延 1 小时
  const handleStartTimeChange = (newStart: string) => {
    setStartTime(newStart);
    if (endTime <= newStart) {
      const [h, m] = newStart.split(':').map(Number);
      const endH = Math.min(23, h + 1);
      const endStr = `${String(endH).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
      setEndTime(endStr);
    }
  };

  // 处理提交
  const handleSubmit = async () => {
    if (!summary.trim()) {
      toast.error('请输入会议主题');
      triggerShake();
      return;
    }
    if (!meetingDate) {
      toast.error('请选择会议日期');
      triggerShake();
      return;
    }
    if (startTime >= endTime) {
      toast.error('会议结束时间必须晚于开始时间');
      triggerShake();
      return;
    }

    // 检查所选会议室是否冲突
    const currentRoom = rooms.find((r) => r.id === selectedRoomId);
    if (selectedRoomId !== 'none' && currentRoom && currentRoom.is_available === false) {
      toast.error(`所选会议室已被占用：${currentRoom.status_message || '不可预约'}`);
      triggerShake();
      return;
    }

    // 解析客户邮箱
    const emails = emailInput
      .split(/[,，\s]+/)
      .map((s) => s.trim())
      .filter((s) => s.includes('@'));

    // 内部参会人钉钉标识列表 (优先传 unionid，兼备 userid)
    const userids = selectedContacts.map((c) => c.unionid || c.userid).filter(Boolean);

    setSubmitting(true);
    try {
      const res = await api.calendar.createMeeting({
        summary: summary.trim(),
        description: description.trim(),
        meeting_date: meetingDate,
        start_time: startTime,
        end_time: endTime,
        room_id: selectedRoomId === 'none' ? undefined : selectedRoomId,
        room_name: currentRoom ? currentRoom.name : undefined,
        attendee_userids: userids,
        attendee_emails: emails,
        enable_video_meeting: enableVideo,
        send_ics_email: sendIcs,
        email_account_id: initialData?.email_account_id,
      });

      setSuccessResult(res);
      toast.success(res.message || '钉钉视频会议日程已成功创建');
      if (onSuccess) onSuccess(res);
    } catch (err: any) {
      triggerShake();
      toast.error(err?.message || '创建会议日程失败');
    } finally {
      setSubmitting(false);
    }
  };

  // 复制钉钉视频入会邀请信息 (官方标准规范)
  const handleCopyInvite = () => {
    const videoUrl = successResult?.video_meeting?.url || successResult?.dingtalk_event?.onlineMeetingInfo?.url || '';
    const confId = successResult?.video_meeting?.conference_id || successResult?.dingtalk_event?.onlineMeetingInfo?.conferenceId || '';
    const organizer = successResult?.organizer_name || successResult?.dingtalk_event?.organizer?.displayName || '发起人';
    const roomName = selectedRoomObj ? selectedRoomObj.name : '线上会议';
    
    let text = `【钉钉视频会议邀请】${summary}
• 组织者：${organizer}
• 会议时间：${meetingDate} ${startTime} ~ ${endTime} (GMT+8)
• 会议地点：${roomName}`;
    if (confId) {
      text += `\n• 钉钉会议号：${confId}`;
    }
    if (videoUrl) {
      text += `\n• 📹 视频入会直达：${videoUrl}`;
    }
    if (description) {
      text += `\n• 会议说明：${description}`;
    }

    navigator.clipboard.writeText(text);
    setCopied(true);
    toast.success('会议邀请已复制到剪贴板，可直接粘贴发给微信或钉钉好友');
    setTimeout(() => setCopied(false), 2000);
  };

  const selectedRoomObj = rooms.find((r) => r.id === selectedRoomId);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className={`max-w-xl max-h-[85vh] p-0 flex flex-col gap-0 overflow-hidden ${
          isShaking ? 't-error-shake' : ''
        }`}
      >
        {successResult ? (
          // 成功态页面 (配合 10-Success Check 动效)
          <div className="p-6 overflow-y-auto max-h-[85vh] flex flex-col items-center text-center space-y-4">
            <div className="w-16 h-16 rounded-full bg-emerald-50 dark:bg-emerald-950/30 flex items-center justify-center border border-emerald-200 dark:border-emerald-800">
              <span className="t-success-check text-emerald-600 dark:text-emerald-400" data-state="in">
                <CheckCircle2 className="w-10 h-10" />
              </span>
            </div>
            <div className="space-y-1">
              <h3 className="text-xl font-semibold text-foreground">会议日程安排完成</h3>
              <p className="text-sm text-muted-foreground">已向参会人派发钉钉日程通知并协同锁房</p>
            </div>

            <div className="w-full space-y-3 text-left pt-2">
              <div className="p-3.5 rounded-lg border bg-muted/30 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-muted-foreground flex items-center gap-1.5">
                    <Video className="w-3.5 h-3.5 text-blue-500" />
                    钉钉视频会议
                  </span>
                  <Badge variant="outline" className="text-blue-600 bg-blue-50 dark:bg-blue-950/50 border-blue-200">
                    已排期
                  </Badge>
                </div>
                <p className="text-sm font-medium">{summary}</p>
                <div className="text-xs text-muted-foreground flex items-center gap-2">
                  <span>
                    {meetingDate} {startTime} ~ {endTime}
                  </span>
                  {selectedContacts.length > 0 && (
                    <span className="text-primary">
                      • 内部同事 {selectedContacts.length} 人
                    </span>
                  )}
                </div>

                {/* 钉钉视频入会链接与一键复制邀请 */}
                {(() => {
                  const videoUrl = successResult.video_meeting?.url || successResult.dingtalk_event?.onlineMeetingInfo?.url || '';
                  const confId = successResult.video_meeting?.conference_id || successResult.dingtalk_event?.onlineMeetingInfo?.conferenceId || '';

                  return (
                    <div className="pt-2 border-t border-border/50 flex flex-col gap-2">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-medium text-foreground">
                          {confId ? `钉钉会议号: ${confId}` : '视频会议房间已生成'}
                        </span>
                        <Button
                          size="sm"
                          variant="secondary"
                          className="h-7 px-2.5 text-xs gap-1.5 font-normal shadow-xs hover:bg-secondary/80"
                          onClick={handleCopyInvite}
                        >
                          {copied ? (
                            <>
                              <Check className="w-3.5 h-3.5 text-emerald-600" />
                              <span className="text-emerald-600 font-medium">已复制邀请</span>
                            </>
                          ) : (
                            <>
                              <Copy className="w-3.5 h-3.5" />
                              <span>复制入会邀请</span>
                            </>
                          )}
                        </Button>
                      </div>

                      {videoUrl && (
                        <div className="flex items-center justify-between text-[11px] bg-background/80 px-2 py-1 rounded border border-border/60">
                          <span className="text-muted-foreground shrink-0 mr-1.5 font-medium">入会链接:</span>
                          <span className="truncate text-blue-600 dark:text-blue-400 select-all font-mono">
                            {videoUrl}
                          </span>
                          <a
                            href={videoUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="ml-2 text-muted-foreground hover:text-primary shrink-0"
                            title="打开入会链接"
                          >
                            <ExternalLink className="w-3 h-3" />
                          </a>
                        </div>
                      )}
                    </div>
                  );
                })()}
              </div>

              {selectedRoomObj && (() => {
                const booking = successResult.oa_booking;
                const isDirect = booking?.status_type === 'direct_booked' || (booking?.booked && Boolean(booking?.meetingid));
                const isApproval = booking?.status_type === 'approval_pending' || Boolean(booking?.requestid);
                const isFailed = booking?.status_type === 'failed' || (!booking?.booked && !booking?.meetingid && !booking?.requestid);

                return (
                  <div className="p-3.5 rounded-lg border bg-muted/30 space-y-1.5">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-semibold text-muted-foreground flex items-center gap-1.5">
                        <Building2 className="w-3.5 h-3.5 text-amber-500" />
                        泛微 OA 物理会议室占位
                      </span>
                      {isDirect && (
                        <Badge variant="outline" className="text-emerald-600 bg-emerald-50 border-emerald-200">
                          静默锁房成功
                        </Badge>
                      )}
                      {isApproval && (
                        <Badge variant="outline" className="text-amber-600 bg-amber-50 border-amber-200">
                          审批流程已发起
                        </Badge>
                      )}
                      {isFailed && (
                        <Badge variant="outline" className="text-rose-600 bg-rose-50 border-rose-200">
                          未成功占位
                        </Badge>
                      )}
                    </div>
                    <p className="text-xs text-foreground font-medium">{selectedRoomObj.name}</p>
                    {booking?.meetingid && (
                      <p className="text-[11px] text-muted-foreground">
                        OA 会议编号 (Meeting ID): {booking.meetingid}
                      </p>
                    )}
                    {booking?.requestid && (
                      <p className="text-[11px] text-muted-foreground">
                        OA 流程单号 (Request ID): {booking.requestid}
                      </p>
                    )}
                    {isFailed && booking?.message && (
                      <p className="text-[11px] text-rose-500">
                        {booking.message}
                      </p>
                    )}
                  </div>
                );
              })()}

              {successResult.email_notice?.sent && (
                <div className="p-3 rounded-lg border border-emerald-100 bg-emerald-50/50 dark:bg-emerald-950/20 text-xs text-emerald-800 dark:text-emerald-300 flex items-center gap-2">
                  <Mail className="w-3.5 h-3.5 flex-shrink-0 text-emerald-600" />
                  <span>{successResult.email_notice.message}</span>
                </div>
              )}
            </div>

            <Button className="w-full mt-4" onClick={() => onOpenChange(false)}>
              完成并返回
            </Button>
          </div>
        ) : (
          // 表单输入页
          <>
            <DialogHeader className="px-6 pt-5 pb-3 border-b shrink-0 pr-12">
              <div className="flex items-center gap-2.5">
                <img
                  src="/dingtalk-app-icon.webp"
                  alt="钉钉"
                  className="w-6 h-6 rounded-md object-contain shrink-0 shadow-xs"
                />
                <DialogTitle className="text-base font-semibold">创建钉钉视频会议日程</DialogTitle>
              </div>
            </DialogHeader>

            <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
              {/* 会议主题 (强制中文) */}
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground flex items-center gap-1.5">
                  会议主题 <span className="text-rose-500">*</span>
                </label>
                <Input
                  value={summary}
                  onChange={(e) => setSummary(e.target.value)}
                  placeholder="如：【线上沟通】业务对接与量产采用确认"
                  className="text-sm"
                />
              </div>

              {/* 日期与起止时间 (采用 shadcn Popover+Calendar 与 Select，严格无换行) */}
              <div className="flex flex-wrap items-center gap-3 p-3 rounded-lg border bg-muted/20">
                {/* 会议日期 */}
                <div className="space-y-1">
                  <label className="text-xs font-medium text-muted-foreground flex items-center gap-1 whitespace-nowrap">
                    <CalendarIcon className="w-3.5 h-3.5 text-primary" /> 会议日期
                  </label>
                  <Popover open={isCalendarOpen} onOpenChange={setIsCalendarOpen}>
                    <PopoverTrigger asChild>
                      <Button
                        variant="outline"
                        className="w-[135px] h-9 px-2.5 text-xs justify-start text-left font-normal bg-background"
                      >
                        <CalendarIcon className="mr-1.5 h-3.5 w-3.5 opacity-70" />
                        <span className="truncate">{meetingDate || '选择日期'}</span>
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-auto p-0 z-50" align="start">
                      <Calendar
                        mode="single"
                        selected={meetingDate ? new Date(meetingDate + 'T00:00:00') : undefined}
                        onSelect={(date) => {
                          if (date) {
                            const y = date.getFullYear();
                            const m = String(date.getMonth() + 1).padStart(2, '0');
                            const d = String(date.getDate()).padStart(2, '0');
                            setMeetingDate(`${y}-${m}-${d}`);
                            setIsCalendarOpen(false);
                          }
                        }}
                      />
                    </PopoverContent>
                  </Popover>
                </div>

                <div className="h-8 w-px bg-border/60 self-end mb-1 hidden sm:block" />

                {/* 开始时间 */}
                <div className="space-y-1">
                  <label className="text-xs font-medium text-muted-foreground flex items-center gap-1 whitespace-nowrap">
                    <Clock className="w-3.5 h-3.5 text-primary" /> 开始时间
                  </label>
                  <FiveMinuteTimePicker
                    value={startTime}
                    onChange={handleStartTimeChange}
                    placeholder="开始时间"
                  />
                </div>

                <div className="text-muted-foreground self-end mb-2.5 text-xs whitespace-nowrap font-medium">至</div>

                {/* 结束时间 */}
                <div className="space-y-1">
                  <label className="text-xs font-medium text-muted-foreground flex items-center gap-1 whitespace-nowrap">
                    <Clock className="w-3.5 h-3.5 text-primary" /> 结束时间
                  </label>
                  <FiveMinuteTimePicker
                    value={endTime}
                    onChange={setEndTime}
                    placeholder="结束时间"
                  />
                </div>
              </div>

              {/* 线下会议室 (泛微 OA 静默预约联动) */}
              <div className="space-y-1.5 rounded-lg border p-3 bg-muted/20">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-medium flex items-center gap-1.5">
                    <MapPin className="w-3.5 h-3.5 text-blue-500" />
                    线下会议室
                  </label>
                  <div className="flex items-center gap-2">
                    <span className="text-[11px] text-muted-foreground">
                      检测时段: {meetingDate || '今日'} {startTime} ~ {endTime}
                    </span>
                    {isLoadingRooms && (
                      <span className="text-[11px] text-primary flex items-center gap-1">
                        <Loader2 className="w-3 h-3 animate-spin" /> 检测中...
                      </span>
                    )}
                  </div>
                </div>

                <Select value={selectedRoomId} onValueChange={setSelectedRoomId}>
                  <SelectTrigger className="w-full text-sm bg-background">
                    <SelectValue placeholder="选择会议室" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">
                      <span className="text-muted-foreground">不预约线下会议室（纯钉钉线上视频）</span>
                    </SelectItem>
                    {rooms.map((room) => {
                      const isAvail = room.is_available !== false;
                      return (
                        <SelectItem key={room.id} value={room.id} disabled={!isAvail}>
                          <div className="flex items-center justify-between w-full gap-3 py-0.5">
                            <div className="flex flex-col text-left truncate">
                              <span className="font-medium text-xs">{room.name}</span>
                              {room.status_message && !isAvail && (
                                <span className="text-[10px] text-muted-foreground truncate max-w-[280px]">
                                  {room.status_message}
                                </span>
                              )}
                            </div>
                            <span
                              className={`text-[10px] px-1.5 py-0.5 rounded shrink-0 font-medium ${
                                isAvail
                                  ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300 t-badge-pop-in'
                                  : 'bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-300'
                              }`}
                            >
                              {isAvail ? '空闲可用' : '已被占用'}
                            </span>
                          </div>
                        </SelectItem>
                      );
                    })}
                  </SelectContent>
                </Select>

                {selectedRoomObj && (
                  <p className="text-[11px] text-muted-foreground pt-1">
                    已选：{selectedRoomObj.name}（容纳 {selectedRoomObj.capacity} 人，{selectedRoomObj.building} {selectedRoomObj.floor}）
                  </p>
                )}
              </div>

              {/* 内部参会人 (钉钉组织员工) */}
              <div className="space-y-2 rounded-lg border p-3 bg-muted/20" ref={dropdownRef}>
                <div className="flex items-center justify-between">
                  <label className="text-xs font-medium flex items-center gap-1.5">
                    <Users className="w-3.5 h-3.5 text-blue-500" />
                    内部参会同事
                  </label>
                  <span className="text-[11px] text-muted-foreground">钉钉日历直接派发日程通知</span>
                </div>

                {/* 搜索添加内部同事 */}
                <div className="relative">
                  <div className="relative">
                    <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
                    <Input
                      value={contactSearch}
                      onChange={(e) => {
                        setContactSearch(e.target.value);
                        setIsDropdownOpen(true);
                      }}
                      onFocus={() => setIsDropdownOpen(true)}
                      placeholder="搜索同事姓名或部门添加参会..."
                      className="text-xs h-8 pl-8 bg-background"
                    />
                  </div>

                  {/* 悬浮下拉匹配结果 (遵循 05-menu-dropdown 出退场动效规范) */}
                  {shouldRenderDropdown && (
                    <div
                      className={`t-dropdown absolute top-full left-0 right-0 mt-1 max-h-48 overflow-y-auto bg-popover text-popover-foreground border rounded-md shadow-lg z-50 p-1 ${
                        isDropdownActive ? 'is-open' : 'is-closing'
                      }`}
                    >
                      {internalContacts.map((contact) => {
                        const isSelected = selectedContacts.some((c) => c.userid === contact.userid);
                        return (
                          <div
                            key={contact.userid || contact.id}
                            onClick={() => {
                              if (!isSelected) {
                                setSelectedContacts([...selectedContacts, contact]);
                              } else {
                                setSelectedContacts(selectedContacts.filter((c) => c.userid !== contact.userid));
                              }
                              setContactSearch('');
                              setIsDropdownOpen(false);
                            }}
                            className={`flex items-center justify-between px-2.5 py-1.5 text-xs rounded cursor-pointer transition-colors ${
                              isSelected ? 'bg-primary/10 text-primary font-medium' : 'hover:bg-muted'
                            }`}
                          >
                            <div className="flex items-center gap-2">
                              <div className="w-5 h-5 rounded-full bg-primary/10 text-primary flex items-center justify-center font-medium text-[10px]">
                                {contact.name.slice(0, 1)}
                              </div>
                              <span>{contact.name}</span>
                              {contact.department && (
                                <span className="text-[11px] text-muted-foreground">({contact.department})</span>
                              )}
                            </div>
                            {isSelected ? (
                              <span className="text-[10px] text-primary">已添加</span>
                            ) : (
                              <span className="text-[10px] text-muted-foreground hover:text-foreground">+ 添加</span>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>

                {/* 已选内部同事徽章 */}
                {selectedContacts.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 pt-1">
                    {selectedContacts.map((contact) => (
                      <span
                        key={contact.userid}
                        className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-background border text-xs text-foreground shadow-2xs animate-in fade-in zoom-in-95 duration-150"
                      >
                        <span className="w-3.5 h-3.5 rounded-full bg-blue-100 text-blue-700 text-[9px] flex items-center justify-center">
                          {contact.name.slice(0, 1)}
                        </span>
                        <span>{contact.name}</span>
                        <button
                          type="button"
                          onClick={() => setSelectedContacts(selectedContacts.filter((c) => c.userid !== contact.userid))}
                          className="text-muted-foreground hover:text-destructive text-xs ml-0.5"
                        >
                          <X className="w-3 h-3" />
                        </button>
                      </span>
                    ))}
                  </div>
                )}
              </div>

              {/* 向客户发送钉钉日程邀请 */}
              <div className="space-y-2 rounded-lg border p-3 bg-muted/20">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-medium flex items-center gap-1.5 cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={sendIcs}
                      onChange={(e) => setSendIcs(e.target.checked)}
                      className="rounded border-gray-300 text-primary focus:ring-primary h-3.5 w-3.5"
                    />
                    <Mail className="w-3.5 h-3.5 text-blue-500" />
                    向客户发送钉钉日程邀请
                  </label>
                </div>
                {sendIcs && (
                  <div className="space-y-1 pt-1">
                    <Input
                      value={emailInput}
                      onChange={(e) => setEmailInput(e.target.value)}
                      placeholder="客户邮箱地址 (如 partner@client.com，多个用逗号隔开)"
                      className="text-sm bg-background"
                    />
                    <p className="text-[11px] text-muted-foreground">
                      将自动随信发送钉钉视频会议链接与标准日历附件 (.ics)，客户可一键导入日历与入会
                    </p>
                  </div>
                )}
              </div>

              {/* 会议说明 */}
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground">会议背景 / 议程说明</label>
                <Input
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="简述议程或入会注意事项（可选）"
                  className="text-sm"
                />
              </div>
            </div>

            <DialogFooter className="px-6 py-3.5 border-t bg-background shrink-0 flex items-center justify-end gap-2">
              <Button variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>
                取消
              </Button>
              <Button
                onClick={handleSubmit}
                disabled={submitting}
                className="gap-1.5 bg-primary hover:bg-primary/90 text-primary-foreground shadow-sm"
              >
                {submitting ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    创建中...
                  </>
                ) : (
                  <>
                    <Video className="w-4 h-4" />
                    创建并发布钉钉视频日程
                  </>
                )}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
};
