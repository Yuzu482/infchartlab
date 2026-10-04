# INF Chart Lab

In Falsus 曲目浏览、存档分析与谱面预览工具。

在线网站：https://infchartlab.wantiaoyoulinai.chatgpt.site/

## 功能

- 多行多列曲目浏览与 MIN / EVO / ULT / FBD 难度选择。
- 分段多列或单列谱面预览，播放、暂停、定位和流速间距调整。
- 中间四键、左右侧键及带横向坐标的 catch / flick 可视化。
- 浏览器本地分析用户谱面及成绩存档，显示 BPM、音符事件和时间范围。
- 后端公开内置谱面接口，以及按用户隔离的私有谱面存储。

原生音符事件数量不等于判定物量。当前 `Rating` 是游戏内部整数评级，
尚未确认存在 Arcaea 式的小数隐藏定数；详见 [调查记录](docs/difficulty-investigation.md)。

## 本地运行

使用 Node.js 24 LTS 和 npm：

```sh
npm ci
npm test
npm run build
node private-dev-server.mjs --dev-auth --port 18081 --db .private-qa.sqlite
```

打开 http://127.0.0.1:18081/ 。开发服务只监听本机；`--dev-auth` 使用模拟身份，
仅供本地测试，不能用于生产环境。原始自制谱面解析和预览可在本地使用。

## 后端与部署

生产入口为 `server/worker.mjs`，构建结果在 `dist/client` 与 `dist/server`。
数据库结构在 `db/schema.ts`，迁移在 `drizzle/`。部署需要配置 D1 的 `DB`
绑定及可信身份注入；`.openai/hosting.json` 未携带原站点 ID。
生产中不能接受客户端自行声明的用户身份。

公开原版谱面的完整时间线保存在在线站点数据库，未随源码仓库上传。
`server/builtin-manifest.mjs` 仅含校验摘要、版本和尺寸。
因此新部署不会自动拥有原站点的公开谱面库，也不会带有任何用户私有数据。
相关运行密钥 `BUILTIN_CHART_KEY` 和导入令牌 `BUILTIN_CHART_SEED_TOKEN`
必须在托管平台配置，不得写入源码。自行导入前须确认数据使用授权。

浏览器 QA 脚本使用配置的浏览器与 Playwright；安装 npm 依赖不会自动安装浏览器。
部分 Python 工具来自原研究工作区，需要额外的本地探针和合法取得的游戏文件，
不属于上述网站运行步骤，也不会自动下载或附带游戏文件。

## 许可证

项目代码采用 [MIT](LICENSE) 许可证。游戏封面、音符视觉素材及游戏衍生内容
不包含在 MIT 授权中；具体范围见 [第三方版权说明](THIRD_PARTY_NOTICES.md)。
本项目与 lowiro 无隶属关系。

该仓库为在线网站第 27 版的独立源码快照，不包含原工作区 Git 历史、
原版 SPC、原版完整谱面时间线、数据库、个人存档或运行凭据。
