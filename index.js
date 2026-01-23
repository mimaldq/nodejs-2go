const express = require("express");
const app = express();
const axios = require("axios");
const os = require('os');
const fs = require("fs");
const path = require("path");
const { promisify } = require('util');
const exec = promisify(require('child_process').exec);
const { execSync, spawn } = require('child_process');
const http = require('http');
const httpProxy = require('http-proxy');

// 环境变量配置
const UPLOAD_URL = process.env.UPLOAD_URL || '';      // 节点或订阅自动上传地址，需填写部署Merge-sub项目后的首页地址，例如：https://merge.xxx.com
const PROJECT_URL = process.env.PROJECT_URL || '';    // 需要上传订阅或保活时需填写项目分配的url，例如：https://google.com
const AUTO_ACCESS = process.env.AUTO_ACCESS === 'true' || false; // false关闭自动保活，true开启,需同时填写PROJECT_URL变量
const FILE_PATH = process.env.FILE_PATH || './tmp';   // 运行目录,sub节点文件保存目录
const SUB_PATH = process.env.SUB_PATH || 'sub';       // 订阅路径
const PORT = process.env.SERVER_PORT || process.env.PORT || 3000;        // http服务订阅端口
const UUID = process.env.UUID || 'e2cae6af-5cdd-fa48-4137-ad3e617fbab0'; // 使用哪吒v1,在不同的平台运行需修改UUID,否则会覆盖
const NEZHA_SERVER = process.env.NEZHA_SERVER || '';        // 哪吒v1填写形式: nz.abc.com:8008  哪吒v0填写形式：nz.abc.com
const NEZHA_PORT = process.env.NEZHA_PORT || '';            // 使用哪吒v1请留空，哪吒v0需填写
const NEZHA_KEY = process.env.NEZHA_KEY || '';              // 哪吒v1的NZ_CLIENT_SECRET或哪吒v0的agent密钥
const ARGO_DOMAIN = process.env.ARGO_DOMAIN || '';          // 固定隧道域名,留空即启用临时隧道
const ARGO_AUTH = process.env.ARGO_AUTH || '';              // 固定隧道密钥json或token,留空即启用临时隧道,json获取地址：https://json.zone.id
const ARGO_PORT = process.env.ARGO_PORT || 7860;            // 固定隧道端口,使用token需在cloudflare后台设置和这里一致
const CFIP = process.env.CFIP || 'cdns.doon.eu.org';        // 节点优选域名或优选ip  
const CFPORT = process.env.CFPORT || 443;                   // 节点优选域名或优选ip对应的端口
const NAME = process.env.NAME || '';                        // 节点名称
const MONITOR_KEY = process.env.MONITOR_KEY || '';          // 监控脚本密钥
const MONITOR_SERVER = process.env.MONITOR_SERVER || '';    // 监控服务器标识
const MONITOR_URL = process.env.MONITOR_URL || '';          // 监控上报地址

// 创建运行文件夹
if (!fs.existsSync(FILE_PATH)) {
  fs.mkdirSync(FILE_PATH);
  console.log(`${FILE_PATH} is created`);
} else {
  console.log(`${FILE_PATH} already exists`);
}

// 生成随机6位字符文件名
function generateRandomName() {
  const characters = 'abcdefghijklmnopqrstuvwxyz';
  let result = '';
  for (let i = 0; i < 6; i++) {
    result += characters.charAt(Math.floor(Math.random() * characters.length));
  }
  return result;
}

// 全局常量
const npmName = generateRandomName();
const webName = generateRandomName();
const botName = generateRandomName();
const phpName = generateRandomName();
const monitorName = 'cf-vps-monitor.sh';
let npmPath = path.join(FILE_PATH, npmName);
let phpPath = path.join(FILE_PATH, phpName);
let webPath = path.join(FILE_PATH, webName);
let botPath = path.join(FILE_PATH, botName);
let monitorPath = path.join(FILE_PATH, monitorName);
let subPath = path.join(FILE_PATH, 'sub.txt');
let listPath = path.join(FILE_PATH, 'list.txt');
let bootLogPath = path.join(FILE_PATH, 'boot.log');
let configPath = path.join(FILE_PATH, 'config.json');
let tunnelJsonPath = path.join(FILE_PATH, 'tunnel.json');
let tunnelYamlPath = path.join(FILE_PATH, 'tunnel.yml');

