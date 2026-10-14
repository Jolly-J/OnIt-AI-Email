import { spawn, execSync } from 'child_process';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

const PORT = 4667;

function getLocalIp() {
  const nets = os.networkInterfaces();
  for (const name of Object.keys(nets)) {
    for (const net of nets[name]) {
      if (net.family === 'IPv4' && !net.internal) {
        return net.address;
      }
    }
  }
  return '127.0.0.1';
}

// 清理指定端口的占用进程 (支持 Mac / Linux / Windows)
function killPort(port) {
  try {
    if (process.platform === 'win32') {
      const stdout = execSync(`netstat -ano | findstr :${port}`, { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'ignore'] });
      const lines = stdout.split('\n');
      for (const line of lines) {
        const parts = line.trim().split(/\s+/);
        if (parts.length >= 5 && parts[1].includes(`:${port}`)) {
          const pid = parts[parts.length - 1];
          if (pid && pid !== '0') {
            try {
              execSync(`taskkill /F /PID ${pid}`, { stdio: 'ignore' });
            } catch {}
          }
        }
      }
    } else {
      const pids = execSync(`lsof -ti :${port}`, { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'ignore'] }).trim();
      if (pids) {
        for (const pid of pids.split('\n')) {
          if (pid) {
            try {
              process.kill(Number(pid), 'SIGKILL');
            } catch {}
          }
        }
      }
    }
  } catch {
    // 端口未被占用
  }
}

// 1. 自动探测并清理端口占用
killPort(PORT);
killPort(4666); // 清理旧端口残留

// 2. 数据库自动升级（使用 Knex 执行无损版本迁移）
const isWin = process.platform === 'win32';
const npmCmd = isWin ? 'npm.cmd' : 'npm';
const npxCmd = isWin ? 'npx.cmd' : 'npm';
const isMock = process.argv.includes('--mock') || process.env.MOCK_MODE === 'true';

if (!isMock) {
  try {
    console.log('[Knex] 正在检查数据库版本并自动增量升级...');
    execSync(`${npxCmd} knex migrate:latest`, {
      cwd: rootDir,
      stdio: 'inherit',
    });
    console.log('[Knex] 数据库结构检查完成，已就绪');
  } catch (err) {
    console.error('[Knex] 数据库升级提示:', err.message);
  }
} else {
  console.log('[MockMode] 已激活 Mock 演示模式，使用纯内存隔离数据库（跳过磁盘 Knex 迁移，零数据污染）');
}

// 3. 预先确保前端产物存在（防范并发冷启动缺失）
const distIndex = path.join(rootDir, 'frontend', 'dist', 'index.html');
if (!fs.existsSync(distIndex)) {
  console.log('[Frontend] 首次启动，正在预编译前端生产资源...');
  try {
    execSync(`${npmCmd} run build`, {
      cwd: path.join(rootDir, 'frontend'),
      stdio: 'inherit',
    });
    console.log('[Frontend] 前端预编译完成');
  } catch (bErr) {
    console.error('[Frontend] 前端构建异常:', bErr.message);
  }
}

// 4. 启动前端监听自动构建 (实现热更新到 dist，增量覆盖)
const frontendWatcher = spawn(npmCmd, ['run', 'build', '--', '--watch'], {
  cwd: path.join(rootDir, 'frontend'),
  stdio: 'ignore',
});

// 5. 启动后端 Python 进程 (一体化挂载前端 dist)

let pythonBin = isWin
  ? path.join(rootDir, 'backend', '.venv', 'Scripts', 'python.exe')
  : path.join(rootDir, 'backend', '.venv', 'bin', 'python3');

if (!fs.existsSync(pythonBin)) {
  pythonBin = isWin ? 'python' : 'python3';
}

const backendProcess = spawn(
  pythonBin,
  ['-m', 'uvicorn', 'main:app', '--host', '0.0.0.0', '--port', String(PORT), '--reload'],
  {
    cwd: path.join(rootDir, 'backend'),
    env: {
      ...process.env,
      PYTHONUNBUFFERED: '1',
      MOCK_MODE: isMock ? 'true' : (process.env.MOCK_MODE || 'false'),
      NO_PROXY: 'localhost,127.0.0.1,dingtalk.com,alicdn.com,.dingtalk.com,.alicdn.com',
      no_proxy: 'localhost,127.0.0.1,dingtalk.com,alicdn.com,.dingtalk.com,.alicdn.com',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  }
);

backendProcess.stderr.on('data', (data) => {
  const msg = data.toString();
  if (msg.includes('ERROR') || msg.includes('Error')) {
    process.stderr.write(`[服务错误] ${msg}`);
  }
});

// 5. 打印极简控制台信息 (严格无任何 Emoji)
const localIp = getLocalIp();
console.log('==================================================');
console.log(`AI Email Assistant 一体化服务已启动${isMock ? ' (Mock 演示体验模式)' : ''}`);
console.log(`端口检测完成: 已自动释放并绑定 ${PORT}`);
if (isMock) {
  console.log('运行模式: Mock 模式已激活 (免钉钉配置，一键体验登录与演示数据)');
}
console.log(`本机电脑访问: http://127.0.0.1:${PORT}`);
if (localIp !== '127.0.0.1') {
  console.log(`局域网手机访问: http://${localIp}:${PORT}`);
}
console.log('');
console.log('请按住 Cmd/Ctrl 点击下方链接打开系统:');
console.log(`http://127.0.0.1:${PORT}`);
if (localIp !== '127.0.0.1') {
  console.log(`手机浏览器访问: http://${localIp}:${PORT}`);
}
console.log('==================================================');
console.log('按 Ctrl+C 可随时停止服务\n');

// 6. 进程退出清理
function cleanup() {
  try {
    frontendWatcher.kill('SIGTERM');
    backendProcess.kill('SIGTERM');
  } catch {}
  killPort(PORT);
  process.exit(0);
}

process.on('SIGINT', cleanup);
process.on('SIGTERM', cleanup);
process.on('exit', cleanup);
