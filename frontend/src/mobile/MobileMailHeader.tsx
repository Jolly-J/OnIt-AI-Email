import React, { useState } from 'react';
import { Menu, Search, Plus, RefreshCw, X, ChevronDown } from 'lucide-react';
import { FolderType } from '@/components/MailSidebar';
import { MailAccount } from '@/lib/api';

interface MobileMailHeaderProps {
  currentFolder: FolderType;
  selectedAccount: MailAccount | undefined;
  onOpenDrawer: () => void;
  onOpenCompose: () => void;
  searchQuery: string;
  onSearchChange: (query: string) => void;
  onSync: () => void;
  syncing: boolean;
}

const FOLDER_NAMES: Record<FolderType, string> = {
  inbox: '收件箱',
  sent: '已发送',
  drafts: '草稿箱',
  trash: '垃圾箱',
  replied: '已回复',
  archived: '已归档',
};

export const MobileMailHeader: React.FC<MobileMailHeaderProps> = ({
  currentFolder,
  selectedAccount,
  onOpenDrawer,
  onOpenCompose,
  searchQuery,
  onSearchChange,
  onSync,
  syncing,
}) => {
  const [showSearch, setShowSearch] = useState(false);

  return (
    <header className="bg-background/95 backdrop-blur-md border-b sticky top-0 z-30 pt-safe select-none">
      <div className="h-14 px-3 flex items-center justify-between gap-2">
        {/* 左侧：菜单抽屉开关 + 文件夹与账号标题 */}
        <div className="flex items-center gap-2.5 min-w-0">
          <button
            onClick={onOpenDrawer}
            className="p-2 rounded-xl text-foreground hover:bg-muted active:scale-95 transition-all"
            title="展开文件夹与账号"
          >
            <Menu className="w-5 h-5" />
          </button>

          <div className="min-w-0 cursor-pointer" onClick={onOpenDrawer}>
            <div className="flex items-center gap-1">
              <h1 className="font-bold text-base text-foreground tracking-tight truncate">
                {FOLDER_NAMES[currentFolder] || '邮件列表'}
              </h1>
              <ChevronDown className="w-3.5 h-3.5 text-muted-foreground" />
            </div>
            <p className="text-[10px] text-muted-foreground truncate leading-tight">
              {selectedAccount ? (selectedAccount.name || selectedAccount.email_address) : '全部聚合邮箱'}
            </p>
          </div>
        </div>

        {/* 右侧：操作按钮组 */}
        <div className="flex items-center gap-1 shrink-0">
          <button
            onClick={() => {
              setShowSearch((prev) => !prev);
              if (showSearch) onSearchChange('');
            }}
            className={`p-2 rounded-xl transition-all ${
              showSearch || searchQuery ? 'text-primary bg-primary/10' : 'text-muted-foreground hover:text-foreground hover:bg-muted'
            }`}
            title="搜索邮件"
          >
            <Search className="w-5 h-5" />
          </button>

          <button
            onClick={onSync}
            disabled={syncing}
            className="p-2 rounded-xl text-muted-foreground hover:text-foreground hover:bg-muted active:scale-95 transition-all disabled:opacity-50"
            title="同步新邮件"
          >
            <RefreshCw className={`w-5 h-5 ${syncing ? 'animate-spin text-primary' : ''}`} />
          </button>

          <button
            onClick={onOpenCompose}
            className="ml-1 p-2 bg-primary text-primary-foreground rounded-xl shadow-xs active:scale-95 hover:bg-primary/90 transition-all flex items-center justify-center"
            title="写新邮件"
          >
            <Plus className="w-5 h-5" />
          </button>
        </div>
      </div>

      {/* 搜索展开框 */}
      {showSearch && (
        <div className="px-3 pb-2.5 pt-1 animate-in fade-in slide-in-from-top-2 duration-200">
          <div className="relative flex items-center">
            <Search className="w-4 h-4 text-muted-foreground absolute left-3 pointer-events-none" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => onSearchChange(e.target.value)}
              placeholder="搜索发件人、收件人、主题或内容..."
              className="w-full h-9 pl-9 pr-8 text-xs rounded-xl bg-muted/60 border border-transparent focus:border-primary/40 focus:bg-background focus:outline-none transition-all"
              autoFocus
            />
            {searchQuery && (
              <button
                onClick={() => onSearchChange('')}
                className="absolute right-2.5 p-1 rounded-full text-muted-foreground hover:text-foreground"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        </div>
      )}
    </header>
  );
};