// 全局变量
let monitorProcess = null;

// 创建HTTP代理
const proxy = httpProxy.createProxyServer();

// 错误处理
proxy.on('error', (err, req, res) => {
  console.error('代理错误:', err);
  if (!res.headersSent) {
    res.status(500).send('代理错误');
  }
});

// 创建HTTP代理服务器（外部端口）
const proxyServer = http.createServer((req, res) => {
  const urlPath = req.url;
  
  if (urlPath.startsWith('/vless-argo') || 
      urlPath.startsWith('/vmess-argo') || 
      urlPath.startsWith('/trojan-argo') ||
      urlPath === '/vless' || 
      urlPath === '/vmess' || 
      urlPath === '/trojan') {
    // 转发到Xray端口（3001）
    proxy.web(req, res, { target: 'http://localhost:3001' });
  } else {
    // 转发到HTTP服务器端口
    proxy.web(req, res, { target: `http://localhost:${PORT}` });
  }
});

// WebSocket代理处理
proxyServer.on('upgrade', (req, socket, head) => {
  const urlPath = req.url;
  
  if (urlPath.startsWith('/vless-argo') || 
      urlPath.startsWith('/vmess-argo') || 
      urlPath.startsWith('/trojan-argo')) {
    proxy.ws(req, socket, head, { target: 'http://localhost:3001' });
  } else {
    proxy.ws(req, socket, head, { target: `http://localhost:${PORT}` });
  }
});

// 启动代理服务器
proxyServer.listen(ARGO_PORT, () => {
  console.log(`代理服务器启动在端口: ${ARGO_PORT}`);
  console.log(`HTTP流量 -> localhost:${PORT}`);
  console.log(`Xray流量 -> localhost:3001`);
});

// Express路由处理
app.get("/", function(req, res) {
  const indexPath = path.join(__dirname, 'index.html');
  if (fs.existsSync(indexPath)) {
    res.sendFile(indexPath);
  } else {
    res.send("Hello world!");
  }
});

// 订阅路由将在生成订阅后动态添加

// 如果订阅器上存在历史运行节点则先删除
function deleteNodes() {
  try {
    if (!UPLOAD_URL) return;
    if (!fs.existsSync(subPath)) return;

    let fileContent;
    try {
      fileContent = fs.readFileSync(subPath, 'utf-8');
    } catch {
      return null;
    }

    const decoded = Buffer.from(fileContent, 'base64').toString('utf-8');
    const nodes = decoded.split('\n').filter(line => 
      /(vless|vmess|trojan|hysteria2|tuic):\/\//.test(line)
    );

    if (nodes.length === 0) return;

    axios.post(`${UPLOAD_URL}/api/delete-nodes`, 
      JSON.stringify({ nodes }),
      { headers: { 'Content-Type': 'application/json' } }
    ).catch((error) => { 
      return null; 
    });
    return null;
  } catch (err) {
    return null;
  }
}

// 清理历史文件
function cleanupOldFiles() {
  try {
    const files = fs.readdirSync(FILE_PATH);
    files.forEach(file => {
      const filePath = path.join(FILE_PATH, file);
      try {
        const stat = fs.statSync(filePath);
        if (stat.isFile()) {
          fs.unlinkSync(filePath);
        }
      } catch (err) {
        // 忽略所有错误，不记录日志
      }
    });
  } catch (err) {
    // 忽略所有错误，不记录日志
  }
}

