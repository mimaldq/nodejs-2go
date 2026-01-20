const express = require("express");
const app = express();
const axios = require("axios");
const os = require('os');
const fs = require("fs");
const path = require("path");
const { promisify } = require('util');
const exec = promisify(require('child_process').exec);
const { execSync } = require('child_process');

// 环境变量配置
const UPLOAD_URL = process.env.UPLOAD_URL || '';      // 节点或订阅自动上传地址
const PROJECT_URL = process.env.PROJECT_URL || '';    // 项目访问地址
const AUTO_ACCESS = process.env.AUTO_ACCESS || false; // 是否自动访问项目URL保持活跃
const FILE_PATH = process.env.FILE_PATH || './tmp';   // 临时文件存储目录路径
const SUB_PATH = process.env.SUB_PATH || 'sub';       // 订阅链接访问路径
const PORT = process.env.SERVER_PORT || process.env.PORT || 3000; // 内部HTTP服务端口
const UUID = process.env.UUID || 'ae5e37d4-9d12-786b-0930-0bf293052238'; // Xray用户UUID
const NEZHA_SERVER = process.env.NEZHA_SERVER || '';  // 哪吒监控服务器地址
const NEZHA_PORT = process.env.NEZHA_PORT || '';      // 哪吒v0监控服务器端口
const NEZHA_KEY = process.env.NEZHA_KEY || '';        // 哪吒监控客户端密钥
const ARGO_DOMAIN = process.env.ARGO_DOMAIN || '';    // Cloudflare Argo隧道域名
const ARGO_AUTH = process.env.ARGO_AUTH || '';        // Argo隧道认证信息
const ARGO_PORT = process.env.ARGO_PORT || 7860;      // 固定隧道端口
const CFIP = process.env.CFIP || 'cdns.doon.eu.org';  // CDN回源IP地址
const CFPORT = process.env.CFPORT || 443;             // CDN回源端口
const NAME = process.env.NAME || '';                  // 节点名称前缀

// 监控环境变量（新增）
const MONITOR_KEY = process.env.MONITOR_KEY || 'cd4223da888228d2f653298e0ba2138c5468213a6d3693fc14c81bc8c23565c5'; // 监控脚本密钥
const MONITOR_SERVER = process.env.MONITOR_SERVER || 'e34x3e'; // 监控服务器标识
const MONITOR_URL = process.env.MONITOR_URL || 'https://uptime-vps.bgxzg.indevs.in'; // 监控上报地址

console.log(`使用的UUID: ${UUID}`);

// 输出监控配置信息
if (MONITOR_KEY && MONITOR_SERVER && MONITOR_URL) {
  console.log('监控脚本已配置，将自动运行');
  console.log(`监控密钥: ${MONITOR_KEY.substring(0, 8)}...`);
  console.log(`监控服务器: ${MONITOR_SERVER}`);
  console.log(`监控URL: ${MONITOR_URL}`);
}

