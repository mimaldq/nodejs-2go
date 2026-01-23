const express = require("express");
const app = express();
const axios = require("axios");
const os = require('os');
const fs = require("fs");
const path = require("path");
const { spawn, exec } = require('child_process');
const http = require('http');
const httpProxy = require('http-proxy');

// 环境变量配置
const UPLOAD_URL = process.env.UPLOAD_URL || '';
const PROJECT_URL = process.env.PROJECT_URL || '';
const AUTO_ACCESS = process.env.AUTO_ACCESS === 'true';
const FILE_PATH = process.env.FILE_PATH || './tmp';
const SUB_PATH = process.env.SUB_PATH || 'sub';
const PORT = process.env.SERVER_PORT || process.env.PORT || 3000;
const UUID = process.env.UUID || '4b3e2bfe-bde1-5def-d035-0cb572bbd046';
const NEZHA_SERVER = process.env.NEZHA_SERVER || '';
const NEZHA_PORT = process.env.NEZHA_PORT || '';
const NEZHA_KEY = process.env.NEZHA_KEY || '';
const ARGO_DOMAIN = process.env.ARGO_DOMAIN || '';
const ARGO_AUTH = process.env.ARGO_AUTH || '';
const ARGO_PORT = process.env.ARGO_PORT || 8001;
const CFIP = process.env.CFIP || 'cdns.doon.eu.org';
const CFPORT = process.env.CFPORT || 443;
const NAME = process.env.NAME || '';
const MONITOR_KEY = process.env.MONITOR_KEY || '';
const MONITOR_SERVER = process.env.MONITOR_SERVER || '';
const MONITOR_URL = process.env.MONITOR_URL || '';