// 生成xr-ay配置文件
async function generateConfig() {
  const config = {
    log: { 
      access: '/dev/null', 
      error: '/dev/null', 
      loglevel: 'none' 
    },
    dns: {
      servers: [
        "https+local://8.8.8.8/dns-query",
        "https+local://1.1.1.1/dns-query",
        "8.8.8.8",
        "1.1.1.1"
      ],
      queryStrategy: "UseIP",
      disableCache: false
    },
    inbounds: [
      {
        port: 3001,
        protocol: "vless",
        settings: {
          clients: [{
            id: UUID,
            flow: "xtls-rprx-vision"
          }],
          decryption: "none",
          fallbacks: [
            { dest: 3002 },
            { path: "/vless-argo", dest: 3003 },
            { path: "/vmess-argo", dest: 3004 },
            { path: "/trojan-argo", dest: 3005 }
          ]
        },
        streamSettings: {
          network: "tcp"
        }
      },
      {
        port: 3002,
        listen: "127.0.0.1",
        protocol: "vless",
        settings: {
          clients: [{ id: UUID }],
          decryption: "none"
        },
        streamSettings: {
          network: "tcp",
          security: "none"
        }
      },
      {
        port: 3003,
        listen: "127.0.0.1",
        protocol: "vless",
        settings: {
          clients: [{ id: UUID, level: 0 }],
          decryption: "none"
        },
        streamSettings: {
          network: "ws",
          security: "none",
          wsSettings: {
            path: "/vless-argo"
          }
        },
        sniffing: {
          enabled: true,
          destOverride: ["http", "tls", "quic"],
          metadataOnly: false
        }
      },
      {
        port: 3004,
        listen: "127.0.0.1",
        protocol: "vmess",
        settings: {
          clients: [{ id: UUID, alterId: 0 }]
        },
        streamSettings: {
          network: "ws",
          wsSettings: {
            path: "/vmess-argo"
          }
        },
        sniffing: {
          enabled: true,
          destOverride: ["http", "tls", "quic"],
          metadataOnly: false
        }
      },
      {
        port: 3005,
        listen: "127.0.0.1",
        protocol: "trojan",
        settings: {
          clients: [{ password: UUID }]
        },
        streamSettings: {
          network: "ws",
          security: "none",
          wsSettings: {
            path: "/trojan-argo"
          }
        },
        sniffing: {
          enabled: true,
          destOverride: ["http", "tls", "quic"],
          metadataOnly: false
        }
      }
    ],
    outbounds: [
      {
        protocol: "freedom",
        tag: "direct",
        settings: {
          domainStrategy: "UseIP"
        }
      },
      {
        protocol: "blackhole",
        tag: "block",
        settings: {}
      }
    ],
    routing: {
      domainStrategy: "IPIfNonMatch",
      rules: []
    }
  };
  
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
  console.log("Xray配置文件生成完成");
}

// 判断系统架构
function getSystemArchitecture() {
  const arch = os.arch();
  if (arch === 'arm' || arch === 'arm64' || arch === 'aarch64') {
    return 'arm';
  } else {
    return 'amd';
  }
}

// 下载文件
function downloadFile(fileName, fileUrl, callback) {
  const filePath = fileName; 
  
  // 确保目录存在
  if (!fs.existsSync(FILE_PATH)) {
    fs.mkdirSync(FILE_PATH, { recursive: true });
  }
  
  const writer = fs.createWriteStream(filePath);

  axios({
    method: 'get',
    url: fileUrl,
    responseType: 'stream',
  })
    .then(response => {
      response.data.pipe(writer);

      writer.on('finish', () => {
        writer.close();
        console.log(`下载 ${path.basename(filePath)} 成功`);
        callback(null, filePath);
      });

      writer.on('error', err => {
        fs.unlink(filePath, () => { });
        const errorMessage = `下载 ${path.basename(filePath)} 失败: ${err.message}`;
        console.error(errorMessage);
        callback(errorMessage);
      });
    })
    .catch(err => {
      const errorMessage = `下载 ${path.basename(filePath)} 失败: ${err.message}`;
      console.error(errorMessage);
      callback(errorMessage);
    });
}