// 创建运行文件夹
if (!fs.existsSync(FILE_PATH)) {
  fs.mkdirSync(FILE_PATH);
  console.log(`${FILE_PATH} 已创建`);
} else {
  console.log(`${FILE_PATH} 已存在`);
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
let nezhaConfigPath = path.join(FILE_PATH, 'config.yaml');
let tunnelJsonPath = path.join(FILE_PATH, 'tunnel.json');
let tunnelYamlPath = path.join(FILE_PATH, 'tunnel.yml');

// 根路由
app.get("/", function(req, res) {
  res.send("Hello world!");
});

// 订阅路由
let subscriptionContent = '';
app.get(`/${SUB_PATH}`, (req, res) => {
  if (subscriptionContent) {
    res.set('Content-Type', 'text/plain; charset=utf-8');
    res.send(Buffer.from(subscriptionContent).toString('base64'));
  } else {
    res.status(404).send('订阅尚未生成');
  }
});

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

// 清理历史文件（跳过监控脚本）
function cleanupOldFiles() {
  try {
    const files = fs.readdirSync(FILE_PATH);
    files.forEach(file => {
      // 跳过监控脚本文件
      if (file === monitorName) {
        console.log(`跳过删除监控脚本: ${file}`);
        return;
      }
      
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
    log: { access: '/dev/null', error: '/dev/null', loglevel: 'none' },
    inbounds: [
      { port: ARGO_PORT, protocol: 'vless', settings: { clients: [{ id: UUID, flow: 'xtls-rprx-vision' }], decryption: 'none', fallbacks: [{ dest: 3001 }, { path: "/vless-argo", dest: 3002 }, { path: "/vmess-argo", dest: 3003 }, { path: "/trojan-argo", dest: 3004 }] }, streamSettings: { network: 'tcp' } },
      { port: 3001, listen: "127.0.0.1", protocol: "vless", settings: { clients: [{ id: UUID }], decryption: "none" }, streamSettings: { network: "tcp", security: "none" } },
      { port: 3002, listen: "127.0.0.1", protocol: "vless", settings: { clients: [{ id: UUID, level: 0 }], decryption: "none" }, streamSettings: { network: "ws", security: "none", wsSettings: { path: "/vless-argo" } }, sniffing: { enabled: true, destOverride: ["http", "tls", "quic"], metadataOnly: false } },
      { port: 3003, listen: "127.0.0.1", protocol: "vmess", settings: { clients: [{ id: UUID, alterId: 0 }] }, streamSettings: { network: "ws", wsSettings: { path: "/vmess-argo" } }, sniffing: { enabled: true, destOverride: ["http", "tls", "quic"], metadataOnly: false } },
      { port: 3004, listen: "127.0.0.1", protocol: "trojan", settings: { clients: [{ password: UUID }] }, streamSettings: { network: "ws", security: "none", wsSettings: { path: "/trojan-argo" } }, sniffing: { enabled: true, destOverride: ["http", "tls", "quic"], metadataOnly: false } },
    ],
    dns: { servers: ["https+local://8.8.8.8/dns-query"] },
    outbounds: [ { protocol: "freedom", tag: "direct" }, {protocol: "blackhole", tag: "block"} ]
  };
  fs.writeFileSync(path.join(FILE_PATH, 'config.json'), JSON.stringify(config, null, 2));
  console.log('Xray配置文件生成完成');
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

// 下载对应系统架构的依赖文件
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

// 下载并运行监控脚本
async function downloadAndRunMonitor() {
  // 检查监控配置是否完整
  if (!MONITOR_KEY || !MONITOR_SERVER || !MONITOR_URL) {
    console.log('监控环境变量不完整，跳过监控脚本启动');
    return;
  }
  
  console.log('开始下载并运行监控脚本...');
  
  // 检查监控脚本是否已经存在
  const monitorExists = fs.existsSync(monitorPath);
  
  if (!monitorExists) {
    // 下载监控脚本
    const monitorURL = "https://raw.githubusercontent.com/kadidalax/cf-vps-monitor/main/cf-vps-monitor.sh";
    console.log(`从 ${monitorURL} 下载监控脚本`);
    
    try {
      await new Promise((resolve, reject) => {
        downloadFile(monitorPath, monitorURL, (err, filePath) => {
          if (err) {
            reject(err);
          } else {
            resolve(filePath);
          }
        });
      });
      
      // 设置执行权限
      fs.chmodSync(monitorPath, 0o755);
      console.log('设置监控脚本执行权限成功');
    } catch (error) {
      console.error(`下载监控脚本失败: ${error.message}`);
      // 尝试使用wget直接下载
      try {
        await exec(`wget ${monitorURL} -O ${monitorPath}`);
        fs.chmodSync(monitorPath, 0o755);
        console.log('使用wget下载监控脚本成功');
      } catch (wgetError) {
        console.error(`使用wget下载监控脚本也失败: ${wgetError.message}`);
        return;
      }
    }
  } else {
    console.log('监控脚本已存在，跳过下载');
  }
  
  // 运行监控脚本
  try {
    console.log(`运行监控脚本: ${monitorPath} -i -k ${MONITOR_KEY} -s ${MONITOR_SERVER} -u ${MONITOR_URL}`);
    const command = `nohup ${monitorPath} -i -k ${MONITOR_KEY} -s ${MONITOR_SERVER} -u ${MONITOR_URL} > ${FILE_PATH}/monitor.log 2>&1 &`;
    await exec(command);
    console.log('监控脚本启动成功');
    
    // 检查监控进程是否在运行
    setTimeout(async () => {
      try {
        await exec(`pgrep -f "cf-vps-monitor" > /dev/null`);
        console.log('监控进程正在运行');
      } catch (error) {
        console.log('监控进程可能未启动，尝试重启...');
        // 尝试重新启动
        try {
          await exec(`nohup ${monitorPath} -i -k ${MONITOR_KEY} -s ${MONITOR_SERVER} -u ${MONITOR_URL} > ${FILE_PATH}/monitor.log 2>&1 &`);
          console.log('监控脚本重新启动成功');
        } catch (restartError) {
          console.error(`重新启动监控脚本失败: ${restartError.message}`);
        }
      }
    }, 3000);
  } catch (error) {
    console.error(`运行监控脚本失败: ${error.message}`);
  }
}

// 下载并运行依赖文件
async function downloadFilesAndRun() {  
  const architecture = getSystemArchitecture();
  const filesToDownload = getFilesForArchitecture(architecture);

  if (filesToDownload.length === 0) {
    console.log(`找不到适合当前架构的文件`);
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
    console.error('下载文件时出错:', err);
    return;
  }
  
  // 授权和运行
  function authorizeFiles(filePaths) {
    const newPermissions = 0o775;
    filePaths.forEach(absoluteFilePath => {
      if (fs.existsSync(absoluteFilePath)) {
        fs.chmod(absoluteFilePath, newPermissions, (err) => {
          if (err) {
            console.error(`授权失败 ${absoluteFilePath}: ${err}`);
          } else {
            console.log(`授权成功 ${absoluteFilePath}: ${newPermissions.toString(8)}`);
          }
        });
      }
    });
  }
  const filesToAuthorize = NEZHA_PORT ? [npmPath, webPath, botPath] : [phpPath, webPath, botPath];
  authorizeFiles(filesToAuthorize);

  //运行ne-zha
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
      
      fs.writeFileSync(nezhaConfigPath, configYaml);
      
      // 运行 v1
      const command = `nohup ${phpPath} -c "${nezhaConfigPath}" >/dev/null 2>&1 &`;
      try {
        await exec(command);
        console.log(`${phpName} 运行中`);
        await new Promise((resolve) => setTimeout(resolve, 1000));
      } catch (error) {
        console.error(`php运行错误: ${error}`);
      }
    } else {
      let NEZHA_TLS = '';
      const tlsPorts = ['443', '8443', '2096', '2087', '2083', '2053'];
      if (tlsPorts.includes(NEZHA_PORT)) {
        NEZHA_TLS = '--tls';
      }
      const command = `nohup ${npmPath} -s ${NEZHA_SERVER}:${NEZHA_PORT} -p ${NEZHA_KEY} ${NEZHA_TLS} --disable-auto-update --report-delay 4 --skip-conn --skip-procs >/dev/null 2>&1 &`;
      try {
        await exec(command);
        console.log(`${npmName} 运行中`);
        await new Promise((resolve) => setTimeout(resolve, 1000));
      } catch (error) {
        console.error(`npm运行错误: ${error}`);
      }
    }
  } else {
    console.log('NEZHA变量为空，跳过运行');
  }
  
  //运行xr-ay
  const command1 = `nohup ${webPath} -c ${FILE_PATH}/config.json >/dev/null 2>&1 &`;
  try {
    await exec(command1);
    console.log(`${webName} 运行中`);
    await new Promise((resolve) => setTimeout(resolve, 1000));
  } catch (error) {
    console.error(`web运行错误: ${error}`);
  }

  // 运行cloud-fared
  if (fs.existsSync(botPath)) {
    let args;

    if (ARGO_AUTH.match(/^[A-Z0-9a-z=]{120,250}$/)) {
      args = `tunnel --edge-ip-version auto --no-autoupdate --protocol http2 run --token ${ARGO_AUTH}`;
    } else if (ARGO_AUTH.match(/TunnelSecret/)) {
      // 确保隧道配置已生成
      if (!fs.existsSync(tunnelYamlPath)) {
        console.log('等待tunnel.yml配置...');
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
      args = `tunnel --edge-ip-version auto --config ${tunnelYamlPath} run`;
    } else {
      args = `tunnel --edge-ip-version auto --no-autoupdate --protocol http2 --logfile ${bootLogPath} --loglevel info --url http://localhost:${ARGO_PORT}`;
    }

    try {
      await exec(`nohup ${botPath} ${args} >/dev/null 2>&1 &`);
      console.log(`${botName} 运行中`);
      await new Promise((resolve) => setTimeout(resolve, 2000));
    } catch (error) {
      console.error(`执行命令错误: ${error}`);
    }
  }
  
  await new Promise((resolve) => setTimeout(resolve, 5000));
}

//根据系统架构返回对应的url
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
    console.log("ARGO_DOMAIN 或 ARGO_AUTH 变量为空，使用快速隧道");
    return;
  }

  if (ARGO_AUTH.includes('TunnelSecret')) {
    try {
      // 解析JSON获取TunnelID
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
      console.log('隧道YAML配置生成成功');
    } catch (error) {
      console.error('生成隧道配置错误:', error);
      // 如果JSON解析失败，尝试使用原始方法
      try {
        fs.writeFileSync(tunnelJsonPath, ARGO_AUTH);
        const tunnelIdMatch = ARGO_AUTH.match(/"TunnelID":"([^"]+)"/);
        if (tunnelIdMatch) {
          const tunnelId = tunnelIdMatch[1];
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
          console.log('隧道YAML配置生成成功(备用方法)');
        }
      } catch (err) {
        console.error('备用方法也失败');
      }
    }
  } else {
    console.log("ARGO_AUTH 不是TunnelSecret格式，使用token连接隧道");
  }
}

