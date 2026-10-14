# 邮箱服务商图标指南

继承[公共资源指南](../AGENTS.md)。消费者是 `frontend/src/components/MailProviderLogo.tsx`，服务商连接预设在 `backend/app/services/mail_service.py`。

| 文件 | 前端映射 |
| --- | --- |
| `aliyun.svg` | 阿里个人与企业邮箱 |
| `qq.svg` | QQ 个人邮箱 |
| `tencent_enterprise.svg` | 腾讯企业邮箱 |
| `netease.svg` | 网易 163 与 126 |
| `custom.svg` | 自定义或无法识别的服务商 |

- 新增服务商时核对 provider 字符串、推断顺序、图标映射、alt 与后端预设；腾讯企业邮箱不能被一般 QQ host 判断提前匹配。
- SVG 保持可缩放 viewBox、透明背景与清楚的窄尺寸显示，避免加入脚本或外部资源依赖。
- 用账号列表、侧栏和邮件列表的实际图标尺寸检查比例与清晰度；不只看原图。