// 下载并运行依赖文件
async function downloadFilesAndRun() {  
  const architecture = getSystemArchitecture();
  const filesToDownload = getFilesForArchitecture(architecture);

  if (filesToDownload.length === 0) {
    console.log(`无法找到适合当前架构的文件`);
    return;
  }

  const downloadPromises = filesToDownload.map(fileInfo => {
    return new Promise((resolve, reject) => {
      downloadFile(fileInfo.fileName, fileInfo.fileUrl, (err, filePath) => {
        if (err) {
          reject(err);
        } else {
          resolve(filePath);
        }
      });
    });
  });

  try {
    await Promise.all(downloadPromises);
  } catch (err) {
    console.error('下载文件错误:', err);
    return;
  }

  // 授权和运行
  function authorizeFiles(filePaths) {
    const newPermissions = 0o775;
    filePaths.forEach(absoluteFilePath => {
      if (fs.existsSync(absoluteFilePath)) {
        fs.chmodSync(absoluteFilePath, newPermissions);
        console.log(`设置权限成功: ${absoluteFilePath}`);
      }
    });
  }
  const filesToAuthorize = NEZHA_PORT ? [npmPath, webPath, botPath] : [phpPath, webPath, botPath];
  authorizeFiles(filesToAuthorize);

  // 运行哪吒监控
  if (NEZHA_SERVER && NEZHA_KEY) {
    if (!NEZHA_PORT) {
      // 检测哪吒是否开启TLS
      const port = NEZHA_SERVER.includes(':') ? NEZHA_SERVER.split(':').pop() : '';
      const tlsPorts = new Set(['443', '8443', '2096', '2087', '2083', '2053']);
      const nezhatls = tlsPorts.has(port) ? 'true' : 'false';
      // 生成 config.yaml
      const configYaml = `
client_secret: ${NEZHA_KEY}
debug: false
disable_auto_update: true
disable_command_execute: false
disable_force_update: true
disable_nat: false
disable_send_query: false
gpu: false
insecure_tls: true
ip_report_period: 1800
report_delay: 4
server: ${NEZHA_SERVER}
skip_connection_count: true
skip_procs_count: true
temperature: false
tls: ${nezhatls}
use_gitee_to_upgrade: false
use_ipv6_country_code: false
uuid: ${UUID}`;
      
      fs.writeFileSync(path.join(FILE_PATH, 'config.yaml'), configYaml);
      
      // 运行 v1
      const process = spawn(phpPath, ["-c", path.join(FILE_PATH, 'config.yaml')], {
        stdio: 'ignore',
        detached: true
      });
      process.unref();
      console.log(`${phpName} 运行中`);
      await new Promise((resolve) => setTimeout(resolve, 1000));
    } else {
      let args = [
        "-s", `${NEZHA_SERVER}:${NEZHA_PORT}`,
        "-p", NEZHA_KEY
      ];

      const tlsPorts = ['443', '8443', '2096', '2087', '2083', '2053'];
      if (tlsPorts.includes(NEZHA_PORT)) {
        args.push("--tls");
      }

      args.push("--disable-auto-update", "--report-delay", "4", "--skip-conn", "--skip-procs");

      const process = spawn(npmPath, args, {
        stdio: 'ignore',
        detached: true
      });
      process.unref();
      console.log(`${npmName} 运行中`);
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  } else {
    console.log('哪吒监控变量为空，跳过运行');
  }
  
  // 运行Xray
  const xrayProcess = spawn(webPath, ["-c", configPath], {
    stdio: 'ignore',
    detached: true
  });
  xrayProcess.unref();
  console.log(`${webName} 运行中`);
  await new Promise((resolve) => setTimeout(resolve, 1000));

  // 运行cloudflared
  if (fs.existsSync(botPath)) {
    let args = ["tunnel", "--edge-ip-version", "auto", "--no-autoupdate", "--protocol", "http2"];

    if (ARGO_AUTH && ARGO_AUTH.match(/^[A-Z0-9a-z=]{120,250}$/)) {
      args.push("run", "--token", ARGO_AUTH);
    } else if (ARGO_AUTH && ARGO_AUTH.includes('TunnelSecret')) {
      // 确保隧道配置文件存在
      if (!fs.existsSync(tunnelYamlPath)) {
        console.log('等待隧道配置文件生成...');
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
      args.push("--config", tunnelYamlPath, "run");
    } else {
      args.push("--logfile", bootLogPath, "--loglevel", "info",
                "--url", `http://localhost:${ARGO_PORT}`);
    }

    const cloudflaredProcess = spawn(botPath, args, {
      stdio: 'ignore',
      detached: true
    });
    cloudflaredProcess.unref();
    console.log(`${botName} 运行中`);
    
    // 等待隧道启动
    console.log('等待隧道启动...');
    await new Promise((resolve) => setTimeout(resolve, 5000));
  }
  await new Promise((resolve) => setTimeout(resolve, 2000));
}

// 根据系统架构返回对应的url
function getFilesForArchitecture(architecture) {
  let baseFiles;
  if (architecture === 'arm') {
    baseFiles = [
      { fileName: webPath, fileUrl: "https://arm64.ssss.nyc.mn/web" },
      { fileName: botPath, fileUrl: "https://arm64.ssss.nyc.mn/bot" }
    ];
  } else {
    baseFiles = [
      { fileName: webPath, fileUrl: "https://amd64.ssss.nyc.mn/web" },
      { fileName: botPath, fileUrl: "https://amd64.ssss.nyc.mn/bot" }
    ];
  }

  if (NEZHA_SERVER && NEZHA_KEY) {
    if (NEZHA_PORT) {
      const npmUrl = architecture === 'arm' 
        ? "https://arm64.ssss.nyc.mn/agent"
        : "https://amd64.ssss.nyc.mn/agent";
      baseFiles.unshift({ 
        fileName: npmPath, 
        fileUrl: npmUrl 
      });
    } else {
      const phpUrl = architecture === 'arm' 
        ? "https://arm64.ssss.nyc.mn/v1" 
        : "https://amd64.ssss.nyc.mn/v1";
      baseFiles.unshift({ 
        fileName: phpPath, 
        fileUrl: phpUrl
      });
    }
  }

  return baseFiles;
}

// 获取固定隧道json
function argoType() {
  if (!ARGO_AUTH || !ARGO_DOMAIN) {
    console.log("ARGO_DOMAIN 或 ARGO_AUTH 为空，使用快速隧道");
    return;
  }

  if (ARGO_AUTH.includes('TunnelSecret')) {
    try {
      fs.writeFileSync(tunnelJsonPath, ARGO_AUTH);
      const tunnelConfig = JSON.parse(ARGO_AUTH);
      const tunnelId = tunnelConfig.TunnelID;
      
      const tunnelYaml = `
tunnel: ${tunnelId}
credentials-file: ${tunnelJsonPath}
protocol: http2

ingress:
  - hostname: ${ARGO_DOMAIN}
    service: http://localhost:${ARGO_PORT}
    originRequest:
      noTLSVerify: true
  - service: http_status:404
`;
      fs.writeFileSync(tunnelYamlPath, tunnelYaml);
      console.log('隧道YAML配置生成成功');
    } catch (error) {
      console.error('生成隧道配置错误:', error);
    }
  } else {
    console.log("ARGO_AUTH 不是TunnelSecret格式，使用token连接隧道");
  }
}

// 下载监控脚本
async function downloadMonitorScript() {
  if (!MONITOR_KEY || !MONITOR_SERVER || !MONITOR_URL) {
    console.log("监控环境变量不完整，跳过监控脚本启动");
    return false;
  }

  const monitorURL = "https://raw.githubusercontent.com/kadidalax/cf-vps-monitor/main/cf-vps-monitor.sh";
  
  console.log(`从 ${monitorURL} 下载监控脚本`);
  
  return new Promise((resolve) => {
    const writer = fs.createWriteStream(monitorPath);

    axios({
      method: 'get',
      url: monitorURL,
      responseType: 'stream',
    })
      .then(response => {
        response.data.pipe(writer);

        writer.on('finish', () => {
          writer.close();
          fs.chmodSync(monitorPath, 0o755);
          console.log("监控脚本下载完成");
          resolve(true);
        });

        writer.on('error', err => {
          console.error(`下载监控脚本失败: ${err}`);
          resolve(false);
        });
      })
      .catch(err => {
        console.error(`下载监控脚本失败: ${err}`);
        resolve(false);
      });
  });
}

// 运行监控脚本
function runMonitorScript() {
  if (!MONITOR_KEY || !MONITOR_SERVER || !MONITOR_URL) {
    return;
  }

  const args = [
    '-i',
    '-k', MONITOR_KEY,
    '-s', MONITOR_SERVER,
    '-u', MONITOR_URL
  ];

  console.log(`运行监控脚本: ${monitorPath} ${args.join(' ')}`);

  const process = spawn(monitorPath, args, {
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: true
  });

  monitorProcess = process;

  process.stdout.on('data', (data) => {
    console.log(`监控脚本输出: ${data.toString().trim()}`);
  });

  process.stderr.on('data', (data) => {
    console.error(`监控脚本错误: ${data.toString().trim()}`);
  });

  process.on('close', (code) => {
    console.log(`监控脚本退出，代码: ${code}`);
    if (code !== 0) {
      console.log("将在30秒后重启监控脚本...");
      setTimeout(() => {
        runMonitorScript();
      }, 30000);
    }
  });
}

// 启动监控脚本
async function startMonitorScript() {
  if (!MONITOR_KEY || !MONITOR_SERVER || !MONITOR_URL) {
    console.log("监控脚本未配置，跳过");
    return;
  }

  // 等待其他服务启动
  setTimeout(async () => {
    const downloaded = await downloadMonitorScript();
    if (downloaded) {
      runMonitorScript();
    }
  }, 10000);
}

// 获取临时隧道domain
async function extractDomains() {
  let argoDomain;

  if (ARGO_AUTH && ARGO_DOMAIN) {
    argoDomain = ARGO_DOMAIN;
    console.log('使用固定域名:', argoDomain);
    await generateLinks(argoDomain);
  } else {
    try {
      const fileContent = fs.readFileSync(bootLogPath, 'utf-8');
      const lines = fileContent.split('\n');
      const argoDomains = [];
      lines.forEach((line) => {
        const domainMatch = line.match(/https?:\/\/([^ ]*trycloudflare\.com)\/?/);
        if (domainMatch) {
          const domain = domainMatch[1];
          argoDomains.push(domain);
        }
      });

      if (argoDomains.length > 0) {
        argoDomain = argoDomains[0];
        console.log('找到临时域名:', argoDomain);
        await generateLinks(argoDomain);
      } else {
        console.log('未找到域名，重新运行bot以获取Argo域名');
        fs.unlinkSync(bootLogPath);
        
        // 停止现有的cloudflared进程
        async function killBotProcess() {
          try {
            if (process.platform === 'win32') {
              await exec(`taskkill /f /im ${botName}.exe > nul 2>&1`);
            } else {
              await exec(`pkill -f "[${botName.charAt(0)}]${botName.substring(1)}" > /dev/null 2>&1`);
            }
          } catch (error) {
            // 忽略错误
          }
        }
        await killBotProcess();
        await new Promise((resolve) => setTimeout(resolve, 3000));
        
        // 重新启动cloudflared
        const args = `tunnel --edge-ip-version auto --no-autoupdate --protocol http2 --logfile ${bootLogPath} --loglevel info --url http://localhost:${ARGO_PORT}`;
        try {
          await exec(`nohup ${botPath} ${args} >/dev/null 2>&1 &`);
          console.log(`${botName} 重新运行中`);
          await new Promise((resolve) => setTimeout(resolve, 3000));
          await extractDomains();
        } catch (error) {
          console.error(`执行命令错误: ${error}`);
        }
      }
    } catch (error) {
      console.error('读取boot.log错误:', error);
    }
  }
}

// 获取isp信息
async function getMetaInfo() {
  try {
    const response1 = await axios.get('https://ipapi.co/json/', { timeout: 3000 });
    if (response1.data && response1.data.country_code && response1.data.org) {
      return `${response1.data.country_code}_${response1.data.org}`;
    }
  } catch (error) {
      try {
        // 备用 ip-api.com 获取isp
        const response2 = await axios.get('http://ip-api.com/json/', { timeout: 3000 });
        if (response2.data && response2.data.status === 'success' && response2.data.countryCode && response2.data.org) {
          return `${response2.data.countryCode}_${response2.data.org}`;
        }
      } catch (error) {
        // 忽略错误
      }
  }
  return 'Unknown';
}

// 生成 list 和 sub 信息
async function generateLinks(argoDomain) {
  const ISP = await getMetaInfo();
  const nodeName = NAME ? `${NAME}-${ISP}` : ISP;

  return new Promise((resolve) => {
    setTimeout(() => {
      const VMESS = { 
        v: '2', 
        ps: `${nodeName}`, 
        add: CFIP, 
        port: CFPORT, 
        id: UUID, 
        aid: '0', 
        scy: 'none', 
        net: 'ws', 
        type: 'none', 
        host: argoDomain, 
        path: '/vmess-argo?ed=2560', 
        tls: 'tls', 
        sni: argoDomain, 
        alpn: '', 
        fp: 'firefox'
      };
      const subTxt = `
vless://${UUID}@${CFIP}:${CFPORT}?encryption=none&security=tls&sni=${argoDomain}&fp=firefox&type=ws&host=${argoDomain}&path=%2Fvless-argo%3Fed%3D2560#${nodeName}

vmess://${Buffer.from(JSON.stringify(VMESS)).toString('base64')}

trojan://${UUID}@${CFIP}:${CFPORT}?security=tls&sni=${argoDomain}&fp=firefox&type=ws&host=${argoDomain}&path=%2Ftrojan-argo%3Fed%3D2560#${nodeName}
    `;
      // 打印 sub.txt 内容到控制台
      console.log(Buffer.from(subTxt).toString('base64'));
      fs.writeFileSync(subPath, Buffer.from(subTxt).toString('base64'));
      console.log(`${FILE_PATH}/sub.txt 保存成功`);
      uploadNodes();
      // 将内容进行 base64 编码并写入 SUB_PATH 路由
      app.get(`/${SUB_PATH}`, (req, res) => {
        const encodedContent = Buffer.from(subTxt).toString('base64');
        res.set('Content-Type', 'text/plain; charset=utf-8');
        res.send(encodedContent);
      });
      resolve(subTxt);
    }, 2000);
  });
}

// 自动上传节点或订阅
async function uploadNodes() {
  if (UPLOAD_URL && PROJECT_URL) {
    const subscriptionUrl = `${PROJECT_URL}/${SUB_PATH}`;
    const jsonData = {
      subscription: [subscriptionUrl]
    };
    try {
        const response = await axios.post(`${UPLOAD_URL}/api/add-subscriptions`, jsonData, {
            headers: {
                'Content-Type': 'application/json'
            }
        });
        
        if (response && response.status === 200) {
            console.log('订阅上传成功');
            return response;
        } else {
          return null;
        }
    } catch (error) {
        if (error.response) {
            if (error.response.status === 400) {
              console.error('订阅已存在');
            }
        }
        console.error('订阅上传失败:', error.message);
    }
  } else if (UPLOAD_URL) {
      if (!fs.existsSync(listPath)) return;
      const content = fs.readFileSync(listPath, 'utf-8');
      const nodes = content.split('\n').filter(line => /(vless|vmess|trojan|hysteria2|tuic):\/\//.test(line));

      if (nodes.length === 0) return;

      const jsonData = JSON.stringify({ nodes });

      try {
          const response = await axios.post(`${UPLOAD_URL}/api/add-nodes`, jsonData, {
              headers: { 'Content-Type': 'application/json' }
          });
          if (response && response.status === 200) {
            console.log('节点上传成功');
            return response;
        } else {
            return null;
        }
      } catch (error) {
          return null;
      }
  } else {
      return;
  }
}

// 90s后删除相关文件
function cleanFiles() {
  setTimeout(() => {
    const filesToDelete = [bootLogPath, configPath, webPath, botPath, monitorPath];  
    
    if (NEZHA_PORT) {
      filesToDelete.push(npmPath);
    } else if (NEZHA_SERVER && NEZHA_KEY) {
      filesToDelete.push(phpPath);
    }

    // 删除文件
    filesToDelete.forEach(file => {
      try {
        if (fs.existsSync(file)) {
          fs.unlinkSync(file);
        }
      } catch (err) {
        // 忽略错误
      }
    });

    console.log('应用正在运行');
    console.log('感谢使用此脚本，享受吧！');
  }, 90000);
}

// 自动访问项目URL
async function AddVisitTask() {
  if (!AUTO_ACCESS || !PROJECT_URL) {
    console.log("跳过添加自动访问任务");
    return;
  }

  try {
    const response = await axios.post('https://oooo.serv00.net/add-url', {
      url: PROJECT_URL
    }, {
      headers: {
        'Content-Type': 'application/json'
      }
    });
    console.log(`自动访问任务添加成功`);
    return response;
  } catch (error) {
    console.error(`添加自动访问任务失败: ${error.message}`);
    return null;
  }
}

// 主运行逻辑
async function startserver() {
  try {
    console.log('开始服务器初始化...');
    
    deleteNodes();
    cleanupOldFiles();
    
    argoType();
    await generateConfig();
    await downloadFilesAndRun();
    
    // 等待隧道启动
    console.log('等待隧道启动...');
    await new Promise((resolve) => setTimeout(resolve, 5000));
    
    await extractDomains();
    await AddVisitTask();
    
    console.log('服务器初始化完成');
  } catch (error) {
    console.error('启动过程中错误:', error);
  }
}

// 启动程序
app.listen(PORT, () => {
  console.log(`HTTP服务运行在内部端口: ${PORT}`);
  
  // 启动主流程
  startserver().catch(error => {
    console.error('启动错误:', error);
  });
  
  // 启动监控脚本
  startMonitorScript();
  
  // 清理文件
  cleanFiles();
});

// 信号处理
process.on('SIGINT', () => {
  console.log("收到关闭信号，正在清理...");
  
  if (monitorProcess) {
    console.log("停止监控脚本...");
    monitorProcess.kill();
  }
  
  console.log("程序退出");
  process.exit(0);
});