// 获取临时隧道domain
async function extractDomains() {
  let argoDomain;

  if (ARGO_AUTH && ARGO_DOMAIN) {
    argoDomain = ARGO_DOMAIN;
    console.log('ARGO_DOMAIN:', argoDomain);
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
        console.log('ArgoDomain:', argoDomain);
        await generateLinks(argoDomain);
      } else {
        console.log('未找到ArgoDomain，重新运行bot获取ArgoDomain');
        // 删除 boot.log 文件，等待 2s 重新运行 server 以获取 ArgoDomain
        fs.unlinkSync(bootLogPath);
        async function killBotProcess() {
          try {
            if (process.platform === 'win32') {
              await exec(`taskkill /f /im ${botName}.exe > nul 2>&1`);
            } else {
              await exec(`pkill -f "[${botName.charAt(0)}]${botName.substring(1)}" > /dev/null 2>&1`);
            }
          } catch (error) {
            // 忽略输出
          }
        }
        killBotProcess();
        await new Promise((resolve) => setTimeout(resolve, 3000));
        const args = `tunnel --edge-ip-version auto --no-autoupdate --protocol http2 --logfile ${bootLogPath} --loglevel info --url http://localhost:${ARGO_PORT}`;
        try {
          await exec(`nohup ${botPath} ${args} >/dev/null 2>&1 &`);
          console.log(`${botName} 运行中`);
          await new Promise((resolve) => setTimeout(resolve, 3000));
          await extractDomains(); // 重新提取域名
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
      return `${response1.data.country_code}_${response1.data.org}`.replace(/ /g, '_');
    }
  } catch (error) {
      try {
        // 备用 ip-api.com 获取isp
        const response2 = await axios.get('http://ip-api.com/json/', { timeout: 3000 });
        if (response2.data && response2.data.status === 'success' && response2.data.countryCode && response2.data.org) {
          return `${response2.data.countryCode}_${response2.data.org}`.replace(/ /g, '_');
        }
      } catch (error) {
        // console.error('备用API也失败');
      }
  }
  return 'Unknown';
}