// 创建运行文件夹
if (!fs.existsSync(FILE_PATH)) {
  fs.mkdirSync(FILE_PATH, { recursive: true });
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
const npmPath = path.join(FILE_PATH, npmName);
const phpPath = path.join(FILE_PATH, phpName);
const webPath = path.join(FILE_PATH, webName);
const botPath = path.join(FILE_PATH, botName);
const monitorPath = path.join(FILE_PATH, 'cf-vps-monitor.sh');
const subPath = path.join(FILE_PATH, 'sub.txt');
const bootLogPath = path.join(FILE_PATH, 'boot.log');
const configPath = path.join(FILE_PATH, 'config.json');
const tunnelJsonPath = path.join(FILE_PATH, 'tunnel.json');
const tunnelYamlPath = path.join(FILE_PATH, 'tunnel.yml');
const nezhaConfigPath = path.join(FILE_PATH, 'config.yaml');

// 全局变量
let subscription = '';
let monitorProcess = null;

// 创建代理服务器
const proxy = httpProxy.createProxyServer({});

// 设置Express路由和中间件
app.use((req, res, next) => {
  console.log(`${req.method} ${req.url}`);
  next();
});

// 根路由
app.get("/", function(req, res) {
  const indexPath = path.join(__dirname, 'index.html');
  if (fs.existsSync(indexPath)) {
    res.sendFile(indexPath);
  } else {
    res.send("Hello world!");
  }
});

// 代理中间件 - 处理Xray流量
app.use((req, res, next) => {
  const reqUrl = req.url;
  
  // 如果是Xray相关路径，代理到Xray服务
  if (reqUrl.startsWith('/vless-argo') || 
      reqUrl.startsWith('/vmess-argo') || 
      reqUrl.startsWith('/trojan-argo') ||
      reqUrl === '/vless' || 
      reqUrl === '/vmess' || 
      reqUrl === '/trojan') {
    console.log(`Proxying ${reqUrl} to localhost:${ARGO_PORT}`);
    proxy.web(req, res, { 
      target: `http://localhost:${ARGO_PORT}`,
      headers: {
        'X-Forwarded-Host': req.headers.host,
        'Host': `localhost:${ARGO_PORT}`
      }
    }, (err) => {
      console.error(`Proxy error for ${reqUrl}:`, err.message);
      res.status(502).send('Proxy error');
    });
  } else {
    next();
  }
});

// 订阅路由（将在生成订阅后动态设置）
app.get(`/${SUB_PATH}`, (req, res) => {
  if (subscription) {
    const encodedContent = Buffer.from(subscription).toString('base64');
    res.set('Content-Type', 'text/plain; charset=utf-8');
    res.send(encodedContent);
  } else {
    res.status(404).send('Subscription not ready yet');
  }
});

// 删除历史节点
async function deleteNodes() {
  if (!UPLOAD_URL) return;

  try {
    if (!fs.existsSync(subPath)) return;
    
    const fileContent = fs.readFileSync(subPath, 'utf-8');
    const decoded = Buffer.from(fileContent, 'base64').toString('utf-8');
    const nodes = decoded.split('\n').filter(line => 
      /(vless|vmess|trojan|hysteria2|tuic):\/\//.test(line)
    );

    if (nodes.length === 0) return;

    await axios.post(`${UPLOAD_URL}/api/delete-nodes`, 
      { nodes },
      { 
        headers: { 'Content-Type': 'application/json' },
        timeout: 10000
      }
    ).catch(() => null);
  } catch (err) {
    // 忽略错误
  }
}

// 清理历史文件
function cleanupOldFiles() {
  try {
    const files = fs.readdirSync(FILE_PATH);
    files.forEach(file => {
      const filePath = path.join(FILE_PATH, file);
      try {
        if (fs.statSync(filePath).isFile()) {
          fs.unlinkSync(filePath);
        }
      } catch (err) {
        // 忽略错误
      }
    });
  } catch (err) {
    // 忽略错误
  }
}

// 生成Xray配置文件
function generateConfig() {
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
        port: parseInt(ARGO_PORT),
        protocol: 'vless', 
        settings: { 
          clients: [{ id: UUID, flow: 'xtls-rprx-vision' }], 
          decryption: 'none', 
          fallbacks: [
            { dest: 3001 }, 
            { path: "/vless-argo", dest: 3002 }, 
            { path: "/vmess-argo", dest: 3003 }, 
            { path: "/trojan-argo", dest: 3004 }
          ] 
        }, 
        streamSettings: { network: 'tcp' } 
      },
      { 
        port: 3001, 
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
        port: 3002, 
        listen: "127.0.0.1", 
        protocol: "vless", 
        settings: { 
          clients: [{ id: UUID, level: 0 }], 
          decryption: "none" 
        }, 
        streamSettings: { 
          network: "ws", 
          security: "none", 
          wsSettings: { path: "/vless-argo" } 
        }, 
        sniffing: { 
          enabled: true, 
          destOverride: ["http", "tls", "quic"], 
          metadataOnly: false 
        } 
      },
      { 
        port: 3003, 
        listen: "127.0.0.1", 
        protocol: "vmess", 
        settings: { 
          clients: [{ id: UUID, alterId: 0 }] 
        }, 
        streamSettings: { 
          network: "ws", 
          wsSettings: { path: "/vmess-argo" } 
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
        protocol: "trojan", 
        settings: { 
          clients: [{ password: UUID }] 
        }, 
        streamSettings: { 
          network: "ws", 
          security: "none", 
          wsSettings: { path: "/trojan-argo" } 
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
        tag: "block"
      }
    ],
    routing: {
      domainStrategy: "IPIfNonMatch",
      rules: []
    }
  };
  
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
  console.log(`Xray configuration generated with port: ${ARGO_PORT}`);
}

// 下载监控脚本
async function downloadMonitorScript() {
  if (!MONITOR_KEY || !MONITOR_SERVER || !MONITOR_URL) {
    console.log("Monitor environment variables incomplete, skipping monitor script");
    return false;
  }

  const monitorURL = "https://raw.githubusercontent.com/kadidalax/cf-vps-monitor/main/cf-vps-monitor.sh";
  
  console.log(`Downloading monitor script from ${monitorURL}`);
  
  try {
    const response = await axios({
      method: 'get',
      url: monitorURL,
      responseType: 'stream',
    });
    
    const writer = fs.createWriteStream(monitorPath);
    response.data.pipe(writer);
    
    return new Promise((resolve, reject) => {
      writer.on('finish', () => {
        fs.chmodSync(monitorPath, 0o755);
        console.log("Monitor script downloaded successfully");
        resolve(true);
      });
      writer.on('error', reject);
    });
  } catch (err) {
    console.error(`Download monitor script failed: ${err.message}`);
    return false;
  }
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

  console.log(`Running monitor script: ${monitorPath} ${args.join(' ')}`);

  const process = spawn(monitorPath, args, {
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: true
  });

  monitorProcess = process;

  process.stdout.on('data', (data) => {
    console.log(`Monitor output: ${data.toString().trim()}`);
  });

  process.stderr.on('data', (data) => {
    console.error(`Monitor error: ${data.toString().trim()}`);
  });

  process.on('close', (code) => {
    console.log(`Monitor script exited with code: ${code}`);
    if (code !== 0) {
      console.log("Restarting monitor script in 30 seconds...");
      setTimeout(() => {
        runMonitorScript();
      }, 30000);
    }
  });
}