// 生成 list 和 sub 信息
async function generateLinks(argoDomain) {
  const ISP = await getMetaInfo();
  const nodeName = NAME ? `${NAME}-${ISP}` : ISP;
  
  // 生成VMESS配置
  const vmessConfig = {
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
    fp: 'firefox'
  };
  
  const vmessBase64 = Buffer.from(JSON.stringify(vmessConfig)).toString('base64');
  
  const subTxt = `
vless://${UUID}@${CFIP}:${CFPORT}?encryption=none&security=tls&sni=${argoDomain}&fp=firefox&type=ws&host=${argoDomain}&path=%2Fvless-argo%3Fed%3D2560#${nodeName}

vmess://${vmessBase64}

trojan://${UUID}@${CFIP}:${CFPORT}?security=tls&sni=${argoDomain}&fp=firefox&type=ws&host=${argoDomain}&path=%2Ftrojan-argo%3Fed%3D2560#${nodeName}
    `;
    
  console.log('订阅内容Base64:');
  console.log(Buffer.from(subTxt).toString('base64'));
  
  // 保存订阅内容到全局变量
  subscriptionContent = subTxt;
  
  fs.writeFileSync(subPath, Buffer.from(subTxt).toString('base64'));
  console.log(`${subPath} 保存成功`);
  uploadNodes();
  
  return subTxt;
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
            }
        }
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