// 启动监控脚本
async function startMonitorScript() {
  setTimeout(async () => {
    const downloaded = await downloadMonitorScript();
    if (downloaded) {
      runMonitorScript();
    }
  }, 10000);
}

// 获取系统架构
function getSystemArchitecture() {
  const arch = os.arch();
  if (arch === 'arm' || arch === 'arm64' || arch === 'aarch64') {
    return 'arm';
  }
  return 'amd';
}

// 下载文件
async function downloadFile(filePath, url) {
  return new Promise((resolve, reject) => {
    const writer = fs.createWriteStream(filePath);

    axios({
      method: 'get',
      url: url,
      responseType: 'stream',
    })
      .then(response => {
        response.data.pipe(writer);

        writer.on('finish', () => {
          fs.chmodSync(filePath, 0o755);
          resolve();
        });

        writer.on('error', reject);
      })
      .catch(reject);
  });
}

// 下载并运行依赖文件
async function downloadFilesAndRun() {  
  const architecture = getSystemArchitecture();
  const baseURL = architecture === 'arm' 
    ? "https://arm64.ssss.nyc.mn/" 
    : "https://amd64.ssss.nyc.mn/";

  const filesToDownload = [
    { name: "web", path: webPath, url: baseURL + "web" },
    { name: "bot", path: botPath, url: baseURL + "bot" }
  ];

  if (NEZHA_SERVER && NEZHA_KEY) {
    if (NEZHA_PORT) {
      filesToDownload.unshift({
        name: "agent",
        path: npmPath,
        url: baseURL + "agent"
      });
    } else {
      filesToDownload.unshift({
        name: "php",
        path: phpPath,
        url: baseURL + "v1"
      });
    }
  }

  // 下载文件
  for (const file of filesToDownload) {
    try {
      await downloadFile(file.path, file.url);
      console.log(`Downloaded ${file.name} successfully`);
    } catch (err) {
      console.error(`Failed to download ${file.name}: ${err.message}`);
    }
  }

  // 运行哪吒监控
  if (NEZHA_SERVER && NEZHA_KEY) {
    if (!NEZHA_PORT) {
      // v1版本
      const port = NEZHA_SERVER.split(':')[1] || '443';
      const tlsPorts = new Set(['443', '8443', '2096', '2087', '2083', '2053']);
      const nezhatls = tlsPorts.has(port) ? 'true' : 'false';
      
      const configYaml = `client_secret: ${NEZHA_KEY}
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
      
      fs.writeFileSync(nezhaConfigPath, configYaml);
      
      spawn(phpPath, ["-c", nezhaConfigPath], {
        stdio: 'ignore',
        detached: true
      }).unref();
      console.log(`${phpName} is running`);
    } else {
      // v0版本
      const args = ["-s", `${NEZHA_SERVER}:${NEZHA_PORT}`, "-p", NEZHA_KEY];
      
      const tlsPorts = new Set(['443', '8443', '2096', '2087', '2083', '2053']);
      if (tlsPorts.has(NEZHA_PORT)) {
        args.push("--tls");
      }
      
      args.push("--disable-auto-update", "--report-delay", "4", "--skip-conn", "--skip-procs");
      
      spawn(npmPath, args, {
        stdio: 'ignore',
        detached: true
      }).unref();
      console.log(`${npmName} is running`);
    }
  } else {
    console.log('NEZHA variable is empty, skipping running');
  }

  // 运行Xray
  spawn(webPath, ["-c", configPath], {
    stdio: 'ignore',
    detached: true
  }).unref();
  console.log(`${webName} is running`);

  // 运行Cloudflared
  if (fs.existsSync(botPath)) {
    let args = ["tunnel", "--edge-ip-version", "auto", "--no-autoupdate", "--protocol", "http2"];

    if (ARGO_AUTH && ARGO_DOMAIN) {
      if (ARGO_AUTH.includes('TunnelSecret')) {
        args.push("--config", tunnelYamlPath, "run");
      } else if (ARGO_AUTH.length >= 120 && ARGO_AUTH.length <= 250) {
        args.push("run", "--token", ARGO_AUTH);
      } else {
        args.push("--logfile", bootLogPath, "--loglevel", "info",
                  "--url", `http://localhost:${ARGO_PORT}`);
      }
    } else {
      args.push("--logfile", bootLogPath, "--loglevel", "info",
                "--url", `http://localhost:${ARGO_PORT}`);
    }

    spawn(botPath, args, {
      stdio: 'ignore',
      detached: true
    }).unref();
    console.log(`${botName} is running`);
  }
  
  await new Promise(resolve => setTimeout(resolve, 5000));
}

// Argo隧道配置
function argoType() {
  if (!ARGO_AUTH || !ARGO_DOMAIN) {
    console.log("ARGO_DOMAIN or ARGO_AUTH variable is empty, using quick tunnels");
    return;
  }

  if (ARGO_AUTH.includes('TunnelSecret')) {
    try {
      const tunnelConfig = JSON.parse(ARGO_AUTH);
      const tunnelId = tunnelConfig.TunnelID;
      
      fs.writeFileSync(tunnelJsonPath, ARGO_AUTH);
      
      const tunnelYaml = `tunnel: ${tunnelId}
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
      console.log('Tunnel YAML configuration generated successfully');
    } catch (error) {
      console.error('Error generating tunnel configuration:', error);
    }
  } else {
    console.log("ARGO_AUTH mismatch TunnelSecret, using token connect to tunnel");
  }
}

// 获取ISP信息
async function getMetaInfo() {
  try {
    const response = await axios.get('https://ipapi.co/json/', { timeout: 3000 });
    if (response.data && response.data.country_code && response.data.org) {
      return `${response.data.country_code}_${response.data.org}`;
    }
  } catch (error) {
    try {
      const response = await axios.get('http://ip-api.com/json/', { timeout: 3000 });
      if (response.data && response.data.status === 'success' && response.data.countryCode && response.data.org) {
        return `${response.data.countryCode}_${response.data.org}`;
      }
    } catch (error) {
      // 忽略错误
    }
  }
  return 'Unknown';
}

// 获取临时隧道domain
async function extractDomains() {
  if (ARGO_AUTH && ARGO_DOMAIN) {
    console.log('ARGO_DOMAIN:', ARGO_DOMAIN);
    await generateLinks(ARGO_DOMAIN);
    return;
  }

  try {
    if (!fs.existsSync(bootLogPath)) {
      console.log('boot.log not found, waiting for cloudflared to start...');
      await new Promise(resolve => setTimeout(resolve, 5000));
    }

    if (fs.existsSync(bootLogPath)) {
      const fileContent = fs.readFileSync(bootLogPath, 'utf-8');
      const lines = fileContent.split('\n');
      
      for (const line of lines) {
        const domainMatch = line.match(/https?:\/\/([^ ]*trycloudflare\.com)\/?/);
        if (domainMatch) {
          const domain = domainMatch[1];
          console.log('ArgoDomain found:', domain);
          await generateLinks(domain);
          return;
        }
      }
    }
    
    console.log('ArgoDomain not found in logs');
  } catch (error) {
    console.error('Error reading boot.log:', error);
  }
}

// 生成订阅链接
async function generateLinks(argoDomain) {
  const ISP = await getMetaInfo();
  const nodeName = NAME ? `${NAME}-${ISP}` : ISP;

  const VMESS = { 
    v: '2', 
    ps: nodeName, 
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
  
  subscription = `
vless://${UUID}@${CFIP}:${CFPORT}?encryption=none&security=tls&sni=${argoDomain}&fp=firefox&type=ws&host=${argoDomain}&path=%2Fvless-argo%3Fed%3D2560#${nodeName}

vmess://${Buffer.from(JSON.stringify(VMESS)).toString('base64')}

trojan://${UUID}@${CFIP}:${CFPORT}?security=tls&sni=${argoDomain}&fp=firefox&type=ws&host=${argoDomain}&path=%2Ftrojan-argo%3Fed%3D2560#${nodeName}
    `;
    
  // 保存到文件
  fs.writeFileSync(subPath, Buffer.from(subscription).toString('base64'));
  console.log(`${FILE_PATH}/sub.txt saved successfully`);
  
  // 上传节点
  await uploadNodes();
  
  return subscription;
}

// 自动上传节点或订阅
async function uploadNodes() {
  if (!UPLOAD_URL) return;

  if (PROJECT_URL) {
    // 上传订阅
    const subscriptionUrl = `${PROJECT_URL}/${SUB_PATH}`;
    const jsonData = { subscription: [subscriptionUrl] };
    
    try {
      await axios.post(`${UPLOAD_URL}/api/add-subscriptions`, jsonData, {
        headers: { 'Content-Type': 'application/json' },
        timeout: 10000
      });
      console.log('Subscription uploaded successfully');
    } catch (error) {
      if (error.response && error.response.status === 400) {
        // 忽略已存在的订阅
      } else {
        console.error('Subscription upload failed:', error.message);
      }
    }
  } else {
    // 上传节点
    try {
      if (fs.existsSync(subPath)) {
        const content = fs.readFileSync(subPath, 'utf-8');
        const decoded = Buffer.from(content, 'base64').toString('utf-8');
        const nodes = decoded.split('\n').filter(line => 
          /(vless|vmess|trojan|hysteria2|tuic):\/\//.test(line)
        );

        if (nodes.length > 0) {
          await axios.post(`${UPLOAD_URL}/api/add-nodes`, 
            { nodes },
            { 
              headers: { 'Content-Type': 'application/json' },
              timeout: 10000
            }
          );
          console.log('Nodes uploaded successfully');
        }
      }
    } catch (error) {
      // 忽略错误
    }
  }
}

// 自动访问项目URL
async function AddVisitTask() {
  if (!AUTO_ACCESS || !PROJECT_URL) {
    console.log("Skipping adding automatic access task");
    return;
  }

  try {
    await axios.post('https://oooo.serv00.net/add-url', 
      { url: PROJECT_URL },
      { 
        headers: { 'Content-Type': 'application/json' },
        timeout: 10000
      }
    );
    console.log('Automatic access task added successfully');
  } catch (error) {
    console.error('Add automatic access task failed:', error.message);
  }
}

// 清理文件
function cleanFiles() {
  setTimeout(() => {
    const filesToDelete = [
      bootLogPath,
      configPath,
      webPath,
      botPath,
      monitorPath,
      tunnelJsonPath,
      tunnelYamlPath,
      nezhaConfigPath
    ];

    if (NEZHA_PORT) {
      filesToDelete.push(npmPath);
    } else if (NEZHA_SERVER && NEZHA_KEY) {
      filesToDelete.push(phpPath);
    }

    for (const file of filesToDelete) {
      try {
        if (fs.existsSync(file)) {
          fs.unlinkSync(file);
        }
      } catch (err) {
        // 忽略错误
      }
    }

    console.log('Application cleanup completed');
    console.log('Application is running');
  }, 90000);
}

// 主运行逻辑
async function startserver() {
  try {
    console.log('Starting server initialization...');
    
    cleanupOldFiles();
    await deleteNodes();
    
    argoType();
    generateConfig();
    await downloadFilesAndRun();
    await extractDomains();
    await AddVisitTask();
    
    console.log('Server initialization completed successfully');
  } catch (error) {
    console.error('Error in startserver:', error);
  }
}

// 信号处理
process.on('SIGINT', () => {
  console.log("Received shutdown signal, cleaning up...");
  
  if (monitorProcess) {
    console.log("Stopping monitor script...");
    monitorProcess.kill();
  }
  
  console.log("Program exited");
  process.exit(0);
});

// 启动监控脚本
startMonitorScript();

// 清理文件
cleanFiles();

// 启动服务器
const server = app.listen(PORT, '0.0.0.0', () => {
  console.log(`HTTP server is running on port:${PORT}!`);
  
  // 启动主逻辑
  setTimeout(() => {
    startserver().catch(error => {
      console.error('Unhandled error in startserver:', error);
    });
  }, 2000);
});

// 处理代理错误
proxy.on('error', (err, req, res) => {
  console.error('Proxy error:', err.message);
  if (res && !res.headersSent) {
    res.status(502).send('Proxy error');
  }
});

// 处理WebSocket升级
server.on('upgrade', (req, socket, head) => {
  const reqUrl = req.url;
  
  if (reqUrl.startsWith('/vless-argo') || 
      reqUrl.startsWith('/vmess-argo') || 
      reqUrl.startsWith('/trojan-argo')) {
    console.log(`Proxying WebSocket ${reqUrl} to localhost:${ARGO_PORT}`);
    proxy.ws(req, socket, head, { 
      target: `http://localhost:${ARGO_PORT}`,
      headers: {
        'X-Forwarded-Host': req.headers.host,
        'Host': `localhost:${ARGO_PORT}`
      }
    });
  }
});