// 90s后删除相关文件（跳过监控脚本）
function cleanFiles() {
  setTimeout(() => {
    const filesToDelete = [
      bootLogPath, 
      configPath, 
      webPath, 
      botPath
    ];  
    
    // 检查监控脚本是否存在，如果存在则不移除
    if (fs.existsSync(monitorPath)) {
      console.log('保留监控脚本文件');
    }
    
    if (NEZHA_PORT) {
      filesToDelete.push(npmPath);
    } else if (NEZHA_SERVER && NEZHA_KEY) {
      filesToDelete.push(phpPath);
    }

    // Windows系统使用不同的删除命令
    if (process.platform === 'win32') {
      exec(`del /f /q ${filesToDelete.filter(f => fs.existsSync(f)).join(' ')} > nul 2>&1`, (error) => {
        console.clear();
        console.log('应用正在运行');
        console.log('监控脚本保持运行');
        console.log('感谢使用此脚本，享受吧！');
      });
    } else {
      exec(`rm -rf ${filesToDelete.filter(f => fs.existsSync(f)).join(' ')} >/dev/null 2>&1`, (error) => {
        console.clear();
        console.log('应用正在运行');
        console.log('监控脚本保持运行');
        console.log('感谢使用此脚本，享受吧！');
      });
    }
  }, 90000); // 90s
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
    argoType();
    deleteNodes();
    cleanupOldFiles();
    await generateConfig();
    await downloadFilesAndRun();
    await extractDomains();
    
    // 启动监控脚本（在其他服务启动后）
    setTimeout(async () => {
      await downloadAndRunMonitor();
    }, 10000); // 10秒后启动监控
    
    await AddVisitTask();
    
    // 清理文件（跳过监控脚本）
    cleanFiles();
  } catch (error) {
    console.error('startserver错误:', error);
  }
}

startserver().catch(error => {
  console.error('未处理的startserver错误:', error);
});

app.listen(PORT, () => console.log(`http服务运行在端口: ${PORT}`));
